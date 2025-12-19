/**
 * LangChain Example
 *
 * Tests llm-meter with LangChain.js
 * Works with ChatOpenAI, ChatAnthropic, ChatGoogleGenerativeAI
 */

import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";
import { instrumentFetch, createConsoleEmitter, createJsonFileEmitter, createMultiEmitter } from "../dist/index.js";

async function testBasicInvoke() {
  console.log("\n=== LangChain: Basic Invoke ===");

  // OpenAI
  const openai = new ChatOpenAI({ model: "gpt-4o-mini" });
  const openaiResult = await openai.invoke([
    new HumanMessage("Say hello in 5 words"),
  ]);
  console.log("OpenAI:", openaiResult.content);

  // Anthropic
  const anthropic = new ChatAnthropic({ model: "claude-3-5-haiku-latest" });
  const anthropicResult = await anthropic.invoke([
    new HumanMessage("Say hello in 5 words"),
  ]);
  console.log("Anthropic:", anthropicResult.content);

  // Google
  const google = new ChatGoogleGenerativeAI({ model: "gemini-2.0-flash" });
  const googleResult = await google.invoke([
    new HumanMessage("Say hello in 5 words"),
  ]);
  console.log("Google:", googleResult.content);
}

async function testStreaming() {
  console.log("\n=== LangChain: Streaming ===");

  const model = new ChatOpenAI({ model: "gpt-4o-mini", streaming: true });

  process.stdout.write("Streaming: ");
  const stream = await model.stream([
    new HumanMessage("Count from 1 to 5"),
  ]);

  for await (const chunk of stream) {
    process.stdout.write(String(chunk.content));
  }
  console.log();
}

async function testChain() {
  console.log("\n=== LangChain: Chain (LCEL) ===");

  const model = new ChatOpenAI({ model: "gpt-4o-mini" });
  const parser = new StringOutputParser();

  const chain = RunnableSequence.from([
    model,
    parser,
  ]);

  const result = await chain.invoke([
    new SystemMessage("You are a helpful assistant."),
    new HumanMessage("What is 2+2?"),
  ]);

  console.log("Chain result:", result);
}

async function testMultiModelChain() {
  console.log("\n=== LangChain: Multi-Model Chain ===");

  const researcher = new ChatOpenAI({ model: "gpt-4o-mini" });
  const summarizer = new ChatAnthropic({ model: "claude-3-5-haiku-latest" });
  const parser = new StringOutputParser();

  // Step 1: Research with OpenAI
  const research = await researcher.invoke([
    new SystemMessage("You are a research assistant."),
    new HumanMessage("What are 3 facts about the moon?"),
  ]);

  // Step 2: Summarize with Anthropic
  const summary = await summarizer.pipe(parser).invoke([
    new SystemMessage("Summarize the following in one sentence."),
    new HumanMessage(String(research.content)),
  ]);

  console.log("Summary:", summary);
}

async function testWithTools() {
  console.log("\n=== LangChain: With Tools ===");

  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
  }).bindTools([
    {
      name: "get_weather",
      description: "Get the weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string" },
        },
        required: ["location"],
      },
    },
  ]);

  const result = await model.invoke([
    new HumanMessage("What's the weather in Tokyo?"),
  ]);

  console.log("Tool calls:", result.tool_calls?.length ?? 0);
}

async function main() {
  // Use fetch instrumentation for LangChain (uses nested SDK copies)
  await instrumentFetch({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./langchain-metrics.jsonl" }),
    ]),
  });

  console.log("Starting LangChain tests...\n");

  await testBasicInvoke();
  await testStreaming();
  await testChain();
  await testMultiModelChain();
  await testWithTools();

  console.log("\n=== All LangChain tests complete ===\n");
}

main().catch(console.error);
