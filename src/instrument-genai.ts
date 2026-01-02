/**
 * Google GenAI SDK instrumentation (new SDK).
 *
 * This module provides global instrumentation for the new Google GenAI SDK
 * (@google/genai package) used by Google ADK and other modern Google AI tools.
 *
 * The new SDK uses:
 *     import { GoogleGenAI } from "@google/genai";
 *     const client = new GoogleGenAI({ apiKey: "..." });
 *     await client.models.generateContent({ model: "...", contents: "..." });
 */

import { randomUUID } from "crypto";
import { getCallRelationship, getFullAgentStack } from "./context.js";
import type { MetricEvent, MeterOptions, BeforeRequestContext, BeforeRequestResult } from "./types.js";
import { RequestCancelledError } from "./types.js";

/**
 * Safely emit a metric event, handling cases where emitMetric might be undefined
 */
async function safeEmit(options: MeterOptions, event: MetricEvent): Promise<void> {
  if (options.emitMetric) {
    await options.emitMetric(event);
  }
}

// Track if we've already instrumented
let isInstrumented = false;
let globalOptions: MeterOptions | null = null;

// Store original methods for uninstrumentation
let originalGenerateContent: ((...args: unknown[]) => Promise<unknown>) | null = null;
let originalGenerateContentStream: ((...args: unknown[]) => Promise<unknown>) | null = null;

/**
 * Normalize usage metadata from google-genai response
 */
function normalizeGenaiUsage(usage: unknown): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens: number;
} | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const u = usage as Record<string, unknown>;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  // Handle both naming conventions
  if ("prompt_token_count" in u) {
    inputTokens = (u.prompt_token_count as number) ?? 0;
  } else if ("promptTokenCount" in u) {
    inputTokens = (u.promptTokenCount as number) ?? 0;
  } else if ("input_tokens" in u) {
    inputTokens = (u.input_tokens as number) ?? 0;
  }

  if ("candidates_token_count" in u) {
    outputTokens = (u.candidates_token_count as number) ?? 0;
  } else if ("candidatesTokenCount" in u) {
    outputTokens = (u.candidatesTokenCount as number) ?? 0;
  } else if ("output_tokens" in u) {
    outputTokens = (u.output_tokens as number) ?? 0;
  }

  if ("cached_content_token_count" in u) {
    cachedTokens = (u.cached_content_token_count as number) ?? 0;
  } else if ("cachedContentTokenCount" in u) {
    cachedTokens = (u.cachedContentTokenCount as number) ?? 0;
  }

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cached_tokens: cachedTokens,
  };
}

/**
 * Extract model name from kwargs
 */
function extractModelFromKwargs(kwargs: Record<string, unknown>): string {
  const model = kwargs.model;
  if (!model) return "unknown";
  if (typeof model === "string") return model;
  if (typeof model === "object" && model !== null && "name" in model) {
    return String((model as { name: unknown }).name);
  }
  return String(model);
}

/**
 * Extract usage from a genai response
 */
function extractUsageFromResponse(response: unknown): ReturnType<typeof normalizeGenaiUsage> {
  if (!response || typeof response !== "object") {
    return null;
  }

  const r = response as Record<string, unknown>;

  // Try usage_metadata first (standard location)
  if (r.usage_metadata) {
    return normalizeGenaiUsage(r.usage_metadata);
  }
  if (r.usageMetadata) {
    return normalizeGenaiUsage(r.usageMetadata);
  }

  // Try direct usage attribute
  if (r.usage) {
    return normalizeGenaiUsage(r.usage);
  }

  return null;
}

/**
 * Build a flat MetricEvent for GenAI (OTel-compatible)
 */
function buildMetricEvent(
  traceId: string,
  spanId: string,
  model: string,
  stream: boolean,
  latencyMs: number,
  usage: ReturnType<typeof normalizeGenaiUsage>,
  meterOptions: MeterOptions,
  error?: string
): MetricEvent {
  // Get relationship data
  const relationship = meterOptions.trackCallRelationships !== false
    ? getCallRelationship(spanId)
    : null;

  // Build base event
  const event: MetricEvent = {
    trace_id: relationship?.traceId ?? traceId,
    span_id: spanId,
    request_id: null,
    provider: "gemini",
    model,
    stream,
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    cached_tokens: usage?.cached_tokens ?? 0,
    reasoning_tokens: 0,
  };

  // Add error if present
  if (error) {
    event.error = error;
  }

  // Add relationship data if enabled
  if (relationship) {
    const agentStack = getFullAgentStack();

    if (relationship.parentSpanId) {
      event.parent_span_id = relationship.parentSpanId;
    }
    if (relationship.callSequence !== undefined) {
      event.call_sequence = relationship.callSequence;
    }
    if (agentStack.length > 0) {
      event.agent_stack = agentStack;
    }
    if (relationship.callSite) {
      event.call_site_file = relationship.callSite.file;
      event.call_site_line = relationship.callSite.line;
      event.call_site_column = relationship.callSite.column;
      if (relationship.callSite.function) {
        event.call_site_function = relationship.callSite.function;
      }
    }
    if (relationship.callStack && relationship.callStack.length > 0) {
      event.call_stack = relationship.callStack;
    }
  }

  return event;
}

/**
 * Sleep helper for throttling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute beforeRequest hook and handle actions
 */
async function executeBeforeRequestHook(
  modelName: string,
  stream: boolean,
  spanId: string,
  traceId: string,
  meterOptions: MeterOptions,
  kwargs: Record<string, unknown>
): Promise<{ model: string }> {
  let currentModel = modelName;

  if (!meterOptions.beforeRequest) {
    return { model: currentModel };
  }

  const context: BeforeRequestContext = {
    model: modelName,
    stream,
    spanId,
    traceId,
    timestamp: new Date(),
    metadata: meterOptions.requestMetadata,
  };

  const result: BeforeRequestResult = await meterOptions.beforeRequest(kwargs, context);

  if (result.action === "cancel") {
    throw new RequestCancelledError(result.reason, context);
  }

  if (result.action === "degrade" && result.toModel) {
    currentModel = result.toModel;
    kwargs.model = result.toModel;
    if (result.delayMs) {
      await sleep(result.delayMs);
    }
  }

  if (result.action === "throttle") {
    await sleep(result.delayMs);
  }

  if (result.action === "alert" && result.delayMs) {
    await sleep(result.delayMs);
  }

  return { model: currentModel };
}

/**
 * Create sync wrapper for generateContent method
 */
function createSyncWrapper(
  originalFn: (...args: unknown[]) => Promise<unknown>,
  getOptions: () => MeterOptions | null,
  isStream: boolean = false
): (...args: unknown[]) => Promise<unknown> {
  return async function (this: unknown, ...args: unknown[]): Promise<unknown> {
    const options = getOptions();
    if (!options) {
      return originalFn.apply(this, args);
    }

    // Extract kwargs (first argument is typically the options object)
    const kwargs = (args[0] as Record<string, unknown>) ?? {};

    // Use spanId for both trace and span (trace will be overridden if context tracking provides one)
    const spanId = options.generateSpanId?.() ?? randomUUID();
    const traceId = spanId; // Will be replaced by context tracking if available
    const t0 = Date.now();

    let model = extractModelFromKwargs(kwargs);

    try {
      // Execute beforeRequest hook (may throttle, cancel, or degrade)
      const hookResult = await executeBeforeRequestHook(model, isStream, spanId, traceId, options, kwargs);
      model = hookResult.model;

      const response = await originalFn.apply(this, args);

      // For streaming, wrap the iterator
      if (isStream && response && typeof response === "object") {
        const r = response as Record<string, unknown>;
        // Check if response is async iterable
        if (Symbol.asyncIterator in r) {
          return createMeteredStream(r as unknown as AsyncIterable<unknown>, traceId, spanId, model, t0, options);
        }
      }

      // Non-streaming: emit metric immediately
      const usage = extractUsageFromResponse(response);
      const event = buildMetricEvent(traceId, spanId, model, isStream, Date.now() - t0, usage, options);
      await safeEmit(options, event);

      return response;
    } catch (error) {
      if (error instanceof RequestCancelledError) {
        throw error;
      }

      const event = buildMetricEvent(
        traceId, spanId, model, isStream, Date.now() - t0, null, options,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(options, event);
      throw error;
    }
  };
}

/**
 * Create a metered stream wrapper
 */
function createMeteredStream(
  originalStream: AsyncIterable<unknown>,
  traceId: string,
  spanId: string,
  model: string,
  t0: number,
  options: MeterOptions
): AsyncIterable<unknown> {
  let finalUsage: ReturnType<typeof normalizeGenaiUsage> = null;
  let metricsEmitted = false;
  let error: string | undefined;

  async function* meteredGenerator() {
    try {
      for await (const chunk of originalStream) {
        // Try to extract usage from chunk
        const chunkUsage = extractUsageFromResponse(chunk);
        if (chunkUsage) {
          finalUsage = chunkUsage;
        }
        yield chunk;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      if (!metricsEmitted) {
        metricsEmitted = true;
        const event = buildMetricEvent(
          traceId, spanId, model, true, Date.now() - t0, finalUsage, options, error
        );
        await safeEmit(options, event);
      }
    }
  }

  return {
    [Symbol.asyncIterator]: () => meteredGenerator(),
  };
}

/**
 * Instrument the Google GenAI SDK (google-genai package).
 *
 * This is the new SDK used by Google ADK and replaces google-generativeai.
 *
 * @param options - Metering options including the metric emitter
 * @returns true if instrumentation succeeded, false if SDK not available
 */
export async function instrumentGenai(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn(
      "[aden] Google GenAI already instrumented. Call uninstrumentGenai() first to re-instrument."
    );
    return true;
  }

  // Try to import the @google/genai package
  // This package may not be installed, so we catch import errors
  let genaiModule: Record<string, unknown>;
  try {
    // @ts-ignore - optional dependency
    genaiModule = await import("@google/genai");
  } catch {
    console.debug("[aden] Google GenAI SDK (@google/genai) not available, skipping");
    return false;
  }

  globalOptions = options;

  const getOptions = () => globalOptions;

  try {
    // The new SDK structure: Client.models.generateContent() / generateContentStream()
    // We need to find and wrap the Models class methods

    // Look for the Models class prototype
    const Models = (genaiModule as { Models?: { prototype?: unknown } }).Models;

    if (Models?.prototype) {
      const proto = Models.prototype as Record<string, unknown>;

      // Store and wrap generateContent
      if (proto.generateContent && typeof proto.generateContent === "function") {
        originalGenerateContent = proto.generateContent as (...args: unknown[]) => Promise<unknown>;
        proto.generateContent = createSyncWrapper(originalGenerateContent, getOptions, false);
      }

      // Store and wrap generateContentStream
      if (proto.generateContentStream && typeof proto.generateContentStream === "function") {
        originalGenerateContentStream = proto.generateContentStream as (...args: unknown[]) => Promise<unknown>;
        proto.generateContentStream = createSyncWrapper(originalGenerateContentStream, getOptions, true);
      }
    }

    // Also try to wrap on the client instance level
    // Some SDKs expose methods differently
    const Client = (genaiModule as { GoogleGenAI?: { prototype?: unknown }; Client?: { prototype?: unknown } })
      .GoogleGenAI ?? (genaiModule as { Client?: { prototype?: unknown } }).Client;

    if (Client?.prototype) {
      const proto = Client.prototype as Record<string, unknown>;

      // Check if models is a getter that returns a Models instance
      const modelsDescriptor = Object.getOwnPropertyDescriptor(proto, "models");
      if (modelsDescriptor?.get) {
        const originalGetter = modelsDescriptor.get;
        Object.defineProperty(proto, "models", {
          get: function () {
            const models = originalGetter.call(this) as Record<string, unknown>;

            // Wrap methods on the models instance if not already wrapped
            if (models.generateContent && typeof models.generateContent === "function") {
              const original = models.generateContent as (...args: unknown[]) => Promise<unknown>;
              if (!originalGenerateContent) {
                originalGenerateContent = original;
              }
              models.generateContent = createSyncWrapper(original, getOptions, false);
            }

            if (models.generateContentStream && typeof models.generateContentStream === "function") {
              const original = models.generateContentStream as (...args: unknown[]) => Promise<unknown>;
              if (!originalGenerateContentStream) {
                originalGenerateContentStream = original;
              }
              models.generateContentStream = createSyncWrapper(original, getOptions, true);
            }

            return models;
          },
          configurable: true,
        });
      }
    }

    isInstrumented = true;
    console.log("[aden] Google GenAI SDK (google-genai) instrumented");
    return true;
  } catch (error) {
    console.warn(`[aden] Failed to instrument Google GenAI SDK: ${error}`);
    return false;
  }
}

/**
 * Remove Google GenAI SDK instrumentation.
 */
export async function uninstrumentGenai(): Promise<void> {
  if (!isInstrumented) {
    return;
  }

  try {
    let genaiModule: Record<string, unknown>;
    try {
      // @ts-ignore - optional dependency
      genaiModule = await import("@google/genai");
    } catch {
      // SDK not installed
      isInstrumented = false;
      globalOptions = null;
      return;
    }

    const Models = (genaiModule as { Models?: { prototype?: unknown } }).Models;

    if (Models?.prototype) {
      const proto = Models.prototype as Record<string, unknown>;

      if (originalGenerateContent) {
        proto.generateContent = originalGenerateContent;
      }
      if (originalGenerateContentStream) {
        proto.generateContentStream = originalGenerateContentStream;
      }
    }
  } catch {
    // Ignore errors during uninstrumentation
  }

  isInstrumented = false;
  globalOptions = null;
  originalGenerateContent = null;
  originalGenerateContentStream = null;

  console.log("[aden] Google GenAI SDK uninstrumented");
}

/**
 * Check if Google GenAI SDK is currently instrumented.
 */
export function isGenaiInstrumented(): boolean {
  return isInstrumented;
}

/**
 * Get current GenAI instrumentation options.
 */
export function getGenaiOptions(): MeterOptions | null {
  return globalOptions;
}
