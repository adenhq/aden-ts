/**
 * Global instrumentation for Google Generative AI (Gemini) clients.
 *
 * Call `instrumentGemini()` once at startup, and all Gemini client instances
 * (existing and future) are automatically metered.
 */

import { randomUUID } from "crypto";
import { getCallRelationship, getFullAgentStack } from "./context.js";
import type {
  MetricEvent,
  MeterOptions,
  NormalizedUsage,
  RequestMetadata,
} from "./types.js";

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
 * Normalize Gemini usage to our standard format
 */
function normalizeGeminiUsage(usageMetadata: unknown): NormalizedUsage | null {
  if (!usageMetadata || typeof usageMetadata !== "object") return null;

  const usage = usageMetadata as Record<string, unknown>;

  return {
    input_tokens: (usage.promptTokenCount as number) ?? 0,
    output_tokens: (usage.candidatesTokenCount as number) ?? 0,
    total_tokens: (usage.totalTokenCount as number) ?? 0,
    cached_tokens: (usage.cachedContentTokenCount as number) ?? 0,
    reasoning_tokens: 0, // Gemini doesn't have this concept yet
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Extract model name from Gemini model instance
 */
function extractModelName(model: unknown): string {
  if (!model || typeof model !== "object") return "unknown";
  const m = model as Record<string, unknown>;
  return (m.model as string) ?? (m.modelName as string) ?? "gemini";
}

/**
 * Build request metadata for Gemini
 */
function buildRequestMetadata(
  model: unknown,
  traceId: string
): RequestMetadata {
  const modelName = extractModelName(model);
  return {
    traceId,
    model: modelName,
    stream: false,
  };
}

/**
 * Get relationship data if enabled
 */
function getRelationshipData(
  traceId: string,
  options: MeterOptions
): Partial<MetricEvent> {
  if (options.trackCallRelationships === false) {
    return {};
  }

  const relationship = getCallRelationship(traceId);
  const agentStack = getFullAgentStack();

  return {
    sessionId: relationship.sessionId,
    parentTraceId: relationship.parentTraceId,
    callSequence: relationship.callSequence,
    agentStack: agentStack.length > 0 ? agentStack : undefined,
    callSite: relationship.callSite ?? undefined,
  };
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
    const traceId = options.generateTraceId?.() ?? randomUUID();
    const t0 = Date.now();
    const reqMeta = buildRequestMetadata(model, traceId);
    const relationshipData = getRelationshipData(traceId, options);

    try {
      const result = await originalFn.apply(this, args);

      // Extract usage from response
      const response = result as Record<string, unknown>;
      const usageMetadata = response?.usageMetadata ??
        (response?.response as Record<string, unknown>)?.usageMetadata;

      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null, // Gemini doesn't provide request IDs
        latency_ms: Date.now() - t0,
        usage: normalizeGeminiUsage(usageMetadata),
      };

      await options.emitMetric(event);
      return result;
    } catch (error) {
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await options.emitMetric(event);
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
    const traceId = options.generateTraceId?.() ?? randomUUID();
    const t0 = Date.now();
    const reqMeta: RequestMetadata = {
      ...buildRequestMetadata(model, traceId),
      stream: true,
    };
    const relationshipData = getRelationshipData(traceId, options);

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
              let finalUsage: NormalizedUsage | null = null;
              try {
                const response = await (result as { response?: Promise<unknown> }).response;
                if (response && typeof response === "object") {
                  const resp = response as Record<string, unknown>;
                  finalUsage = normalizeGeminiUsage(resp.usageMetadata);
                }
              } catch {
                // Response promise may have failed
              }

              const event: MetricEvent = {
                ...reqMeta,
                ...relationshipData,
                requestId: null,
                latency_ms: Date.now() - t0,
                usage: finalUsage,
              };

              await options.emitMetric(event);
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
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
      };

      await options.emitMetric(event);
      return result;
    } catch (error) {
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await options.emitMetric(event);
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
    const traceId = options.generateTraceId?.() ?? randomUUID();
    const t0 = Date.now();
    const reqMeta = buildRequestMetadata(model, traceId);
    const relationshipData = getRelationshipData(traceId, options);

    console.log(`[llm-meter] Gemini sendMessage called, model: ${reqMeta.model}`);

    try {
      const result = await originalFn.apply(this, args);

      // Extract usage from response
      const response = result as Record<string, unknown>;
      const usageMetadata = response?.usageMetadata ??
        (response?.response as Record<string, unknown>)?.usageMetadata;

      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: normalizeGeminiUsage(usageMetadata),
      };

      console.log(`[llm-meter] Gemini sendMessage completed, latency: ${event.latency_ms}ms, usage:`, event.usage);
      await options.emitMetric(event);
      return result;
    } catch (error) {
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await options.emitMetric(event);
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
    const traceId = options.generateTraceId?.() ?? randomUUID();
    const t0 = Date.now();
    const reqMeta: RequestMetadata = {
      ...buildRequestMetadata(model, traceId),
      stream: true,
    };
    const relationshipData = getRelationshipData(traceId, options);

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
              let finalUsage: NormalizedUsage | null = null;
              try {
                const response = await (result as { response?: Promise<unknown> }).response;
                if (response && typeof response === "object") {
                  const resp = response as Record<string, unknown>;
                  finalUsage = normalizeGeminiUsage(resp.usageMetadata);
                }
              } catch {
                // Response promise may have failed
              }

              const event: MetricEvent = {
                ...reqMeta,
                ...relationshipData,
                requestId: null,
                latency_ms: Date.now() - t0,
                usage: finalUsage,
              };

              await options.emitMetric(event);
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
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
      };

      await options.emitMetric(event);
      return result;
    } catch (error) {
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: null,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await options.emitMetric(event);
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
    console.log("[llm-meter] Wrapping ChatSession.sendMessage");
    const originalSendMessage = chat.sendMessage.bind(chat);
    chat.sendMessage = wrapSendMessage(
      originalSendMessage as (...args: unknown[]) => Promise<unknown>,
      getOptions,
      getModel
    );
  }

  // Wrap sendMessageStream
  if (chat.sendMessageStream && typeof chat.sendMessageStream === "function") {
    console.log("[llm-meter] Wrapping ChatSession.sendMessageStream");
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
  console.log("[llm-meter] instrumentGemini called");

  if (isInstrumented) {
    console.warn(
      "[llm-meter] Gemini already instrumented. Call uninstrumentGemini() first to re-instrument."
    );
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let GoogleGenerativeAI: any = null;

  // First, check if SDK class was provided via options (preferred for monorepos/file dependencies)
  if (options.sdks?.GoogleGenerativeAI) {
    GoogleGenerativeAI = options.sdks.GoogleGenerativeAI;
    console.log("[llm-meter] Using provided GoogleGenerativeAI class from options.sdks");
  } else {
    // Fall back to dynamic import (works when there's only one copy of the SDK)
    try {
      const geminiModule = await import("@google/generative-ai");
      console.log("[llm-meter] Gemini SDK loaded via import, module keys:", Object.keys(geminiModule));
      GoogleGenerativeAI = geminiModule.GoogleGenerativeAI;
    } catch (err) {
      console.log("[llm-meter] Failed to load Gemini SDK:", err);
      // SDK not installed
      return false;
    }
  }

  console.log("[llm-meter] GoogleGenerativeAI constructor:", GoogleGenerativeAI ? "found" : "not found");
  if (GoogleGenerativeAI?.prototype) {
    console.log("[llm-meter] GoogleGenerativeAI.prototype methods:", Object.getOwnPropertyNames(GoogleGenerativeAI.prototype));
  }

  if (!GoogleGenerativeAI) {
    console.log("[llm-meter] GoogleGenerativeAI is null/undefined");
    return false;
  }

  globalOptions = options;

  // Add a marker to verify we're patching the right prototype
  (GoogleGenerativeAI.prototype as Record<string, unknown>).__llmMeterInstrumented = true;
  console.log("[llm-meter] Added instrumentation marker to GoogleGenerativeAI.prototype");

  // Gemini's architecture: GoogleGenerativeAI -> getGenerativeModel() -> GenerativeModel
  // We need to wrap the GenerativeModel's methods
  // The cleanest way is to wrap getGenerativeModel to wrap the returned model

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  originalGetGenerativeModel = GoogleGenerativeAI.prototype.getGenerativeModel as any;
  console.log("[llm-meter] Original getGenerativeModel:", typeof originalGetGenerativeModel);

  if (originalGetGenerativeModel) {
    console.log("[llm-meter] Patching GoogleGenerativeAI.prototype.getGenerativeModel");
    GoogleGenerativeAI.prototype.getGenerativeModel = function (
      this: unknown,
      ...args: unknown[]
    ) {
      console.log("[llm-meter] >>> getGenerativeModel called!");
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
          console.log("[llm-meter] Gemini startChat called");
          const chat = boundStartChat(...args) as Record<string, unknown>;
          return wrapChatSession(chat, () => globalOptions!, () => model);
        };
      }

      console.log(`[llm-meter] Gemini model wrapped: ${extractModelName(model)}`);
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
