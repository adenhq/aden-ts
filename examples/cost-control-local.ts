/**
 * Cost Control Example (Local Mode)
 *
 * Demonstrates the Aden SDK cost control logic without requiring a server.
 * Shows how budget limits, throttling, and model degradation work.
 *
 * Run: npx tsx examples/cost-control-local.ts
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  instrument,
  uninstrument,
  createConsoleEmitter,
  type ControlPolicy,
  type ControlRequest,
  type ControlDecision,
  type ControlAction,
} from "../src/index.js";

// =============================================================================
// Simulated Policy Engine (what the server does)
// =============================================================================

class LocalPolicyEngine {
  private policy: ControlPolicy;
  private budgetSpend: Map<string, number> = new Map();
  private requestCounts: Map<string, { count: number; windowStart: number }> = new Map();

  constructor(policy: ControlPolicy) {
    this.policy = policy;
  }

  /**
   * Evaluate policy and return a decision
   */
  getDecision(request: ControlRequest): ControlDecision {
    // 1. Check block rules
    if (this.policy.blocks) {
      for (const block of this.policy.blocks) {
        if (this.matchesBlockRule(request, block)) {
          return { action: "block", reason: block.reason };
        }
      }
    }

    // 2. Check budget limits
    if (this.policy.budgets && request.context_id) {
      const budget = this.policy.budgets.find((b) => b.context_id === request.context_id);
      if (budget) {
        const currentSpend = this.budgetSpend.get(request.context_id) || 0;
        const projectedSpend = currentSpend + (request.estimated_cost ?? 0);

        if (projectedSpend > budget.limit_usd) {
          if (budget.action_on_exceed === "degrade" && budget.degrade_to_model) {
            return {
              action: "degrade",
              reason: `Budget exceeded: $${projectedSpend.toFixed(4)} > $${budget.limit_usd}`,
              degradeToModel: budget.degrade_to_model,
            };
          }
          return {
            action: budget.action_on_exceed as ControlAction,
            reason: `Budget exceeded: $${projectedSpend.toFixed(4)} > $${budget.limit_usd}`,
          };
        }

        // Check degradation threshold
        if (this.policy.degradations) {
          for (const degrade of this.policy.degradations) {
            if (
              degrade.from_model === request.model &&
              degrade.trigger === "budget_threshold" &&
              degrade.threshold_percent
            ) {
              const usagePercent = (currentSpend / budget.limit_usd) * 100;
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

    // 3. Check throttle rules
    if (this.policy.throttles) {
      for (const throttle of this.policy.throttles) {
        if (!throttle.context_id || throttle.context_id === request.context_id) {
          if (throttle.requests_per_minute) {
            const key = `${throttle.context_id ?? "global"}:${throttle.provider ?? "all"}`;
            const rateInfo = this.checkRateLimit(key, throttle.requests_per_minute);
            if (rateInfo.exceeded) {
              return {
                action: "throttle",
                reason: `Rate limit: ${rateInfo.count}/${throttle.requests_per_minute}/min`,
                throttleDelayMs: throttle.delay_ms ?? 1000,
              };
            }
          }
        }
      }
    }

    return { action: "allow" };
  }

  /**
   * Record spend for a context
   */
  recordSpend(contextId: string, amount: number): void {
    const current = this.budgetSpend.get(contextId) || 0;
    this.budgetSpend.set(contextId, current + amount);
  }

  /**
   * Get current spend for a context
   */
  getSpend(contextId: string): number {
    return this.budgetSpend.get(contextId) || 0;
  }

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

  private checkRateLimit(key: string, limit: number): { exceeded: boolean; count: number } {
    const now = Date.now();
    const windowMs = 60000;

    let info = this.requestCounts.get(key);
    if (!info || now - info.windowStart > windowMs) {
      info = { count: 0, windowStart: now };
    }

    info.count++;
    this.requestCounts.set(key, info);

    return { exceeded: info.count > limit, count: info.count };
  }
}

// =============================================================================
// Demo
// =============================================================================

async function runLocalDemo() {
  console.log("=".repeat(60));
  console.log("🎯 Aden SDK - Cost Control Demo (Local Mode)");
  console.log("=".repeat(60));

  // Define a cost control policy
  const policy: ControlPolicy = {
    version: "demo-1",
    updated_at: new Date().toISOString(),

    // Budget rules
    budgets: [
      {
        context_id: "user_free_tier",
        limit_usd: 0.01, // $0.01 for free tier
        current_spend_usd: 0,
        action_on_exceed: "block",
      },
      {
        context_id: "user_pro_tier",
        limit_usd: 1.0, // $1.00 for pro tier
        current_spend_usd: 0,
        action_on_exceed: "degrade",
        degrade_to_model: "gpt-4o-mini",
      },
    ],

    // Degradation rules
    degradations: [
      {
        from_model: "gpt-4o",
        to_model: "gpt-4o-mini",
        trigger: "budget_threshold",
        threshold_percent: 80,
        context_id: "user_pro_tier",
      },
    ],

    // Throttle rules
    throttles: [
      {
        context_id: "user_free_tier",
        requests_per_minute: 5,
      },
    ],

    // Block rules
    blocks: [
      {
        context_id: "user_banned",
        reason: "Account suspended for policy violation",
      },
      {
        model_pattern: "gpt-4o",
        context_id: "user_free_tier",
        reason: "GPT-4o not available on free tier",
      },
    ],
  };

  console.log("\n📋 Policy Configuration:");
  console.log(JSON.stringify(policy, null, 2));

  // Create policy engine
  const engine = new LocalPolicyEngine(policy);

  // Test scenarios
  console.log("\n" + "=".repeat(60));
  console.log("🧪 Testing Policy Decisions");
  console.log("=".repeat(60));

  const testCases: Array<{ name: string; request: ControlRequest; simulateSpend?: number }> = [
    {
      name: "Free tier user - GPT-4o-mini request",
      request: {
        context_id: "user_free_tier",
        provider: "openai",
        model: "gpt-4o-mini",
        estimated_cost: 0.001,
      },
    },
    {
      name: "Free tier user - GPT-4o (blocked model)",
      request: {
        context_id: "user_free_tier",
        provider: "openai",
        model: "gpt-4o",
        estimated_cost: 0.01,
      },
    },
    {
      name: "Banned user - any request",
      request: {
        context_id: "user_banned",
        provider: "openai",
        model: "gpt-4o-mini",
        estimated_cost: 0.001,
      },
    },
    {
      name: "Pro tier user - GPT-4o at 50% budget",
      request: {
        context_id: "user_pro_tier",
        provider: "openai",
        model: "gpt-4o",
        estimated_cost: 0.05,
      },
      simulateSpend: 0.5, // Already spent $0.50 of $1.00
    },
    {
      name: "Pro tier user - GPT-4o at 85% budget (should degrade)",
      request: {
        context_id: "user_pro_tier",
        provider: "openai",
        model: "gpt-4o",
        estimated_cost: 0.05,
      },
      simulateSpend: 0.85, // Already spent $0.85 of $1.00
    },
    {
      name: "Free tier user - budget exceeded",
      request: {
        context_id: "user_free_tier",
        provider: "openai",
        model: "gpt-4o-mini",
        estimated_cost: 0.005,
      },
      simulateSpend: 0.008, // Already spent $0.008 of $0.01
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📌 ${testCase.name}`);
    console.log(`   Request: ${testCase.request.model} (est. $${testCase.request.estimated_cost})`);

    // Simulate prior spend if specified
    if (testCase.simulateSpend !== undefined && testCase.request.context_id) {
      // Reset and set spend
      engine.recordSpend(
        testCase.request.context_id,
        testCase.simulateSpend - engine.getSpend(testCase.request.context_id)
      );
      console.log(`   Prior spend: $${testCase.simulateSpend.toFixed(4)}`);
    }

    const decision = engine.getDecision(testCase.request);

    const actionEmoji = {
      allow: "✅",
      block: "🚫",
      throttle: "⏳",
      degrade: "📉",
    }[decision.action];

    console.log(`   Decision: ${actionEmoji} ${decision.action.toUpperCase()}`);
    if (decision.reason) console.log(`   Reason: ${decision.reason}`);
    if (decision.degradeToModel) console.log(`   Use instead: ${decision.degradeToModel}`);
    if (decision.throttleDelayMs) console.log(`   Wait: ${decision.throttleDelayMs}ms`);
  }

  // Show rate limiting
  console.log("\n" + "=".repeat(60));
  console.log("⏱️  Testing Rate Limiting (5 req/min for free tier)");
  console.log("=".repeat(60));

  // Create fresh engine for rate limit test
  const rateLimitEngine = new LocalPolicyEngine(policy);

  for (let i = 1; i <= 7; i++) {
    const decision = rateLimitEngine.getDecision({
      context_id: "user_free_tier",
      provider: "openai",
      model: "gpt-4o-mini",
      estimated_cost: 0.0001,
    });

    const status = decision.action === "allow" ? "✅ allowed" : `⏳ throttled (${decision.reason})`;
    console.log(`   Request ${i}: ${status}`);
  }

  console.log("\n✨ Demo complete!\n");
}

// =============================================================================
// Live Demo with OpenAI (requires OPENAI_API_KEY)
// =============================================================================

async function runLiveDemo() {
  console.log("\n" + "=".repeat(60));
  console.log("🔴 Live Demo with OpenAI");
  console.log("=".repeat(60));

  if (!process.env.OPENAI_API_KEY) {
    console.log("\n⚠️  OPENAI_API_KEY not set - skipping live demo\n");
    return;
  }

  const openai = new OpenAI();

  // Instrument with console output
  await instrument({
    emitMetric: createConsoleEmitter({ pretty: true }),
    sdks: { OpenAI },
  });

  console.log("\n📤 Making a real request...\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "What is 2+2? Reply in one word." }],
      max_tokens: 10,
    });

    console.log("\nResponse:", response.choices[0]?.message?.content);
    console.log("Tokens used:", response.usage?.total_tokens);
  } catch (error: any) {
    console.error("Request failed:", error.message);
  }

  await uninstrument();
}

// Run demos
async function main() {
  await runLocalDemo();
  await runLiveDemo();
}

main().catch(console.error);
