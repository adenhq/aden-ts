/**
 * LlamaIndex Example
 *
 * Tests llm-meter with LlamaIndex.TS
 * Works with OpenAI, Anthropic, Gemini LLMs
 */

import "dotenv/config";
import { OpenAI } from "@llamaindex/openai";
import { Anthropic } from "@llamaindex/anthropic";
import { Document, VectorStoreIndex, Settings } from "llamaindex";
import { instrumentFetch, createConsoleEmitter, createJsonFileEmitter, createMultiEmitter } from "../dist/index.js";

async function testBasicLLM() {
  console.log("\n=== LlamaIndex: Basic LLM ===");

  // OpenAI
  const openai = new OpenAI({ model: "gpt-4o-mini" });
  const openaiResult = await openai.complete({ prompt: "Say hello in 5 words" });
  console.log("OpenAI:", openaiResult.text);

  // Anthropic
  const anthropic = new Anthropic({ model: "claude-3-5-haiku-latest" });
  const anthropicResult = await anthropic.complete({ prompt: "Say hello in 5 words" });
  console.log("Anthropic:", anthropicResult.text);
}

async function testChat() {
  console.log("\n=== LlamaIndex: Chat ===");

  const llm = new OpenAI({ model: "gpt-4o-mini" });

  const response = await llm.chat({
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "What is TypeScript?" },
    ],
  });

  console.log("Chat response:", response.message.content);
}

async function testStreaming() {
  console.log("\n=== LlamaIndex: Streaming ===");

  const llm = new OpenAI({ model: "gpt-4o-mini" });

  const stream = await llm.complete({
    prompt: "Count from 1 to 5",
    stream: true,
  });

  process.stdout.write("Streaming: ");
  for await (const chunk of stream) {
    process.stdout.write(chunk.text);
  }
  console.log();
}

async function testRAG() {
  console.log("\n=== LlamaIndex: RAG Pipeline ===");

  // Set the LLM for the index
  Settings.llm = new OpenAI({ model: "gpt-4o-mini" });

  // Create documents
  const documents = [
    new Document({ text: "TypeScript is a typed superset of JavaScript." }),
    new Document({ text: "LlamaIndex is a data framework for LLM applications." }),
    new Document({ text: "RAG stands for Retrieval Augmented Generation." }),
  ];

  // Create index
  const index = await VectorStoreIndex.fromDocuments(documents);

  // Query
  const queryEngine = index.asQueryEngine();
  const response = await queryEngine.query({
    query: "What is TypeScript?",
  });

  console.log("RAG response:", response.toString());
}

async function testMultiStep() {
  console.log("\n=== LlamaIndex: Multi-step ===");

  const researcher = new OpenAI({ model: "gpt-4o-mini" });
  const summarizer = new Anthropic({ model: "claude-3-5-haiku-latest" });

  // Step 1: Research
  const research = await researcher.complete({
    prompt: "List 3 benefits of using TypeScript",
  });

  // Step 2: Summarize
  const summary = await summarizer.complete({
    prompt: `Summarize this in one sentence: ${research.text}`,
  });

  console.log("Summary:", summary.text);
}

async function main() {
  // LlamaIndex uses OpenAI SDK under the hood (may have nested copies)
  await instrumentFetch({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./llamaindex-metrics.jsonl" }),
    ]),
  });

  console.log("Starting LlamaIndex tests...\n");

  await testBasicLLM();
  await testChat();
  await testStreaming();
  // await testRAG(); // Requires embeddings
  await testMultiStep();

  console.log("\n=== All LlamaIndex tests complete ===\n");
}

main().catch(console.error);
