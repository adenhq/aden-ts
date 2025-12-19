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
  ToolCallMetric,
  BeforeRequestContext,
  BeforeRequestResult,
} from "./types.js";
import { RequestCancelledError } from "./types.js";

/**
 * Safely emit a metric event, handling cases where emitMetric might be undefined
 */
async function safeEmit(options: MeterOptions, event: MetricEvent): Promise<void> {
  if (options.emitMetric) {
    await options.emitMetric(event);
  }
}

/**
 * Build a flat MetricEvent for OpenAI (OTel-compatible)
 */
function buildFlatEvent(
  spanId: string,
  params: Record<string, unknown>,
  stream: boolean,
  latencyMs: number,
  usage: NormalizedUsage | null,
  requestId: string | null,
  meterOptions: MeterOptions,
  toolCalls?: ToolCallMetric[],
  error?: string
): MetricEvent {
  // Get relationship data first to get trace_id
  const relationship = meterOptions.trackCallRelationships !== false
    ? getCallRelationship(spanId)
    : null;

  const event: MetricEvent = {
    trace_id: relationship?.traceId ?? spanId, // Use trace from context, fallback to spanId
    span_id: spanId,
    request_id: requestId,
    provider: "openai",
    model: params.model as string,
    stream,
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    cached_tokens: usage?.cached_tokens ?? 0,
    reasoning_tokens: usage?.reasoning_tokens ?? 0,
  };

  // Add service tier if present
  if (params.service_tier) {
    event.service_tier = params.service_tier as string;
  }

  // Add error if present
  if (error) {
    event.error = error;
  }

  // Add tool call info
  if (toolCalls && toolCalls.length > 0) {
    event.tool_call_count = toolCalls.length;
    event.tool_names = toolCalls.map(t => t.name ?? t.type).join(", ");
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
 * Create metered stream wrapper
 */
function createMeteredStream<T extends AsyncIterable<unknown>>(
  stream: T,
  spanId: string,
  params: Record<string, unknown>,
  t0: number,
  meterOptions: MeterOptions
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

          if (meterOptions.trackToolCalls !== false) {
            toolCalls.push(...extractToolCalls(response));
          }
        }

        if (
          meterOptions.trackToolCalls !== false &&
          event.type === "response.function_call_arguments.done"
        ) {
          toolCalls.push({
            type: "function",
            name: event.name as string | undefined,
          });
        }
      }

      if (result.done) {
        const metricEvent = buildFlatEvent(
          spanId, params, true, Date.now() - t0, finalUsage,
          requestId, meterOptions, toolCalls.length > 0 ? toolCalls : undefined
        );
        await safeEmit(meterOptions, metricEvent);
      }

      return result;
    },
    async return(value?: unknown) {
      const metricEvent = buildFlatEvent(
        spanId, params, true, Date.now() - t0, finalUsage,
        requestId, meterOptions, toolCalls.length > 0 ? toolCalls : undefined
      );
      await safeEmit(meterOptions, metricEvent);

      if (originalIterator.return) {
        return originalIterator.return(value);
      }
      return { done: true, value: undefined };
    },
    async throw(error?: unknown) {
      const metricEvent = buildFlatEvent(
        spanId, params, true, Date.now() - t0, null, requestId, meterOptions, undefined,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(meterOptions, metricEvent);

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
 * Sleep helper for throttling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute beforeRequest hook and handle actions
 * Returns the potentially modified params (with degraded model if applicable)
 */
async function executeBeforeRequestHook(
  params: Record<string, unknown>,
  spanId: string,
  meterOptions: MeterOptions
): Promise<Record<string, unknown>> {
  if (!meterOptions.beforeRequest) {
    return params;
  }

  const context: BeforeRequestContext = {
    model: params.model as string,
    stream: !!params.stream,
    spanId,
    traceId: spanId,
    timestamp: new Date(),
    metadata: meterOptions.requestMetadata,
  };

  const result: BeforeRequestResult = await meterOptions.beforeRequest(params, context);

  if (result.action === "cancel") {
    throw new RequestCancelledError(result.reason, context);
  }

  if (result.action === "throttle") {
    await sleep(result.delayMs);
    return params;
  }

  if (result.action === "degrade") {
    // Apply delay if throttle is combined with degrade
    if (result.delayMs) {
      await sleep(result.delayMs);
    }
    // Return modified params with degraded model
    return { ...params, model: result.toModel };
  }

  if (result.action === "alert") {
    // Apply delay if throttle is combined with alert
    if (result.delayMs) {
      await sleep(result.delayMs);
    }
    // Alerts allow the request to proceed - the alert was already triggered
    return params;
  }

  // action === "proceed" - continue normally
  return params;
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
    const meterOptions = getOptions();
    const spanId = meterOptions.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    try {
      // Execute beforeRequest hook (may throttle, cancel, or degrade)
      const finalParams = await executeBeforeRequestHook(params, spanId, meterOptions);

      const result = await originalFn.call(this, finalParams, ...rest);

      // Handle streaming
      if (
        finalParams.stream &&
        result &&
        typeof result === "object" &&
        Symbol.asyncIterator in result
      ) {
        return createMeteredStream(
          result as AsyncIterable<unknown>,
          spanId,
          finalParams,
          t0,
          meterOptions
        );
      }

      // Non-streaming
      const usage = normalizeUsage((result as Record<string, unknown>)?.usage);
      const toolCalls = meterOptions.trackToolCalls !== false ? extractToolCalls(result) : undefined;
      const event = buildFlatEvent(
        spanId, finalParams, false, Date.now() - t0, usage,
        extractRequestId(result), meterOptions, toolCalls
      );

      await safeEmit(meterOptions, event);
      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId, params, false, Date.now() - t0, null, null, meterOptions, undefined,
        error instanceof Error ? error.message : String(error)
      );

      await safeEmit(meterOptions, event);
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
      "[aden] OpenAI already instrumented. Call uninstrumentOpenAI() first to re-instrument."
    );
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Completions: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Responses: any = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let OpenAI: any = null;

    // Prefer SDK class from options (ensures same module instance as user code)
    if (options.sdks?.OpenAI) {
      OpenAI = options.sdks.OpenAI;
    } else {
      // Fallback to dynamic import (may be different module instance in some bundlers)
      const openaiModule = await import("openai") as any;
      OpenAI = openaiModule.default || openaiModule.OpenAI;
    }

    // The Chat.Completions class is used by client.chat.completions
    // The Responses class is used by client.responses
    Completions = OpenAI?.Chat?.Completions;
    Responses = OpenAI?.Responses;
  } catch (e) {
    // SDK not installed
    return false;
  }

  if (!Completions && !Responses) {
    return false;
  }

  globalOptions = options;

  // Patch Responses.prototype.create
  if (Responses?.prototype?.create) {
    originalResponsesCreate = Responses.prototype.create as (...args: unknown[]) => unknown;
    Responses.prototype.create = wrapCreateMethod(
      originalResponsesCreate,
      () => globalOptions!
    );
  }

  // Patch Completions.prototype.create (for chat.completions.create)
  if (Completions?.prototype?.create) {
    originalChatCreate = Completions.prototype.create as (...args: unknown[]) => unknown;
    Completions.prototype.create = wrapCreateMethod(
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const openaiModule = await import("openai") as any;
    const OpenAI = openaiModule.default || openaiModule.OpenAI;
    const Completions = OpenAI?.Chat?.Completions;
    const Responses = OpenAI?.Responses;

    if (originalResponsesCreate && Responses?.prototype) {
      Responses.prototype.create = originalResponsesCreate;
      originalResponsesCreate = null;
    }

    if (originalChatCreate && Completions?.prototype) {
      Completions.prototype.create = originalChatCreate;
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
