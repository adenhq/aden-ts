/**
 * Express Middleware Example
 *
 * Demonstrates how to:
 * 1. Integrate openai-meter with Express.js
 * 2. Track per-request usage with request context
 * 3. Add usage data to response headers
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  type MetricEvent,
  type NormalizedUsage,
} from "../src/index.js";

// Note: This is a standalone example. In a real app, you'd use:
// import express from "express";

/**
 * Simulated Express-like types for this example
 */
interface Request {
  id: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Response {
  setHeader: (name: string, value: string) => void;
  json: (data: unknown) => void;
  locals: Record<string, unknown>;
}

type NextFunction = () => void;

/**
 * Request-scoped usage storage using AsyncLocalStorage pattern
 */
class RequestContext {
  private static contexts: Map<string, {
    requestId: string;
    usage: NormalizedUsage | null;
    startTime: number;
    events: MetricEvent[];
  }> = new Map();

  static create(requestId: string) {
    this.contexts.set(requestId, {
      requestId,
      usage: null,
      startTime: Date.now(),
      events: [],
    });
  }

  static get(requestId: string) {
    return this.contexts.get(requestId);
  }

  static addEvent(requestId: string, event: MetricEvent) {
    const ctx = this.contexts.get(requestId);
    if (ctx) {
      ctx.events.push(event);
      // Aggregate usage
      if (event.usage) {
        if (!ctx.usage) {
          ctx.usage = { ...event.usage };
        } else {
          ctx.usage.input_tokens += event.usage.input_tokens;
          ctx.usage.output_tokens += event.usage.output_tokens;
          ctx.usage.total_tokens += event.usage.total_tokens;
          ctx.usage.reasoning_tokens += event.usage.reasoning_tokens;
          ctx.usage.cached_tokens += event.usage.cached_tokens;
        }
      }
    }
  }

  static cleanup(requestId: string) {
    this.contexts.delete(requestId);
  }
}

/**
 * Current request ID (in real app, use AsyncLocalStorage)
 */
let currentRequestId: string = "";

/**
 * Create metered client with request context awareness
 */
const openai = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: (event) => {
    if (currentRequestId) {
      RequestContext.addEvent(currentRequestId, event);
    }
    console.log(`[${currentRequestId}] OpenAI call: ${event.usage?.total_tokens ?? 0} tokens`);
  },
});

/**
 * Middleware: Initialize request context
 */
function initRequestContext(req: Request, res: Response, next: NextFunction) {
  req.id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  RequestContext.create(req.id);
  currentRequestId = req.id;
  console.log(`[${req.id}] Request started`);
  next();
}

/**
 * Middleware: Finalize and add usage headers
 */
function finalizeUsage(req: Request, res: Response, next: NextFunction) {
  const ctx = RequestContext.get(req.id);
  if (ctx) {
    const duration = Date.now() - ctx.startTime;

    // Add usage headers
    res.setHeader("X-Request-Id", req.id);
    res.setHeader("X-OpenAI-Calls", ctx.events.length.toString());

    if (ctx.usage) {
      res.setHeader("X-Tokens-Input", ctx.usage.input_tokens.toString());
      res.setHeader("X-Tokens-Output", ctx.usage.output_tokens.toString());
      res.setHeader("X-Tokens-Total", ctx.usage.total_tokens.toString());
      res.setHeader("X-Tokens-Cached", ctx.usage.cached_tokens.toString());
    }

    res.setHeader("X-Duration-Ms", duration.toString());

    // Store in res.locals for logging
    res.locals.usage = ctx.usage;
    res.locals.openaiCalls = ctx.events.length;

    console.log(`[${req.id}] Request completed in ${duration}ms`);
    if (ctx.usage) {
      console.log(`[${req.id}] Total tokens: ${ctx.usage.total_tokens}`);
    }

    // Cleanup
    RequestContext.cleanup(req.id);
  }
  next();
}

/**
 * Example route handler
 */
async function chatHandler(req: Request, res: Response) {
  const { message } = req.body as { message: string };

  // Make OpenAI calls - usage is automatically tracked
  const response = await openai.responses.create({
    model: "gpt-5-mini-2025-08-07",
    input: message,
    max_output_tokens: 200,
  });

  res.json({
    reply: response.output_text,
    requestId: req.id,
  });
}

/**
 * Simulate Express request/response cycle
 */
async function simulateRequest(body: unknown) {
  // Simulated request
  const req: Request = {
    id: "",
    headers: { "content-type": "application/json" },
    body,
  };

  // Simulated response
  const responseHeaders: Record<string, string> = {};
  const res: Response = {
    setHeader: (name, value) => {
      responseHeaders[name] = value;
    },
    json: (data) => {
      console.log("\nResponse body:", JSON.stringify(data, null, 2));
      console.log("\nResponse headers:", responseHeaders);
    },
    locals: {},
  };

  // Run middleware chain
  initRequestContext(req, res, () => {});

  try {
    await chatHandler(req, res);
  } finally {
    finalizeUsage(req, res, () => {});
  }
}

async function main() {
  console.log("=== Express Middleware Example ===\n");

  // Simulate multiple requests
  await simulateRequest({ message: "What is TypeScript?" });
  console.log("\n" + "=".repeat(50) + "\n");

  await simulateRequest({ message: "How do I use async/await?" });
  console.log("\n" + "=".repeat(50) + "\n");

  await simulateRequest({ message: "Explain closures" });
}

main().catch(console.error);
