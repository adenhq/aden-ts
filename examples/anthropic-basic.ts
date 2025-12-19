/**
 * Anthropic SDK Basic Example
 *
 * Tests: Messages API, streaming, non-streaming, tool use
 */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import {
  instrument,
  createConsoleEmitter,
  createJsonFileEmitter,
  createMultiEmitter,
} from "../dist/index.js";

// Client created after instrumentation in main()
let client: Anthropic;

async function testMessages() {
  console.log("\n=== Anthropic Messages (non-streaming) ===");
  const response = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 100,
    messages: [{ role: "user", content: "Say hello in 5 words" }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  console.log("Response:", textBlock?.type === "text" ? textBlock.text : "");
}

async function testMessagesStreaming() {
  console.log("\n=== Anthropic Messages (streaming) ===");
  const stream = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 100,
    messages: [{ role: "user", content: "Count from 1 to 5" }],
    stream: true,
  });

  process.stdout.write("Response: ");
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
  console.log();
}

async function testWithTools() {
  console.log("\n=== Anthropic with Tool Use ===");
  const response = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 200,
    messages: [{ role: "user", content: "What's the weather in Paris?" }],
    tools: [
      {
        name: "get_weather",
        description: "Get current weather for a location",
        input_schema: {
          type: "object" as const,
          properties: {
            location: { type: "string", description: "City name" },
          },
          required: ["location"],
        },
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  console.log("Tool calls:", toolUse ? 1 : 0);
  if (toolUse?.type === "tool_use") {
    console.log("Tool name:", toolUse.name);
  }
}

async function testWithCache() {
  console.log("\n=== Anthropic with Prompt Caching ===");
  // Long system prompt to trigger caching
  const systemPrompt = `You are a helpful assistant. `.repeat(100);

  const response = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 50,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: "Hi!" }],
  });

  console.log("Cache tokens:", response.usage.cache_read_input_tokens ?? 0);
}

// Run all tests
async function main() {
  // Initialize instrumentation - pass Anthropic class for correct module instance
  await instrument({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./anthropic-metrics.jsonl" }),
    ]),
    sdks: { Anthropic },
  });

  // Create client AFTER instrumentation
  client = new Anthropic();

  console.log("Starting Anthropic SDK tests...\n");

  await testMessages();
  await testMessagesStreaming();
  await testWithTools();
  // await testWithCache(); // Uncomment if you have cache-enabled model

  console.log("\n=== All Anthropic tests complete ===\n");
}

main().catch(console.error);
