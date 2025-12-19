/**
 * Mastra Agent Framework Example
 *
 * Tests Aden with Mastra agent framework
 * Works with agents, tools, and workflows
 */

import "dotenv/config";
import { Agent, createTool } from "@mastra/core";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { instrumentFetch, createConsoleEmitter, createJsonFileEmitter, createMultiEmitter, withAgent } from "../dist/index.js";

// Define tools
const calculatorTool = createTool({
  id: "calculator",
  description: "Perform basic arithmetic",
  inputSchema: z.object({
    operation: z.enum(["add", "subtract", "multiply", "divide"]),
    a: z.number(),
    b: z.number(),
  }),
  execute: async ({ operation, a, b }) => {
    switch (operation) {
      case "add": return { result: a + b };
      case "subtract": return { result: a - b };
      case "multiply": return { result: a * b };
      case "divide": return { result: a / b };
    }
  },
});

const weatherTool = createTool({
  id: "get_weather",
  description: "Get weather for a location",
  inputSchema: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    // Mock weather data
    return { location, temperature: 22, condition: "sunny" };
  },
});

async function testBasicAgent() {
  console.log("\n=== Mastra: Basic Agent ===");

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: openai("gpt-4o-mini"),
  });

  // Use Aden's withAgent to track agent context
  const response = await withAgent("AssistantAgent", async () => {
    return agent.generate("What is TypeScript in one sentence?");
  });

  console.log("Response:", response.text);
}

async function testAgentWithTools() {
  console.log("\n=== Mastra: Agent with Tools ===");

  const agent = new Agent({
    name: "Calculator",
    instructions: "You are a calculator assistant. Use the calculator tool.",
    model: openai("gpt-4o-mini"),
    tools: { calculator: calculatorTool },
  });

  const response = await withAgent("CalculatorAgent", async () => {
    return agent.generate("What is 42 * 17?");
  });

  console.log("Response:", response.text);
}

async function testMultiAgentWorkflow() {
  console.log("\n=== Mastra: Multi-Agent Workflow ===");

  // Research agent (OpenAI)
  const researcher = new Agent({
    name: "Researcher",
    instructions: "Research and provide detailed information.",
    model: openai("gpt-4o-mini"),
  });

  // Summarizer agent (Anthropic)
  const summarizer = new Agent({
    name: "Summarizer",
    instructions: "Summarize information concisely.",
    model: anthropic("claude-3-5-haiku-latest"),
  });

  // Step 1: Research
  const research = await withAgent("ResearcherAgent", async () => {
    return researcher.generate("What are the key features of TypeScript?");
  });

  // Step 2: Summarize
  const summary = await withAgent("SummarizerAgent", async () => {
    return summarizer.generate(
      `Summarize this in one sentence: ${research.text}`
    );
  });

  console.log("Summary:", summary.text);
}

async function testStreamingAgent() {
  console.log("\n=== Mastra: Streaming Agent ===");

  const agent = new Agent({
    name: "Storyteller",
    instructions: "Tell short, engaging stories.",
    model: openai("gpt-4o-mini"),
  });

  process.stdout.write("Story: ");

  const stream = await withAgent("StorytellerAgent", async () => {
    return agent.stream("Tell a very short story about a robot.");
  });

  for await (const chunk of stream.textStream) {
    process.stdout.write(chunk);
  }
  console.log();
}

async function testAgentWithWeather() {
  console.log("\n=== Mastra: Agent with Weather Tool ===");

  const agent = new Agent({
    name: "WeatherBot",
    instructions: "Provide weather information using the weather tool.",
    model: openai("gpt-4o-mini"),
    tools: { get_weather: weatherTool },
  });

  const response = await withAgent("WeatherAgent", async () => {
    return agent.generate("What's the weather like in Tokyo?");
  });

  console.log("Response:", response.text);
}

async function main() {
  // Mastra uses Vercel AI SDK providers under the hood (direct fetch calls)
  await instrumentFetch({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./mastra-metrics.jsonl" }),
    ]),
  });

  console.log("Starting Mastra tests...\n");

  await testBasicAgent();
  await testAgentWithTools();
  await testMultiAgentWorkflow();
  await testStreamingAgent();
  await testAgentWithWeather();

  console.log("\n=== All Mastra tests complete ===\n");
}

main().catch(console.error);
