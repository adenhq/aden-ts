/**
 * Basic usage example for openai-meter
 *
 * This example shows how to:
 * 1. Wrap an OpenAI client with metering
 * 2. Track usage metrics for API calls
 * 3. Handle both streaming and non-streaming responses
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  createConsoleEmitter,
  withBudgetGuardrails,
  type MetricEvent,
} from "../src/index.js";

// Create a basic OpenAI client
const client = new OpenAI();

// Wrap with metering using the console emitter for debugging
const metered = makeMeteredOpenAI(client, {
  emitMetric: createConsoleEmitter({ pretty: true }),
});

// Example 1: Basic non-streaming call
async function basicExample() {
  console.log("\n=== Basic Non-Streaming Example ===\n");

  const response = await metered.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: "What is 2 + 2?",
  });

  console.log("\nResponse:", response.output);
}

// Example 2: Streaming call
async function streamingExample() {
  console.log("\n=== Streaming Example ===\n");

  const stream = await metered.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: "Count from 1 to 5.",
    stream: true,
  });

  process.stdout.write("Response: ");
  for await (const event of stream) {
    // Handle streaming events
    if (
      event.type === "response.output_text.delta" &&
      "delta" in event
    ) {
      process.stdout.write(event.delta as string);
    }
  }
  console.log("\n");
  // Metrics are automatically emitted when stream completes
}

// Example 3: Custom metric handler
async function customMetricExample() {
  console.log("\n=== Custom Metric Handler Example ===\n");

  const metrics: MetricEvent[] = [];

  const customMetered = makeMeteredOpenAI(new OpenAI(), {
    emitMetric: (event) => {
      // Store metrics for later analysis
      metrics.push(event);

      // Calculate cost (simplified example)
      if (event.usage) {
        const inputCost = event.usage.input_tokens * 0.00001; // Example rate
        const outputCost = event.usage.output_tokens * 0.00003;
        console.log(`Estimated cost: $${(inputCost + outputCost).toFixed(6)}`);
      }
    },
    trackToolCalls: true,
  });

  await customMetered.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: "Hello!",
  });

  console.log("Collected metrics:", metrics.length);
}

// Example 4: Budget guardrails
async function budgetExample() {
  console.log("\n=== Budget Guardrails Example ===\n");

  const budgeted = withBudgetGuardrails(
    makeMeteredOpenAI(new OpenAI(), {
      emitMetric: createConsoleEmitter(),
    }),
    {
      maxInputTokens: 100,
      onExceeded: "warn", // or "throw" to block the request
      onExceededHandler: (info) => {
        console.log(
          `Warning: Request would use ${info.estimatedInputTokens} tokens ` +
            `(limit: ${info.maxInputTokens})`
        );
      },
    }
  );

  // This should trigger a warning but still proceed
  await budgeted.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: "Tell me a very short story.",
  });
}

// Example 5: Request metadata tracking
async function metadataExample() {
  console.log("\n=== Request Metadata Example ===\n");

  const meteredWithMeta = makeMeteredOpenAI(new OpenAI(), {
    emitMetric: (event) => {
      console.log("Request trace:", {
        traceId: event.traceId,
        model: event.model,
        serviceTier: event.service_tier,
        latency: `${event.latency_ms}ms`,
        cached: event.usage?.cached_tokens ?? 0,
      });
    },
  });

  await meteredWithMeta.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: "Hi!",
    // These parameters are tracked in metrics
    service_tier: "auto",
    max_output_tokens: 100,
  });
}

// Run examples
async function main() {
  try {
    await basicExample();
    await streamingExample();
    await customMetricExample();
    await budgetExample();
    await metadataExample();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
