/**
 * Global instrumentation for Google Generative AI (Gemini) clients.
 *
 * Call `instrumentGemini()` once at startup, and all Gemini client instances
 * (existing and future) are automatically metered.
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalGenerateContent: ((...args: unknown[]) => Promise<unknown>) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalGenerateContentStream: ((...args: unknown[]) => Promise<unknown>) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalGetGenerativeModel: ((...args: unknown[]) => unknown) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalStartChat: ((...args: unknown[]) => unknown) | null = null;

/**
 * Extract model name from Gemini model instance
 */
function extractModelName(model: unknown): string {
  if (!model || typeof model !== "object") return "unknown";
  const m = model as Record<string, unknown>;
  return (m.model as string) ?? (m.modelName as string) ?? "gemini";
}

/**
 * Build a flat MetricEvent for Gemini (OTel-compatible)
 */
function buildFlatEvent(
  spanId: string,
  model: unknown,
  stream: boolean,
  latencyMs: number,
  usageMetadata: unknown,
  meterOptions: MeterOptions,
  error?: string
): MetricEvent {
  // Get relationship data first to get trace_id
  const relationship = meterOptions.trackCallRelationships !== false
    ? getCallRelationship(spanId)
    : null;

  // Extract usage from Gemini format
  const usage = usageMetadata as Record<string, unknown> | null;
  const inputTokens = (usage?.promptTokenCount as number) ?? 0;
  const outputTokens = (usage?.candidatesTokenCount as number) ?? 0;
  const totalTokens = (usage?.totalTokenCount as number) ?? 0;
  const cachedTokens = (usage?.cachedContentTokenCount as number) ?? 0;

  // Build base event
  const event: MetricEvent = {
    trace_id: relationship?.traceId ?? spanId, // Use trace from context, fallback to spanId
    span_id: spanId,
    request_id: null, // Gemini doesn't provide request IDs
    provider: "gemini",
    model: extractModelName(model),
    stream,
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_tokens: cachedTokens,
    reasoning_tokens: 0, // Gemini doesn't have this concept yet
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
  spanId: string,
  meterOptions: MeterOptions
): Promise<void> {
  if (!meterOptions.beforeRequest) {
    return;
  }

  const context: BeforeRequestContext = {
    model: modelName,
    stream: false,
    spanId,
    traceId: spanId,
    timestamp: new Date(),
    metadata: meterOptions.requestMetadata,
  };

  // For Gemini, we pass an empty params object since the model is not in params
  const result: BeforeRequestResult = await meterOptions.beforeRequest({ model: modelName }, context);

  if (result.action === "cancel") {
    throw new RequestCancelledError(result.reason, context);
  }

  if (result.action === "throttle") {
    await sleep(result.delayMs);
  }

  // Note: "degrade" action is not directly applicable for Gemini since
  // the model is set on the GenerativeModel instance, not per-request

  // "alert" action allows request to proceed - the alert was already triggered
  // (handled by not throwing or returning early)
}

/**
 * Create wrapper for generateContent method
 */
function wrapGenerateContent(
  originalFn: (...args: unknown[]) => Promise<unknown>,
  getOptions: () => MeterOptions,
  getModel: () => unknown
) {
  return async function (
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const options = getOptions();
    const model = getModel();
    const modelName = extractModelName(model);
    const spanId = options.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    try {
      // Execute beforeRequest hook (may throttle or cancel)
      await executeBeforeRequestHook(modelName, spanId, options);

      const result = await originalFn.apply(this, args);

      // Extract usage from response
      const response = result as Record<string, unknown>;
      const usageMetadata = response?.usageMetadata ??
        (response?.response as Record<string, unknown>)?.usageMetadata;

      const event = buildFlatEvent(spanId, model, false, Date.now() - t0, usageMetadata, options);
      await safeEmit(options, event);
      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId, model, false, Date.now() - t0, null, options,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(options, event);
      throw error;
    }
  };
}

/**
 * Create wrapper for generateContentStream method
 *
 * The result object has:
 * - stream: AsyncGenerator<EnhancedGenerateContentResponse> - to iterate chunks
 * - response: Promise<EnhancedGenerateContentResponse> - final aggregated response
 *
 * Callers use: for await (const chunk of result.stream) { ... }
 * So we need to wrap result.stream, not the result object itself.
 */
function wrapGenerateContentStream(
  originalFn: (...args: unknown[]) => Promise<unknown>,
  getOptions: () => MeterOptions,
  getModel: () => unknown
) {
  return async function (
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const options = getOptions();
    const model = getModel();
    const modelName = extractModelName(model);
    const spanId = options.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    try {
      // Execute beforeRequest hook (may throttle or cancel)
      await executeBeforeRequestHook(modelName, spanId, options);

      const streamResult = await originalFn.apply(this, args);
      const result = streamResult as Record<string, unknown>;

      // The stream result has a 'stream' AsyncGenerator and a 'response' Promise
      const originalStream = result.stream as AsyncIterable<unknown>;

      if (originalStream && Symbol.asyncIterator in originalStream) {
        let metricsEmitted = false;

        // Create a wrapped stream generator that emits metrics after completion
        async function* wrappedStreamGenerator() {
          try {
            for await (const chunk of originalStream) {
              yield chunk;
            }
          } finally {
            // Emit metrics when stream completes (either normally or via break/return)
            if (!metricsEmitted) {
              metricsEmitted = true;

              // Get usage from the response promise
              let usageMetadata: unknown = null;
              try {
                const response = await (result as { response?: Promise<unknown> }).response;
                if (response && typeof response === "object") {
                  usageMetadata = (response as Record<string, unknown>).usageMetadata;
                }
              } catch {
                // Response promise may have failed
              }

              const event = buildFlatEvent(spanId, model, true, Date.now() - t0, usageMetadata, options);
              await safeEmit(options, event);
            }
          }
        }

        // Return the result with the wrapped stream
        return {
          ...result,
          stream: wrappedStreamGenerator(),
        };
      }

      // Fallback: emit metrics immediately if not a proper stream
      const event = buildFlatEvent(spanId, model, true, Date.now() - t0, null, options);
      await safeEmit(options, event);
      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId, model, true, Date.now() - t0, null, options,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(options, event);
      throw error;
    }
  };
}

/**
 * Create wrapper for chat.sendMessage method
 */
function wrapSendMessage(
  originalFn: (...args: unknown[]) => Promise<unknown>,
  getOptions: () => MeterOptions,
  getModel: () => unknown
) {
  return async function (
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const options = getOptions();
    const model = getModel();
    const spanId = options.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    try {
      const result = await originalFn.apply(this, args);

      // Extract usage from response
      const response = result as Record<string, unknown>;
      const usageMetadata = response?.usageMetadata ??
        (response?.response as Record<string, unknown>)?.usageMetadata;

      const event = buildFlatEvent(spanId, model, false, Date.now() - t0, usageMetadata, options);
      await safeEmit(options, event);
      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId, model, false, Date.now() - t0, null, options,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(options, event);
      throw error;
    }
  };
}

/**
 * Create wrapper for chat.sendMessageStream method
 *
 * The result object has:
 * - stream: AsyncGenerator<EnhancedGenerateContentResponse> - to iterate chunks
 * - response: Promise<EnhancedGenerateContentResponse> - final aggregated response
 *
 * Callers use: for await (const chunk of result.stream) { ... }
 * So we need to wrap result.stream, not the result object itself.
 */
function wrapSendMessageStream(
  originalFn: (...args: unknown[]) => Promise<unknown>,
  getOptions: () => MeterOptions,
  getModel: () => unknown
) {
  return async function (
    this: unknown,
    ...args: unknown[]
  ): Promise<unknown> {
    const options = getOptions();
    const model = getModel();
    const spanId = options.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    try {
      const streamResult = await originalFn.apply(this, args);
      const result = streamResult as Record<string, unknown>;

      // The stream result has a 'stream' AsyncGenerator and a 'response' Promise
      const originalStream = result.stream as AsyncIterable<unknown>;

      if (originalStream && Symbol.asyncIterator in originalStream) {
        let metricsEmitted = false;

        // Create a wrapped stream generator that emits metrics after completion
        async function* wrappedStreamGenerator() {
          try {
            for await (const chunk of originalStream) {
              yield chunk;
            }
          } finally {
            // Emit metrics when stream completes (either normally or via break/return)
            if (!metricsEmitted) {
              metricsEmitted = true;

              // Get usage from the response promise
              let usageMetadata: unknown = null;
              try {
                const response = await (result as { response?: Promise<unknown> }).response;
                if (response && typeof response === "object") {
                  usageMetadata = (response as Record<string, unknown>).usageMetadata;
                }
              } catch {
                // Response promise may have failed
              }

              const event = buildFlatEvent(spanId, model, true, Date.now() - t0, usageMetadata, options);
              await safeEmit(options, event);
            }
          }
        }

        // Return the result with the wrapped stream
        return {
          ...result,
          stream: wrappedStreamGenerator(),
        };
      }

      // Fallback: emit metrics immediately
      const event = buildFlatEvent(spanId, model, true, Date.now() - t0, null, options);
      await safeEmit(options, event);
      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId, model, true, Date.now() - t0, null, options,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(options, event);
      throw error;
    }
  };
}

/**
 * Wrap a ChatSession to instrument sendMessage and sendMessageStream
 */
function wrapChatSession(
  chat: Record<string, unknown>,
  getOptions: () => MeterOptions,
  getModel: () => unknown
): Record<string, unknown> {
  // Wrap sendMessage
  if (chat.sendMessage && typeof chat.sendMessage === "function") {
    const originalSendMessage = chat.sendMessage.bind(chat);
    chat.sendMessage = wrapSendMessage(
      originalSendMessage as (...args: unknown[]) => Promise<unknown>,
      getOptions,
      getModel
    );
  }

  // Wrap sendMessageStream
  if (chat.sendMessageStream && typeof chat.sendMessageStream === "function") {
    const originalSendMessageStream = chat.sendMessageStream.bind(chat);
    chat.sendMessageStream = wrapSendMessageStream(
      originalSendMessageStream as (...args: unknown[]) => Promise<unknown>,
      getOptions,
      getModel
    );
  }

  return chat;
}

/**
 * Instrument Google Generative AI (Gemini) globally.
 *
 * Call once at application startup. All Gemini GenerativeModel instances
 * will automatically be metered.
 *
 * @returns true if instrumentation was successful, false if SDK not found
 */
export async function instrumentGemini(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn(
      "[aden] Gemini already instrumented. Call uninstrumentGemini() first to re-instrument."
    );
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GoogleGenerativeAI: any = null;

  // First, check if SDK class was provided via options (preferred for monorepos/file dependencies)
  if (options.sdks?.GoogleGenerativeAI) {
    GoogleGenerativeAI = options.sdks.GoogleGenerativeAI;
  } else {
    // Fall back to dynamic import (works when there's only one copy of the SDK)
    try {
      const geminiModule = await import("@google/generative-ai");
      GoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
    } catch {
      // SDK not installed
      return false;
    }
  }

  if (!GoogleGenerativeAI) {
    return false;
  }

  globalOptions = options;

  // Gemini's architecture: GoogleGenerativeAI -> getGenerativeModel() -> GenerativeModel
  // We need to wrap the GenerativeModel's methods
  // The cleanest way is to wrap getGenerativeModel to wrap the returned model

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel as any;

  if (originalGetGenerativeModel) {
    GoogleGenerativeAI.prototype.getGenerativeModel = function (
      this: unknown,
      ...args: unknown[]
    ) {
      const model = (originalGetGenerativeModel as Function).apply(this, args) as Record<string, unknown>;

      // Store original methods if not already wrapped
      if (!originalGenerateContent && model.generateContent) {
        originalGenerateContent = model.generateContent as (...args: unknown[]) => Promise<unknown>;
      }
      if (!originalGenerateContentStream && model.generateContentStream) {
        originalGenerateContentStream = model.generateContentStream as (...args: unknown[]) => Promise<unknown>;
      }

      // Wrap generateContent
      if (model.generateContent && originalGenerateContent) {
        model.generateContent = wrapGenerateContent(
          originalGenerateContent,
          () => globalOptions!,
          () => model
        );
      }

      // Wrap generateContentStream
      if (model.generateContentStream && originalGenerateContentStream) {
        model.generateContentStream = wrapGenerateContentStream(
          originalGenerateContentStream,
          () => globalOptions!,
          () => model
        );
      }

      // Wrap startChat to instrument chat sessions
      if (model.startChat && typeof model.startChat === "function") {
        if (!originalStartChat) {
          originalStartChat = model.startChat as (...args: unknown[]) => unknown;
        }
        const boundStartChat = (model.startChat as Function).bind(model);
        model.startChat = function (...args: unknown[]) {
          const chat = boundStartChat(...args) as Record<string, unknown>;
          return wrapChatSession(chat, () => globalOptions!, () => model);
        };
      }

      return model;
    };
  }

  isInstrumented = true;
  return true;
}

/**
 * Remove Gemini instrumentation.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrumentGemini(): Promise<void> {
  if (!isInstrumented) {
    return;
  }

  // Note: Since we wrap models at creation time, we can't easily unwrap
  // existing models. New models created after uninstrument will be unwrapped.

  try {
    const geminiModule = await import("@google/generative-ai");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const GoogleGenerativeAI = geminiModule.GoogleGenerativeAI as any;

    // Restore original getGenerativeModel
    if (originalGetGenerativeModel && GoogleGenerativeAI?.prototype) {
      GoogleGenerativeAI.prototype.getGenerativeModel = originalGetGenerativeModel;
    }
  } catch {
    // SDK not installed, nothing to do
  }

  globalOptions = null;
  isInstrumented = false;
  originalGenerateContent = null;
  originalGenerateContentStream = null;
  originalGetGenerativeModel = null;
  originalStartChat = null;
}

/**
 * Check if Gemini is currently instrumented
 */
export function isGeminiInstrumented(): boolean {
  return isInstrumented;
}
