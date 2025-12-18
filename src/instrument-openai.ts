/**
 * OpenAI SDK instrumentation.
 *
 * Call `instrumentOpenAI()` to instrument the OpenAI SDK.
 * This is called automatically by the main `instrument()` function.
 */

import { randomUUID } from "crypto";
import { normalizeUsage } from "./normalize.js";
import { getCallRelationship, getFullAgentStack } from "./context.js";
import type {
  MetricEvent,
  MeterOptions,
  NormalizedUsage,
  RequestMetadata,
  ToolCallMetric,
} from "./types.js";

// Track if we've already instrumented
let isInstrumented = false;
let globalOptions: MeterOptions | null = null;

// Store original methods for uninstrumentation
let originalResponsesCreate: ((...args: unknown[]) => unknown) | null = null;
let originalChatCreate: ((...args: unknown[]) => unknown) | null = null;

/**
 * Extract request ID from response
 */
function extractRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const res = response as Record<string, unknown>;
  return (res.request_id ?? res.requestId ?? null) as string | null;
}

/**
 * Extract tool calls from response
 */
function extractToolCalls(response: unknown): ToolCallMetric[] {
  if (!response || typeof response !== "object") return [];

  const res = response as Record<string, unknown>;
  const toolCalls: ToolCallMetric[] = [];

  // Handle output array (Responses API)
  if (Array.isArray(res.output)) {
    for (const item of res.output) {
      if (item && typeof item === "object") {
        const outputItem = item as Record<string, unknown>;
        if (outputItem.type === "function_call") {
          toolCalls.push({
            type: "function",
            name: outputItem.name as string | undefined,
          });
        } else if (
          outputItem.type === "web_search_call" ||
          outputItem.type === "code_interpreter_call" ||
          outputItem.type === "file_search_call"
        ) {
          toolCalls.push({
            type: (outputItem.type as string).replace("_call", ""),
          });
        }
      }
    }
  }

  // Handle choices array (Chat Completions API)
  if (Array.isArray(res.choices)) {
    for (const choice of res.choices) {
      if (choice && typeof choice === "object") {
        const c = choice as Record<string, unknown>;
        const message = c.message as Record<string, unknown> | undefined;
        if (message && Array.isArray(message.tool_calls)) {
          for (const tc of message.tool_calls) {
            if (tc && typeof tc === "object") {
              const toolCall = tc as Record<string, unknown>;
              const fn = toolCall.function as Record<string, unknown> | undefined;
              toolCalls.push({
                type: (toolCall.type as string) ?? "function",
                name: fn?.name as string | undefined,
              });
            }
          }
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Build request metadata
 */
function buildRequestMetadata(
  params: Record<string, unknown>,
  traceId: string
): RequestMetadata {
  return {
    traceId,
    model: params.model as string,
    service_tier: params.service_tier as string | undefined,
    max_output_tokens: params.max_output_tokens as number | undefined,
    max_tool_calls: params.max_tool_calls as number | undefined,
    prompt_cache_key: params.prompt_cache_key as string | undefined,
    prompt_cache_retention: params.prompt_cache_retention as string | undefined,
    stream: !!params.stream,
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
 * Create metered stream wrapper
 */
function createMeteredStream<T extends AsyncIterable<unknown>>(
  stream: T,
  reqMeta: RequestMetadata,
  relationshipData: Partial<MetricEvent>,
  t0: number,
  options: MeterOptions
): T {
  const originalIterator = stream[Symbol.asyncIterator]();
  let finalUsage: NormalizedUsage | null = null;
  let requestId: string | null = null;
  const toolCalls: ToolCallMetric[] = [];

  const meteredIterator: AsyncIterator<unknown> = {
    async next() {
      const result = await originalIterator.next();

      if (!result.done && result.value) {
        const event = result.value as Record<string, unknown>;

        if (!requestId) {
          requestId = extractRequestId(event);
        }

        if (
          event.type === "response.completed" ||
          event.type === "message_stop"
        ) {
          const response = (event.response ?? event) as Record<string, unknown>;
          finalUsage = normalizeUsage(response.usage);

          if (options.trackToolCalls !== false) {
            toolCalls.push(...extractToolCalls(response));
          }
        }

        if (
          options.trackToolCalls !== false &&
          event.type === "response.function_call_arguments.done"
        ) {
          toolCalls.push({
            type: "function",
            name: event.name as string | undefined,
          });
        }
      }

      if (result.done) {
        const metricEvent: MetricEvent = {
          ...reqMeta,
          ...relationshipData,
          requestId,
          latency_ms: Date.now() - t0,
          usage: finalUsage,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };

        await options.emitMetric(metricEvent);
      }

      return result;
    },
    async return(value?: unknown) {
      const metricEvent: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId,
        latency_ms: Date.now() - t0,
        usage: finalUsage,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      await options.emitMetric(metricEvent);

      if (originalIterator.return) {
        return originalIterator.return(value);
      }
      return { done: true, value: undefined };
    },
    async throw(error?: unknown) {
      const metricEvent: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await options.emitMetric(metricEvent);

      if (originalIterator.throw) {
        return originalIterator.throw(error);
      }
      throw error;
    },
  };

  return {
    ...stream,
    [Symbol.asyncIterator]() {
      return meteredIterator;
    },
  } as T;
}

/**
 * Create wrapper for create methods
 */
function wrapCreateMethod(
  originalFn: (...args: unknown[]) => unknown,
  getOptions: () => MeterOptions
) {
  return async function (
    this: unknown,
    params: Record<string, unknown>,
    ...rest: unknown[]
  ) {
    const options = getOptions();
    const traceId = options.generateTraceId?.() ?? randomUUID();
    const t0 = Date.now();
    const reqMeta = buildRequestMetadata(params, traceId);
    const relationshipData = getRelationshipData(traceId, options);

    try {
      const result = await originalFn.call(this, params, ...rest);

      // Handle streaming
      if (
        params.stream &&
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      ) {
        return createMeteredStream(
          result as AsyncIterable<unknown>,
          reqMeta,
          relationshipData,
          t0,
          options
        );
      }

      // Non-streaming
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: extractRequestId(result),
        latency_ms: Date.now() - t0,
        usage: normalizeUsage((result as Record<string, unknown>)?.usage),
        tool_calls:
          options.trackToolCalls !== false
            ? extractToolCalls(result)
            : undefined,
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
 * Instrument OpenAI SDK globally.
 *
 * Call once at application startup. All OpenAI client instances
 * will automatically be metered.
 *
 * @returns true if instrumentation was successful, false if SDK not found
 */
export async function instrumentOpenAI(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn(
      "[llm-meter] OpenAI already instrumented. Call uninstrumentOpenAI() first to re-instrument."
    );
    return true;
  }

  // Try to import openai using dynamic import
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OpenAI: any = null;
  try {
    const openaiModule = await import("openai");
    OpenAI = openaiModule.default || openaiModule.OpenAI;
  } catch {
    // SDK not installed
    return false;
  }

  if (!OpenAI) {
    return false;
  }

  globalOptions = options;

  // Get the prototype to patch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responsesProto = OpenAI.prototype.responses as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatCompletionsProto = (OpenAI.prototype.chat as any)?.completions as any;

  // Patch responses.create
  if (responsesProto?.create) {
    originalResponsesCreate = responsesProto.create as (...args: unknown[]) => unknown;
    responsesProto.create = wrapCreateMethod(
      originalResponsesCreate,
      () => globalOptions!
    );
  }

  // Patch chat.completions.create
  if (chatCompletionsProto?.create) {
    originalChatCreate = chatCompletionsProto.create as (...args: unknown[]) => unknown;
    chatCompletionsProto.create = wrapCreateMethod(
      originalChatCreate,
      () => globalOptions!
    );
  }

  isInstrumented = true;
  return true;
}

/**
 * Remove OpenAI instrumentation.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrumentOpenAI(): Promise<void> {
  if (!isInstrumented) {
    return;
  }

  try {
    const openaiModule = await import("openai");
    const OpenAI = (openaiModule.default || openaiModule.OpenAI) as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responsesProto = OpenAI.prototype.responses as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatCompletionsProto = (OpenAI.prototype.chat as any)?.completions as any;

    if (originalResponsesCreate && responsesProto) {
      responsesProto.create = originalResponsesCreate;
      originalResponsesCreate = null;
    }

    if (originalChatCreate && chatCompletionsProto) {
      chatCompletionsProto.create = originalChatCreate;
      originalChatCreate = null;
    }
  } catch {
    // SDK not installed, nothing to do
  }

  globalOptions = null;
  isInstrumented = false;
}

/**
 * Check if OpenAI is currently instrumented
 */
export function isOpenAIInstrumented(): boolean {
  return isInstrumented;
}
