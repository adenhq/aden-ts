/**
 * Global instrumentation for Anthropic (Claude) SDK clients.
 *
 * Call `instrumentAnthropic()` once at startup, and all Anthropic client instances
 * (existing and future) are automatically metered.
 */

import { randomUUID } from "crypto";
import { getCallRelationship, getFullAgentStack } from "./context.js";
import type {
  MetricEvent,
  MeterOptions,
  NormalizedUsage,
  ToolCallMetric,
} from "./types.js";

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
let originalMessagesCreate: ((...args: unknown[]) => unknown) | null = null;

/**
 * Normalize Anthropic usage to our standard format
 */
function normalizeAnthropicUsage(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") return null;

  const u = usage as Record<string, unknown>;

  return {
    input_tokens: (u.input_tokens as number) ?? 0,
    output_tokens: (u.output_tokens as number) ?? 0,
    total_tokens:
      ((u.input_tokens as number) ?? 0) + ((u.output_tokens as number) ?? 0),
    cached_tokens: (u.cache_read_input_tokens as number) ?? 0,
    reasoning_tokens: 0,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Extract request ID from Anthropic response headers
 */
function extractRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const res = response as Record<string, unknown>;
  return (res.id ?? null) as string | null;
}

/**
 * Extract tool calls from Anthropic response
 */
function extractToolCalls(response: unknown): ToolCallMetric[] {
  if (!response || typeof response !== "object") return [];

  const res = response as Record<string, unknown>;
  const toolCalls: ToolCallMetric[] = [];

  // Anthropic uses content array with type: "tool_use"
  if (Array.isArray(res.content)) {
    for (const item of res.content) {
      if (item && typeof item === "object") {
        const contentItem = item as Record<string, unknown>;
        if (contentItem.type === "tool_use") {
          toolCalls.push({
            type: "function",
            name: contentItem.name as string | undefined,
          });
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Build a flat MetricEvent for Anthropic (OTel-compatible)
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
    provider: "anthropic",
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

/**
 * Create metered stream wrapper for Anthropic
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

        // Capture message_start for request ID
        if (event.type === "message_start") {
          const message = event.message as Record<string, unknown>;
          if (message) {
            requestId = extractRequestId(message);
          }
        }

        // Capture message_delta for usage
        if (event.type === "message_delta") {
          const usage = event.usage as Record<string, unknown>;
          if (usage) {
            finalUsage = normalizeAnthropicUsage(usage);
          }
        }

        // Capture tool_use from content_block_start
        if (
          meterOptions.trackToolCalls !== false &&
          event.type === "content_block_start"
        ) {
          const contentBlock = event.content_block as Record<string, unknown>;
          if (contentBlock?.type === "tool_use") {
            toolCalls.push({
              type: "function",
              name: contentBlock.name as string | undefined,
            });
          }
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
 * Create wrapper for messages.create method
 */
function wrapMessagesCreate(
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
          spanId,
          params,
          t0,
          meterOptions
        );
      }

      // Non-streaming response
      const response = result as Record<string, unknown>;
      const usage = normalizeAnthropicUsage(response?.usage);
      const toolCalls = meterOptions.trackToolCalls !== false ? extractToolCalls(result) : undefined;
      const event = buildFlatEvent(
        spanId, params, false, Date.now() - t0, usage,
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
 * Instrument Anthropic (Claude) SDK globally.
 *
 * Call once at application startup. All Anthropic client instances
 * will automatically be metered.
 *
 * @returns true if instrumentation was successful, false if SDK not found
 */
export async function instrumentAnthropic(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn(
      "[aden] Anthropic already instrumented. Call uninstrumentAnthropic() first to re-instrument."
    );
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Messages: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Anthropic: any = null;

    // Prefer SDK class from options (ensures same module instance as user code)
    if (options.sdks?.Anthropic) {
      Anthropic = options.sdks.Anthropic;
    } else {
      // Fallback to dynamic import (may be different module instance in some bundlers)
      const anthropicModule = await import("@anthropic-ai/sdk") as any;
      Anthropic = anthropicModule.default || anthropicModule.Anthropic;
    }

    // The Messages class is used by client.messages
    Messages = Anthropic?.Messages;
  } catch {
    // SDK not installed
    return false;
  }

  if (!Messages) {
    return false;
  }

  globalOptions = options;

  // Patch Messages.prototype.create directly
  if (Messages.prototype?.create) {
    originalMessagesCreate = Messages.prototype.create as (
      ...args: unknown[]
    ) => unknown;
    Messages.prototype.create = wrapMessagesCreate(
      originalMessagesCreate,
      () => globalOptions!
    );
  }

  isInstrumented = true;
  return true;
}

/**
 * Remove Anthropic instrumentation.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrumentAnthropic(): Promise<void> {
  if (!isInstrumented) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anthropicModule = await import("@anthropic-ai/sdk") as any;
    const Messages = anthropicModule.Messages;

    if (originalMessagesCreate && Messages?.prototype) {
      Messages.prototype.create = originalMessagesCreate;
      originalMessagesCreate = null;
    }
  } catch {
    // SDK not installed, nothing to do
  }

  globalOptions = null;
  isInstrumented = false;
}

/**
 * Check if Anthropic is currently instrumented
 */
export function isAnthropicInstrumented(): boolean {
  return isInstrumented;
}
