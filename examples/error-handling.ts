/**
 * Error Handling & Retry Tracking Example
 *
 * Demonstrates how to:
 * 1. Track failed requests and errors
 * 2. Detect retry patterns and potential double-billing
 * 3. Monitor rate limits and adjust accordingly
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  withBudgetGuardrails,
  BudgetExceededError,
  type MetricEvent,
} from "../src/index.js";

/**
 * Request tracker for monitoring errors and retries
 */
class RequestMonitor {
  private requests: Map<
    string,
    {
      event: MetricEvent;
      retryCount: number;
      timestamps: Date[];
    }
  > = new Map();

  private errorCounts: Record<string, number> = {};
  private totalRequests = 0;
  private failedRequests = 0;

  track(event: MetricEvent) {
    this.totalRequests++;

    // Track by trace ID
    const existing = this.requests.get(event.traceId);
    if (existing) {
      // This is a retry
      existing.retryCount++;
      existing.timestamps.push(new Date());
      console.log(`⚠️  Retry detected for ${event.traceId} (attempt ${existing.retryCount + 1})`);
    } else {
      this.requests.set(event.traceId, {
        event,
        retryCount: 0,
        timestamps: [new Date()],
      });
    }

    // Track errors
    if (event.error) {
      this.failedRequests++;
      const errorType = this.classifyError(event.error);
      this.errorCounts[errorType] = (this.errorCounts[errorType] ?? 0) + 1;

      console.log(`❌ Request failed: ${event.error}`);
      console.log(`   Error type: ${errorType}`);
      console.log(`   Model: ${event.model}`);
      console.log(`   Latency: ${event.latency_ms}ms`);
    } else {
      console.log(`✓ Request succeeded`);
      console.log(`   Model: ${event.model}`);
      console.log(`   Tokens: ${event.usage?.input_tokens ?? 0} in / ${event.usage?.output_tokens ?? 0} out`);
      console.log(`   Latency: ${event.latency_ms}ms`);
    }
  }

  private classifyError(error: string): string {
    if (error.includes("rate_limit") || error.includes("429")) {
      return "rate_limit";
    }
    if (error.includes("timeout") || error.includes("ETIMEDOUT")) {
      return "timeout";
    }
    if (error.includes("context_length") || error.includes("maximum context")) {
      return "context_exceeded";
    }
    if (error.includes("invalid_api_key") || error.includes("401")) {
      return "auth_error";
    }
    if (error.includes("insufficient_quota")) {
      return "quota_exceeded";
    }
    if (error.includes("server_error") || error.includes("500")) {
      return "server_error";
    }
    return "unknown";
  }

  getStats() {
    const retries = Array.from(this.requests.values()).filter((r) => r.retryCount > 0);
    const totalRetries = retries.reduce((sum, r) => sum + r.retryCount, 0);

    return {
      totalRequests: this.totalRequests,
      uniqueRequests: this.requests.size,
      failedRequests: this.failedRequests,
      successRate: ((this.totalRequests - this.failedRequests) / this.totalRequests) * 100,
      retriedRequests: retries.length,
      totalRetries,
      errorsByType: this.errorCounts,
    };
  }

  printReport() {
    const stats = this.getStats();
    console.log("\n=== Request Monitor Report ===");
    console.log(`Total requests: ${stats.totalRequests}`);
    console.log(`Unique requests: ${stats.uniqueRequests}`);
    console.log(`Failed requests: ${stats.failedRequests}`);
    console.log(`Success rate: ${stats.successRate.toFixed(1)}%`);
    console.log(`Retried requests: ${stats.retriedRequests}`);
    console.log(`Total retries: ${stats.totalRetries}`);

    if (Object.keys(stats.errorsByType).length > 0) {
      console.log("\nErrors by type:");
      for (const [type, count] of Object.entries(stats.errorsByType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
  }
}

// Create monitor
const monitor = new RequestMonitor();

// Create metered client with error tracking
const baseClient = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: (event) => {
    monitor.track(event);
  },
});

// Add budget guardrails that will trigger errors
const client = withBudgetGuardrails(baseClient, {
  maxInputTokens: 50, // Very low limit to trigger budget errors
  onExceeded: "throw",
});

async function demonstrateErrorHandling() {
  console.log("=== Error Handling Example ===\n");

  // Test 1: Normal successful request
  console.log("--- Test 1: Normal request ---");
  try {
    await baseClient.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Hi",
      max_output_tokens: 50,
    });
  } catch (error) {
    console.log("Unexpected error:", error);
  }

  console.log("\n--- Test 2: Budget exceeded ---");
  try {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Tell me a very long and detailed story about a magical kingdom with dragons, wizards, and brave knights who embark on epic quests.",
      max_output_tokens: 100,
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      console.log(`Budget exceeded: ${error.estimatedInputTokens} tokens > ${error.maxInputTokens} limit`);
    } else {
      console.log("Error:", error);
    }
  }

  console.log("\n--- Test 3: Another successful request ---");
  try {
    await baseClient.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Hello!",
      max_output_tokens: 50,
    });
  } catch (error) {
    console.log("Error:", error);
  }

  // Print final report
  monitor.printReport();
}

demonstrateErrorHandling().catch(console.error);
