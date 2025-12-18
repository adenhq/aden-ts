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
  RequestMetadata,
  ToolCallMetric,
} from "./types.js";

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
 * Build request metadata for Anthropic
 */
function buildRequestMetadata(
  params: Record<string, unknown>,
  traceId: string
): RequestMetadata {
  return {
    traceId,
    model: params.model as string,
    max_output_tokens: params.max_tokens as number | undefined,
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
 * Create metered stream wrapper for Anthropic
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
          options.trackToolCalls !== false &&
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

      // Non-streaming response
      const response = result as Record<string, unknown>;
      const event: MetricEvent = {
        ...reqMeta,
        ...relationshipData,
        requestId: extractRequestId(result),
        latency_ms: Date.now() - t0,
        usage: normalizeAnthropicUsage(response?.usage),
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
      "[llm-meter] Anthropic already instrumented. Call uninstrumentAnthropic() first to re-instrument."
    );
    return true;
  }

  // Try to import @anthropic-ai/sdk using dynamic import
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Anthropic: any = null;
  try {
    const anthropicModule = await import("@anthropic-ai/sdk");
    Anthropic = anthropicModule.default || anthropicModule.Anthropic;
  } catch {
    // SDK not installed
    return false;
  }

  if (!Anthropic) {
    return false;
  }

  globalOptions = options;

  // Anthropic SDK structure: Anthropic -> messages.create()
  // We need to patch the messages resource's create method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messagesProto = Anthropic.prototype.messages as any;

  if (messagesProto?.create) {
    originalMessagesCreate = messagesProto.create as (
      ...args: unknown[]
    ) => unknown;
    messagesProto.create = wrapMessagesCreate(
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
    const anthropicModule = await import("@anthropic-ai/sdk");
    const Anthropic = (anthropicModule.default || anthropicModule.Anthropic) as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messagesProto = Anthropic.prototype.messages as any;

    if (originalMessagesCreate && messagesProto) {
      messagesProto.create = originalMessagesCreate;
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
