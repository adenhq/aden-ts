/**
 * Cost Tracking Example
 *
 * Demonstrates how to:
 * 1. Calculate costs per request based on model pricing
 * 2. Track cumulative spend across sessions
 * 3. Set up cost alerts and limits
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  type MetricEvent,
  type NormalizedUsage,
} from "../src/index.js";

// Model pricing (per 1M tokens) - update these based on current OpenAI pricing
const MODEL_PRICING: Record<string, { input: number; output: number; cached?: number }> = {
  "gpt-5": { input: 2.00, output: 8.00, cached: 0.50 },
  "gpt-5-mini": { input: 0.40, output: 1.60, cached: 0.10 },
  "gpt-4.1": { input: 2.00, output: 8.00, cached: 0.50 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60, cached: 0.10 },
  "gpt-4.1-nano": { input: 0.10, output: 0.40, cached: 0.025 },
  "gpt-4o": { input: 2.50, output: 10.00, cached: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, cached: 0.075 },
  "o3": { input: 10.00, output: 40.00 },
  "o3-mini": { input: 1.10, output: 4.40 },
};

/**
 * Calculate cost for a single request
 */
function calculateCost(model: string, usage: NormalizedUsage | null): number {
  if (!usage) return 0;

  // Find pricing - try exact match first, then prefix match
  let pricing = MODEL_PRICING[model];
  if (!pricing) {
    const baseModel = Object.keys(MODEL_PRICING).find((key) => model.startsWith(key));
    pricing = baseModel ? MODEL_PRICING[baseModel] : { input: 0, output: 0 };
  }

  // Calculate tokens (accounting for cache)
  const uncachedInputTokens = usage.input_tokens - usage.cached_tokens;
  const cachedTokens = usage.cached_tokens;

  // Cost calculation (pricing is per 1M tokens)
  const inputCost = (uncachedInputTokens / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * (pricing.cached ?? pricing.input * 0.5);
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;

  return inputCost + cachedCost + outputCost;
}

/**
 * Cost tracker class for managing spend
 */
class CostTracker {
  private totalCost = 0;
  private requestCount = 0;
  private costByModel: Record<string, number> = {};
  private budgetLimit: number | null = null;
  private onBudgetAlert?: (current: number, limit: number) => void;

  setBudgetLimit(limit: number, onAlert?: (current: number, limit: number) => void) {
    this.budgetLimit = limit;
    this.onBudgetAlert = onAlert;
  }

  track(event: MetricEvent) {
    const cost = calculateCost(event.model, event.usage);
    this.totalCost += cost;
    this.requestCount++;

    // Track by model
    const baseModel = event.model.split("-").slice(0, 2).join("-");
    this.costByModel[baseModel] = (this.costByModel[baseModel] ?? 0) + cost;

    // Check budget
    if (this.budgetLimit && this.totalCost >= this.budgetLimit * 0.8) {
      this.onBudgetAlert?.(this.totalCost, this.budgetLimit);
    }

    return cost;
  }

  getStats() {
    return {
      totalCost: this.totalCost,
      requestCount: this.requestCount,
      averageCostPerRequest: this.requestCount > 0 ? this.totalCost / this.requestCount : 0,
      costByModel: this.costByModel,
    };
  }

  reset() {
    this.totalCost = 0;
    this.requestCount = 0;
    this.costByModel = {};
  }
}

// Create cost tracker
const costTracker = new CostTracker();

// Set a budget limit with alert
costTracker.setBudgetLimit(0.10, (current, limit) => {
  console.log(`⚠️  Budget alert: $${current.toFixed(4)} of $${limit.toFixed(2)} used (${((current / limit) * 100).toFixed(1)}%)`);
});

// Create metered client with cost tracking
const client = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: (event) => {
    const cost = costTracker.track(event);

    console.log(`[${event.model}] ${event.usage?.input_tokens ?? 0} in / ${event.usage?.output_tokens ?? 0} out`);
    console.log(`  Cost: $${cost.toFixed(6)} | Total: $${costTracker.getStats().totalCost.toFixed(6)}`);

    if (event.usage?.cached_tokens) {
      console.log(`  Cache savings: ${event.usage.cached_tokens} tokens cached`);
    }
  },
});

async function main() {
  console.log("=== Cost Tracking Example ===\n");

  // Make several requests
  const prompts = [
    "What is JavaScript?",
    "Explain closures in JavaScript",
    "What are Promises?",
    "How does async/await work?",
    "What is the event loop?",
  ];

  for (const prompt of prompts) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: prompt,
      max_output_tokens: 150,
    });
    console.log("");
  }

  // Print final stats
  const stats = costTracker.getStats();
  console.log("\n=== Session Summary ===");
  console.log(`Total requests: ${stats.requestCount}`);
  console.log(`Total cost: $${stats.totalCost.toFixed(6)}`);
  console.log(`Average cost/request: $${stats.averageCostPerRequest.toFixed(6)}`);
  console.log("Cost by model:", stats.costByModel);
}

main().catch(console.error);
