/**
 * Control Actions Example
 *
 * Demonstrates control actions in the Aden SDK:
 * 1. allow   - Request proceeds normally
 * 2. block   - Request is rejected (budget exceeded)
 *
 * The control agent fetches policies from the server which define:
 * - Budget limits with limitAction (kill/degrade/throttle)
 * - Multi-budget matching (global + agent/tenant/customer budgets)
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
  RequestCancelledError,
} from "../src/index.js";

const USER_ID = "demo_user_control_actions";
const apiKey = process.env.ADEN_API_KEY!;
const serverUrl = process.env.ADEN_API_URL || "https://kube.acho.io";
const BUDGET_LIMIT = 0.0003; // Very tight limit to trigger blocking quickly

// Track alerts received
const alertsReceived: Array<{ level: string; message: string; timestamp: Date }> = [];

interface PolicyBudget {
  id: string;
  type: string;
  limit: number;
  spent: number;
  limitAction?: string;
  [key: string]: unknown;
}

interface Policy {
  budgets?: PolicyBudget[];
  [key: string]: unknown;
}

async function getBudgetStatus(debug = false): Promise<{ spend: number; limit: number; percent: number }> {
  /**
   * Get current budget status from policy.
   * Looks for either a global budget or a customer budget matching USER_ID.
   */
  try {
    const res = await fetch(`${serverUrl}/v1/control/policy`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      if (debug) console.log(`   [DEBUG] Failed to get policy: HTTP ${res.status}`);
      return { spend: 0, limit: BUDGET_LIMIT, percent: 0 };
    }
    const data = (await res.json()) as Policy;

    // Find global budget or customer budget matching USER_ID
    const budget = data.budgets?.find((b) =>
      b.type === "global" ||
      (b.type === "customer" && (b.id === USER_ID || b.name === USER_ID))
    );

    if (budget) {
      const spend = budget.spent ?? 0;
      const limit = budget.limit ?? 0.07;
      if (debug) {
        console.log(`   [DEBUG] Budget (${budget.type}): $${spend.toFixed(6)} / $${limit} (${limit > 0 ? ((spend / limit) * 100).toFixed(1) : 0}%)`);
      }
      return {
        spend,
        limit,
        percent: limit > 0 ? (spend / limit) * 100 : 0,
      };
    }

    if (debug) console.log("   [DEBUG] No matching budget found in policy");
    return { spend: 0, limit: BUDGET_LIMIT, percent: 0 };
  } catch (e) {
    if (debug) console.log(`   [DEBUG] Failed to get policy: ${e}`);
    return { spend: 0, limit: BUDGET_LIMIT, percent: 0 };
  }
}

async function setupPolicy(): Promise<void> {
  /**
   * Set up the control policy on the server.
   * Finds or creates a budget and sets a tight limit to demonstrate control actions.
   */
  console.log("=".repeat(60));
  console.log("Setting up control policy...");
  console.log("=".repeat(60) + "\n");

  const headers = { Authorization: `Bearer ${apiKey}` };
  const jsonHeaders = { ...headers, "Content-Type": "application/json" };

  // Get current policy
  let policy: Policy;
  try {
    const policyRes = await fetch(`${serverUrl}/v1/control/policy`, { headers });
    if (!policyRes.ok) {
      console.log(`  Failed to get policy: HTTP ${policyRes.status}`);
      const text = await policyRes.text();
      console.log(`  Response: ${text.slice(0, 200) || "(empty)"}`);
      console.log(`  Make sure the control server is running at ${serverUrl}`);
      return;
    }
    policy = (await policyRes.json()) as Policy;
  } catch (e) {
    console.log(`  Failed to connect to control server: ${e}`);
    console.log(`  Make sure the control server is running at ${serverUrl}`);
    return;
  }

  // Find global budget or customer budget matching USER_ID
  const existingBudget = policy.budgets?.find((b) =>
    b.type === "global" ||
    (b.type === "customer" && (b.id === USER_ID || b.name === USER_ID))
  );

  let targetBudget: PolicyBudget;
  let isNew = false;

  if (existingBudget) {
    console.log(`  Found existing budget: ${existingBudget.id} (${existingBudget.type})`);
    console.log(`  Current spend: $${(existingBudget.spent ?? 0).toFixed(6)}`);
    targetBudget = existingBudget;
  } else {
    // Create a new global budget for this demo
    console.log(`  No matching budget found, creating new global budget`);
    targetBudget = {
      id: "demo_global_budget",
      type: "global",
      limit: 0,
      spent: 0,
    };
    isNew = true;
  }

  const currentSpend = targetBudget.spent ?? 0;

  // Set limit to current_spend + $0.0003 to trigger thresholds quickly
  const newLimit = currentSpend + BUDGET_LIMIT;
  console.log(`  Setting limit to: $${newLimit.toFixed(6)} (spend + $${BUDGET_LIMIT})`);

  // Update the budget in the policy via PUT
  const updatedBudget = { ...targetBudget, limit: newLimit, limitAction: "kill" };
  const otherBudgets = policy.budgets?.filter((b) => b.id !== targetBudget.id) ?? [];
  const updatedBudgets = [updatedBudget, ...otherBudgets];

  const updateRes = await fetch(`${serverUrl}/v1/control/policies/default`, {
    method: "PUT",
    headers: jsonHeaders,
    body: JSON.stringify({ budgets: updatedBudgets }),
  });

  if (updateRes.ok) {
    console.log(`  ${isNew ? "Created" : "Updated"} budget limit to $${newLimit.toFixed(6)}`);
  } else {
    console.log(`  Failed to update budget: ${updateRes.status}`);
    const text = await updateRes.text();
    console.log(`  Response: ${text.slice(0, 200) || "(empty)"}`);
  }

  // Calculate starting usage percentage
  const usagePct = newLimit > 0 ? (currentSpend / newLimit) * 100 : 0;
  console.log(`  Starting at ${usagePct.toFixed(1)}% budget usage\n`);

  // Get and display the updated policy budgets
  try {
    const policyRes = await fetch(`${serverUrl}/v1/control/policy`, { headers });
    if (policyRes.ok) {
      const updatedPolicy = (await policyRes.json()) as Policy;
      console.log("Updated policy budgets:");
      const budget = updatedPolicy.budgets?.find((b) =>
        b.type === "global" ||
        (b.type === "customer" && (b.id === USER_ID || b.name === USER_ID))
      );
      if (budget) {
        console.log(JSON.stringify(budget, null, 2));
      }
    }
  } catch {
    // Ignore
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
      alertsReceived.push({
        level: alert.level,
        message: alert.message,
        timestamp: alert.timestamp,
      });
      console.log(`\n   [ALERT CALLBACK] [${alert.level.toUpperCase()}] ${alert.message}`);
      console.log(`   Provider: ${alert.provider}, Model: ${alert.model}\n`);
    },
  });

  // Create client AFTER instrumentation
  const openai = new OpenAI();

  console.log("\n" + "=".repeat(60));
  console.log("Making LLM requests to demonstrate control actions...");
  console.log("=".repeat(60));

  const prompts = [
    "What is 2+2?",           // Request 1: ALLOW
    "Say hello",              // Request 2: ALLOW
    "What color is the sky?", // Request 3: likely BLOCKED (>100% budget)
    "Count to 3",             // Request 4: BLOCKED
    "Name a fruit",           // Request 5: BLOCKED
  ];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const status = await getBudgetStatus(i === 0); // Debug first request

    console.log(`\n[Request ${i + 1}/${prompts.length}] "${prompt}"`);
    console.log(`   Budget: $${status.spend.toFixed(6)} / $${status.limit} (${status.percent.toFixed(1)}%)`);

    const startTime = Date.now();

    try {
      // Pass agent metadata to trigger multi-budget matching
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 20,
      });

      const duration = Date.now() - startTime;
      const content = response.choices[0]?.message?.content;
      const actualModel = response.model;

      // Check if model was degraded
      const wasDegraded = actualModel.includes("mini");

      console.log(`   Response (${duration}ms): "${content}"`);
      console.log(`   Model: ${actualModel}${wasDegraded ? " (DEGRADED from gpt-4o)" : ""}, Tokens: ${response.usage?.total_tokens}`);

      // Check for throttle (if request took > 1.5s, it was likely throttled)
      if (duration > 1500) {
        console.log(`   (Request was THROTTLED - ${duration}ms latency)`);
      }
    } catch (error: unknown) {
      const duration = Date.now() - startTime;

      if (error instanceof RequestCancelledError) {
        console.log(`   BLOCKED (${duration}ms): ${error.message}`);
      } else if (error instanceof Error) {
        const msg = error.message;
        if (msg.includes("cancelled") || msg.includes("Budget")) {
          console.log(`   BLOCKED (${duration}ms): ${msg}`);
        } else if (msg.includes("Rate limit")) {
          console.log(`   THROTTLED: ${msg}`);
        } else {
          console.log(`   ERROR: ${msg}`);
        }
      } else {
        console.log(`   ERROR: ${String(error)}`);
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
  console.log("  - allow: Requests allowed when under budget");
  console.log("  - block: Requests blocked when budget exceeded");

  await uninstrument();
  console.log("\nDemo complete!\n");
}

main().catch(console.error);
