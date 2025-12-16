/**
 * Advanced example: Sending metrics to a backend
 *
 * This example shows how to:
 * 1. Batch metrics for efficient backend delivery
 * 2. Add tenant/user attribution
 * 3. Handle errors gracefully
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  createBatchEmitter,
  createMultiEmitter,
  createConsoleEmitter,
  type MetricEvent,
} from "../src/index.js";

// Simulated backend API
async function sendToMetricsBackend(events: MetricEvent[]): Promise<void> {
  // In production, this would be an HTTP call to your metrics service
  console.log(`[Backend] Received ${events.length} events`);

  for (const event of events) {
    const record = {
      timestamp: new Date().toISOString(),
      trace_id: event.traceId,
      request_id: event.requestId,
      model: event.model,
      input_tokens: event.usage?.input_tokens ?? 0,
      output_tokens: event.usage?.output_tokens ?? 0,
      cached_tokens: event.usage?.cached_tokens ?? 0,
      reasoning_tokens: event.usage?.reasoning_tokens ?? 0,
      latency_ms: event.latency_ms,
      error: event.error ?? null,
      // Add your own dimensions
      // tenant_id: getTenantFromContext(),
      // user_id: getUserFromContext(),
    };
    console.log("[Backend] Record:", JSON.stringify(record));
  }
}

// Create a batched emitter that flushes every 10 events or 5 seconds
const batchEmitter = createBatchEmitter(sendToMetricsBackend, {
  maxBatchSize: 10,
  flushInterval: 5000,
});

// Combine with console logging for development visibility
const combinedEmitter = createMultiEmitter([
  createConsoleEmitter({ pretty: true }),
  batchEmitter,
]);

// Create the metered client
const client = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: combinedEmitter,
});

async function runMultipleRequests() {
  console.log("Making multiple requests...\n");

  // Simulate multiple API calls
  const prompts = [
    "What is TypeScript?",
    "Explain async/await",
    "What is a Promise?",
  ];

  for (const prompt of prompts) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: prompt,
      max_output_tokens: 100,
    });
  }

  // Ensure all metrics are flushed before exit
  console.log("\nFlushing remaining metrics...");
  await batchEmitter.flush();
  batchEmitter.stop();
}

runMultipleRequests().catch(console.error);
