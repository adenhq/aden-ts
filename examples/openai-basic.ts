/**
 * OpenAI SDK Basic Example
 *
 * Tests: Chat Completions API, Responses API, streaming, non-streaming
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  instrument,
  createConsoleEmitter,
  createJsonFileEmitter,
  createMultiEmitter,
} from "../dist/index.js";

// Client created after instrumentation in main()
let client: OpenAI;

async function testChatCompletion() {
  console.log("\n=== OpenAI Chat Completion (non-streaming) ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Say hello in 5 words" }],
  });
  console.log("Response:", response.choices[0]?.message?.content);
}

async function testChatCompletionStreaming() {
  console.log("\n=== OpenAI Chat Completion (streaming) ===");
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Count from 1 to 5" }],
    stream: true,
  });

  process.stdout.write("Response: ");
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content ?? "";
    process.stdout.write(content);
  }
  console.log();
}

async function testResponsesAPI() {
  console.log("\n=== OpenAI Responses API (non-streaming) ===");
  const response = await client.responses.create({
    model: "gpt-4o-mini",
    input: "What is 2+2?",
  });
  console.log("Response:", response.output_text);
}

async function testResponsesAPIStreaming() {
  console.log("\n=== OpenAI Responses API (streaming) ===");
  const stream = await client.responses.create({
    model: "gpt-4o-mini",
    input: "Tell me a joke",
    stream: true,
  });

  process.stdout.write("Response: ");
  for await (const event of stream) {
    if (event.type === "response.output_text.delta") {
      process.stdout.write(event.delta ?? "");
    }
  }
  console.log();
}

async function testWithTools() {
  console.log("\n=== OpenAI with Tool Calls ===");
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather for a location",
          parameters: {
            type: "object",
            properties: {
              location: { type: "string" },
            },
            required: ["location"],
          },
        },
      },
    ],
  });
  console.log("Tool calls:", response.choices[0]?.message?.tool_calls?.length ?? 0);
}

// Run all tests
async function main() {
  // Initialize instrumentation - pass OpenAI class for correct module instance
  await instrument({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./openai-metrics.jsonl" }),
    ]),
    sdks: { OpenAI },
  });

  // Create client AFTER instrumentation
  client = new OpenAI();

  console.log("Starting OpenAI SDK tests...\n");

  await testChatCompletion();
  await testChatCompletionStreaming();
  await testResponsesAPI();
  await testResponsesAPIStreaming();
  await testWithTools();

  console.log("\n=== All OpenAI tests complete ===\n");
}

main().catch(console.error);
