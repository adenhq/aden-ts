/**
 * Dify SDK Basic Example
 *
 * Tests: ChatClient, CompletionClient with Aden instrumentation
 *
 * Dify is a platform where LLM calls happen on the server side.
 * The SDK calls Dify's API, and the response includes usage metadata
 * from the server, including pre-calculated costs.
 *
 * Prerequisites:
 * 1. A Dify account (cloud or self-hosted)
 * 2. A Dify application with an API key
 * 3. Set DIFY_API_KEY and DIFY_API_URL environment variables
 */

import "dotenv/config";
import {
  instrument,
  createConsoleEmitter,
  createJsonFileEmitter,
  createMultiEmitter,
} from "../dist/index.js";

// Get Dify config from environment
const DIFY_API_KEY = process.env.DIFY_API_KEY;
const DIFY_API_URL = process.env.DIFY_API_URL || "https://api.dify.ai/v1";

// Will be loaded dynamically
let ChatClient: any;
let CompletionClient: any;

async function testChatClient() {
  console.log("\n=== Dify ChatClient (blocking) ===");

  if (!DIFY_API_KEY) {
    console.log("Skipped: DIFY_API_KEY not set");
    return;
  }

  // v3.0.0 API: constructor(apiKey, baseUrl)
  const client = new ChatClient(DIFY_API_KEY, DIFY_API_URL);

  try {
    const response = await client.createChatMessage(
      {}, // inputs
      "Say hello in 5 words", // query
      "test-user", // user
      false, // stream: false = blocking
    ) as { data: any };

    const data = response.data;
    console.log("Response:", data?.answer?.substring(0, 100) || "No answer");

    // Show usage info from Dify
    const usage = data?.metadata?.usage;
    if (usage) {
      console.log("Usage from Dify:");
      console.log(`  Prompt tokens: ${usage.prompt_tokens}`);
      console.log(`  Completion tokens: ${usage.completion_tokens}`);
      console.log(`  Total cost: ${usage.total_price} ${usage.currency}`);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

async function testCompletionClient() {
  console.log("\n=== Dify CompletionClient (blocking) ===");

  const completionApiKey = process.env.DIFY_COMPLETION_API_KEY;
  if (!completionApiKey) {
    console.log("Skipped: DIFY_COMPLETION_API_KEY not set");
    return;
  }

  // v3.0.0 API: constructor(apiKey, baseUrl)
  const client = new CompletionClient(completionApiKey, DIFY_API_URL);

  try {
    const response = await client.createCompletionMessage(
      { topic: "TypeScript" }, // inputs
      "Write a haiku about the given topic", // query
      "test-user", // user
      false, // stream: false = blocking
    ) as { data: any };

    const data = response.data;
    console.log("Response:", data?.answer || "No answer");
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

// Run all tests
async function main() {
  console.log("Starting Dify SDK tests...");
  console.log(`API URL: ${DIFY_API_URL}`);
  console.log(`API Key: ${DIFY_API_KEY ? "***" + DIFY_API_KEY.slice(-4) : "Not set"}`);

  // Dynamic import for ESM-only dify-client
  const difyModule = await import("dify-client");
  ChatClient = difyModule.ChatClient;
  CompletionClient = difyModule.CompletionClient;

  // Import uninstrument for cleanup
  const { uninstrument } = await import("../dist/index.js");

  // Initialize instrumentation
  // Note: We pass the Dify module for correct module instance
  await instrument({
    // Use Aden API key from environment (sends metrics to server)
    apiKey: process.env.ADEN_API_KEY,
    serverUrl: process.env.ADEN_API_URL,
    // Also log locally for debugging
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./dify-metrics.jsonl" }),
    ]),
    sdks: {
      Dify: { ChatClient, CompletionClient },
    },
  });

  try {
    await testChatClient();
    await testCompletionClient();

    console.log("\n=== All Dify tests complete ===\n");
  } finally {
    // Cleanup - this flushes pending events to the server
    console.log("Cleaning up and flushing events...");
    await uninstrument();
    console.log("Done!");
  }
}

main().catch(console.error);
