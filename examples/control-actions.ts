/**
 * Control Actions Example
 *
 * Demonstrates all control actions in the Aden SDK:
 * 1. allow   - Request proceeds normally
 * 2. block   - Request is rejected (budget exceeded)
 * 3. throttle - Request is delayed before proceeding
 * 4. degrade  - Request uses a cheaper model
 * 5. alert    - Request proceeds but triggers notification
 *
 * Prerequisites:
 * 1. Set ADEN_API_KEY in .env
 * 2. Set ADEN_API_URL to your control server (or use default)
 * 3. Set OPENAI_API_KEY for making actual LLM calls
 *
 * Run: npx tsx examples/control-actions.ts
 */

import "dotenv/config";
import OpenAI from "openai";
import { instrument, uninstrument, createConsoleEmitter } from "../src/index.js";

const USER_ID = "demo_user_control_actions";
const apiKey = process.env.ADEN_API_KEY!;
const serverUrl = process.env.ADEN_API_URL || "http://localhost:8888";

// Track alerts received
const alertsReceived: Array<{ level: string; message: string; timestamp: Date }> = [];

async function setupPolicy() {
  console.log("=".repeat(60));
  console.log("Setting up control policy...");
  console.log("=".repeat(60) + "\n");

  // Clear existing policy
  await fetch(`${serverUrl}/v1/control/policy`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  // Reset budget
  await fetch(`${serverUrl}/v1/control/budget/${USER_ID}/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  // 1. Budget with $0.002 limit - small enough to trigger all thresholds
  await fetch(`${serverUrl}/v1/control/policy/budgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      context_id: USER_ID,
      limit_usd: 0.002, // $0.002 budget (~4-5 requests)
      action_on_exceed: "block",
    }),
  });
  console.log("  Budget: $0.002 limit, block on exceed");

  // 2. Throttle rule: 3 requests per minute (will trigger after 3rd request)
  await fetch(`${serverUrl}/v1/control/policy/throttles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      context_id: USER_ID,
      requests_per_minute: 3,
      delay_ms: 2000, // 2 second delay when throttled
    }),
  });
  console.log("  Throttle: 3 req/min, 2s delay when exceeded");

  // 3. Degradation rule: gpt-4o -> gpt-4o-mini at 50% budget
  await fetch(`${serverUrl}/v1/control/policy/degradations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from_model: "gpt-4o",
      to_model: "gpt-4o-mini",
      trigger: "budget_threshold",
      threshold_percent: 50,
      context_id: USER_ID,
    }),
  });
  console.log("  Degradation: gpt-4o -> gpt-4o-mini at 50% budget");

  // 4. Alert rule: Warn when any gpt-4* model is used
  await fetch(`${serverUrl}/v1/control/policy/alerts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model_pattern: "gpt-4*",
      trigger: "model_usage",
      level: "warning",
      message: "Expensive model (gpt-4*) is being used",
    }),
  });
  console.log("  Alert: Warning when gpt-4* model is used");

  // 5. Alert rule: Critical when budget > 80%
  await fetch(`${serverUrl}/v1/control/policy/alerts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      context_id: USER_ID,
      trigger: "budget_threshold",
      threshold_percent: 80,
      level: "critical",
      message: "Budget nearly exhausted (>80%)",
    }),
  });
  console.log("  Alert: Critical when budget > 80%\n");

  // Get and display the full policy
  const policyRes = await fetch(`${serverUrl}/v1/control/policy`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const policy = await policyRes.json();
  console.log("Full policy:");
  console.log(JSON.stringify(policy, null, 2));
}

const BUDGET_LIMIT = 0.002; // Must match the budget rule

async function getBudgetStatus(): Promise<{ spend: number; limit: number; percent: number }> {
  const res = await fetch(`${serverUrl}/v1/control/budget/${USER_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  return {
    spend: data.current_spend_usd,
    limit: BUDGET_LIMIT,
    percent: (data.current_spend_usd / BUDGET_LIMIT) * 100,
  };
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("Aden SDK - Control Actions Demo");
  console.log("=".repeat(60) + "\n");

  if (!apiKey) {
    console.error("ADEN_API_KEY required");
    process.exit(1);
  }

  await setupPolicy();

  const openai = new OpenAI();

  // Instrument with alert handler
  console.log("\n" + "=".repeat(60));
  console.log("Initializing Aden instrumentation...");
  console.log("=".repeat(60) + "\n");

  await instrument({
    apiKey,
    serverUrl,
    emitMetric: createConsoleEmitter({ pretty: true }),
    sdks: { OpenAI },
    getContextId: () => USER_ID,
    onAlert: (alert) => {
      // This callback is invoked when an alert is triggered
      alertsReceived.push({
        level: alert.level,
        message: alert.message,
        timestamp: alert.timestamp,
      });
      console.log(`\n   [ALERT CALLBACK] [${alert.level.toUpperCase()}] ${alert.message}`);
      console.log(`   Provider: ${alert.provider}, Model: ${alert.model}\n`);
    },
  });

  console.log("\n" + "=".repeat(60));
  console.log("Making LLM requests to demonstrate control actions...");
  console.log("=".repeat(60));

  const prompts = [
    "What is 2+2?",           // Request 1: ALLOW + ALERT (gpt-4o)
    "Say hello",              // Request 2: ALLOW + ALERT (gpt-4o)
    "What color is the sky?", // Request 3: ALLOW + ALERT + likely DEGRADE (>50% budget)
    "Count to 3",             // Request 4: THROTTLE (>3/min) + DEGRADE + possibly BLOCK
    "Name a fruit",           // Request 5: THROTTLE + likely BLOCKED (>100% budget)
    "Say bye",                // Request 6: THROTTLE + BLOCKED
    "Last request",           // Request 7: THROTTLE + BLOCKED
  ];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const status = await getBudgetStatus();

    console.log(`\n[Request ${i + 1}/${prompts.length}] "${prompt}"`);
    console.log(`   Budget: $${status.spend.toFixed(6)} / $${status.limit} (${status.percent.toFixed(1)}%)`);

    const startTime = Date.now();

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
      });

      const duration = Date.now() - startTime;
      const content = response.choices[0]?.message?.content;
      const actualModel = response.model;

      // Check if model was degraded (requested gpt-4o but got gpt-4o-mini)
      const wasDegraded = actualModel.includes("mini");

      console.log(`   Response (${duration}ms): "${content}"`);
      console.log(`   Model: ${actualModel}${wasDegraded ? " (DEGRADED from gpt-4o)" : ""}, Tokens: ${response.usage?.total_tokens}`);

      // Check for throttle (if request took > 1.5s, it was likely throttled)
      if (duration > 1500) {
        console.log(`   (Request was THROTTLED - ${duration}ms latency)`);
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;

      if (error.message?.includes("cancelled") || error.message?.includes("Budget")) {
        console.log(`   BLOCKED (${duration}ms): ${error.message}`);
      } else if (error.message?.includes("Rate limit")) {
        console.log(`   THROTTLED: ${error.message}`);
      } else {
        console.log(`   ERROR: ${error.message}`);
      }
    }

    // Brief delay between requests
    await new Promise((r) => setTimeout(r, 300));
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));

  const finalStatus = await getBudgetStatus();
  console.log(`\nFinal Budget Status:`);
  console.log(`  User: ${USER_ID}`);
  console.log(`  Spent: $${finalStatus.spend.toFixed(6)}`);
  console.log(`  Limit: $${finalStatus.limit}`);
  console.log(`  Usage: ${finalStatus.percent.toFixed(1)}%`);

  console.log(`\nAlerts Received: ${alertsReceived.length}`);
  for (const alert of alertsReceived) {
    console.log(`  [${alert.level.toUpperCase()}] ${alert.message}`);
  }

  console.log("\nControl Actions Demonstrated:");
  console.log("  - allow: Requests 1-3 proceeded normally");
  console.log("  - alert: Triggered for gpt-4* model usage");
  console.log("  - throttle: Applied after 3 requests/min exceeded");
  console.log("  - degrade: gpt-4o -> gpt-4o-mini after 50% budget");
  console.log("  - block: Requests blocked after budget exceeded");

  await uninstrument();
  console.log("\nDemo complete!\n");
}

main().catch(console.error);
