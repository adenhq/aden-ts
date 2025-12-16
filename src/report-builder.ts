/**
 * Report Builder
 * Combines real analytics data with pattern simulations to generate comprehensive reports
 */

import type { MetricEvent } from "./types.js";
import type { AnalyticsJSON, ConversationPattern, MultiTenantPattern, CascadedAgentPattern, PatternEvent } from "./report-types.js";
import {
  simulateConversation,
  simulateMultiTenant,
  simulateCascadedAgents,
} from "./pattern-simulator.js";
import { generateHTMLReport } from "./html-report.js";

/**
 * Internal unified event type for report building
 * Supports both real MetricEvent and simulated PatternEvent
 */
interface UnifiedEvent {
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost: number;
  error?: string;
  timestamp?: string;
}

/**
 * Convert MetricEvent to UnifiedEvent
 */
function fromMetricEvent(event: MetricEvent): UnifiedEvent {
  return {
    model: event.model,
    latency_ms: event.latency_ms,
    input_tokens: event.usage?.input_tokens ?? 0,
    output_tokens: event.usage?.output_tokens ?? 0,
    cached_tokens: event.usage?.cached_tokens ?? 0,
    reasoning_tokens: event.usage?.reasoning_tokens ?? 0,
    cost: 0, // Will be calculated
    error: event.error,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convert PatternEvent to UnifiedEvent
 */
function fromPatternEvent(event: PatternEvent): UnifiedEvent {
  return {
    model: event.model,
    latency_ms: event.latency_ms,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    cached_tokens: event.cached_tokens,
    reasoning_tokens: event.reasoning_tokens,
    cost: event.cost,
    error: event.error,
    timestamp: event.timestamp,
  };
}

// Model pricing per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number; cached: number }> = {
  "gpt-5": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-5-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "o3": { input: 10.0, output: 40.0, cached: 2.5 },
  "o3-mini": { input: 1.1, output: 4.4, cached: 0.275 },
};

export interface ReportBuilderOptions {
  /**
   * Include simulated conversation patterns
   */
  simulateConversations?: number;

  /**
   * Include simulated multi-tenant data
   */
  simulateMultiTenant?: {
    tenants: number;
    requestsPerTenant?: { min: number; max: number };
  };

  /**
   * Include simulated cascaded agent executions
   */
  simulateCascadedAgents?: number;

  /**
   * Custom model pricing
   */
  pricing?: Record<string, { input: number; output: number; cached: number }>;
}

/**
 * Report Builder for generating comprehensive analytics reports
 */
export class ReportBuilder {
  private events: MetricEvent[] = [];
  private conversations: ConversationPattern[] = [];
  private multiTenant: MultiTenantPattern | null = null;
  private cascadedAgents: CascadedAgentPattern[] = [];
  private startTime: Date = new Date();
  private pricing: Record<string, { input: number; output: number; cached: number }>;

  constructor(options?: { pricing?: Record<string, { input: number; output: number; cached: number }> }) {
    this.pricing = { ...MODEL_PRICING, ...options?.pricing };
  }

  /**
   * Record a metric event from real API calls
   */
  recordEvent(event: MetricEvent): void {
    this.events.push(event);
  }

  /**
   * Add a conversation pattern (real or simulated)
   */
  addConversation(conversation: ConversationPattern): void {
    this.conversations.push(conversation);
  }

  /**
   * Set multi-tenant data (real or simulated)
   */
  setMultiTenant(data: MultiTenantPattern): void {
    this.multiTenant = data;
  }

  /**
   * Add a cascaded agent execution (real or simulated)
   */
  addCascadedAgent(execution: CascadedAgentPattern): void {
    this.cascadedAgents.push(execution);
  }

  /**
   * Simulate and add patterns based on options
   */
  addSimulatedPatterns(options: ReportBuilderOptions): void {
    // Simulate conversations
    if (options.simulateConversations && options.simulateConversations > 0) {
      for (let i = 0; i < options.simulateConversations; i++) {
        this.conversations.push(
          simulateConversation({
            turns: Math.floor(Math.random() * 10) + 3,
            model: Math.random() > 0.3 ? "gpt-5-mini" : "gpt-5",
            enableCaching: Math.random() > 0.3,
          })
        );
      }
    }

    // Simulate multi-tenant
    if (options.simulateMultiTenant) {
      this.multiTenant = simulateMultiTenant({
        tenantCount: options.simulateMultiTenant.tenants,
        requestsPerTenant: options.simulateMultiTenant.requestsPerTenant,
      });
    }

    // Simulate cascaded agents
    if (options.simulateCascadedAgents && options.simulateCascadedAgents > 0) {
      const taskDescriptions = [
        "Research competitor analysis and generate report",
        "Analyze codebase and suggest refactoring opportunities",
        "Process customer feedback and extract insights",
        "Generate marketing content with SEO optimization",
        "Debug production issue with log analysis",
      ];

      for (let i = 0; i < options.simulateCascadedAgents; i++) {
        this.cascadedAgents.push(
          simulateCascadedAgents({
            taskDescription: taskDescriptions[i % taskDescriptions.length],
            maxDepth: Math.floor(Math.random() * 2) + 2,
            avgSubagentsPerLevel: Math.floor(Math.random() * 2) + 2,
          })
        );
      }
    }
  }

  /**
   * Calculate cost for MetricEvent
   */
  private calculateEventCost(event: MetricEvent): number {
    if (!event.usage) return 0;
    const pricing = this.pricing[event.model] ?? this.pricing["gpt-5-mini"] ?? { input: 1, output: 3, cached: 0.25 };
    const uncachedInput = event.usage.input_tokens - event.usage.cached_tokens;
    return (
      (uncachedInput / 1_000_000) * pricing.input +
      (event.usage.cached_tokens / 1_000_000) * pricing.cached +
      (event.usage.output_tokens / 1_000_000) * pricing.output
    );
  }

  /**
   * Calculate cost for UnifiedEvent
   */
  private calculateUnifiedEventCost(event: UnifiedEvent): number {
    // If cost is already set (from simulated data), use it
    if (event.cost > 0) return event.cost;

    const pricing = this.pricing[event.model] ?? this.pricing["gpt-5-mini"] ?? { input: 1, output: 3, cached: 0.25 };
    const uncachedInput = event.input_tokens - event.cached_tokens;
    return (
      (uncachedInput / 1_000_000) * pricing.input +
      (event.cached_tokens / 1_000_000) * pricing.cached +
      (event.output_tokens / 1_000_000) * pricing.output
    );
  }

  /**
   * Generate the complete analytics JSON
   */
  buildJSON(): AnalyticsJSON {
    const endTime = new Date();
    const durationMs = endTime.getTime() - this.startTime.getTime();
    const durationHours = durationMs / 3600000;

    // Aggregate all events from patterns into unified format
    const allEvents: UnifiedEvent[] = [];

    // Add real metric events
    for (const event of this.events) {
      allEvents.push(fromMetricEvent(event));
    }

    // Add events from conversations
    for (const conv of this.conversations) {
      for (const turn of conv.turns) {
        allEvents.push(fromPatternEvent(turn.event));
      }
    }

    // Add events from multi-tenant
    if (this.multiTenant) {
      for (const tenant of this.multiTenant.tenants) {
        for (const event of tenant.events) {
          allEvents.push(fromPatternEvent(event));
        }
      }
    }

    // Add events from cascaded agents (recursive)
    const collectAgentEvents = (agent: CascadedAgentPattern["root_agent"]): void => {
      for (const event of agent.events) {
        allEvents.push(fromPatternEvent(event));
      }
      for (const sub of agent.subagents) {
        collectAgentEvents(sub);
      }
    };
    for (const task of this.cascadedAgents) {
      collectAgentEvents(task.root_agent);
    }

    // Calculate summary metrics
    const successful = allEvents.filter((e) => !e.error);
    let totalCost = 0;
    let totalTokens = 0;
    let cacheSavings = 0;

    const costByModel: Record<string, { requests: number; tokens: number; cost: number }> = {};
    const costByHour: Record<string, { cost: number; requests: number }> = {};

    for (const event of allEvents) {
      const cost = this.calculateUnifiedEventCost(event);
      totalCost += cost;

      const tokens = event.input_tokens + event.output_tokens;
      totalTokens += tokens;

      // Cache savings
      if (event.cached_tokens > 0) {
        const pricing = this.pricing[event.model] ?? this.pricing["gpt-5-mini"];
        if (pricing) {
          cacheSavings += (event.cached_tokens / 1_000_000) * (pricing.input - pricing.cached);
        }
      }

      // By model
      const model = event.model.split("-").slice(0, 2).join("-");
      if (!costByModel[model]) {
        costByModel[model] = { requests: 0, tokens: 0, cost: 0 };
      }
      costByModel[model].requests++;
      costByModel[model].tokens += tokens;
      costByModel[model].cost += cost;

      // By hour
      const hour = event.timestamp?.slice(0, 13) ?? new Date().toISOString().slice(0, 13);
      if (!costByHour[hour]) {
        costByHour[hour] = { cost: 0, requests: 0 };
      }
      costByHour[hour].cost += cost;
      costByHour[hour].requests++;
    }

    // Latency calculations
    const latencies = successful.map((e) => e.latency_ms).sort((a, b) => a - b);
    const percentile = (arr: number[], p: number): number => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, idx)];
    };

    const avgLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    // Cost by pattern type
    const costByPattern: Record<string, number> = {
      conversations: this.conversations.reduce((sum, c) => sum + c.summary.total_cost, 0),
      multi_tenant: this.multiTenant?.summary.total_cost ?? 0,
      cascaded_agents: this.cascadedAgents.reduce((sum, a) => sum + a.summary.total_cost, 0),
      direct: this.events.reduce((sum, e) => sum + this.calculateEventCost(e), 0),
    };

    // Calculate effective duration for projection
    // Use the simulated time span if available, otherwise use real elapsed time
    let effectiveDurationHours = durationHours;
    if (effectiveDurationHours < 0.01 && allEvents.length > 0) {
      // For simulated data, estimate 1 hour of usage
      effectiveDurationHours = 1;
    }

    // Generate recommendations
    const recommendations = this.generateRecommendations({
      totalCost,
      durationHours: effectiveDurationHours,
      cacheSavings,
      avgLatency,
      p95Latency: percentile(latencies, 95),
      successRate: allEvents.length > 0 ? (successful.length / allEvents.length) * 100 : 100,
      totalTokens,
    });

    return {
      generated_at: new Date().toISOString(),
      period: {
        start: this.startTime.toISOString(),
        end: endTime.toISOString(),
        duration_hours: Math.max(effectiveDurationHours, 0.01),
      },
      summary: {
        total_requests: allEvents.length,
        total_tokens: totalTokens,
        total_cost: totalCost,
        projected_monthly_cost: effectiveDurationHours > 0 ? (totalCost / effectiveDurationHours) * 24 * 30 : 0,
        cache_savings: cacheSavings,
        success_rate: allEvents.length > 0 ? (successful.length / allEvents.length) * 100 : 100,
        avg_latency_ms: avgLatency,
        p50_latency_ms: percentile(latencies, 50),
        p95_latency_ms: percentile(latencies, 95),
        p99_latency_ms: percentile(latencies, 99),
      },
      costs: {
        by_model: costByModel,
        by_hour: Object.entries(costByHour).map(([hour, data]) => ({
          hour,
          cost: data.cost,
          requests: data.requests,
        })),
        by_pattern_type: costByPattern,
      },
      patterns: {
        conversations: this.conversations,
        multi_tenant: this.multiTenant,
        cascaded_agents: this.cascadedAgents,
      },
      recommendations,
    };
  }

  /**
   * Generate recommendations based on metrics
   */
  private generateRecommendations(metrics: {
    totalCost: number;
    durationHours: number;
    cacheSavings: number;
    avgLatency: number;
    p95Latency: number;
    successRate: number;
    totalTokens: number;
  }): AnalyticsJSON["recommendations"] {
    const recommendations: AnalyticsJSON["recommendations"] = [];

    const projectedMonthly = metrics.durationHours > 0
      ? (metrics.totalCost / metrics.durationHours) * 24 * 30
      : 0;

    // Cache efficiency
    const cacheRatio = metrics.totalCost > 0 ? metrics.cacheSavings / metrics.totalCost : 0;
    if (cacheRatio < 0.1) {
      recommendations.push({
        category: "cost",
        severity: "warning",
        title: "Low Cache Utilization",
        description: "Your cache hit rate is below 10%. Enabling prompt caching for repeated prompts can reduce costs by up to 75%.",
        potential_savings: projectedMonthly * 0.3,
        action: "Enable prompt_cache_key for conversations and repeated system prompts.",
      });
    }

    // High projected cost
    if (projectedMonthly > 1000) {
      recommendations.push({
        category: "cost",
        severity: projectedMonthly > 5000 ? "critical" : "warning",
        title: "High Projected Monthly Cost",
        description: `Your projected monthly cost is $${projectedMonthly.toFixed(0)}. Consider optimizing model selection for different task complexities.`,
        potential_savings: projectedMonthly * 0.25,
        action: "Use gpt-5-mini for simple tasks, reserve gpt-5/o3 for complex reasoning.",
      });
    }

    // High latency
    if (metrics.p95Latency > 5000) {
      recommendations.push({
        category: "performance",
        severity: "warning",
        title: "High P95 Latency",
        description: `Your P95 latency is ${metrics.p95Latency.toFixed(0)}ms. This may impact user experience.`,
        action: "Consider streaming responses, reducing max_output_tokens, or using faster models for time-sensitive requests.",
      });
    }

    // Low success rate
    if (metrics.successRate < 99) {
      recommendations.push({
        category: "reliability",
        severity: metrics.successRate < 95 ? "critical" : "warning",
        title: "Elevated Error Rate",
        description: `Your success rate is ${metrics.successRate.toFixed(1)}%. Investigate error patterns and implement appropriate retry strategies.`,
        action: "Review error logs, implement exponential backoff, and consider fallback models.",
      });
    }

    // Agent optimization
    if (this.cascadedAgents.length > 0) {
      const avgAgentsPerTask = this.cascadedAgents.reduce((sum, a) => sum + a.summary.total_agents, 0) / this.cascadedAgents.length;
      if (avgAgentsPerTask > 5) {
        recommendations.push({
          category: "efficiency",
          severity: "info",
          title: "Complex Agent Hierarchies",
          description: `You're averaging ${avgAgentsPerTask.toFixed(1)} agents per task. Consider consolidating agent responsibilities to reduce overhead.`,
          potential_savings: projectedMonthly * 0.15,
          action: "Review agent decomposition strategy and consider combining related subtasks.",
        });
      }
    }

    // Multi-tenant optimization
    if (this.multiTenant) {
      const overQuotaTenants = this.multiTenant.tenants.filter((t) => t.summary.quota_used > 80);
      if (overQuotaTenants.length > 0) {
        recommendations.push({
          category: "reliability",
          severity: "warning",
          title: "Tenants Approaching Quota",
          description: `${overQuotaTenants.length} tenant(s) are using over 80% of their quota. Consider upgrading their tier or implementing usage alerts.`,
          action: "Set up proactive quota alerts and upsell higher tiers to power users.",
        });
      }
    }

    // All good
    if (recommendations.length === 0) {
      recommendations.push({
        category: "efficiency",
        severity: "info",
        title: "All Systems Healthy",
        description: "Your AI usage metrics look good! Continue monitoring for changes in usage patterns.",
        action: "Maintain current practices and review metrics weekly.",
      });
    }

    return recommendations;
  }

  /**
   * Build and return HTML report
   */
  buildHTML(): string {
    const json = this.buildJSON();
    return generateHTMLReport(json);
  }

  /**
   * Reset the builder
   */
  reset(): void {
    this.events = [];
    this.conversations = [];
    this.multiTenant = null;
    this.cascadedAgents = [];
    this.startTime = new Date();
  }
}

/**
 * Create a metric emitter that feeds into the report builder
 */
export function createReportEmitter(builder: ReportBuilder) {
  return (event: MetricEvent) => {
    builder.recordEvent(event);
  };
}
