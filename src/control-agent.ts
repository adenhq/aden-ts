/**
 * Control Agent - Bidirectional communication with control server
 *
 * Emits: metrics, control events, heartbeat
 * Receives: control policies (budgets, throttle, block, degrade)
 *
 * Uses WebSocket for real-time communication with HTTP polling fallback.
 */

import { randomUUID } from "crypto";
import WebSocket from "ws";
import type { MetricEvent } from "./types.js";
import type {
  AlertEvent,
  BudgetRule,
  ControlAgentOptions,
  ControlDecision,
  ControlEvent,
  ControlPolicy,
  ControlRequest,
  HeartbeatEvent,
  IControlAgent,
  MetricEventWrapper,
  ServerEvent,
  ErrorEvent,
} from "./control-types.js";

// Package version (should match package.json)
const SDK_VERSION = "0.1.0";

/**
 * Control Agent implementation
 */
export class ControlAgent implements IControlAgent {
  private options: Required<ControlAgentOptions>;
  private ws: WebSocket | null = null;
  private cachedPolicy: ControlPolicy | null = null;
  private lastPolicyFetch: number = 0;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private eventQueue: ServerEvent[] = [];
  private maxQueueSize: number = 1000;

  // Stats for heartbeat
  private requestsSinceLastHeartbeat: number = 0;
  private errorsSinceLastHeartbeat: number = 0;

  // Rate limiting tracking
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();

  constructor(options: ControlAgentOptions) {
    this.options = {
      serverUrl: options.serverUrl.replace(/\/$/, ""),
      apiKey: options.apiKey,
      pollingIntervalMs: options.pollingIntervalMs ?? 30000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 10000,
      timeoutMs: options.timeoutMs ?? 5000,
      failOpen: options.failOpen ?? true,
      getContextId: options.getContextId ?? (() => undefined),
      instanceId: options.instanceId ?? randomUUID(),
      onAlert: options.onAlert ?? (() => {}),
    };
  }

  /**
   * Connect to the control server
   */
  async connect(): Promise<void> {
    const url = this.options.serverUrl;

    // Determine transport based on URL scheme
    if (url.startsWith("wss://") || url.startsWith("ws://")) {
      await this.connectWebSocket();
    } else {
      // HTTP-only mode: just use polling
      this.startPolling();
    }

    // Start heartbeat
    this.startHeartbeat();
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, _reject) => {
      // Helper to handle fallback to polling
      const fallbackToPolling = async () => {
        await this.startPolling();
        resolve();
      };

      try {
        const wsUrl = `${this.options.serverUrl}/v1/control/ws`;
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "X-SDK-Instance-ID": this.options.instanceId,
          },
        });

        this.ws.on("open", () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log("[aden] WebSocket connected to control server");

          // Flush queued events
          this.flushEventQueue();

          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("close", () => {
          this.connected = false;
          console.log("[aden] WebSocket disconnected, falling back to polling");
          this.scheduleReconnect();
          this.startPolling();
        });

        this.ws.on("error", (error) => {
          console.warn("[aden] WebSocket error:", error.message);
          this.errorsSinceLastHeartbeat++;
          if (!this.connected) {
            // Initial connection failed, start polling and wait for first fetch
            fallbackToPolling();
          }
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            console.warn("[aden] WebSocket connection timeout, using polling");
            fallbackToPolling();
          }
        }, this.options.timeoutMs);
      } catch (error) {
        console.warn("[aden] WebSocket setup failed:", error);
        fallbackToPolling();
      }
    });
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("[aden] Max reconnect attempts reached, using polling only");
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, ... up to 30s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.connected) {
        await this.connectWebSocket();
      }
    }, delay);
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.type === "policy") {
        this.cachedPolicy = message.policy as ControlPolicy;
        this.lastPolicyFetch = Date.now();
        console.log("[aden] Policy updated:", this.cachedPolicy.version);
      } else if (message.type === "command") {
        // Handle real-time commands (future: immediate block, etc.)
        console.log("[aden] Command received:", message);
      }
    } catch (error) {
      console.warn("[aden] Failed to parse message:", error);
    }
  }

  /**
   * Start HTTP polling for policy updates
   * Returns a promise that resolves when the first policy fetch completes
   */
  private async startPolling(): Promise<void> {
    if (this.pollingTimer) return;

    // Fetch immediately and wait for it
    await this.fetchPolicy();

    // Then poll at interval
    this.pollingTimer = setInterval(() => {
      if (!this.connected) {
        this.fetchPolicy();
      }
    }, this.options.pollingIntervalMs);
  }

  /**
   * Stop HTTP polling
   */
  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Fetch policy via HTTP
   */
  private async fetchPolicy(): Promise<void> {
    try {
      const response = await this.httpRequest("/v1/control/policy", "GET");
      if (response.ok) {
        const policy = await response.json() as ControlPolicy;
        this.cachedPolicy = policy;
        this.lastPolicyFetch = Date.now();
      }
    } catch (error) {
      console.warn("[aden] Failed to fetch policy:", error);
    }
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.options.heartbeatIntervalMs);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Send heartbeat event
   */
  private sendHeartbeat(): void {
    const event: HeartbeatEvent = {
      event_type: "heartbeat",
      timestamp: new Date().toISOString(),
      sdk_instance_id: this.options.instanceId,
      status: this.connected ? "healthy" : "degraded",
      requests_since_last: this.requestsSinceLastHeartbeat,
      errors_since_last: this.errorsSinceLastHeartbeat,
      policy_cache_age_seconds: this.lastPolicyFetch
        ? Math.floor((Date.now() - this.lastPolicyFetch) / 1000)
        : -1,
      websocket_connected: this.connected,
      sdk_version: SDK_VERSION,
    };

    this.sendEvent(event);

    // Reset counters
    this.requestsSinceLastHeartbeat = 0;
    this.errorsSinceLastHeartbeat = 0;
  }

  /**
   * Disconnect from the control server
   */
  async disconnect(): Promise<void> {
    this.stopPolling();
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Get a control decision for a request
   */
  async getDecision(request: ControlRequest): Promise<ControlDecision> {
    this.requestsSinceLastHeartbeat++;

    // If no policy, use default based on failOpen
    if (!this.cachedPolicy) {
      return this.options.failOpen
        ? { action: "allow" }
        : { action: "block", reason: "No policy available and failOpen is false" };
    }

    return this.evaluatePolicy(request, this.cachedPolicy);
  }

  /**
   * Evaluate policy rules against a request
   * Priority order: block > budget/degrade > throttle > alert > allow
   * Note: throttle adds delay but doesn't skip other checks
   */
  private evaluatePolicy(request: ControlRequest, policy: ControlPolicy): ControlDecision {
    // Track throttle info separately (throttle is applied but doesn't skip other checks)
    let throttleInfo: { delayMs: number; reason: string } | null = null;

    // 1. Check block rules first (highest priority)
    if (policy.blocks) {
      for (const block of policy.blocks) {
        if (this.matchesBlockRule(request, block)) {
          return { action: "block", reason: block.reason };
        }
      }
    }

    // 2. Check throttle rules (rate limiting - captures delay but continues checking)
    if (policy.throttles) {
      for (const throttle of policy.throttles) {
        // Match by context or global
        if (!throttle.context_id || throttle.context_id === request.context_id) {
          // Match by provider or all
          if (!throttle.provider || throttle.provider === request.provider) {
            // Check rate limit
            if (throttle.requests_per_minute) {
              const key = `${throttle.context_id ?? "global"}:${throttle.provider ?? "all"}`;
              const rateInfo = this.checkRateLimit(key, throttle.requests_per_minute);
              if (rateInfo.exceeded) {
                throttleInfo = {
                  delayMs: throttle.delay_ms ?? 1000,
                  reason: `Rate limit: ${rateInfo.count}/${throttle.requests_per_minute}/min`,
                };
                break; // Found throttle, but continue to check budget/degrade/block
              }
            }

            // Apply fixed delay (no rate limit, just a constant delay)
            if (throttle.delay_ms && !throttle.requests_per_minute) {
              throttleInfo = {
                delayMs: throttle.delay_ms,
                reason: "Fixed throttle delay",
              };
              break;
            }
          }
        }
      }
    }

    // 3. Check budget limits
    if (policy.budgets) {
      const applicableBudgets = this.findApplicableBudgets(policy.budgets, request);
      for (const budget of applicableBudgets) {
        const projectedSpend = budget.spent + (request.estimated_cost ?? 0);
        if (projectedSpend > budget.limit) {
          // Budget exceeded - check limitAction
          if (budget.limitAction === "degrade" && budget.degradeToModel) {
            return {
              action: "degrade",
              reason: `Budget "${budget.name}" exceeded: $${projectedSpend.toFixed(4)} > $${budget.limit}`,
              degradeToModel: budget.degradeToModel,
              ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
            };
          }
          // Map limitAction to ControlAction (kill -> block, throttle -> throttle)
          const action = budget.limitAction === "kill" ? "block" : budget.limitAction;
          return {
            action,
            reason: `Budget "${budget.name}" exceeded: $${projectedSpend.toFixed(4)} > $${budget.limit}`,
          };
        }

        // Check degradation rules based on budget threshold
        if (policy.degradations) {
          for (const degrade of policy.degradations) {
            if (
              degrade.from_model === request.model &&
              degrade.trigger === "budget_threshold" &&
              degrade.threshold_percent
            ) {
              const usagePercent = (budget.spent / budget.limit) * 100;
              if (usagePercent >= degrade.threshold_percent) {
                return {
                  action: "degrade",
                  reason: `Budget "${budget.name}" at ${usagePercent.toFixed(1)}% (threshold: ${degrade.threshold_percent}%)`,
                  degradeToModel: degrade.to_model,
                  ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
                };
              }
            }
          }
        }
      }
    }

    // 4. Check always-degrade rules
    if (policy.degradations) {
      for (const degrade of policy.degradations) {
        if (degrade.from_model === request.model && degrade.trigger === "always") {
          if (!degrade.context_id || degrade.context_id === request.context_id) {
            return {
              action: "degrade",
              reason: "Model degradation rule (always)",
              degradeToModel: degrade.to_model,
              ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
            };
          }
        }
      }
    }

    // 5. Check alert rules (alerts do NOT block - they notify and allow)
    if (policy.alerts) {
      for (const alert of policy.alerts) {
        if (this.matchesAlertRule(request, alert, policy)) {
          // Trigger the onAlert callback asynchronously (don't block)
          const alertEvent: AlertEvent = {
            level: alert.level,
            message: alert.message,
            reason: `Triggered by ${alert.trigger}`,
            contextId: request.context_id,
            provider: request.provider,
            model: request.model,
            timestamp: new Date(),
          };

          // Fire and forget - don't await to avoid blocking the request
          Promise.resolve(this.options.onAlert(alertEvent)).catch((err) => {
            console.warn("[aden] Alert callback error:", err);
          });

          // Return alert decision (request still proceeds, may include throttle delay)
          return {
            action: "alert",
            reason: alert.message,
            alertLevel: alert.level,
            ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
          };
        }
      }
    }

    // 6. If throttle is active but no other action, return throttle
    if (throttleInfo) {
      return {
        action: "throttle",
        reason: throttleInfo.reason,
        throttleDelayMs: throttleInfo.delayMs,
      };
    }

    return { action: "allow" };
  }

  /**
   * Check if request matches an alert rule
   */
  private matchesAlertRule(
    request: ControlRequest,
    alert: { context_id?: string; provider?: string; model_pattern?: string; trigger: string; threshold_percent?: number },
    policy: ControlPolicy
  ): boolean {
    // Check context match
    if (alert.context_id && alert.context_id !== request.context_id) return false;

    // Check provider match
    if (alert.provider && alert.provider !== request.provider) return false;

    // Check model pattern match
    if (alert.model_pattern) {
      const regex = new RegExp("^" + alert.model_pattern.replace(/\*/g, ".*") + "$");
      if (!regex.test(request.model)) return false;
    }

    // Check trigger conditions
    switch (alert.trigger) {
      case "always":
        return true;

      case "model_usage":
        // Model pattern already matched above
        return true;

      case "budget_threshold":
        if (alert.threshold_percent && policy.budgets) {
          const applicableBudgets = this.findApplicableBudgets(policy.budgets, request);
          for (const budget of applicableBudgets) {
            const usagePercent = (budget.spent / budget.limit) * 100;
            if (usagePercent >= alert.threshold_percent) {
              return true;
            }
          }
        }
        return false;

      default:
        return false;
    }
  }

  /**
   * Check if request matches a block rule
   */
  private matchesBlockRule(
    request: ControlRequest,
    block: { context_id?: string; provider?: string; model_pattern?: string; reason: string }
  ): boolean {
    if (block.context_id && block.context_id !== request.context_id) return false;
    if (block.provider && block.provider !== request.provider) return false;
    if (block.model_pattern) {
      const regex = new RegExp("^" + block.model_pattern.replace(/\*/g, ".*") + "$");
      if (!regex.test(request.model)) return false;
    }
    return true;
  }

  /**
   * Find budgets that apply to the given request based on budget type
   */
  private findApplicableBudgets(budgets: BudgetRule[], request: ControlRequest): BudgetRule[] {
    const result: BudgetRule[] = [];
    const metadata = request.metadata || {};

    for (const budget of budgets) {
      switch (budget.type) {
        case "global":
          // Global budgets always apply
          result.push(budget);
          break;

        case "agent":
          // Match by agent_id in metadata
          if (metadata.agent_id && budget.id.includes(String(metadata.agent_id))) {
            result.push(budget);
          }
          break;

        case "tenant":
          // Match by tenant_id in metadata
          if (metadata.tenant_id && budget.id.includes(String(metadata.tenant_id))) {
            result.push(budget);
          }
          break;

        case "customer":
          // Match by customer_id in metadata or context_id
          if (
            (metadata.customer_id && budget.id.includes(String(metadata.customer_id))) ||
            (request.context_id && budget.id.includes(request.context_id))
          ) {
            result.push(budget);
          }
          break;

        case "feature":
          // Match by feature in metadata
          if (metadata.feature && budget.id.includes(String(metadata.feature))) {
            result.push(budget);
          }
          break;

        case "tag":
          // Match if request has any of the budget's tags
          if (budget.tags && Array.isArray(metadata.tags)) {
            const requestTags = metadata.tags as string[];
            const hasMatchingTag = budget.tags.some((tag) => requestTags.includes(tag));
            if (hasMatchingTag) {
              result.push(budget);
            }
          }
          break;
      }
    }

    return result;
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
   * Report a metric event to the server
   */
  async reportMetric(event: MetricEvent): Promise<void> {
    // Inject context_id into the metric metadata
    const contextId = this.options.getContextId?.();
    const enrichedEvent: MetricEvent = {
      ...event,
      metadata: {
        ...event.metadata,
        ...(contextId && { context_id: contextId }),
      },
    };

    const wrapper: MetricEventWrapper = {
      event_type: "metric",
      timestamp: new Date().toISOString(),
      sdk_instance_id: this.options.instanceId,
      data: enrichedEvent,
    };

    await this.sendEvent(wrapper);

    // Update local budget tracking
    if (this.cachedPolicy?.budgets && event.total_tokens > 0) {
      const estimatedCost = this.estimateCost(event);
      const contextId = this.options.getContextId?.();

      for (const budget of this.cachedPolicy.budgets) {
        // Update global budgets
        if (budget.type === "global") {
          budget.spent += estimatedCost;
        }
        // Update customer budgets that match the context_id
        else if (budget.type === "customer" && contextId) {
          if (budget.id === contextId || budget.id.includes(contextId)) {
            budget.spent += estimatedCost;
          }
        }
      }
    }
  }

  /**
   * Estimate cost from a metric event
   * Uses gpt-4o pricing as default: $2.50/1M input, $10/1M output
   */
  private estimateCost(event: MetricEvent): number {
    // gpt-4o pricing (default for estimation)
    const inputCost = event.input_tokens * 0.0000025; // $2.50 per 1M tokens
    const outputCost = event.output_tokens * 0.00001; // $10 per 1M tokens
    return inputCost + outputCost;
  }

  /**
   * Report a control event to the server
   */
  async reportControlEvent(
    event: Omit<ControlEvent, "event_type" | "timestamp" | "sdk_instance_id">
  ): Promise<void> {
    const fullEvent: ControlEvent = {
      ...event,
      event_type: "control",
      timestamp: new Date().toISOString(),
      sdk_instance_id: this.options.instanceId,
    };

    await this.sendEvent(fullEvent);
  }

  /**
   * Report an error event
   */
  async reportError(message: string, error?: Error, traceId?: string): Promise<void> {
    this.errorsSinceLastHeartbeat++;

    const event: ErrorEvent = {
      event_type: "error",
      timestamp: new Date().toISOString(),
      sdk_instance_id: this.options.instanceId,
      message,
      code: error?.name,
      stack: error?.stack,
      trace_id: traceId,
    };

    await this.sendEvent(event);
  }

  /**
   * Send an event to the server
   */
  private async sendEvent(event: ServerEvent): Promise<void> {
    // If WebSocket is connected, send via WebSocket
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(event));
        return;
      } catch (error) {
        console.warn("[aden] WebSocket send failed, queuing event");
      }
    }

    // Otherwise queue for HTTP batch or later WebSocket send
    this.queueEvent(event);

    // If not connected via WebSocket, send via HTTP immediately
    if (!this.connected) {
      await this.flushEventQueue();
    }
  }

  /**
   * Queue an event for later sending
   */
  private queueEvent(event: ServerEvent): void {
    if (this.eventQueue.length >= this.maxQueueSize) {
      // Drop oldest events when queue is full
      this.eventQueue.shift();
    }
    this.eventQueue.push(event);
  }

  /**
   * Flush queued events
   */
  private async flushEventQueue(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    // If WebSocket is connected, send via WebSocket
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      const events = [...this.eventQueue];
      this.eventQueue = [];

      for (const event of events) {
        try {
          this.ws.send(JSON.stringify(event));
        } catch (error) {
          // Re-queue failed events
          this.queueEvent(event);
        }
      }
      return;
    }

    // Otherwise send via HTTP batch
    try {
      const events = [...this.eventQueue];
      this.eventQueue = [];

      await this.httpRequest("/v1/control/events", "POST", { events });
    } catch (error) {
      console.warn("[aden] Failed to flush event queue:", error);
      // Events are lost - could re-queue but might cause infinite growth
    }
  }

  /**
   * Make HTTP request to server
   */
  private async httpRequest(
    path: string,
    method: string,
    body?: unknown
  ): Promise<Response> {
    const httpUrl = this.options.serverUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${httpUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`,
          "X-SDK-Instance-ID": this.options.instanceId,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if connected to server (WebSocket)
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current cached policy
   */
  getPolicy(): ControlPolicy | null {
    return this.cachedPolicy;
  }
}

/**
 * Create a control agent
 */
export function createControlAgent(options: ControlAgentOptions): ControlAgent {
  return new ControlAgent(options);
}

/**
 * Create a metric emitter that sends to the control agent
 *
 * This allows the control agent to work alongside other emitters:
 * ```typescript
 * const agent = createControlAgent({ ... });
 *
 * await instrument({
 *   emitMetric: createMultiEmitter([
 *     createConsoleEmitter({ pretty: true }),
 *     createControlAgentEmitter(agent),
 *   ]),
 *   controlAgent: agent,
 * });
 * ```
 */
export function createControlAgentEmitter(agent: IControlAgent): (event: MetricEvent) => Promise<void> {
  return async (event: MetricEvent) => {
    await agent.reportMetric(event);
  };
}
