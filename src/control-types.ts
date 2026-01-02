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
 * - allow: Request proceeds normally
 * - block: Request is rejected
 * - throttle: Request is delayed before proceeding
 * - degrade: Request uses a cheaper/fallback model
 * - alert: Request proceeds but triggers an alert notification
 */
export type ControlAction = "allow" | "block" | "throttle" | "degrade" | "alert";

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
  /** If action is "alert", the severity level */
  alertLevel?: "info" | "warning" | "critical";
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
 * Budget type - what scope the budget applies to
 */
export type BudgetType = "global" | "agent" | "tenant" | "customer" | "feature" | "tag";

/**
 * Limit action - what to do when budget is exceeded
 */
export type LimitAction = "kill" | "throttle" | "degrade";

/**
 * Budget alert configuration
 */
export interface BudgetAlert {
  /** Threshold percentage (0-100) */
  threshold: number;
  /** Whether this alert is enabled */
  enabled: boolean;
}

/**
 * Budget notification settings
 */
export interface BudgetNotifications {
  /** Show in-app notifications */
  inApp: boolean;
  /** Send email notifications */
  email: boolean;
  /** Email recipients */
  emailRecipients: string[];
  /** Send webhook notifications */
  webhook: boolean;
}

/**
 * Budget rule - limits spend per context
 */
export interface BudgetRule {
  /** Unique identifier for this budget */
  id: string;
  /** Human-readable name */
  name: string;
  /** Budget type/scope */
  type: BudgetType;
  /** Tags for tag-based budgets (required when type is 'tag') */
  tags?: string[];
  /** Budget limit in USD */
  limit: number;
  /** Current spend in USD */
  spent: number;
  /** Action to take when budget is exceeded */
  limitAction: LimitAction;
  /** If limitAction is "degrade", switch to this model */
  degradeToModel?: string;
  /** Alert thresholds */
  alerts: BudgetAlert[];
  /** Notification settings */
  notifications: BudgetNotifications;
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
 * Alert rule - trigger notifications without blocking
 */
export interface AlertRule {
  /** Context ID this rule applies to (omit for global) */
  context_id?: string;
  /** Provider this rule applies to (omit for all) */
  provider?: string;
  /** Model pattern to alert on (e.g., "gpt-4*" for expensive models) */
  model_pattern?: string;
  /** When to trigger the alert */
  trigger: "budget_threshold" | "model_usage" | "always";
  /** For budget_threshold: percentage at which to trigger (0-100) */
  threshold_percent?: number;
  /** Alert severity level */
  level: "info" | "warning" | "critical";
  /** Message to include in the alert */
  message: string;
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
  /** Alert rules */
  alerts?: AlertRule[];
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
 * Alert event passed to onAlert callback
 */
export interface AlertEvent {
  /** Alert severity level */
  level: "info" | "warning" | "critical";
  /** Alert message */
  message: string;
  /** Reason the alert was triggered */
  reason: string;
  /** Context ID that triggered the alert */
  contextId?: string;
  /** Provider that triggered the alert */
  provider: string;
  /** Model that triggered the alert */
  model: string;
  /** Timestamp of the alert */
  timestamp: Date;
}

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
  /**
   * Callback invoked when an alert is triggered.
   * Alerts do NOT block requests - they are notifications only.
   * Use this for logging, notifications, or monitoring.
   */
  onAlert?: (alert: AlertEvent) => void | Promise<void>;

  // ==========================================================================
  // Hybrid Enforcement Options
  // ==========================================================================

  /**
   * Enable hybrid enforcement (local + server-side validation).
   * When enabled, budgets above the threshold are validated with the server.
   * Default: false
   */
  enableHybridEnforcement?: boolean;

  /**
   * Budget usage threshold (percentage) at which to start server validation.
   * Requests below this threshold use local-only enforcement.
   * Default: 80
   */
  serverValidationThreshold?: number;

  /**
   * Timeout for server validation requests (ms).
   * Default: 2000
   */
  serverValidationTimeoutMs?: number;

  /**
   * Enable adaptive threshold adjustment based on remaining budget.
   * When enabled, force validation when remaining budget is critically low.
   * Default: true
   */
  adaptiveThresholdEnabled?: boolean;

  /**
   * Minimum remaining budget (USD) that triggers forced server validation.
   * Only applies when adaptiveThresholdEnabled is true.
   * Default: 1.0
   */
  adaptiveMinRemainingUsd?: number;

  /**
   * Enable probabilistic sampling for server validation.
   * Reduces latency impact by validating a fraction of requests.
   * Default: true
   */
  samplingEnabled?: boolean;

  /**
   * Base sampling rate at the threshold (0-1).
   * This is the minimum rate used at serverValidationThreshold.
   * Default: 0.1 (10%)
   */
  samplingBaseRate?: number;

  /**
   * Budget usage percentage at which to validate all requests.
   * Between threshold and this value, sampling rate interpolates to 1.0.
   * Default: 95
   */
  samplingFullValidationPercent?: number;

  /**
   * Maximum expected overspend percentage beyond the soft limit.
   * Acts as a hard limit safety net to prevent runaway spending.
   * Default: 10 (allowing up to 110% of budget)
   */
  maxExpectedOverspendPercent?: number;
}

/**
 * Budget validation request sent to server
 */
export interface BudgetValidationRequest {
  /** Budget ID to validate */
  budgetId: string;
  /** Estimated cost of the pending request */
  estimatedCost: number;
  /** Local spend tracking (server uses max of local vs server) */
  localSpend?: number;
  /** Budget context */
  context?: {
    type?: string;
    value?: string;
    tags?: string[];
  };
}

/**
 * Budget validation response from server
 */
export interface BudgetValidationResponse {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Action to take */
  action: "allow" | "block" | "degrade" | "throttle";
  /** Authoritative spend from server (TSDB) */
  authoritativeSpend: number;
  /** Budget limit */
  budgetLimit: number;
  /** Current usage percentage */
  usagePercent: number;
  /** Policy version */
  policyVersion: string;
  /** Updated spend after this request */
  updatedSpend: number;
  /** Reason for the decision */
  reason?: string;
  /** Projected usage percentage */
  projectedPercent?: number;
  /** Model to degrade to (if action is "degrade") */
  degradeToModel?: string;
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
