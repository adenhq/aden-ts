import type { MetricEvent } from "./types.js";

/**
 * Time-series data point for trend analysis
 */
interface TimeSeriesPoint {
  timestamp: Date;
  value: number;
}

/**
 * Comprehensive analytics for CTO-level reporting
 */
export interface AnalyticsReport {
  // Cost metrics
  costs: {
    total: number;
    byModel: Record<string, number>;
    byHour: TimeSeriesPoint[];
    projectedMonthly: number;
    cacheSavings: number;
    avgCostPerRequest: number;
    avgCostPer1kTokens: number;
  };

  // Performance metrics
  performance: {
    avgLatency: number;
    p50Latency: number;
    p95Latency: number;
    p99Latency: number;
    requestsPerMinute: number;
    tokensPerSecond: number;
  };

  // Efficiency metrics
  efficiency: {
    cacheHitRate: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    inputOutputRatio: number;
    reasoningOverhead: number;
  };

  // Reliability metrics
  reliability: {
    successRate: number;
    errorRate: number;
    errorsByType: Record<string, number>;
    avgRetriesPerRequest: number;
  };

  // Usage patterns
  usage: {
    totalRequests: number;
    totalTokens: number;
    peakRequestsPerMinute: number;
    peakHour: string;
    modelDistribution: Record<string, number>;
  };
}

/**
 * Model pricing for cost calculations (per 1M tokens)
 */
const DEFAULT_PRICING: Record<string, { input: number; output: number; cached: number }> = {
  "gpt-5": { input: 2.00, output: 8.00, cached: 0.50 },
  "gpt-5-mini": { input: 0.40, output: 1.60, cached: 0.10 },
  "gpt-4.1": { input: 2.00, output: 8.00, cached: 0.50 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60, cached: 0.10 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40, cached: 0.025 },
  "gpt-4o": { input: 2.50, output: 10.00, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, cached: 0.075 },
  "o3": { input: 10.00, output: 40.00, cached: 2.50 },
  "o3-mini": { input: 1.10, output: 4.40, cached: 0.275 },
};

/**
 * Analytics engine for collecting and analyzing metrics
 */
export class AnalyticsEngine {
  private events: MetricEvent[] = [];
  private pricing: Record<string, { input: number; output: number; cached: number }>;
  private startTime: Date = new Date();

  constructor(customPricing?: Record<string, { input: number; output: number; cached: number }>) {
    this.pricing = { ...DEFAULT_PRICING, ...customPricing };
  }

  /**
   * Record a metric event
   */
  record(event: MetricEvent): void {
    this.events.push(event);
  }

  /**
   * Get the pricing for a model (with fallback to base model)
   */
  private getModelPricing(model: string): { input: number; output: number; cached: number } {
    if (this.pricing[model]) return this.pricing[model];

    // Try prefix matching (e.g., "gpt-4.1-mini-2025-04-14" -> "gpt-4.1-mini")
    for (const key of Object.keys(this.pricing)) {
      if (model.startsWith(key)) {
        return this.pricing[key];
      }
    }

    // Default fallback
    return { input: 1.0, output: 3.0, cached: 0.25 };
  }

  /**
   * Calculate cost for a single event
   */
  private calculateEventCost(event: MetricEvent): number {
    if (event.input_tokens === 0 && event.output_tokens === 0) return 0;

    const pricing = this.getModelPricing(event.model);
    const uncachedInput = event.input_tokens - event.cached_tokens;
    const cachedInput = event.cached_tokens;

    return (
      (uncachedInput / 1_000_000) * pricing.input +
      (cachedInput / 1_000_000) * pricing.cached +
      (event.output_tokens / 1_000_000) * pricing.output
    );
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Generate comprehensive analytics report
   */
  generateReport(): AnalyticsReport {
    const successful = this.events.filter((e) => !e.error);
    const failed = this.events.filter((e) => e.error);

    // Cost calculations
    const costByModel: Record<string, number> = {};
    let totalCost = 0;
    let totalCacheSavings = 0;

    for (const event of this.events) {
      const cost = this.calculateEventCost(event);
      totalCost += cost;

      const baseModel = event.model.split("-").slice(0, 2).join("-");
      costByModel[baseModel] = (costByModel[baseModel] ?? 0) + cost;

      // Calculate cache savings
      if (event.cached_tokens > 0) {
        const pricing = this.getModelPricing(event.model);
        const savedCost = (event.cached_tokens / 1_000_000) * (pricing.input - pricing.cached);
        totalCacheSavings += savedCost;
      }
    }

    // Hourly cost breakdown
    const hourlyBuckets: Record<string, number> = {};
    for (const event of this.events) {
      // Use the event's approximate timestamp (startTime + latency gives us roughly when it completed)
      const eventTime = new Date(this.startTime.getTime() + event.latency_ms);
      // Create an ISO string for the hour bucket: "2025-12-15T10:00:00.000Z"
      const hourKey = eventTime.toISOString().slice(0, 13) + ":00:00.000Z";
      hourlyBuckets[hourKey] = (hourlyBuckets[hourKey] ?? 0) + this.calculateEventCost(event);
    }
    const costByHour = Object.entries(hourlyBuckets).map(([hourKey, value]) => ({
      timestamp: new Date(hourKey),
      value,
    }));

    // Performance calculations
    const latencies = successful.map((e) => e.latency_ms).sort((a, b) => a - b);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    // Duration for rate calculations
    const durationMs = this.events.length > 0
      ? Math.max(1000, Date.now() - this.startTime.getTime())
      : 1000;
    const durationMinutes = durationMs / 60000;

    // Token calculations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalReasoningTokens = 0;

    for (const event of this.events) {
      totalInputTokens += event.input_tokens;
      totalOutputTokens += event.output_tokens;
      totalCachedTokens += event.cached_tokens;
      totalReasoningTokens += event.reasoning_tokens;
    }

    const totalTokens = totalInputTokens + totalOutputTokens;

    // Error classification
    const errorsByType: Record<string, number> = {};
    for (const event of failed) {
      const errorType = this.classifyError(event.error ?? "unknown");
      errorsByType[errorType] = (errorsByType[errorType] ?? 0) + 1;
    }

    // Model distribution
    const modelDistribution: Record<string, number> = {};
    for (const event of this.events) {
      const baseModel = event.model.split("-").slice(0, 2).join("-");
      modelDistribution[baseModel] = (modelDistribution[baseModel] ?? 0) + 1;
    }

    // Calculate peak requests per minute
    const minuteBuckets: Record<string, number> = {};
    for (let i = 0; i < this.events.length; i++) {
      const minute = Math.floor(i / 60).toString();
      minuteBuckets[minute] = (minuteBuckets[minute] ?? 0) + 1;
    }
    const peakRequestsPerMinute = Math.max(...Object.values(minuteBuckets), 0);

    // Project monthly cost (based on current rate)
    const hoursElapsed = durationMs / 3600000;
    const projectedMonthly = hoursElapsed > 0 ? (totalCost / hoursElapsed) * 24 * 30 : 0;

    return {
      costs: {
        total: totalCost,
        byModel: costByModel,
        byHour: costByHour,
        projectedMonthly,
        cacheSavings: totalCacheSavings,
        avgCostPerRequest: this.events.length > 0 ? totalCost / this.events.length : 0,
        avgCostPer1kTokens: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
      },
      performance: {
        avgLatency,
        p50Latency: this.percentile(latencies, 50),
        p95Latency: this.percentile(latencies, 95),
        p99Latency: this.percentile(latencies, 99),
        requestsPerMinute: this.events.length / Math.max(durationMinutes, 1),
        tokensPerSecond: totalTokens / (durationMs / 1000),
      },
      efficiency: {
        cacheHitRate: totalInputTokens > 0 ? (totalCachedTokens / totalInputTokens) * 100 : 0,
        avgInputTokens: this.events.length > 0 ? totalInputTokens / this.events.length : 0,
        avgOutputTokens: this.events.length > 0 ? totalOutputTokens / this.events.length : 0,
        inputOutputRatio: totalOutputTokens > 0 ? totalInputTokens / totalOutputTokens : 0,
        reasoningOverhead: totalOutputTokens > 0 ? (totalReasoningTokens / totalOutputTokens) * 100 : 0,
      },
      reliability: {
        successRate: this.events.length > 0 ? (successful.length / this.events.length) * 100 : 100,
        errorRate: this.events.length > 0 ? (failed.length / this.events.length) * 100 : 0,
        errorsByType,
        avgRetriesPerRequest: 0, // Would need retry tracking
      },
      usage: {
        totalRequests: this.events.length,
        totalTokens,
        peakRequestsPerMinute,
        peakHour: costByHour.length > 0
          ? costByHour.reduce((a, b) => (a.value > b.value ? a : b)).timestamp.toISOString()
          : "N/A",
        modelDistribution,
      },
    };
  }

  /**
   * Classify error type
   */
  private classifyError(error: string): string {
    const lower = error.toLowerCase();
    if (lower.includes("rate_limit") || lower.includes("429")) return "rate_limit";
    if (lower.includes("timeout") || lower.includes("etimedout")) return "timeout";
    if (lower.includes("context_length") || lower.includes("maximum context")) return "context_exceeded";
    if (lower.includes("invalid_api_key") || lower.includes("401")) return "auth_error";
    if (lower.includes("insufficient_quota")) return "quota_exceeded";
    if (lower.includes("server_error") || lower.includes("500")) return "server_error";
    if (lower.includes("budget")) return "budget_exceeded";
    return "unknown";
  }

  /**
   * Format report as markdown for CTO presentation
   */
  formatMarkdown(report: AnalyticsReport): string {
    return `# AI Usage Analytics Report

Generated: ${new Date().toISOString()}

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Spend | $${report.costs.total.toFixed(4)} |
| Projected Monthly | $${report.costs.projectedMonthly.toFixed(2)} |
| Cache Savings | $${report.costs.cacheSavings.toFixed(4)} |
| Success Rate | ${report.reliability.successRate.toFixed(1)}% |
| Avg Latency | ${report.performance.avgLatency.toFixed(0)}ms |

## Cost Analysis

### Spend by Model
${Object.entries(report.costs.byModel)
  .sort(([, a], [, b]) => b - a)
  .map(([model, cost]) => `- **${model}**: $${cost.toFixed(4)}`)
  .join("\n")}

### Cost Efficiency
- Average cost per request: $${report.costs.avgCostPerRequest.toFixed(6)}
- Average cost per 1K tokens: $${report.costs.avgCostPer1kTokens.toFixed(6)}
- Cache hit rate: ${report.efficiency.cacheHitRate.toFixed(1)}%
- Cache savings: $${report.costs.cacheSavings.toFixed(4)}

## Performance Metrics

| Percentile | Latency |
|------------|---------|
| p50 | ${report.performance.p50Latency.toFixed(0)}ms |
| p95 | ${report.performance.p95Latency.toFixed(0)}ms |
| p99 | ${report.performance.p99Latency.toFixed(0)}ms |

- Requests per minute: ${report.performance.requestsPerMinute.toFixed(2)}
- Tokens per second: ${report.performance.tokensPerSecond.toFixed(1)}

## Token Efficiency

- Average input tokens: ${report.efficiency.avgInputTokens.toFixed(0)}
- Average output tokens: ${report.efficiency.avgOutputTokens.toFixed(0)}
- Input/Output ratio: ${report.efficiency.inputOutputRatio.toFixed(2)}:1
- Reasoning overhead: ${report.efficiency.reasoningOverhead.toFixed(1)}%

## Reliability

- Success rate: ${report.reliability.successRate.toFixed(1)}%
- Error rate: ${report.reliability.errorRate.toFixed(1)}%
${Object.keys(report.reliability.errorsByType).length > 0
  ? "\n### Errors by Type\n" +
    Object.entries(report.reliability.errorsByType)
      .map(([type, count]) => `- ${type}: ${count}`)
      .join("\n")
  : ""}

## Usage Patterns

- Total requests: ${report.usage.totalRequests.toLocaleString()}
- Total tokens: ${report.usage.totalTokens.toLocaleString()}
- Peak requests/min: ${report.usage.peakRequestsPerMinute}

### Model Distribution
${Object.entries(report.usage.modelDistribution)
  .sort(([, a], [, b]) => b - a)
  .map(([model, count]) => {
    const pct = ((count / report.usage.totalRequests) * 100).toFixed(1);
    return `- ${model}: ${count} (${pct}%)`;
  })
  .join("\n")}

---

## Recommendations

${this.generateRecommendations(report)}
`;
  }

  /**
   * Generate actionable recommendations based on metrics
   */
  private generateRecommendations(report: AnalyticsReport): string {
    const recommendations: string[] = [];

    // Cost recommendations
    if (report.efficiency.cacheHitRate < 20) {
      recommendations.push(
        "🔄 **Enable prompt caching**: Your cache hit rate is low. Use `prompt_cache_key` to improve cache hits and reduce costs by up to 75% on repeated prompts."
      );
    }

    if (report.costs.projectedMonthly > 1000) {
      recommendations.push(
        "💰 **Consider model optimization**: Your projected monthly spend is significant. Evaluate if smaller models (e.g., gpt-4.1-mini instead of gpt-4.1) can handle simpler tasks."
      );
    }

    // Performance recommendations
    if (report.performance.p95Latency > 5000) {
      recommendations.push(
        "⚡ **Optimize latency**: P95 latency is high. Consider streaming responses for better UX, or reducing `max_output_tokens` where possible."
      );
    }

    // Efficiency recommendations
    if (report.efficiency.inputOutputRatio > 10) {
      recommendations.push(
        "📝 **Review prompt efficiency**: Input tokens significantly exceed output. Consider summarizing context or using conversation compaction."
      );
    }

    if (report.efficiency.reasoningOverhead > 50) {
      recommendations.push(
        "🧠 **Tune reasoning effort**: Reasoning tokens are consuming >50% of output. For simpler tasks, use `reasoning: { effort: 'low' }` to reduce costs."
      );
    }

    // Reliability recommendations
    if (report.reliability.errorRate > 5) {
      recommendations.push(
        "⚠️ **Investigate errors**: Error rate exceeds 5%. Review error types and implement appropriate retry strategies."
      );
    }

    if (report.reliability.errorsByType["rate_limit"] > 0) {
      recommendations.push(
        "🚦 **Implement rate limiting**: You're hitting rate limits. Add client-side throttling or upgrade to a higher tier."
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ **All metrics look healthy!** Continue monitoring for changes in usage patterns.");
    }

    return recommendations.join("\n\n");
  }

  /**
   * Reset analytics data
   */
  reset(): void {
    this.events = [];
    this.startTime = new Date();
  }

  /**
   * Get raw events
   */
  getEvents(): MetricEvent[] {
    return [...this.events];
  }
}

/**
 * Create an emitter that feeds into the analytics engine
 */
export function createAnalyticsEmitter(engine: AnalyticsEngine) {
  return (event: MetricEvent) => {
    engine.record(event);
  };
}
