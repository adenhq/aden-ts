import type OpenAI from "openai";
import type { IControlAgent } from "./control-types.js";

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
 * Complete metric event emitted after each API call.
 * All fields are flat (not nested) for consistent cross-provider analytics.
 * Uses OpenTelemetry-compatible naming: trace_id groups operations, span_id identifies each operation.
 */
export interface MetricEvent {
  // === Identity (OTel-compatible) ===
  /** Trace ID grouping related operations (OTel standard) */
  trace_id: string;
  /** Unique span ID for this specific operation (OTel standard) */
  span_id: string;
  /** Parent span ID for nested/hierarchical calls (OTel standard) */
  parent_span_id?: string;
  /** Provider-specific request ID (if available) */
  request_id: string | null;
  /** LLM provider: openai, gemini, anthropic */
  provider: "openai" | "gemini" | "anthropic";
  /** Model used for the request */
  model: string;
  /** Whether streaming was enabled */
  stream: boolean;
  /** ISO timestamp when the request started */
  timestamp: string;

  // === Performance ===
  /** Request latency in milliseconds */
  latency_ms: number;
  /** HTTP status code (if available) */
  status_code?: number;
  /** Error message if request failed */
  error?: string;

  // === Token Usage (flat, consistent across providers) ===
  /** Input/prompt tokens consumed */
  input_tokens: number;
  /** Output/completion tokens consumed */
  output_tokens: number;
  /** Total tokens (input + output) */
  total_tokens: number;
  /** Tokens served from cache (reduces cost) */
  cached_tokens: number;
  /** Reasoning tokens used (for o1/o3 models) */
  reasoning_tokens: number;

  // === Rate Limits (flat) ===
  /** Remaining requests in current window */
  rate_limit_remaining_requests?: number;
  /** Remaining tokens in current window */
  rate_limit_remaining_tokens?: number;
  /** Time until request limit resets (seconds) */
  rate_limit_reset_requests?: number;
  /** Time until token limit resets (seconds) */
  rate_limit_reset_tokens?: number;

  // === Call Relationship Tracking ===
  /** Sequence number within the trace */
  call_sequence?: number;
  /** Stack of agent/handler names leading to this call */
  agent_stack?: string[];

  // === Call Site (flat) ===
  /** File path where the call originated (immediate caller) */
  call_site_file?: string;
  /** Line number where the call originated */
  call_site_line?: number;
  /** Column number where the call originated */
  call_site_column?: number;
  /** Function name where the call originated */
  call_site_function?: string;
  /** Full call stack for detailed tracing (file:line:function) */
  call_stack?: string[];

  // === Tool Usage ===
  /** Number of tool calls made */
  tool_call_count?: number;
  /** Tool names that were called (comma-separated) */
  tool_names?: string;

  // === Provider-specific (optional) ===
  /** Service tier (OpenAI: auto, default, flex, priority) */
  service_tier?: string;
  /** Custom metadata attached to the request */
  metadata?: Record<string, string>;
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
  /** Generated span ID for this request (OTel standard) */
  spanId: string;
  /** Trace ID grouping related operations (OTel standard) */
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
  | { action: "cancel"; reason: string }
  | { action: "degrade"; toModel: string; toProvider?: string; reason?: string; delayMs?: number }
  | { action: "alert"; level: "info" | "warning" | "critical"; message: string; delayMs?: number };

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
/**
 * SDK classes that can be passed for instrumentation.
 * Use this when you have multiple copies of SDK packages in your node_modules
 * (e.g., when using file: dependencies or monorepos).
 */
export interface SDKClasses {
  /** GoogleGenerativeAI class from @google/generative-ai */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GoogleGenerativeAI?: any;
  /** OpenAI class from openai */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  OpenAI?: any;
  /** Anthropic class from @anthropic-ai/sdk */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Anthropic?: any;
}

/**
 * Default control server URL
 */
export const DEFAULT_CONTROL_SERVER = "https://kube.acho.io";

/**
 * Get the control server URL with priority:
 * 1. Explicit serverUrl option
 * 2. ADEN_API_URL environment variable
 * 3. DEFAULT_CONTROL_SERVER constant
 */
export function getControlServerUrl(serverUrl?: string): string {
  return serverUrl ?? process.env.ADEN_API_URL ?? DEFAULT_CONTROL_SERVER;
}

export interface MeterOptions {
  /**
   * API key for the control server.
   * When provided, automatically creates a control agent and emitter.
   * This is the simplest way to enable metering with remote control.
   *
   * If not provided, checks ADEN_API_KEY environment variable.
   *
   * @example
   * ```typescript
   * // Simplest setup - just provide API key
   * await instrument({
   *   apiKey: process.env.ADEN_API_KEY,
   *   sdks: { OpenAI },
   * });
   * ```
   */
  apiKey?: string;

  /**
   * Control server URL.
   * Priority: serverUrl option > ADEN_API_URL env var > https://kube.acho.io
   * Only used when apiKey is provided.
   */
  serverUrl?: string;

  /**
   * Whether to allow requests when control server is unreachable.
   * Default: true (fail open - requests proceed if server is down)
   * Set to false for strict control (fail closed - block if server unreachable)
   */
  failOpen?: boolean;

  /**
   * Custom metric emitter function.
   * When apiKey is provided, this is optional - metrics go to control server.
   * When apiKey is NOT provided, this is required.
   *
   * You can combine with apiKey to emit to multiple destinations:
   * @example
   * ```typescript
   * await instrument({
   *   apiKey: process.env.ADEN_API_KEY,
   *   emitMetric: createConsoleEmitter({ pretty: true }), // Also log locally
   * });
   * ```
   */
  emitMetric?: MetricEmitter;

  /** Whether to include tool call metrics (default: true) */
  trackToolCalls?: boolean;
  /** Custom span ID generator (default: crypto.randomUUID) */
  generateSpanId?: () => string;
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
  /**
   * SDK classes to instrument. Pass these when you have multiple copies of
   * SDK packages in your node_modules (common in monorepos or with file: dependencies).
   * If not provided, Aden will try to import the SDKs from its own node_modules,
   * which may not be the same instance your application uses.
   *
   * @example
   * ```typescript
   * import { GoogleGenerativeAI } from "@google/generative-ai";
   *
   * instrument({
   *   apiKey: process.env.ADEN_API_KEY,
   *   sdks: { GoogleGenerativeAI },
   * });
   * ```
   */
  sdks?: SDKClasses;
  /**
   * Function to get the current context ID (user ID, session ID, etc.)
   * Used for budget tracking and policy enforcement per context.
   *
   * @example
   * ```typescript
   * instrument({
   *   apiKey: process.env.ADEN_API_KEY,
   *   getContextId: () => getCurrentUserId(),
   * });
   * ```
   */
  getContextId?: () => string | undefined;
  /**
   * Pre-configured control agent instance.
   * Use this for advanced control agent configuration.
   * When apiKey is provided, a control agent is created automatically.
   */
  controlAgent?: IControlAgent;
  /**
   * Callback invoked when an alert is triggered by the control agent.
   * Alerts do NOT block requests - they are notifications only.
   * Use this for logging, notifications, or monitoring.
   *
   * @example
   * ```typescript
   * instrument({
   *   apiKey: process.env.ADEN_API_KEY,
   *   onAlert: (alert) => {
   *     console.warn(`[${alert.level}] ${alert.message}`);
   *     // Send to Slack, PagerDuty, etc.
   *   },
   * });
   * ```
   */
  onAlert?: (alert: { level: "info" | "warning" | "critical"; message: string; reason: string; contextId?: string; provider: string; model: string; timestamp: Date }) => void | Promise<void>;
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
