/**
 * Control Types - Types for the Control Agent
 *
 * Defines control actions, events, and policies for bidirectional
 * communication with the control server.
 */

import type { MetricEvent } from "./types.js";

// =============================================================================
// Control Actions
// =============================================================================

/**
 * Control actions that can be applied to requests
 */
export type ControlAction = "allow" | "block" | "throttle" | "degrade";

/**
 * Control decision - what action to take for a request
 */
export interface ControlDecision {
  /** The action to take */
  action: ControlAction;
  /** Human-readable reason for the decision */
  reason?: string;
  /** If action is "degrade", switch to this model */
  degradeToModel?: string;
  /** If action is "throttle", delay by this many milliseconds */
  throttleDelayMs?: number;
}

// =============================================================================
// Control Events (SDK → Server)
// =============================================================================

/**
 * Base event structure with common fields
 */
interface BaseEvent {
  /** Event type discriminator */
  event_type: string;
  /** ISO timestamp of the event */
  timestamp: string;
  /** SDK instance ID for tracking */
  sdk_instance_id: string;
}

/**
 * Control event - emitted when a control action is taken
 */
export interface ControlEvent extends BaseEvent {
  event_type: "control";
  /** Trace ID for correlation */
  trace_id: string;
  /** Span ID of the affected request */
  span_id: string;
  /** Context ID (user, session, deal, etc.) */
  context_id?: string;
  /** Provider (openai, anthropic, gemini) */
  provider: string;
  /** Original model that was requested */
  original_model: string;
  /** Action that was taken */
  action: ControlAction;
  /** Reason for the action */
  reason?: string;
  /** If degraded, what model was used instead */
  degraded_to?: string;
  /** If throttled, how long was the delay in ms */
  throttle_delay_ms?: number;
  /** Estimated cost that triggered the decision */
  estimated_cost?: number;
}

/**
 * Metric event wrapper for server emission
 */
export interface MetricEventWrapper extends BaseEvent {
  event_type: "metric";
  /** The actual metric data */
  data: MetricEvent;
}

/**
 * Heartbeat event - periodic health check
 */
export interface HeartbeatEvent extends BaseEvent {
  event_type: "heartbeat";
  /** Connection status */
  status: "healthy" | "degraded" | "reconnecting";
  /** Requests processed since last heartbeat */
  requests_since_last: number;
  /** Errors since last heartbeat */
  errors_since_last: number;
  /** Current policy cache age in seconds */
  policy_cache_age_seconds: number;
  /** Whether WebSocket is connected */
  websocket_connected: boolean;
  /** SDK version */
  sdk_version: string;
}

/**
 * Error event - emitted when an error occurs
 */
export interface ErrorEvent extends BaseEvent {
  event_type: "error";
  /** Error message */
  message: string;
  /** Error code (if available) */
  code?: string;
  /** Stack trace (if available) */
  stack?: string;
  /** Related trace ID (if applicable) */
  trace_id?: string;
}

/**
 * Union type for all events emitted to server
 */
export type ServerEvent =
  | ControlEvent
  | MetricEventWrapper
  | HeartbeatEvent
  | ErrorEvent;

// =============================================================================
// Control Policies (Server → SDK)
// =============================================================================

/**
 * Budget rule - limits spend per context
 */
export interface BudgetRule {
  /** Context ID this rule applies to (e.g., user_id, session_id) */
  context_id: string;
  /** Budget limit in USD */
  limit_usd: number;
  /** Current spend in USD (server tracks this) */
  current_spend_usd: number;
  /** Action to take when budget is exceeded */
  action_on_exceed: ControlAction;
  /** If action is "degrade", switch to this model */
  degrade_to_model?: string;
}

/**
 * Throttle rule - rate limiting
 */
export interface ThrottleRule {
  /** Context ID this rule applies to (omit for global) */
  context_id?: string;
  /** Provider this rule applies to (omit for all) */
  provider?: string;
  /** Maximum requests per minute */
  requests_per_minute?: number;
  /** Fixed delay to apply to each request (ms) */
  delay_ms?: number;
}

/**
 * Block rule - hard block on certain requests
 */
export interface BlockRule {
  /** Context ID to block (omit for pattern match) */
  context_id?: string;
  /** Provider to block (omit for all) */
  provider?: string;
  /** Model pattern to block (e.g., "gpt-4*") */
  model_pattern?: string;
  /** Reason shown to caller */
  reason: string;
}

/**
 * Degrade rule - automatic model downgrade
 */
export interface DegradeRule {
  /** Model to downgrade from */
  from_model: string;
  /** Model to downgrade to */
  to_model: string;
  /** When to trigger the downgrade */
  trigger: "budget_threshold" | "rate_limit" | "always";
  /** For budget_threshold: percentage at which to trigger (0-100) */
  threshold_percent?: number;
  /** Context ID this rule applies to (omit for all) */
  context_id?: string;
}

/**
 * Complete control policy from server
 */
export interface ControlPolicy {
  /** Policy version for cache invalidation */
  version: string;
  /** When this policy was last updated */
  updated_at: string;
  /** Budget rules */
  budgets?: BudgetRule[];
  /** Throttle rules */
  throttles?: ThrottleRule[];
  /** Block rules */
  blocks?: BlockRule[];
  /** Degrade rules */
  degradations?: DegradeRule[];
}

// =============================================================================
// Control Request (for getting decisions)
// =============================================================================

/**
 * Request context for getting a control decision
 */
export interface ControlRequest {
  /** Context ID (user, session, deal, etc.) */
  context_id?: string;
  /** Provider being called */
  provider: string;
  /** Model being requested */
  model: string;
  /** Estimated cost of this request in USD */
  estimated_cost?: number;
  /** Estimated input tokens */
  estimated_input_tokens?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Control Agent Options
// =============================================================================

/**
 * Options for creating a control agent
 */
export interface ControlAgentOptions {
  /** Server URL (wss:// for WebSocket, https:// for HTTP-only) */
  serverUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Polling interval for HTTP fallback (ms), default: 30000 */
  pollingIntervalMs?: number;
  /** Heartbeat interval (ms), default: 10000 */
  heartbeatIntervalMs?: number;
  /** Request timeout (ms), default: 5000 */
  timeoutMs?: number;
  /** Fail open (allow) if server is unreachable, default: true */
  failOpen?: boolean;
  /** Custom context ID extractor */
  getContextId?: () => string | undefined;
  /** SDK instance identifier (auto-generated if not provided) */
  instanceId?: string;
}

// =============================================================================
// Control Agent Interface
// =============================================================================

/**
 * Control Agent interface - the public API
 */
export interface IControlAgent {
  /**
   * Connect to the control server
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the control server
   */
  disconnect(): Promise<void>;

  /**
   * Get a control decision for a request
   */
  getDecision(request: ControlRequest): Promise<ControlDecision>;

  /**
   * Report a metric event to the server
   */
  reportMetric(event: MetricEvent): Promise<void>;

  /**
   * Report a control event to the server
   */
  reportControlEvent(event: Omit<ControlEvent, "event_type" | "timestamp" | "sdk_instance_id">): Promise<void>;

  /**
   * Check if connected to server
   */
  isConnected(): boolean;

  /**
   * Get current cached policy
   */
  getPolicy(): ControlPolicy | null;
}
