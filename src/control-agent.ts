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
import { logger } from "./logging.js";
import type {
  AlertEvent,
  BudgetRule,
  BudgetValidationResponse,
  ControlAction,
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

  // Pricing cache (fetched from server)
  private pricingCache: Map<string, { input: number; output: number; cached_input: number }> = new Map();
  private pricingAliases: Map<string, string> = new Map();

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
      // Hybrid enforcement options (defaults match Python SDK)
      enableHybridEnforcement: options.enableHybridEnforcement ?? true,
      serverValidationThreshold: options.serverValidationThreshold ?? 5,
      serverValidationTimeoutMs: options.serverValidationTimeoutMs ?? 2000,
      adaptiveThresholdEnabled: options.adaptiveThresholdEnabled ?? true,
      adaptiveMinRemainingUsd: options.adaptiveMinRemainingUsd ?? 5.0,
      samplingEnabled: options.samplingEnabled ?? true,
      samplingBaseRate: options.samplingBaseRate ?? 0.1,
      samplingFullValidationPercent: options.samplingFullValidationPercent ?? 95,
      maxExpectedOverspendPercent: options.maxExpectedOverspendPercent ?? 10,
    };
  }

  /**
   * Connect to the control server
   */
  async connect(): Promise<void> {
    const url = this.options.serverUrl;
    logger.debug(`Connecting to control server: ${url}`);

    // Determine transport based on URL scheme
    if (url.startsWith("wss://") || url.startsWith("ws://")) {
      await this.connectWebSocket();
    } else {
      // HTTP-only mode: just use polling
      logger.debug("Using HTTP polling mode (no WebSocket URL)");
      await this.startPolling();
    }

    // Fetch pricing table for accurate cost estimation
    try {
      await this.fetchPricing();
    } catch (error) {
      logger.warn("Failed to fetch pricing table:", error);
      // Continue with fallback pricing
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
        logger.debug(`Attempting WebSocket connection to: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl, {
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "X-SDK-Instance-ID": this.options.instanceId,
          },
        });

        this.ws.on("open", () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          logger.info("WebSocket connected to control server");

          // Flush queued events
          this.flushEventQueue();

          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on("close", () => {
          this.connected = false;
          logger.info("WebSocket disconnected, falling back to polling");
          this.scheduleReconnect();
          this.startPolling();
        });

        this.ws.on("error", (error) => {
          logger.warn("WebSocket error:", error.message);
          this.errorsSinceLastHeartbeat++;
          if (!this.connected) {
            // Initial connection failed, start polling and wait for first fetch
            fallbackToPolling();
          }
        });

        // Timeout for initial connection
        setTimeout(() => {
          if (!this.connected) {
            logger.warn("WebSocket connection timeout, using polling");
            fallbackToPolling();
          }
        }, this.options.timeoutMs);
      } catch (error) {
        logger.warn("WebSocket setup failed:", error);
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
      logger.warn("Max reconnect attempts reached, using polling only");
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
        logger.info("Policy updated:", this.cachedPolicy.version);
      } else if (message.type === "command") {
        // Handle real-time commands (future: immediate block, etc.)
        logger.info("Command received:", message);
      }
    } catch (error) {
      logger.warn("Failed to parse message:", error);
    }
  }

  /**
   * Start HTTP polling for policy updates
   * Returns a promise that resolves when the first policy fetch completes
   */
  private async startPolling(): Promise<void> {
    if (this.pollingTimer) return;

    logger.debug(`Starting HTTP polling (interval: ${this.options.pollingIntervalMs}ms)`);

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
    logger.debug("Fetching policy from server...");
    try {
      const response = await this.httpRequest("/v1/control/policy", "GET");
      if (response.ok) {
        const policy = await response.json() as ControlPolicy;
        this.cachedPolicy = policy;
        this.lastPolicyFetch = Date.now();
        logger.debug(`Policy fetched successfully (version: ${policy.version}, budgets: ${policy.budgets?.length ?? 0})`);
      } else {
        logger.debug(`Policy fetch returned status ${response.status}`);
      }
    } catch (error) {
      logger.warn("Failed to fetch policy:", error);
    }
  }

  /**
   * Fetch pricing table from server and cache it
   */
  private async fetchPricing(): Promise<void> {
    logger.debug("Fetching pricing table from server...");
    try {
      const response = await this.httpRequest("/tsdb/pricing", "GET");
      if (response.ok) {
        const data = await response.json() as { pricing?: Record<string, { input?: number; output?: number; cached_input?: number; aliases?: string[] }> };
        const pricing = data.pricing ?? {};

        // Build cache and alias map
        for (const [model, rates] of Object.entries(pricing)) {
          const modelLower = model.toLowerCase();
          this.pricingCache.set(modelLower, {
            input: rates.input ?? 1.0,
            output: rates.output ?? 3.0,
            cached_input: rates.cached_input ?? (rates.input ?? 1.0) * 0.25,
          });

          // Index aliases
          if (rates.aliases) {
            for (const alias of rates.aliases) {
              this.pricingAliases.set(alias.toLowerCase(), modelLower);
            }
          }
        }

        logger.debug(`Loaded pricing for ${this.pricingCache.size} models`);
      } else {
        logger.debug(`Pricing fetch returned status ${response.status}`);
      }
    } catch (error) {
      logger.warn("Failed to fetch pricing:", error);
      // Continue with fallback pricing
    }
  }

  /**
   * Get pricing for a model from cached pricing table
   */
  private getModelPricing(model: string): { input: number; output: number; cached_input: number } {
    const fallback = { input: 1.0, output: 3.0, cached_input: 0.25 };

    if (!model) {
      return fallback;
    }

    const modelLower = model.toLowerCase();

    // Check direct match first
    if (this.pricingCache.has(modelLower)) {
      return this.pricingCache.get(modelLower)!;
    }

    // Check aliases
    if (this.pricingAliases.has(modelLower)) {
      const canonical = this.pricingAliases.get(modelLower)!;
      if (this.pricingCache.has(canonical)) {
        return this.pricingCache.get(canonical)!;
      }
    }

    // Try prefix matching for versioned models
    for (const [cachedModel, rates] of this.pricingCache) {
      if (modelLower.startsWith(cachedModel) || cachedModel.startsWith(modelLower)) {
        return rates;
      }
    }

    // Fallback pricing for unknown models
    return fallback;
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;

    logger.debug(`Starting heartbeat (interval: ${this.options.heartbeatIntervalMs}ms)`);
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
    logger.debug("Disconnecting from control server...");
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
    logger.debug("Disconnected from control server");
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

    return await this.evaluatePolicy(request, this.cachedPolicy);
  }

  /**
   * Evaluate policy rules against a request
   * Priority order: block > budget/degrade > throttle > alert > allow
   * Note: throttle adds delay but doesn't skip other checks
   */
  private async evaluatePolicy(request: ControlRequest, policy: ControlPolicy): Promise<ControlDecision> {
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

    // 3. Check budget limits (with hybrid enforcement when enabled)
    // Evaluate ALL matching budgets and return the MOST RESTRICTIVE decision
    if (policy.budgets) {
      const applicableBudgets = this.findApplicableBudgets(policy.budgets, request);

      if (applicableBudgets.length > 0) {
        let mostRestrictiveDecision: ControlDecision | null = null;
        let mostRestrictivePriority = -1;

        for (const budget of applicableBudgets) {
          let decision: ControlDecision | null = null;

          if (this.options.enableHybridEnforcement) {
            // Use hybrid enforcement evaluation
            decision = await this.evaluateBudgetWithHybridEnforcement(
              request,
              budget,
              throttleInfo
            );
          } else {
            // Local-only enforcement
            decision = this.evaluateBudgetLocally(request, budget, throttleInfo);
          }

          // Check degradation rules based on budget threshold (if no decision yet)
          if (!decision && policy.degradations) {
            for (const degrade of policy.degradations) {
              if (
                degrade.provider === request.provider &&
                degrade.from_model === request.model &&
                degrade.trigger === "budget_threshold" &&
                degrade.threshold_percent
              ) {
                const usagePercent = (budget.spent / budget.limit) * 100;
                if (usagePercent >= degrade.threshold_percent) {
                  decision = {
                    action: "degrade",
                    reason: `Budget "${budget.name}" at ${usagePercent.toFixed(1)}% (threshold: ${degrade.threshold_percent}%)`,
                    degradeToModel: degrade.to_model,
                    degradeToProvider: degrade.provider,
                    ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
                  };
                  break;
                }
              }
            }
          }

          // Track most restrictive decision
          if (decision) {
            const priority = this.getActionPriority(decision.action);
            if (priority > mostRestrictivePriority) {
              mostRestrictiveDecision = decision;
              mostRestrictivePriority = priority;
            }

            // Short-circuit: BLOCK is highest priority, no need to continue
            if (decision.action === "block") {
              break;
            }
          }
        }

        // Return most restrictive decision if found
        if (mostRestrictiveDecision) {
          // Add throttle info if present and not already blocking
          if (throttleInfo && mostRestrictiveDecision.action !== "block" && !mostRestrictiveDecision.throttleDelayMs) {
            mostRestrictiveDecision.throttleDelayMs = throttleInfo.delayMs;
          }
          return mostRestrictiveDecision;
        }
      }
    }

    // 4. Check always-degrade rules
    if (policy.degradations) {
      for (const degrade of policy.degradations) {
        if (
          degrade.provider === request.provider &&
          degrade.from_model === request.model &&
          degrade.trigger === "always"
        ) {
          if (!degrade.context_id || degrade.context_id === request.context_id) {
            return {
              action: "degrade",
              reason: "Model degradation rule (always)",
              degradeToModel: degrade.to_model,
              degradeToProvider: degrade.provider,
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
            logger.warn("Alert callback error:", err);
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
   * Get action priority for finding most restrictive decision.
   * Higher priority = more restrictive.
   */
  private getActionPriority(action: ControlAction): number {
    const priority: Record<ControlAction, number> = {
      allow: 0,
      alert: 1,
      throttle: 2,
      degrade: 3,
      block: 4,
    };
    return priority[action] ?? 0;
  }

  /**
   * Evaluate a single budget using local-only enforcement.
   * Returns a decision if the budget triggers an action, null otherwise.
   */
  private evaluateBudgetLocally(
    request: ControlRequest,
    budget: BudgetRule,
    throttleInfo: { delayMs: number; reason: string } | null
  ): ControlDecision | null {
    const projectedSpend = budget.spent + (request.estimated_cost ?? 0);

    if (projectedSpend > budget.limit) {
      // Budget exceeded - check limitAction
      if (budget.limitAction === "degrade" && budget.degradeToModel) {
        return {
          action: "degrade",
          reason: `Budget "${budget.name}" exceeded: $${projectedSpend.toFixed(4)} > $${budget.limit}`,
          degradeToModel: budget.degradeToModel,
          degradeToProvider: budget.degradeToProvider,
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

    return null;
  }

  /**
   * Find budgets that apply to the given request based on budget type.
   *
   * Matching logic by budget type:
   * - global: Matches ALL requests
   * - agent: Matches if request.metadata.agent == budget.name or budget.id
   * - tenant: Matches if request.metadata.tenant_id == budget.name or budget.id
   * - customer: Matches if request.metadata.customer_id == budget.name or budget.id
   * - feature: Matches if request.metadata.feature == budget.name or budget.id
   * - tag: Matches if any request.metadata.tags intersect with budget.tags
   * - legacy (context_id): Matches if request.context_id == budget.context_id
   */
  private findApplicableBudgets(budgets: BudgetRule[], request: ControlRequest): BudgetRule[] {
    const result: BudgetRule[] = [];
    const metadata = request.metadata || {};

    for (const budget of budgets) {
      // Legacy context_id matching (for backwards compatibility)
      if (budget.context_id && request.context_id) {
        if (budget.context_id === request.context_id) {
          result.push(budget);
          continue;
        }
      }

      switch (budget.type) {
        case "global":
          // Global budgets always apply
          result.push(budget);
          break;

        case "agent": {
          // Match by agent in metadata against name OR id with exact equality
          const agent = metadata.agent as string | undefined;
          if (agent && (agent === budget.name || agent === budget.id)) {
            result.push(budget);
          }
          break;
        }

        case "tenant": {
          // Match by tenant_id in metadata against name OR id with exact equality
          const tenantId = metadata.tenant_id as string | undefined;
          if (tenantId && (tenantId === budget.name || tenantId === budget.id)) {
            result.push(budget);
          }
          break;
        }

        case "customer": {
          // Match by customer_id in metadata or context_id against name OR id
          const customerId = metadata.customer_id as string | undefined;
          if (
            (customerId && (customerId === budget.name || customerId === budget.id)) ||
            (request.context_id && (request.context_id === budget.name || request.context_id === budget.id))
          ) {
            result.push(budget);
          }
          break;
        }

        case "feature": {
          // Match by feature in metadata against name OR id with exact equality
          const feature = metadata.feature as string | undefined;
          if (feature && (feature === budget.name || feature === budget.id)) {
            result.push(budget);
          }
          break;
        }

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

    // Update local budget tracking for all matching budgets
    if (this.cachedPolicy?.budgets && event.total_tokens > 0) {
      const estimatedCost = this.estimateCost(event);
      const contextId = this.options.getContextId?.();
      const metadata = event.metadata || {};

      for (const budget of this.cachedPolicy.budgets) {
        let shouldUpdate = false;

        // Check if this budget applies to this event
        switch (budget.type) {
          case "global":
            // Global budgets always apply
            shouldUpdate = true;
            break;

          case "agent": {
            // Match by agent in metadata against name OR id
            const agent = metadata.agent as string | undefined;
            shouldUpdate = Boolean(agent && (agent === budget.name || agent === budget.id));
            break;
          }

          case "tenant": {
            // Match by tenant_id in metadata against name OR id
            const tenantId = metadata.tenant_id as string | undefined;
            shouldUpdate = Boolean(tenantId && (tenantId === budget.name || tenantId === budget.id));
            break;
          }

          case "customer": {
            // Match by customer_id in metadata or context_id against name OR id
            const customerId = metadata.customer_id as string | undefined;
            shouldUpdate = Boolean(
              (customerId && (customerId === budget.name || customerId === budget.id)) ||
              (contextId && (contextId === budget.name || contextId === budget.id))
            );
            break;
          }

          case "feature": {
            // Match by feature in metadata against name OR id
            const feature = metadata.feature as string | undefined;
            shouldUpdate = Boolean(feature && (feature === budget.name || feature === budget.id));
            break;
          }

          case "tag": {
            // Match if request has any of the budget's tags
            if (budget.tags && Array.isArray(metadata.tags)) {
              const requestTags = metadata.tags as string[];
              shouldUpdate = budget.tags.some((tag) => requestTags.includes(tag));
            }
            break;
          }
        }

        // Also check legacy context_id matching
        if (!shouldUpdate && budget.context_id && contextId) {
          shouldUpdate = budget.context_id === contextId;
        }

        if (shouldUpdate) {
          budget.spent += estimatedCost;
        }
      }
    }
  }

  /**
   * Estimate cost from a metric event using server pricing table.
   * Falls back to default pricing if model not found.
   */
  private estimateCost(event: MetricEvent): number {
    if (event.total_tokens === 0) {
      return 0;
    }

    // Get pricing for this model (fetched from server on connect)
    const rates = this.getModelPricing(event.model);

    // Calculate cost (pricing is per 1M tokens)
    // Use cached_input rate for cached tokens if available
    const cachedTokens = event.cached_tokens ?? 0;
    const regularInput = Math.max(0, event.input_tokens - cachedTokens);

    const inputCost = (regularInput * rates.input) / 1_000_000;
    const cachedCost = (cachedTokens * rates.cached_input) / 1_000_000;
    const outputCost = (event.output_tokens * rates.output) / 1_000_000;

    return inputCost + cachedCost + outputCost;
  }

  // ===========================================================================
  // Hybrid Enforcement - Server-Side Budget Validation
  // ===========================================================================

  /**
   * Calculate the sampling rate for server validation based on usage percentage.
   *
   * The rate interpolates from samplingBaseRate at threshold to 1.0 at
   * samplingFullValidationPercent.
   *
   * Example with defaults (threshold=80%, base_rate=0.1, full=95%):
   * - At 80%: 10% of requests validated
   * - At 87.5%: 55% of requests validated
   * - At 95%+: 100% of requests validated
   */
  private calculateSamplingRate(usagePercent: number): number {
    const threshold = this.options.serverValidationThreshold;
    const fullPercent = this.options.samplingFullValidationPercent;
    const baseRate = this.options.samplingBaseRate;

    if (usagePercent >= fullPercent) {
      return 1.0;
    }

    if (usagePercent < threshold) {
      return 0.0;
    }

    // Linear interpolation from baseRate to 1.0
    const rangeSize = fullPercent - threshold;
    const progress = (usagePercent - threshold) / rangeSize;
    return baseRate + (1.0 - baseRate) * progress;
  }

  /**
   * Determine if we should validate this request with the server.
   *
   * Uses adaptive thresholds and probabilistic sampling to minimize
   * latency impact while maintaining enforcement accuracy.
   *
   * Returns true if:
   * 1. Hybrid enforcement is enabled
   * 2. Budget usage is at or above the validation threshold
   * 3. Either:
   *    a. Remaining budget is below adaptiveMinRemainingUsd (always validate)
   *    b. Sampling dice roll succeeds based on current usage level
   */
  private shouldValidateWithServer(
    budgetUsagePercent: number,
    remainingBudgetUsd: number,
    _budgetLimitUsd: number
  ): boolean {
    if (!this.options.enableHybridEnforcement) {
      return false;
    }

    // Below threshold - no validation needed
    if (budgetUsagePercent < this.options.serverValidationThreshold) {
      return false;
    }

    // ADAPTIVE: Force validation if remaining budget is critically low
    if (this.options.adaptiveThresholdEnabled) {
      if (remainingBudgetUsd <= this.options.adaptiveMinRemainingUsd) {
        logger.debug(
          `Remaining budget $${remainingBudgetUsd.toFixed(4)} <= ` +
          `$${this.options.adaptiveMinRemainingUsd.toFixed(2)}, forcing validation`
        );
        return true;
      }
    }

    // SAMPLING: Probabilistic validation based on usage level
    if (this.options.samplingEnabled) {
      const samplingRate = this.calculateSamplingRate(budgetUsagePercent);
      const shouldSample = Math.random() < samplingRate;

      if (!shouldSample) {
        logger.debug(
          `Skipping validation (sampling rate: ${(samplingRate * 100).toFixed(1)}%, ` +
          `usage: ${budgetUsagePercent.toFixed(1)}%)`
        );
        return false;
      }

      logger.debug(
        `Sampled for validation (rate: ${(samplingRate * 100).toFixed(1)}%, ` +
        `usage: ${budgetUsagePercent.toFixed(1)}%)`
      );
      return true;
    }

    // No sampling - validate all requests above threshold
    return true;
  }

  /**
   * Check if request exceeds the hard limit (soft limit + max overspend buffer).
   *
   * This provides a safety net to prevent runaway spending even under
   * concurrency race conditions.
   *
   * Returns a BLOCK decision if hard limit exceeded, null otherwise.
   */
  private checkHardLimit(
    _usagePercent: number,
    projectedPercent: number
  ): ControlDecision | null {
    const hardLimit = 100.0 + this.options.maxExpectedOverspendPercent;

    if (projectedPercent >= hardLimit) {
      return {
        action: "block",
        reason: `Hard limit exceeded: ${projectedPercent.toFixed(1)}% >= ${hardLimit.toFixed(1)}%`,
      };
    }

    return null;
  }

  /**
   * Validate budget with server synchronously.
   *
   * Returns BudgetValidationResponse if successful, null if validation failed.
   * On failure, caller should fall back to local enforcement based on failOpen.
   */
  private async validateBudgetWithServer(
    budgetId: string,
    estimatedCost: number,
    localSpend?: number
  ): Promise<BudgetValidationResponse | null> {
    const httpUrl = this.options.serverUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://");

    try {
      const body: Record<string, unknown> = {
        budget_id: budgetId,
        estimated_cost: estimatedCost,
      };

      // Include local spend so server can use max(local, TSDB) for accuracy
      if (localSpend !== undefined) {
        body.local_spend = localSpend;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.serverValidationTimeoutMs
      );

      try {
        const response = await fetch(`${httpUrl}/v1/control/budget/validate`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.options.apiKey}`,
            "X-SDK-Instance-ID": this.options.instanceId,
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          const data = await response.json() as Record<string, unknown>;
          logger.debug(
            `Server validation response: allowed=${data.allowed}, ` +
            `action=${data.action}, reason=${data.reason}`
          );
          return {
            allowed: (data.allowed as boolean) ?? true,
            action: (data.action as "allow" | "block" | "degrade" | "throttle") ?? "allow",
            authoritativeSpend: (data.authoritative_spend as number) ?? 0,
            budgetLimit: (data.budget_limit as number) ?? 0,
            usagePercent: (data.usage_percent as number) ?? 0,
            policyVersion: (data.policy_version as string) ?? "",
            updatedSpend: (data.updated_spend as number) ?? 0,
            reason: data.reason as string | undefined,
            projectedPercent: data.projected_percent as number | undefined,
            degradeToModel: data.degrade_to_model as string | undefined,
            degradeToProvider: data.degrade_to_provider as string | undefined,
          };
        } else {
          logger.warn(`Server validation returned status ${response.status}`);
          return null;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      logger.warn(`Server validation failed: ${error}`);
      return null;
    }
  }

  /**
   * Convert server validation response to a ControlDecision
   */
  private applyServerValidationResult(
    validation: BudgetValidationResponse,
    budgetId: string
  ): ControlDecision {
    // Update local budget cache with authoritative spend
    if (this.cachedPolicy?.budgets) {
      for (const budget of this.cachedPolicy.budgets) {
        if (budget.id === budgetId) {
          budget.spent = validation.updatedSpend;
          break;
        }
      }
    }

    return {
      action: validation.action,
      reason: validation.reason ?? `Server validation: ${validation.action}`,
      degradeToModel: validation.degradeToModel,
      degradeToProvider: validation.degradeToProvider,
    };
  }

  /**
   * Evaluate a single budget with hybrid enforcement
   */
  private async evaluateBudgetWithHybridEnforcement(
    request: ControlRequest,
    budget: BudgetRule,
    throttleInfo: { delayMs: number; reason: string } | null
  ): Promise<ControlDecision | null> {
    const estimatedCost = request.estimated_cost ?? 0;
    const currentSpend = budget.spent;
    const limit = budget.limit;

    // Calculate local usage and projected percentages
    const usagePercent = limit > 0 ? (currentSpend / limit) * 100 : 0;
    const projectedSpend = currentSpend + estimatedCost;
    const projectedPercent = limit > 0 ? (projectedSpend / limit) * 100 : 0;
    const remaining = Math.max(0, limit - currentSpend);

    // HARD LIMIT CHECK: Block if exceeding max allowed overspend
    // Only applies when budget action is "kill" (block)
    if (budget.limitAction === "kill") {
      const hardLimitDecision = this.checkHardLimit(usagePercent, projectedPercent);
      if (hardLimitDecision) {
        return hardLimitDecision;
      }
    }

    // HYBRID ENFORCEMENT: Check if we should validate with server
    if (this.shouldValidateWithServer(usagePercent, remaining, limit)) {
      logger.debug(
        `Budget '${budget.name}' at ${usagePercent.toFixed(1)}% ` +
        `($${currentSpend.toFixed(6)}/$${limit.toFixed(6)}), validating with server`
      );

      const validation = await this.validateBudgetWithServer(
        budget.id,
        estimatedCost,
        currentSpend
      );

      if (validation) {
        // Server validation succeeded - use authoritative decision
        return this.applyServerValidationResult(validation, budget.id);
      } else {
        // Server validation failed - fall back to local enforcement
        logger.warn(
          `Server validation failed for budget '${budget.id}', using local enforcement`
        );
        if (!this.options.failOpen) {
          return {
            action: "block",
            reason: `Server validation failed for budget '${budget.id}' and failOpen is false`,
          };
        }
        // Continue with local enforcement below
      }
    }

    // LOCAL ENFORCEMENT: Check if budget would be exceeded (soft limit)
    if (projectedPercent >= 100) {
      if (budget.limitAction === "degrade" && budget.degradeToModel) {
        return {
          action: "degrade",
          reason: `Budget "${budget.name}" exceeded: $${projectedSpend.toFixed(4)} > $${limit} (${projectedPercent.toFixed(1)}%)`,
          degradeToModel: budget.degradeToModel,
          degradeToProvider: budget.degradeToProvider,
          ...(throttleInfo && { throttleDelayMs: throttleInfo.delayMs }),
        };
      }
      // Map limitAction to ControlAction (kill -> block, throttle -> throttle)
      const action = budget.limitAction === "kill" ? "block" : budget.limitAction;
      return {
        action,
        reason: `Budget "${budget.name}" exceeded: $${projectedSpend.toFixed(4)} > $${limit} (${projectedPercent.toFixed(1)}%)`,
      };
    }

    // No restrictive action needed for this budget
    return null;
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
        logger.debug(`Event sent via WebSocket: ${event.event_type}`);
        return;
      } catch (error) {
        logger.warn("WebSocket send failed, queuing event");
      }
    }

    // Otherwise queue for HTTP batch or later WebSocket send
    this.queueEvent(event);
    logger.debug(`Event queued: ${event.event_type} (queue size: ${this.eventQueue.length})`);

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

    const eventCount = this.eventQueue.length;

    // If WebSocket is connected, send via WebSocket
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      logger.debug(`Flushing ${eventCount} events via WebSocket`);
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
    logger.debug(`Flushing ${eventCount} events via HTTP`);
    try {
      const events = [...this.eventQueue];
      this.eventQueue = [];

      await this.httpRequest("/v1/control/events", "POST", { events });
      logger.debug(`Successfully sent ${eventCount} events via HTTP`);
    } catch (error) {
      logger.warn("Failed to flush event queue:", error);
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
