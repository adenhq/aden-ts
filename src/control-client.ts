/**
 * Control Client - Communicates with remote control server
 *
 * Sends metrics to server, receives control commands (block, throttle, degrade)
 */

import type { MetricEvent } from "./types.js";

/**
 * Control actions that can be applied to requests
 */
export type ControlAction = "allow" | "block" | "throttle" | "degrade";

/**
 * Control decision received from server or computed locally
 */
export interface ControlDecision {
  /** The action to take */
  action: ControlAction;
  /** Reason for the decision (for logging/debugging) */
  reason?: string;
  /** If action is "degrade", switch to this model */
  degradeToModel?: string;
  /** If action is "throttle", delay by this many milliseconds */
  throttleDelayMs?: number;
}

/**
 * Control event reported when a control action is taken
 */
export interface ControlEvent {
  /** Timestamp of the event */
  timestamp: string;
  /** Trace ID for correlation */
  trace_id: string;
  /** Span ID of the affected request */
  span_id: string;
  /** Context ID (user, session, etc.) */
  context_id?: string;
  /** Original model requested */
  original_model: string;
  /** Provider (openai, anthropic, gemini) */
  provider: string;
  /** Action that was taken */
  action: ControlAction;
  /** Reason for the action */
  reason?: string;
  /** If degraded, what model was used instead */
  degraded_to?: string;
  /** If throttled, how long was the delay */
  throttle_delay_ms?: number;
  /** Estimated cost that triggered the decision */
  estimated_cost?: number;
}

/**
 * Request context sent to server for control decision
 */
export interface ControlRequest {
  /** Context ID (user, session, deal, etc.) */
  context_id?: string;
  /** Provider being called */
  provider: string;
  /** Model being requested */
  model: string;
  /** Estimated cost of this request */
  estimated_cost?: number;
  /** Estimated input tokens */
  estimated_input_tokens?: number;
  /** Current session spend */
  session_spend?: number;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Server connection options
 */
export interface ControlServerOptions {
  /** Server URL for the control API */
  serverUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** How often to refresh cached policies (ms), default 30000 */
  policyRefreshIntervalMs?: number;
  /** Timeout for server requests (ms), default 5000 */
  timeoutMs?: number;
  /** Whether to fail open (allow) if server is unreachable, default true */
  failOpen?: boolean;
}

/**
 * Policy rules received from server
 */
export interface ControlPolicy {
  /** Budget limits per context */
  budgets?: {
    context_id: string;
    limit_usd: number;
    current_spend_usd: number;
    action_on_exceed: ControlAction;
    degrade_to_model?: string;
  }[];

  /** Model degradation rules */
  degradations?: {
    from_model: string;
    to_model: string;
    trigger: "budget_threshold" | "rate_limit" | "always";
    threshold_percent?: number;
  }[];

  /** Rate/throttle limits */
  throttles?: {
    context_id?: string;
    requests_per_minute?: number;
    delay_ms?: number;
  }[];

  /** Block rules */
  blocks?: {
    context_id?: string;
    provider?: string;
    model?: string;
    reason: string;
  }[];
}

/**
 * Control Client for communicating with remote server
 */
export class ControlClient {
  private options: Required<ControlServerOptions>;
  private cachedPolicy: ControlPolicy | null = null;
  private lastPolicyFetch: number = 0;
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();

  constructor(options: ControlServerOptions) {
    this.options = {
      serverUrl: options.serverUrl.replace(/\/$/, ""), // Remove trailing slash
      apiKey: options.apiKey,
      policyRefreshIntervalMs: options.policyRefreshIntervalMs ?? 30000,
      timeoutMs: options.timeoutMs ?? 5000,
      failOpen: options.failOpen ?? true,
    };
  }

  /**
   * Get control decision for a request
   */
  async getDecision(request: ControlRequest): Promise<ControlDecision> {
    // Try to get fresh policy
    await this.refreshPolicyIfNeeded();

    // If no policy, use default (allow)
    if (!this.cachedPolicy) {
      return { action: "allow" };
    }

    return this.evaluatePolicy(request, this.cachedPolicy);
  }

  /**
   * Report a metric event to the server
   */
  async reportMetric(event: MetricEvent): Promise<void> {
    try {
      await this.fetch("/v1/metrics", {
        method: "POST",
        body: JSON.stringify(event),
      });
    } catch (error) {
      // Log but don't throw - metrics reporting shouldn't break the app
      console.warn("[aden] Failed to report metric:", error);
    }
  }

  /**
   * Report a control event to the server
   */
  async reportControlEvent(event: ControlEvent): Promise<void> {
    try {
      await this.fetch("/v1/control-events", {
        method: "POST",
        body: JSON.stringify(event),
      });
    } catch (error) {
      console.warn("[aden] Failed to report control event:", error);
    }
  }

  /**
   * Fetch fresh policy from server
   */
  async fetchPolicy(): Promise<ControlPolicy | null> {
    try {
      const response = await this.fetch("/v1/policy", { method: "GET" });
      const policy = await response.json() as ControlPolicy;
      this.cachedPolicy = policy;
      this.lastPolicyFetch = Date.now();
      return policy;
    } catch (error) {
      console.warn("[aden] Failed to fetch policy:", error);
      return null;
    }
  }

  /**
   * Refresh policy if cache is stale
   */
  private async refreshPolicyIfNeeded(): Promise<void> {
    const elapsed = Date.now() - this.lastPolicyFetch;
    if (elapsed > this.options.policyRefreshIntervalMs) {
      await this.fetchPolicy();
    }
  }

  /**
   * Evaluate policy rules against a request
   */
  private evaluatePolicy(request: ControlRequest, policy: ControlPolicy): ControlDecision {
    // Check block rules first
    if (policy.blocks) {
      for (const block of policy.blocks) {
        if (this.matchesBlockRule(request, block)) {
          return { action: "block", reason: block.reason };
        }
      }
    }

    // Check budget limits
    if (policy.budgets && request.context_id) {
      const budget = policy.budgets.find(b => b.context_id === request.context_id);
      if (budget) {
        const projectedSpend = budget.current_spend_usd + (request.estimated_cost ?? 0);
        if (projectedSpend > budget.limit_usd) {
          if (budget.action_on_exceed === "degrade" && budget.degrade_to_model) {
            return {
              action: "degrade",
              reason: `Budget limit exceeded (${projectedSpend.toFixed(4)} > ${budget.limit_usd})`,
              degradeToModel: budget.degrade_to_model,
            };
          }
          return {
            action: budget.action_on_exceed,
            reason: `Budget limit exceeded (${projectedSpend.toFixed(4)} > ${budget.limit_usd})`,
          };
        }
      }
    }

    // Check degradation rules
    if (policy.degradations) {
      for (const degrade of policy.degradations) {
        if (degrade.from_model === request.model) {
          if (degrade.trigger === "always") {
            return {
              action: "degrade",
              reason: "Model degradation rule (always)",
              degradeToModel: degrade.to_model,
            };
          }
          // Budget threshold trigger
          if (degrade.trigger === "budget_threshold" && policy.budgets && request.context_id) {
            const budget = policy.budgets.find(b => b.context_id === request.context_id);
            if (budget && degrade.threshold_percent) {
              const usagePercent = (budget.current_spend_usd / budget.limit_usd) * 100;
              if (usagePercent >= degrade.threshold_percent) {
                return {
                  action: "degrade",
                  reason: `Budget at ${usagePercent.toFixed(1)}% (threshold: ${degrade.threshold_percent}%)`,
                  degradeToModel: degrade.to_model,
                };
              }
            }
          }
        }
      }
    }

    // Check throttle rules
    if (policy.throttles) {
      for (const throttle of policy.throttles) {
        if (!throttle.context_id || throttle.context_id === request.context_id) {
          // Check rate limit
          if (throttle.requests_per_minute) {
            const key = throttle.context_id ?? "global";
            const rateInfo = this.checkRateLimit(key, throttle.requests_per_minute);
            if (rateInfo.exceeded) {
              return {
                action: "throttle",
                reason: `Rate limit exceeded (${rateInfo.count}/${throttle.requests_per_minute} per minute)`,
                throttleDelayMs: throttle.delay_ms ?? 1000,
              };
            }
          }
          // Apply fixed delay
          if (throttle.delay_ms && !throttle.requests_per_minute) {
            return {
              action: "throttle",
              reason: "Throttle rule applied",
              throttleDelayMs: throttle.delay_ms,
            };
          }
        }
      }
    }

    return { action: "allow" };
  }

  /**
   * Check if request matches a block rule
   */
  private matchesBlockRule(
    request: ControlRequest,
    block: { context_id?: string; provider?: string; model?: string; reason: string }
  ): boolean {
    if (block.context_id && block.context_id !== request.context_id) return false;
    if (block.provider && block.provider !== request.provider) return false;
    if (block.model && block.model !== request.model) return false;
    return true;
  }

  /**
   * Check rate limit for a key
   */
  private checkRateLimit(key: string, limit: number): { exceeded: boolean; count: number } {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    let info = this.requestCounts.get(key);
    if (!info || now - info.windowStart > windowMs) {
      info = { count: 0, windowStart: now };
    }

    info.count++;
    this.requestCounts.set(key, info);

    return { exceeded: info.count > limit, count: info.count };
  }

  /**
   * Make HTTP request to server
   */
  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.options.serverUrl}${path}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.options.apiKey}`,
          ...init.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Update local spend tracking (called after successful requests)
   */
  updateSpend(contextId: string, amount: number): void {
    if (!this.cachedPolicy?.budgets) return;

    const budget = this.cachedPolicy.budgets.find(b => b.context_id === contextId);
    if (budget) {
      budget.current_spend_usd += amount;
    }
  }
}

/**
 * Create a control client
 */
export function createControlClient(options: ControlServerOptions): ControlClient {
  return new ControlClient(options);
}

/**
 * Create a metric emitter that sends to the control server
 */
export function createServerEmitter(client: ControlClient): (event: MetricEvent) => Promise<void> {
  return async (event: MetricEvent) => {
    await client.reportMetric(event);
  };
}
