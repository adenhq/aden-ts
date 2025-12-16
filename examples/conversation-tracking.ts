/**
 * Conversation Tracking Example
 *
 * Demonstrates how to:
 * 1. Track token usage across multi-turn conversations
 * 2. Monitor context window utilization
 * 3. Detect when conversations are getting expensive
 */

import "dotenv/config";
import OpenAI from "openai";
import { makeMeteredOpenAI, type MetricEvent } from "../src/index.js";

// Model context limits
const CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5": 1_047_576,
  "gpt-5-mini": 1_047_576,
  "gpt-4.1": 1_047_576,
  "gpt-4.1-mini": 1_047_576,
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
};

/**
 * Conversation tracker for managing multi-turn usage
 */
class ConversationTracker {
  private conversations: Map<
    string,
    {
      turns: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      cachedTokens: number;
      turnHistory: Array<{
        turn: number;
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
        timestamp: Date;
      }>;
      startedAt: Date;
    }
  > = new Map();

  startConversation(conversationId: string) {
    this.conversations.set(conversationId, {
      turns: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cachedTokens: 0,
      turnHistory: [],
      startedAt: new Date(),
    });
    console.log(`[Conv: ${conversationId}] Started new conversation`);
  }

  recordTurn(conversationId: string, event: MetricEvent) {
    let conv = this.conversations.get(conversationId);
    if (!conv) {
      this.startConversation(conversationId);
      conv = this.conversations.get(conversationId)!;
    }

    conv.turns++;
    const inputTokens = event.usage?.input_tokens ?? 0;
    const outputTokens = event.usage?.output_tokens ?? 0;
    const cachedTokens = event.usage?.cached_tokens ?? 0;

    conv.totalInputTokens += inputTokens;
    conv.totalOutputTokens += outputTokens;
    conv.cachedTokens += cachedTokens;

    conv.turnHistory.push({
      turn: conv.turns,
      inputTokens,
      outputTokens,
      cachedTokens,
      timestamp: new Date(),
    });

    // Calculate context utilization
    const contextLimit = CONTEXT_LIMITS[event.model] ?? 128_000;
    const contextUsed = inputTokens; // Current turn's context
    const contextUtilization = (contextUsed / contextLimit) * 100;

    // Calculate cache efficiency
    const cacheEfficiency = inputTokens > 0 ? (cachedTokens / inputTokens) * 100 : 0;

    console.log(`[Conv: ${conversationId}] Turn ${conv.turns}`);
    console.log(`  Tokens: ${inputTokens} in / ${outputTokens} out`);
    console.log(`  Cached: ${cachedTokens} (${cacheEfficiency.toFixed(1)}% cache hit)`);
    console.log(`  Context: ${contextUsed.toLocaleString()} / ${contextLimit.toLocaleString()} (${contextUtilization.toFixed(1)}%)`);
    console.log(`  Cumulative: ${conv.totalInputTokens + conv.totalOutputTokens} tokens over ${conv.turns} turns`);

    // Warnings
    if (contextUtilization > 75) {
      console.log(`  ⚠️  High context utilization - consider summarizing`);
    }
    if (conv.turns > 10 && cacheEfficiency < 50) {
      console.log(`  ⚠️  Low cache efficiency - enable prompt caching`);
    }

    return conv;
  }

  getConversationStats(conversationId: string) {
    return this.conversations.get(conversationId);
  }

  endConversation(conversationId: string) {
    const conv = this.conversations.get(conversationId);
    if (conv) {
      const duration = (new Date().getTime() - conv.startedAt.getTime()) / 1000;
      console.log(`\n[Conv: ${conversationId}] Ended`);
      console.log(`  Duration: ${duration.toFixed(1)}s`);
      console.log(`  Total turns: ${conv.turns}`);
      console.log(`  Total tokens: ${conv.totalInputTokens + conv.totalOutputTokens}`);
      console.log(`  Avg tokens/turn: ${((conv.totalInputTokens + conv.totalOutputTokens) / conv.turns).toFixed(0)}`);
      console.log(`  Cache savings: ${conv.cachedTokens} tokens`);
    }
    this.conversations.delete(conversationId);
  }
}

// Create conversation tracker
const tracker = new ConversationTracker();
let currentConversationId = "conv-001";

// Create metered client
const client = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: (event) => {
    tracker.recordTurn(currentConversationId, event);
  },
});

async function simulateConversation() {
  console.log("=== Conversation Tracking Example ===\n");

  // Start a conversation
  tracker.startConversation(currentConversationId);

  // Use previous_response_id for multi-turn
  let previousResponseId: string | undefined;

  const turns = [
    "Hi! I want to learn about TypeScript.",
    "What are the main benefits over JavaScript?",
    "Can you show me a simple example of type annotations?",
    "How do interfaces differ from types?",
    "Thanks! One more question - what are generics?",
  ];

  for (const userMessage of turns) {
    console.log(`\nUser: ${userMessage}\n`);

    const response = await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: userMessage,
      previous_response_id: previousResponseId,
      max_output_tokens: 200,
      // Enable prompt caching for better efficiency
      // prompt_cache_key: currentConversationId,
    });

    previousResponseId = response.id;

    // Show abbreviated response
    const outputText = response.output_text || "(no text output)";
    console.log(`Assistant: ${outputText.slice(0, 100)}...`);
  }

  // End and summarize
  tracker.endConversation(currentConversationId);
}

simulateConversation().catch(console.error);
