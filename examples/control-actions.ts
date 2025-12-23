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
import {
  instrument,
  uninstrument,
  createConsoleEmitter,
  createMultiEmitter,
  type MetricEvent,
} from "../src/index.js";

const USER_ID = "demo_user_control_actions";
const apiKey = process.env.ADEN_API_KEY!;
const serverUrl = process.env.ADEN_API_URL || "http://localhost:8888";

// Track alerts received
const alertsReceived: Array<{ level: string; message: string; timestamp: Date }> = [];

// Track budget locally (SDK tracks spend, server only provides policy)
let localSpend = 0;
const BUDGET_LIMIT = 0.0003; // Small budget to demonstrate all actions in 5 requests

function getBudgetStatus(): { spend: number; limit: number; percent: number } {
  return {
    spend: localSpend,
    limit: BUDGET_LIMIT,
    percent: (localSpend / BUDGET_LIMIT) * 100,
  };
}

const POLICY_ID = "default";

async function setupPolicy() {
  console.log("=".repeat(60));
  console.log("Setting up control policy...");
  console.log("=".repeat(60) + "\n");

  // Clear existing rules from the policy
  await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/rules`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  console.log("  Cleared existing rules");

  // 1. Add Budget rule: $0.002 limit - small enough to trigger all thresholds
  const budgetRes = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/budgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      id: USER_ID,
      name: "Demo User Budget",
      type: "customer",
      limit: BUDGET_LIMIT, // Small budget to hit all thresholds
      spent: 0,
      limitAction: "kill",
      alerts: [{ threshold: 80, enabled: true }],
      notifications: { inApp: true, email: false, emailRecipients: [], webhook: false },
    }),
  });
  if (!budgetRes.ok) {
    console.log(`  Warning: Could not add budget rule (${budgetRes.status})`);
  } else {
    console.log(`  Budget: $${BUDGET_LIMIT} limit, kill on exceed`);
  }

  // 2. Add Throttle rule: 2 requests per minute (will throttle starting at request 3)
  const throttleRes = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/throttles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      context_id: USER_ID,
      requests_per_minute: 2,
      delay_ms: 2000, // 2 second delay when throttled
    }),
  });
  if (!throttleRes.ok) {
    console.log(`  Warning: Could not add throttle rule (${throttleRes.status})`);
  } else {
    console.log("  Throttle: 2 req/min, 2s delay when exceeded");
  }

  // 3. Add Degradation rule: gpt-4o -> gpt-4o-mini at 50% budget
  const degradeRes = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/degradations`, {
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
  if (!degradeRes.ok) {
    console.log(`  Warning: Could not add degradation rule (${degradeRes.status})`);
  } else {
    console.log("  Degradation: gpt-4o -> gpt-4o-mini at 50% budget");
  }

  // 4. Add Alert rule: Warn when any gpt-4* model is used
  const alertRes1 = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/alerts`, {
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
  if (!alertRes1.ok) {
    console.log(`  Warning: Could not add alert rule (${alertRes1.status})`);
  } else {
    console.log("  Alert: Warning when gpt-4* model is used");
  }

  // 5. Add Alert rule: Critical when budget > 80%
  const alertRes2 = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}/alerts`, {
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
  if (!alertRes2.ok) {
    console.log(`  Warning: Could not add alert rule (${alertRes2.status})`);
  } else {
    console.log("  Alert: Critical when budget > 80%");
  }

  console.log();

  // Get and display the full policy
  const policyRes = await fetch(`${serverUrl}/v1/control/policies/${POLICY_ID}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!policyRes.ok) {
    console.log(`  Warning: Could not fetch policy (${policyRes.status})`);
  } else {
    const policy = await policyRes.json();
    console.log("Full policy:");
    console.log(JSON.stringify(policy, null, 2));
  }
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

  // Custom emitter to track spend locally
  // Calculate cost from tokens (gpt-4o pricing: $2.50/1M input, $10/1M output)
  const trackSpendEmitter = (event: MetricEvent) => {
    const inputCost = event.input_tokens * 0.0000025; // $2.50 per 1M tokens
    const outputCost = event.output_tokens * 0.00001; // $10 per 1M tokens
    localSpend += inputCost + outputCost;
  };

  await instrument({
    apiKey,
    serverUrl,
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      trackSpendEmitter,
    ]),
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
    "What is 2+2?",           // Request 1: ALLOW + ALERT (~35% budget)
    "Say hello",              // Request 2: ALLOW + ALERT + DEGRADE (>50% budget)
    "What color is the sky?", // Request 3: THROTTLE + ALERT + DEGRADE + possibly BLOCKED (>100%)
    "Count to 3",             // Request 4: THROTTLE + BLOCKED (budget exceeded)
    "Name a fruit",           // Request 5: THROTTLE + BLOCKED
  ];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const status = getBudgetStatus();

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

  const finalStatus = getBudgetStatus();
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
  console.log("  - allow: Request 1 proceeded normally");
  console.log("  - alert: Triggered for gpt-4* model usage");
  console.log("  - degrade: gpt-4o -> gpt-4o-mini when budget > 50% (request 2+)");
  console.log("  - throttle: Applied after 2 requests/min exceeded (request 3+)");
  console.log("  - block: Requests blocked when budget > 100%");

  await uninstrument();
  console.log("\nDemo complete!\n");
}

main().catch(console.error);
