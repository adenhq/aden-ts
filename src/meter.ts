import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { normalizeUsage } from "./normalize.js";
import type {
  MetricEvent,
  MeterOptions,
  MeteredOpenAI,
  ToolCallMetric,
  NormalizedUsage,
  RequestMetadata,
  BeforeRequestContext,
  BeforeRequestResult,
} from "./types.js";
import { RequestCancelledError } from "./types.js";

/**
 * Extracts request ID from various response object shapes
 */
function extractRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const res = response as Record<string, unknown>;
  return (res.request_id ?? res.requestId ?? null) as string | null;
}

/**
 * Extracts tool call metrics from a response
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
            type: outputItem.type.replace("_call", ""),
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
              const fn = toolCall.function as
                | Record<string, unknown>
                | undefined;
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
 * Builds request metadata from params
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

/**
 * Helper to sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes the beforeRequest hook if provided, handling throttle and cancel actions
 */
async function executeBeforeRequestHook(
  params: Record<string, unknown>,
  context: BeforeRequestContext,
  meterOptions: MeterOptions
): Promise<void> {
  if (!meterOptions.beforeRequest) {
    return;
  }

  const result: BeforeRequestResult = await meterOptions.beforeRequest(
    params,
    context
  );

  if (result.action === "cancel") {
    throw new RequestCancelledError(result.reason, context);
  }

  if (result.action === "throttle") {
    await sleep(result.delayMs);
  }

  // action === "proceed" - continue normally
}

/**
 * Builds the beforeRequest context from params and options
 */
function buildBeforeRequestContext(
  params: Record<string, unknown>,
  traceId: string,
  meterOptions: MeterOptions
): BeforeRequestContext {
  return {
    model: params.model as string,
    stream: !!params.stream,
    traceId,
    timestamp: new Date(),
    metadata: meterOptions.requestMetadata,
  };
}

/**
 * Wraps a non-streaming API call with metering
 */
async function meterNonStreamingCall<T>(
  originalFn: AnyFunction,
  params: Record<string, unknown>,
  options: unknown[],
  meterOptions: MeterOptions
): Promise<T> {
  const traceId = meterOptions.generateTraceId?.() ?? randomUUID();
  const t0 = Date.now();
  const reqMeta = buildRequestMetadata(params, traceId);

  // Execute beforeRequest hook (may throttle or cancel)
  const beforeCtx = buildBeforeRequestContext(params, traceId, meterOptions);
  await executeBeforeRequestHook(params, beforeCtx, meterOptions);

  try {
    const res = await originalFn(params, ...options);

    const event: MetricEvent = {
      ...reqMeta,
      requestId: extractRequestId(res),
      latency_ms: Date.now() - t0,
      usage: normalizeUsage((res as Record<string, unknown>)?.usage),
      tool_calls:
        meterOptions.trackToolCalls !== false
          ? extractToolCalls(res)
          : undefined,
    };

    await meterOptions.emitMetric(event);
    return res;
  } catch (error) {
    const event: MetricEvent = {
      ...reqMeta,
      requestId: null,
      latency_ms: Date.now() - t0,
      usage: null,
      error: error instanceof Error ? error.message : String(error),
    };

    await meterOptions.emitMetric(event);
    throw error;
  }
}

/**
 * Creates an async iterable wrapper that meters streaming responses
 */
function createMeteredStream<T extends AsyncIterable<unknown>>(
  stream: T,
  reqMeta: RequestMetadata,
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

        // Extract request ID from any event that has it
        if (!requestId) {
          requestId = extractRequestId(event);
        }

        // Check for completed event with usage
        if (
          event.type === "response.completed" ||
          event.type === "message_stop"
        ) {
          const response = (event.response ?? event) as Record<string, unknown>;
          finalUsage = normalizeUsage(response.usage);

          // Extract tool calls from final response
          if (meterOptions.trackToolCalls !== false) {
            toolCalls.push(...extractToolCalls(response));
          }
        }

        // Track tool call events during streaming
        if (
          meterOptions.trackToolCalls !== false &&
          typeof event.type === "string"
        ) {
          if (event.type === "response.function_call_arguments.done") {
            toolCalls.push({
              type: "function",
              name: event.name as string | undefined,
            });
          }
        }
      }

      // When stream ends, emit metrics
      if (result.done) {
        const metricEvent: MetricEvent = {
          ...reqMeta,
          requestId,
          latency_ms: Date.now() - t0,
          usage: finalUsage,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        };

        await meterOptions.emitMetric(metricEvent);
      }

      return result;
    },
    async return(value?: unknown) {
      // Handle early termination
      const metricEvent: MetricEvent = {
        ...reqMeta,
        requestId,
        latency_ms: Date.now() - t0,
        usage: finalUsage,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      await meterOptions.emitMetric(metricEvent);

      if (originalIterator.return) {
        return originalIterator.return(value);
      }
      return { done: true, value: undefined };
    },
    async throw(error?: unknown) {
      const metricEvent: MetricEvent = {
        ...reqMeta,
        requestId,
        latency_ms: Date.now() - t0,
        usage: null,
        error: error instanceof Error ? error.message : String(error),
      };

      await meterOptions.emitMetric(metricEvent);

      if (originalIterator.throw) {
        return originalIterator.throw(error);
      }
      throw error;
    },
  };

  // Return a new object that wraps the stream but uses our metered iterator
  return {
    ...stream,
    [Symbol.asyncIterator]() {
      return meteredIterator;
    },
  } as T;
}

/**
 * Wraps a streaming API call with metering
 */
async function meterStreamingCall<T>(
  originalFn: AnyFunction,
  params: Record<string, unknown>,
  options: unknown[],
  meterOptions: MeterOptions
): Promise<T> {
  const traceId = meterOptions.generateTraceId?.() ?? randomUUID();
  const t0 = Date.now();
  const reqMeta = buildRequestMetadata(params, traceId);

  // Execute beforeRequest hook (may throttle or cancel)
  const beforeCtx = buildBeforeRequestContext(params, traceId, meterOptions);
  await executeBeforeRequestHook(params, beforeCtx, meterOptions);

  try {
    const stream = await originalFn(params, ...options);

    // Check if result is async iterable (streaming response)
    if (
      stream &&
      typeof stream === "object" &&
      Symbol.asyncIterator in stream
    ) {
      return createMeteredStream(
        stream as AsyncIterable<unknown> & T,
        reqMeta,
        t0,
        meterOptions
      );
    }

    // Fallback for non-iterable responses
    return stream;
  } catch (error) {
    const event: MetricEvent = {
      ...reqMeta,
      requestId: null,
      latency_ms: Date.now() - t0,
      usage: null,
      error: error instanceof Error ? error.message : String(error),
    };

    await meterOptions.emitMetric(event);
    throw error;
  }
}

/**
 * Wraps an OpenAI client with metering capabilities.
 *
 * This function injects metering into the client without modifying the SDK,
 * allowing you to track usage metrics, billing data, and request metadata
 * for every API call.
 *
 * @param client - The OpenAI client instance to wrap
 * @param options - Metering options including the metric emitter
 * @returns The same client with metering injected
 *
 * @example
 * ```ts
 * import OpenAI from "openai";
 * import { makeMeteredOpenAI } from "openai-meter";
 *
 * const client = new OpenAI();
 * const metered = makeMeteredOpenAI(client, {
 *   emitMetric: (event) => {
 *     console.log("Usage:", event.usage);
 *     // Send to your metrics backend
 *   },
 * });
 *
 * // Use normally - metrics are collected automatically
 * const response = await metered.responses.create({
 *   model: "gpt-4.1",
 *   input: "Hello!",
 * });
 * ```
 */
export function makeMeteredOpenAI(
  client: OpenAI,
  options: MeterOptions
): MeteredOpenAI {
  // Wrap responses.create if it exists
  if (client.responses?.create) {
    const originalCreate = client.responses.create.bind(client.responses);

    (client.responses as unknown as Record<string, unknown>).create = async (
      params: Record<string, unknown>,
      ...opts: unknown[]
    ) => {
      if (params.stream) {
        return meterStreamingCall(originalCreate, params, opts, options);
      }
      return meterNonStreamingCall(originalCreate, params, opts, options);
    };
  }

  // Wrap chat.completions.create if it exists
  if (client.chat?.completions?.create) {
    const originalChatCreate = client.chat.completions.create.bind(
      client.chat.completions
    );

    (client.chat.completions as unknown as Record<string, unknown>).create =
      async (params: Record<string, unknown>, ...opts: unknown[]) => {
        if (params.stream) {
          return meterStreamingCall(originalChatCreate, params, opts, options);
        }
        return meterNonStreamingCall(originalChatCreate, params, opts, options);
      };
  }

  // Mark client as metered
  const metered = client as MeteredOpenAI;
  metered.__metered = true;
  metered.__meterOptions = options;

  return metered;
}

/**
 * Check if a client has already been wrapped with metering
 */
export function isMetered(client: OpenAI): client is MeteredOpenAI {
  return (client as MeteredOpenAI).__metered === true;
}
