/**
 * Vercel AI SDK Example
 *
 * Tests Aden with Vercel AI SDK (ai package)
 * Works with generateText, streamText, generateObject
 */

import "dotenv/config";
// Vercel AI SDK uses different env var name for Google
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= process.env.GOOGLE_API_KEY;
import { generateText, streamText, generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import { instrumentFetch, createConsoleEmitter, createJsonFileEmitter, createMultiEmitter } from "../dist/index.js";

async function testGenerateText() {
  console.log("\n=== Vercel AI SDK: generateText ===");

  // OpenAI
  const openaiResult = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: "Say hello in 5 words",
  });
  console.log("OpenAI:", openaiResult.text);

  // Anthropic
  const anthropicResult = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    prompt: "Say hello in 5 words",
  });
  console.log("Anthropic:", anthropicResult.text);

  // Google
  const googleResult = await generateText({
    model: google("gemini-2.0-flash"),
    prompt: "Say hello in 5 words",
  });
  console.log("Google:", googleResult.text);
}

async function testStreamText() {
  console.log("\n=== Vercel AI SDK: streamText ===");

  const result = await streamText({
    model: openai("gpt-4o-mini"),
    prompt: "Count from 1 to 5",
  });

  process.stdout.write("Streaming: ");
  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log();
}

async function testGenerateObject() {
  console.log("\n=== Vercel AI SDK: generateObject ===");

  const schema = z.object({
    name: z.string(),
    age: z.number(),
    occupation: z.string(),
  });

  const result = await generateObject({
    model: openai("gpt-4o-mini"),
    schema,
    prompt: "Generate a fictional person",
  });

  console.log("Generated:", result.object);
}

async function testMultiStep() {
  console.log("\n=== Vercel AI SDK: Multi-step Agent ===");

  // Step 1: Research
  const research = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: "What are the key facts about TypeScript?",
  });

  // Step 2: Summarize
  const summary = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    prompt: `Summarize this in one sentence: ${research.text}`,
  });

  console.log("Summary:", summary.text);
}

async function main() {
  // Use fetch instrumentation for Vercel AI SDK (makes direct HTTP calls)
  await instrumentFetch({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./vercel-ai-metrics.jsonl" }),
    ]),
  });

  console.log("Starting Vercel AI SDK tests...\n");

  await testGenerateText();
  await testStreamText();
  await testGenerateObject();
  await testMultiStep();

  console.log("\n=== All Vercel AI SDK tests complete ===\n");
}

main().catch(console.error);
