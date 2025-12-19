/**
 * Control Agent Example
 *
 * Demonstrates bidirectional communication with a control server
 * for real-time cost control:
 * - Block: Cancel requests that exceed budget
 * - Throttle: Delay requests during high load
 * - Degrade: Switch to cheaper models when approaching budget limits
 *
 * The control agent works alongside existing emitters, adding
 * server-side policy enforcement to local metrics collection.
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  instrument,
  createConsoleEmitter,
  uninstrument,
  type ControlPolicy,
} from "../dist/index.js";

// Client created after instrumentation
let client: OpenAI;

/**
 * Simulate a control server for demonstration.
 *
 * In production, this would be your Aden control server that:
 * - Receives metrics from all SDK instances
 * - Evaluates policies based on budget, usage patterns, etc.
 * - Sends back control decisions (allow/block/throttle/degrade)
 */
function logPolicyExplanation(policy: ControlPolicy | null) {
  if (!policy) {
    console.log("  No policy loaded (fail-open: requests allowed)");
    return;
  }

  console.log(`  Policy version: ${policy.version}`);
  console.log(`  Updated: ${policy.updated_at}`);

  if (policy.budgets?.length) {
    console.log("  Budget rules:");
    for (const budget of policy.budgets) {
      console.log(`    - ${budget.context_id}: $${budget.limit_usd} max (current: $${budget.current_spend_usd})`);
    }
  }

  if (policy.throttles?.length) {
    console.log("  Throttle rules:");
    for (const throttle of policy.throttles) {
      const target = throttle.provider ?? "all providers";
      console.log(`    - ${target}: ${throttle.delay_ms}ms delay, ${throttle.requests_per_minute ?? "∞"} req/min`);
    }
  }

  if (policy.blocks?.length) {
    console.log("  Block rules:");
    for (const block of policy.blocks) {
      const target = block.model_pattern ?? block.provider ?? "all";
      console.log(`    - Block ${target}: ${block.reason}`);
    }
  }

  if (policy.degradations?.length) {
    console.log("  Degradation rules:");
    for (const degrade of policy.degradations) {
      console.log(`    - ${degrade.from_model} -> ${degrade.to_model} (trigger: ${degrade.trigger})`);
    }
  }
}

async function testBasicWithControl() {
  console.log("\n=== Test: Basic Request with Control Agent ===");
  console.log("Making a request that will be evaluated against server policies...\n");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hello in 5 words" }],
    });
    console.log("Response:", response.choices[0]?.message?.content);
    console.log("  -> Request was ALLOWED by control agent");
  } catch (error) {
    if (error instanceof Error && error.message.includes("blocked")) {
      console.log("  -> Request was BLOCKED:", error.message);
    } else {
      throw error;
    }
  }
}

async function testExpensiveModel() {
  console.log("\n=== Test: Expensive Model (may be degraded) ===");
  console.log("Requesting gpt-4o - control agent may downgrade to cheaper model...\n");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o", // Expensive model
      messages: [{ role: "user", content: "What is 2+2?" }],
    });
    console.log("Response:", response.choices[0]?.message?.content);
    console.log(`  -> Model used: ${response.model}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("blocked")) {
      console.log("  -> Request was BLOCKED:", error.message);
    } else {
      throw error;
    }
  }
}

async function testMultipleRequests() {
  console.log("\n=== Test: Multiple Rapid Requests (may be throttled) ===");
  console.log("Making 3 requests in quick succession...\n");

  const startTime = Date.now();

  for (let i = 1; i <= 3; i++) {
    const reqStart = Date.now();
    try {
      await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: `Request ${i}: Say "${i}"` }],
        max_tokens: 5,
      });
      const elapsed = Date.now() - reqStart;
      console.log(`  Request ${i}: ${elapsed}ms`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("blocked")) {
        console.log(`  Request ${i}: BLOCKED - ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const totalTime = Date.now() - startTime;
  console.log(`  Total time: ${totalTime}ms`);
  console.log("  (Throttled requests would show longer times)");
}

async function main() {
  // Check for API key
  const apiKey = process.env.ADEN_API_KEY;

  if (!apiKey) {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║           Control Agent Example - Demo Mode                ║");
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log("║ No API key configured. Running in demo mode.               ║");
    console.log("║                                                            ║");
    console.log("║ To connect to control server, set:                         ║");
    console.log("║   ADEN_API_KEY=your-api-key                                ║");
    console.log("║                                                            ║");
    console.log("║ Without an API key, requests proceed normally (fail-open). ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log();
  }

  // Single-line setup - control agent is created automatically when apiKey is provided
  // Also add local console logging for this demo
  const result = await instrument({
    apiKey, // Auto-connects to https://kube.acho.io when provided
    emitMetric: createConsoleEmitter({ pretty: true }), // Optional: also log locally
    failOpen: true, // Allow requests even if server unreachable
    sdks: { OpenAI },
  });

  // Get the control agent from the result (or null if no apiKey)
  const controlAgent = result.controlAgent;

  // Create client AFTER instrumentation
  client = new OpenAI();

  console.log("Starting Control Agent tests...\n");

  // Show current policy status
  console.log("=== Current Policy Status ===");
  if (controlAgent) {
    console.log(`  Connected: ${controlAgent.isConnected()}`);
    logPolicyExplanation(controlAgent.getPolicy());
  } else {
    console.log("  No control agent (running without API key)");
    console.log("  Requests will proceed without policy enforcement");
  }

  // Run tests
  await testBasicWithControl();
  await testExpensiveModel();
  await testMultipleRequests();

  console.log("\n=== Control Agent Tests Complete ===");
  console.log("\nThe control agent enables:");
  console.log("  • Real-time budget enforcement from a central server");
  console.log("  • Automatic model degradation when costs spike");
  console.log("  • Request throttling during high-load periods");
  console.log("  • Emergency blocking for runaway costs or abuse");
  console.log("  • All while metrics continue to be collected locally");
  console.log();

  // Disconnect gracefully (uninstrument handles control agent cleanup)
  await uninstrument();
}

main().catch(console.error);
