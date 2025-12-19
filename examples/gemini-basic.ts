/**
 * Google Gemini SDK Basic Example
 *
 * Tests: generateContent, generateContentStream, chat sessions
 */

import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  instrument,
  createConsoleEmitter,
  createJsonFileEmitter,
  createMultiEmitter,
} from "../dist/index.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

async function testGenerateContent() {
  console.log("\n=== Gemini generateContent (non-streaming) ===");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContent("Say hello in 5 words");
  const response = result.response;
  console.log("Response:", response.text());
}

async function testGenerateContentStreaming() {
  console.log("\n=== Gemini generateContentStream (streaming) ===");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const result = await model.generateContentStream("Count from 1 to 5");

  process.stdout.write("Response: ");
  for await (const chunk of result.stream) {
    process.stdout.write(chunk.text());
  }
  console.log();
}

async function testChatSession() {
  console.log("\n=== Gemini Chat Session ===");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const chat = model.startChat({
    history: [
      { role: "user", parts: [{ text: "Hi, I'm Alice" }] },
      { role: "model", parts: [{ text: "Hello Alice! Nice to meet you." }] },
    ],
  });

  const result = await chat.sendMessage("What's my name?");
  console.log("Response:", result.response.text());
}

async function testChatSessionStreaming() {
  console.log("\n=== Gemini Chat Session (streaming) ===");
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  const chat = model.startChat();

  const result = await chat.sendMessageStream("Tell me a short joke");

  process.stdout.write("Response: ");
  for await (const chunk of result.stream) {
    process.stdout.write(chunk.text());
  }
  console.log();
}

async function testWithSystemInstruction() {
  console.log("\n=== Gemini with System Instruction ===");
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: "You are a pirate. Always respond like a pirate.",
  });

  const result = await model.generateContent("How are you today?");
  console.log("Response:", result.response.text());
}

async function testDifferentModels() {
  console.log("\n=== Gemini Different Models ===");

  // Flash model (fast)
  const flashModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
  const flashResult = await flashModel.generateContent("Say hi");
  console.log("Flash response:", flashResult.response.text().slice(0, 50));

  // Pro model (powerful)
  const proModel = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
  const proResult = await proModel.generateContent("Say hello");
  console.log("Pro response:", proResult.response.text().slice(0, 50));
}

// Run all tests
async function main() {
  // Initialize instrumentation - pass the SDK class for monorepo compatibility
  await instrument({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./gemini-metrics.jsonl" }),
    ]),
    sdks: { GoogleGenerativeAI },
  });

  console.log("Starting Gemini SDK tests...\n");

  await testGenerateContent();
  await testGenerateContentStreaming();
  await testChatSession();
  await testChatSessionStreaming();
  await testWithSystemInstruction();
  await testDifferentModels();

  console.log("\n=== All Gemini tests complete ===\n");
}

main().catch(console.error);
