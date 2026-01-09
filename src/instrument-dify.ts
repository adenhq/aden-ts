/**
 * Global instrumentation for Dify SDK clients.
 *
 * Call `instrumentDify()` once at startup, and all Dify client instances
 * (existing and future) are automatically metered.
 *
 * Dify is a platform where LLM calls happen on the server side. The SDK
 * calls Dify's API, and the response includes usage metadata from the server,
 * including pre-calculated costs.
 */

import { randomUUID } from "crypto";
import { getCallRelationship, getFullAgentStack } from "./context.js";
import type {
  MetricEvent,
  MeterOptions,
  NormalizedUsage,
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

// Track if we've already instrumented
let isInstrumented = false;
let globalOptions: MeterOptions | null = null;

// Store original methods for uninstrumentation
let originalChatCreate: ((...args: unknown[]) => unknown) | null = null;
let originalCompletionCreate: ((...args: unknown[]) => unknown) | null = null;
let originalWorkflowRun: ((...args: unknown[]) => unknown) | null = null;

/**
 * Dify usage response format from metadata.usage
 */
interface DifyUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_price?: string;
  completion_price?: string;
  total_price?: string;
  currency?: string;
  latency?: number;
}

/**
 * Normalize Dify usage to our standard format
 */
function normalizeDifyUsage(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") return null;

  const u = usage as DifyUsage;

  return {
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    total_tokens: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)),
    cached_tokens: 0,
    reasoning_tokens: 0,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Extract cost information from Dify response
 * Dify provides pre-calculated costs as strings
 */
function extractDifyCost(usage: unknown): { input_cost?: number; output_cost?: number; total_cost?: number; currency?: string } | null {
  if (!usage || typeof usage !== "object") return null;

  const u = usage as DifyUsage;
  const result: { input_cost?: number; output_cost?: number; total_cost?: number; currency?: string } = {};

  try {
    if (u.prompt_price) {
      result.input_cost = parseFloat(u.prompt_price);
    }
    if (u.completion_price) {
      result.output_cost = parseFloat(u.completion_price);
    }
    if (u.total_price) {
      result.total_cost = parseFloat(u.total_price);
    }
    if (u.currency) {
      result.currency = u.currency;
    }
  } catch {
    return null;
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract usage from Dify API response
 * Response format: { metadata: { usage: { ... } } }
 */
function extractUsageFromResponse(response: unknown): DifyUsage | null {
  if (!response || typeof response !== "object") return null;

  // Handle axios/fetch response with .data
  const res = response as Record<string, unknown>;
  let data = res;

  // If it's a Response object with json() method, we can't call it here
  // The caller should have already extracted the data
  if (res.data && typeof res.data === "object") {
    data = res.data as Record<string, unknown>;
  }

  const metadata = data.metadata as Record<string, unknown> | undefined;
  if (!metadata) return null;

  const usage = metadata.usage as DifyUsage | undefined;
  return usage ?? null;
}

/**
 * Extract request/message ID from Dify response
 */
function extractRequestId(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;

  const res = response as Record<string, unknown>;
  let data = res;

  if (res.data && typeof res.data === "object") {
    data = res.data as Record<string, unknown>;
  }

  return (data.message_id ?? data.id ?? null) as string | null;
}

/**
 * Extract model info from Dify response metadata
 */
function extractModel(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;

  const res = response as Record<string, unknown>;
  let data = res;

  if (res.data && typeof res.data === "object") {
    data = res.data as Record<string, unknown>;
  }

  const metadata = data.metadata as Record<string, unknown> | undefined;
  if (!metadata) return null;

  return (metadata.model ?? metadata.model_id ?? null) as string | null;
}

/**
 * Build a flat MetricEvent for Dify (OTel-compatible)
 */
function buildFlatEvent(
  spanId: string,
  methodType: string,
  stream: boolean,
  latencyMs: number,
  usage: NormalizedUsage | null,
  costInfo: { input_cost?: number; output_cost?: number; total_cost?: number; currency?: string } | null,
  requestId: string | null,
  model: string | null,
  meterOptions: MeterOptions,
  error?: string
): MetricEvent {
  // Get relationship data first to get trace_id
  const relationship = meterOptions.trackCallRelationships !== false
    ? getCallRelationship(spanId)
    : null;

  const event: MetricEvent = {
    trace_id: relationship?.traceId ?? spanId,
    span_id: spanId,
    request_id: requestId,
    provider: "dify",
    model: model ?? `dify-${methodType}`,
    stream,
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    total_tokens: usage?.total_tokens ?? 0,
    cached_tokens: usage?.cached_tokens ?? 0,
    reasoning_tokens: usage?.reasoning_tokens ?? 0,
  };

  // Add cost info if available (Dify provides pre-calculated costs)
  if (costInfo) {
    if (costInfo.input_cost !== undefined) {
      event.input_cost = costInfo.input_cost;
    }
    if (costInfo.output_cost !== undefined) {
      event.output_cost = costInfo.output_cost;
    }
    if (costInfo.total_cost !== undefined) {
      event.total_cost = costInfo.total_cost;
    }
    if (costInfo.currency) {
      event.currency = costInfo.currency;
    }
  }

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
  params: Record<string, unknown>,
  spanId: string,
  methodType: string,
  meterOptions: MeterOptions
): Promise<Record<string, unknown>> {
  if (!meterOptions.beforeRequest) {
    return params;
  }

  const responseMode = params.response_mode as string | undefined;

  const context: BeforeRequestContext = {
    model: `dify-${methodType}`,
    stream: responseMode === "streaming",
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
    if (result.delayMs) {
      await sleep(result.delayMs);
    }
    // Note: Dify doesn't support model switching at runtime,
    // but we still support the hook for consistency
    return params;
  }

  if (result.action === "alert") {
    if (result.delayMs) {
      await sleep(result.delayMs);
    }
    return params;
  }

  return params;
}

/**
 * Create wrapper for Dify client methods
 */
function wrapDifyMethod(
  originalFn: (...args: unknown[]) => unknown,
  methodType: string,
  getOptions: () => MeterOptions
) {
  return async function (
    this: unknown,
    ...args: unknown[]
  ) {
    const meterOptions = getOptions();
    const spanId = meterOptions.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    // Extract params - Dify methods typically take an object as first arg
    const params = (args[0] && typeof args[0] === "object" ? args[0] : {}) as Record<string, unknown>;
    const responseMode = params.response_mode as string | undefined;
    const isStreaming = responseMode === "streaming";

    try {
      // Execute beforeRequest hook
      const finalParams = await executeBeforeRequestHook(params, spanId, methodType, meterOptions);

      // Update args with potentially modified params
      const finalArgs = [finalParams, ...args.slice(1)];

      const result = await originalFn.apply(this, finalArgs);

      // For streaming, we would need to wrap the stream
      // For now, handle non-streaming case
      if (!isStreaming && result) {
        const usage = extractUsageFromResponse(result);
        const normalizedUsage = normalizeDifyUsage(usage);
        const costInfo = extractDifyCost(usage);
        const requestId = extractRequestId(result);
        const model = extractModel(result);

        const event = buildFlatEvent(
          spanId,
          methodType,
          false,
          Date.now() - t0,
          normalizedUsage,
          costInfo,
          requestId,
          model,
          meterOptions
        );

        await safeEmit(meterOptions, event);
      }

      return result;
    } catch (error) {
      const event = buildFlatEvent(
        spanId,
        methodType,
        isStreaming,
        Date.now() - t0,
        null,
        null,
        null,
        null,
        meterOptions,
        error instanceof Error ? error.message : String(error)
      );

      await safeEmit(meterOptions, event);
      throw error;
    }
  };
}

/**
 * Instrument Dify SDK globally.
 *
 * Call once at application startup. All Dify client instances
 * will automatically be metered.
 *
 * @returns true if instrumentation was successful, false if SDK not found
 */
export async function instrumentDify(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn(
      "[aden] Dify already instrumented. Call uninstrumentDify() first to re-instrument."
    );
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ChatClient: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let CompletionClient: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let WorkflowClient: any = null;

  try {
    // Prefer SDK class from options
    if (options.sdks?.Dify) {
      const DifyModule = options.sdks.Dify;
      ChatClient = DifyModule.ChatClient ?? DifyModule;
      CompletionClient = DifyModule.CompletionClient;
      WorkflowClient = DifyModule.WorkflowClient;
    } else {
      // Fallback to dynamic import
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const difyModule = await import("dify-client") as any;
      ChatClient = difyModule.ChatClient;
      CompletionClient = difyModule.CompletionClient;
      WorkflowClient = difyModule.WorkflowClient;
    }
  } catch {
    // SDK not installed
    return false;
  }

  if (!ChatClient && !CompletionClient && !WorkflowClient) {
    return false;
  }

  globalOptions = options;

  // Patch ChatClient.prototype.createChatMessage
  if (ChatClient?.prototype?.createChatMessage) {
    originalChatCreate = ChatClient.prototype.createChatMessage as (...args: unknown[]) => unknown;
    ChatClient.prototype.createChatMessage = wrapDifyMethod(
      originalChatCreate,
      "chat",
      () => globalOptions!
    );
  }

  // Patch CompletionClient.prototype.createCompletionMessage
  if (CompletionClient?.prototype?.createCompletionMessage) {
    originalCompletionCreate = CompletionClient.prototype.createCompletionMessage as (...args: unknown[]) => unknown;
    CompletionClient.prototype.createCompletionMessage = wrapDifyMethod(
      originalCompletionCreate,
      "completion",
      () => globalOptions!
    );
  }

  // Patch WorkflowClient.prototype.run
  if (WorkflowClient?.prototype?.run) {
    originalWorkflowRun = WorkflowClient.prototype.run as (...args: unknown[]) => unknown;
    WorkflowClient.prototype.run = wrapDifyMethod(
      originalWorkflowRun,
      "workflow",
      () => globalOptions!
    );
  }

  isInstrumented = true;
  return true;
}

/**
 * Remove Dify instrumentation.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrumentDify(): Promise<void> {
  if (!isInstrumented) {
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const difyModule = await import("dify-client") as any;
    const { ChatClient, CompletionClient, WorkflowClient } = difyModule;

    if (originalChatCreate && ChatClient?.prototype) {
      ChatClient.prototype.createChatMessage = originalChatCreate;
      originalChatCreate = null;
    }

    if (originalCompletionCreate && CompletionClient?.prototype) {
      CompletionClient.prototype.createCompletionMessage = originalCompletionCreate;
      originalCompletionCreate = null;
    }

    if (originalWorkflowRun && WorkflowClient?.prototype) {
      WorkflowClient.prototype.run = originalWorkflowRun;
      originalWorkflowRun = null;
    }
  } catch {
    // SDK not installed, nothing to do
  }

  globalOptions = null;
  isInstrumented = false;
}

/**
 * Check if Dify is currently instrumented
 */
export function isDifyInstrumented(): boolean {
  return isInstrumented;
}
