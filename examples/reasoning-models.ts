/**
 * Reasoning Models Tracking Example
 *
 * Demonstrates how to:
 * 1. Track reasoning tokens for o-series models (o3, o3-mini)
 * 2. Monitor thinking vs output token ratio
 * 3. Optimize reasoning effort settings
 */

import "dotenv/config";
import OpenAI from "openai";
import { makeMeteredOpenAI, type MetricEvent, type NormalizedUsage } from "../src/index.js";

/**
 * Reasoning metrics tracker
 */
class ReasoningTracker {
  private requests: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    visibleOutputTokens: number;
    latency: number;
    reasoningEffort?: string;
  }> = [];

  track(event: MetricEvent, reasoningEffort?: string) {
    if (!event.usage) return;

    const reasoningTokens = event.usage.reasoning_tokens;
    const visibleOutputTokens = event.usage.output_tokens - reasoningTokens;

    this.requests.push({
      model: event.model,
      inputTokens: event.usage.input_tokens,
      outputTokens: event.usage.output_tokens,
      reasoningTokens,
      visibleOutputTokens,
      latency: event.latency_ms,
      reasoningEffort,
    });

    // Calculate metrics
    const reasoningRatio = event.usage.output_tokens > 0
      ? (reasoningTokens / event.usage.output_tokens) * 100
      : 0;

    const thinkingMultiplier = visibleOutputTokens > 0
      ? reasoningTokens / visibleOutputTokens
      : 0;

    console.log(`[${event.model}] Reasoning Analysis`);
    console.log(`  Input: ${event.usage.input_tokens} tokens`);
    console.log(`  Output: ${event.usage.output_tokens} tokens total`);
    console.log(`    - Reasoning (hidden): ${reasoningTokens} tokens`);
    console.log(`    - Visible output: ${visibleOutputTokens} tokens`);
    console.log(`  Reasoning ratio: ${reasoningRatio.toFixed(1)}% of output is thinking`);
    console.log(`  Thinking multiplier: ${thinkingMultiplier.toFixed(1)}x more thinking than output`);
    console.log(`  Latency: ${event.latency_ms}ms`);

    // Cost impact warning
    if (reasoningTokens > visibleOutputTokens * 5) {
      console.log(`  ⚠️  High reasoning overhead - consider reducing effort`);
    }
  }

  getAggregateStats() {
    if (this.requests.length === 0) return null;

    const totals = this.requests.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        reasoningTokens: acc.reasoningTokens + r.reasoningTokens,
        visibleOutputTokens: acc.visibleOutputTokens + r.visibleOutputTokens,
        latency: acc.latency + r.latency,
      }),
      { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, visibleOutputTokens: 0, latency: 0 }
    );

    return {
      requestCount: this.requests.length,
      ...totals,
      avgReasoningRatio: (totals.reasoningTokens / totals.outputTokens) * 100,
      avgLatency: totals.latency / this.requests.length,
    };
  }

  printReport() {
    const stats = this.getAggregateStats();
    if (!stats) {
      console.log("No requests tracked");
      return;
    }

    console.log("\n=== Reasoning Models Report ===");
    console.log(`Total requests: ${stats.requestCount}`);
    console.log(`Total input tokens: ${stats.inputTokens.toLocaleString()}`);
    console.log(`Total output tokens: ${stats.outputTokens.toLocaleString()}`);
    console.log(`  - Reasoning: ${stats.reasoningTokens.toLocaleString()} (${stats.avgReasoningRatio.toFixed(1)}%)`);
    console.log(`  - Visible: ${stats.visibleOutputTokens.toLocaleString()}`);
    console.log(`Average latency: ${stats.avgLatency.toFixed(0)}ms`);

    // Cost analysis
    const reasoningCostMultiplier = stats.outputTokens / stats.visibleOutputTokens;
    console.log(`\nCost impact: Output costs ${reasoningCostMultiplier.toFixed(1)}x more than visible text`);
  }
}

// Create tracker
const reasoningTracker = new ReasoningTracker();
let currentReasoningEffort: string | undefined;

// Create metered client
const client = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: (event) => {
    reasoningTracker.track(event, currentReasoningEffort);
  },
});

async function demonstrateReasoningTracking() {
  console.log("=== Reasoning Models Example ===\n");
  console.log("Note: This example uses gpt-5-mini-2025-08-07 to simulate.");
  console.log("Replace with o3 or o3-mini to see actual reasoning tokens.\n");

  // Example 1: Simple question (low reasoning expected)
  console.log("--- Test 1: Simple factual question ---");
  currentReasoningEffort = "low";

  await client.responses.create({
    model: "gpt-5-mini-2025-08-07", // Use "o3-mini" for actual reasoning
    input: "What is 2 + 2?",
    max_output_tokens: 100,
    // For o-series models:
    // reasoning: { effort: "low" },
  });

  console.log("\n--- Test 2: Complex reasoning question ---");
  currentReasoningEffort = "medium";

  await client.responses.create({
    model: "gpt-5-mini-2025-08-07", // Use "o3" for actual reasoning
    input: `Solve this step by step:
    A farmer has chickens and cows. If there are 30 heads and 74 legs total,
    how many chickens and how many cows does the farmer have?`,
    max_output_tokens: 500,
    // For o-series models:
    // reasoning: { effort: "medium" },
  });

  console.log("\n--- Test 3: Code generation with reasoning ---");
  currentReasoningEffort = "high";

  await client.responses.create({
    model: "gpt-5-mini-2025-08-07", // Use "o3" for actual reasoning
    input: `Write a function that finds all prime numbers up to n using the Sieve of Eratosthenes.
    Explain your reasoning for each step.`,
    max_output_tokens: 800,
    // For o-series models:
    // reasoning: { effort: "high" },
  });

  // Print aggregate report
  reasoningTracker.printReport();

  console.log("\n💡 Tip: With actual o-series models, you'll see reasoning tokens");
  console.log("   in output_tokens_details.reasoning_tokens");
}

demonstrateReasoningTracking().catch(console.error);
