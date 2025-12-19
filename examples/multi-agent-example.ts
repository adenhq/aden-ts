/**
 * Multi-Agent Pattern Example
 *
 * Demonstrates how Aden tracks multi-agent workflows
 * Similar to CrewAI/AutoGen patterns but using direct SDK calls
 */

import "dotenv/config";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  instrument,
  createConsoleEmitter,
  createJsonFileEmitter,
  createMultiEmitter,
  withAgent,
  withMeterContext,
} from "../dist/index.js";

// Clients created after instrumentation in main()
let openai: OpenAI;
let anthropic: Anthropic;
let gemini: GoogleGenerativeAI;

// Agent definitions
interface AgentConfig {
  name: string;
  role: string;
  provider: "openai" | "anthropic" | "gemini";
  model: string;
}

const agents: AgentConfig[] = [
  {
    name: "Researcher",
    role: "Research and gather information on topics",
    provider: "openai",
    model: "gpt-4o-mini",
  },
  {
    name: "Analyst",
    role: "Analyze data and extract insights",
    provider: "anthropic",
    model: "claude-3-5-haiku-latest",
  },
  {
    name: "Writer",
    role: "Write clear, engaging content",
    provider: "gemini",
    model: "gemini-2.0-flash",
  },
  {
    name: "Reviewer",
    role: "Review and improve content quality",
    provider: "openai",
    model: "gpt-4o-mini",
  },
];

// Agent execution function
async function runAgent(agent: AgentConfig, prompt: string): Promise<string> {
  return withAgent(agent.name, async () => {
    const systemPrompt = `You are a ${agent.role}. Be concise and focused.`;

    switch (agent.provider) {
      case "openai": {
        const response = await openai.chat.completions.create({
          model: agent.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        });
        return response.choices[0]?.message?.content ?? "";
      }

      case "anthropic": {
        const response = await anthropic.messages.create({
          model: agent.model,
          max_tokens: 512,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        });
        const textBlock = response.content.find((b) => b.type === "text");
        return textBlock?.type === "text" ? textBlock.text : "";
      }

      case "gemini": {
        const model = gemini.getGenerativeModel({
          model: agent.model,
          systemInstruction: systemPrompt,
        });
        const result = await model.generateContent(prompt);
        return result.response.text();
      }
    }
  });
}

// Workflow: Sequential Pipeline
async function sequentialWorkflow(topic: string) {
  console.log("\n=== Sequential Pipeline Workflow ===");
  console.log(`Topic: ${topic}\n`);

  // Each agent processes in sequence, passing results to the next
  const research = await runAgent(
    agents[0], // Researcher
    `Research this topic: ${topic}`
  );
  console.log("Researcher done");

  const analysis = await runAgent(
    agents[1], // Analyst
    `Analyze this research:\n${research}`
  );
  console.log("Analyst done");

  const draft = await runAgent(
    agents[2], // Writer
    `Write a brief article based on:\n${analysis}`
  );
  console.log("Writer done");

  const final = await runAgent(
    agents[3], // Reviewer
    `Review and improve:\n${draft}`
  );
  console.log("Reviewer done");

  return final;
}

// Workflow: Parallel Research
async function parallelWorkflow(topics: string[]) {
  console.log("\n=== Parallel Research Workflow ===");
  console.log(`Topics: ${topics.join(", ")}\n`);

  // Research all topics in parallel
  const researchPromises = topics.map((topic, i) =>
    runAgent(agents[0], `Research briefly: ${topic}`)
  );

  const researches = await Promise.all(researchPromises);
  console.log("All research done");

  // Combine and analyze
  const combined = researches.join("\n\n---\n\n");
  const synthesis = await runAgent(
    agents[1],
    `Synthesize these research findings into one paragraph:\n${combined}`
  );

  return synthesis;
}

// Workflow: Debate/Discussion
async function debateWorkflow(proposition: string) {
  console.log("\n=== Debate Workflow ===");
  console.log(`Proposition: ${proposition}\n`);

  // Pro argument (OpenAI)
  const proArg = await runAgent(
    { ...agents[0], name: "ProDebater", role: "Argue in favor" },
    `Argue in favor of: ${proposition}`
  );
  console.log("Pro argument done");

  // Con argument (Anthropic)
  const conArg = await runAgent(
    { ...agents[1], name: "ConDebater", role: "Argue against" },
    `Argue against: ${proposition}`
  );
  console.log("Con argument done");

  // Judge/synthesis (Gemini)
  const verdict = await runAgent(
    { ...agents[2], name: "Judge", role: "Evaluate arguments fairly" },
    `Evaluate these arguments:\n\nPRO: ${proArg}\n\nCON: ${conArg}\n\nProvide a balanced conclusion.`
  );
  console.log("Verdict done");

  return verdict;
}

// Workflow: Iterative Refinement
async function iterativeWorkflow(task: string, maxIterations = 3) {
  console.log("\n=== Iterative Refinement Workflow ===");
  console.log(`Task: ${task}\n`);

  let draft = await runAgent(agents[2], task); // Writer

  for (let i = 0; i < maxIterations; i++) {
    console.log(`Iteration ${i + 1}...`);

    // Review
    const feedback = await runAgent(
      agents[3],
      `Review this and suggest one specific improvement:\n${draft}`
    );

    // Revise
    draft = await runAgent(
      agents[2],
      `Revise based on this feedback:\n${feedback}\n\nOriginal:\n${draft}`
    );
  }

  return draft;
}

// Main
async function main() {
  // Initialize instrumentation - pass SDK classes for correct module instance
  await instrument({
    emitMetric: createMultiEmitter([
      createConsoleEmitter({ pretty: true }),
      createJsonFileEmitter({ filePath: "./multi-agent-metrics.jsonl" }),
    ]),
    sdks: { OpenAI, Anthropic, GoogleGenerativeAI },
  });

  // Create clients AFTER instrumentation
  openai = new OpenAI();
  anthropic = new Anthropic();
  gemini = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

  console.log("Starting Multi-Agent Workflow Examples...\n");

  // Wrap everything in a trace context
  await withMeterContext(async () => {
    // Run different workflow patterns
    const result1 = await sequentialWorkflow("Benefits of TypeScript");
    console.log("\nSequential Result:", result1.slice(0, 100) + "...");

    const result2 = await parallelWorkflow(["React", "Vue", "Svelte"]);
    console.log("\nParallel Result:", result2.slice(0, 100) + "...");

    const result3 = await debateWorkflow("AI will replace most jobs");
    console.log("\nDebate Result:", result3.slice(0, 100) + "...");

    // const result4 = await iterativeWorkflow("Write a haiku about coding", 2);
    // console.log("\nIterative Result:", result4);
  });

  console.log("\n=== All Multi-Agent workflows complete ===");
  console.log("Check multi-agent-metrics.jsonl for detailed traces\n");
}

main().catch(console.error);
