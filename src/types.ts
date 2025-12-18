import type OpenAI from "openai";

/**
 * Normalized usage metrics that work across both API response shapes
 * (Responses API vs Chat Completions API)
 */
export interface NormalizedUsage {
  /** Input/prompt tokens consumed */
  input_tokens: number;
  /** Output/completion tokens consumed */
  output_tokens: number;
  /** Total tokens (input + output) */
  total_tokens: number;
  /** Reasoning tokens used (for o1/o3 models) */
  reasoning_tokens: number;
  /** Tokens served from prompt cache (reduces cost) */
  cached_tokens: number;
  /** Prediction tokens that were accepted */
  accepted_prediction_tokens: number;
  /** Prediction tokens that were rejected */
  rejected_prediction_tokens: number;
}

/**
 * Request metadata that affects billing/cost
 */
export interface RequestMetadata {
  /** Unique trace ID for this request */
  traceId: string;
  /** Model used for the request */
  model: string;
  /** Service tier (affects pricing/performance) */
  service_tier?: "auto" | "default" | "flex" | "priority" | string;
  /** Maximum output tokens cap */
  max_output_tokens?: number;
  /** Maximum tool calls allowed */
  max_tool_calls?: number;
  /** Prompt cache key for improved cache hits */
  prompt_cache_key?: string;
  /** Prompt cache retention policy */
  prompt_cache_retention?: "in_memory" | "24h" | string;
  /** Whether streaming was enabled */
  stream: boolean;
}

/**
 * Information about where an LLM call originated in the code
 */
export interface CallSite {
  /** File path where the call originated */
  file: string;
  /** Line number */
  line: number;
  /** Column number */
  column: number;
  /** Function name (if available) */
  function?: string;
}

/**
 * Complete metric event emitted after each API call
 */
export interface MetricEvent extends RequestMetadata {
  /** OpenAI request ID for correlation */
  requestId: string | null;
  /** Request latency in milliseconds */
  latency_ms: number;
  /** Normalized usage metrics */
  usage: NormalizedUsage | null;
  /** HTTP status code (if available) */
  status_code?: number;
  /** Error message if request failed */
  error?: string;
  /** Rate limit information */
  rate_limit?: RateLimitInfo;
  /** Tool calls made during the request */
  tool_calls?: ToolCallMetric[];
  /** Custom metadata attached to the request */
  metadata?: Record<string, string>;

  // Call relationship tracking (auto-detected)

  /** Session ID grouping related calls together */
  sessionId?: string;
  /** Parent trace ID for nested/hierarchical calls */
  parentTraceId?: string;
  /** Sequence number within the session */
  callSequence?: number;
  /** Stack of agent/handler names leading to this call */
  agentStack?: string[];
  /** Source code location where this call originated */
  callSite?: CallSite;
}

/**
 * Rate limit information from response headers
 */
export interface RateLimitInfo {
  /** Remaining requests in current window */
  remaining_requests?: number;
  /** Remaining tokens in current window */
  remaining_tokens?: number;
  /** Time until request limit resets (seconds) */
  reset_requests?: number;
  /** Time until token limit resets (seconds) */
  reset_tokens?: number;
}

/**
 * Metric for individual tool calls
 */
export interface ToolCallMetric {
  /** Tool type (function, web_search, code_interpreter, etc.) */
  type: string;
  /** Tool/function name */
  name?: string;
  /** Duration of tool execution in ms (if available) */
  duration_ms?: number;
}

/**
 * Callback function for emitting metrics
 */
export type MetricEmitter = (event: MetricEvent) => void | Promise<void>;

/**
 * Context passed to the beforeRequest hook
 */
export interface BeforeRequestContext {
  /** The model being used for this request */
  model: string;
  /** Whether this is a streaming request */
  stream: boolean;
  /** Generated trace ID for this request */
  traceId: string;
  /** Timestamp when the request was initiated */
  timestamp: Date;
  /** Custom metadata that can be passed through */
  metadata?: Record<string, unknown>;
}

/**
 * Result from the beforeRequest hook
 */
export type BeforeRequestResult =
  | { action: "proceed" }
  | { action: "throttle"; delayMs: number }
  | { action: "cancel"; reason: string };

/**
 * Hook called before each API request, allowing user-defined rate limiting
 *
 * @example
 * ```ts
 * beforeRequest: async (params, context) => {
 *   const remaining = await checkQuota(context.metadata?.tenantId);
 *   if (remaining <= 0) {
 *     return { action: 'cancel', reason: 'Quota exceeded' };
 *   }
 *   if (remaining < 10) {
 *     return { action: 'throttle', delayMs: 1000 };
 *   }
 *   return { action: 'proceed' };
 * }
 * ```
 */
export type BeforeRequestHook = (
  params: Record<string, unknown>,
  context: BeforeRequestContext
) => BeforeRequestResult | Promise<BeforeRequestResult>;

/**
 * Error thrown when a request is cancelled by the beforeRequest hook
 */
export class RequestCancelledError extends Error {
  constructor(
    public readonly reason: string,
    public readonly context: BeforeRequestContext
  ) {
    super(`Request cancelled: ${reason}`);
    this.name = "RequestCancelledError";
  }
}

/**
 * Options for the metered OpenAI client
 */
export interface MeterOptions {
  /** Custom metric emitter function */
  emitMetric: MetricEmitter;
  /** Whether to include tool call metrics (default: true) */
  trackToolCalls?: boolean;
  /** Custom trace ID generator (default: crypto.randomUUID) */
  generateTraceId?: () => string;
  /**
   * Hook called before each request for user-defined rate limiting.
   * Can cancel requests, throttle them with a delay, or allow them to proceed.
   */
  beforeRequest?: BeforeRequestHook;
  /** Custom metadata to pass to beforeRequest hook */
  requestMetadata?: Record<string, unknown>;
  /**
   * Whether to automatically track call relationships using AsyncLocalStorage.
   * When enabled, related LLM calls are grouped by session, with parent/child
   * relationships, agent stacks, and call sites automatically detected.
   * Default: true
   */
  trackCallRelationships?: boolean;
}

/**
 * Budget configuration for guardrails
 */
export interface BudgetConfig {
  /** Maximum input tokens allowed per request */
  maxInputTokens?: number;
  /** Maximum total tokens allowed per request */
  maxTotalTokens?: number;
  /** Action to take when budget is exceeded */
  onExceeded?: "throw" | "truncate" | "warn";
  /** Custom handler when budget is exceeded */
  onExceededHandler?: (info: BudgetExceededInfo) => void | Promise<void>;
}

/**
 * Information about a budget violation
 */
export interface BudgetExceededInfo {
  /** Estimated input tokens */
  estimatedInputTokens: number;
  /** Configured maximum */
  maxInputTokens: number;
  /** Model being used */
  model: string;
  /** Original input that exceeded budget */
  input: unknown;
}

/**
 * Streaming event types we care about for metrics
 */
export type StreamingEventType =
  | "response.created"
  | "response.in_progress"
  | "response.completed"
  | "response.failed"
  | "response.incomplete"
  | "response.output_item.added"
  | "response.content_part.added"
  | "response.content_part.done"
  | "response.output_item.done"
  | "response.function_call_arguments.delta"
  | "response.function_call_arguments.done";

/**
 * Extended OpenAI client with metering capabilities
 */
export type MeteredOpenAI = OpenAI & {
  __metered: true;
  __meterOptions: MeterOptions;
};
