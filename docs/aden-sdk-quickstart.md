Quick reference for integrating Aden LLM observability & cost control into TypeScript/JavaScript agents.

## Prerequisites

`.env` file should contain:

```
OPENAI_API_KEY=sk-xxx          # or ANTHROPIC_API_KEY, GOOGLE_API_KEY
ADEN_API_URL=https://kube.acho.io
ADEN_API_KEY=your-api-key-here
```

## Installation

```bash
npm install aden dotenv

# Install the LLM SDKs you use
npm install openai                  # For OpenAI
npm install @anthropic-ai/sdk       # For Anthropic
npm install @google/generative-ai   # For Google Gemini
```

## Basic Setup (3 Steps)

### 1. Import and Load Environment

```typescript
import "dotenv/config";
import OpenAI from "openai";
import {
  instrument,
  uninstrument,
  createConsoleEmitter,
  RequestCancelledError,
} from "aden";
import type { BeforeRequestResult } from "aden";
```

### 2. Define Budget Check Callback

```typescript
function budgetCheck(params: unknown, context: { budget?: { exhausted?: boolean; percent_used?: number } }): BeforeRequestResult {
  const budgetInfo = context.budget;

  if (budgetInfo?.exhausted) {
    return { action: "cancel", reason: "Budget exhausted" };
  }

  if (budgetInfo && budgetInfo.percent_used >= 95) {
    return { action: "throttle", delayMs: 2000 };
  }

  if (budgetInfo && budgetInfo.percent_used >= 80) {
    return { action: "degrade", toModel: "gpt-4o-mini", reason: "Approaching limit" };
  }

  return { action: "proceed" };
}
```

### 3. Initialize Aden (at startup)

```typescript
await instrument({
  apiKey: process.env.ADEN_API_KEY,
  serverUrl: process.env.ADEN_API_URL,
  emitMetric: createConsoleEmitter({ pretty: true }),
  onAlert: (alert) => console.log(`[Aden ${alert.level}] ${alert.message}`),
  beforeRequest: budgetCheck,
  sdks: { OpenAI },
});
```

### 4. Handle Budget Errors in Your Agent

```typescript
async function runAgent(userInput: string): Promise<string> {
  try {
    const openai = new OpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: userInput }],
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (e) {
    if (e instanceof RequestCancelledError) {
      return `Sorry, you have used up your allowance. ${e.message}`;
    }
    throw e;
  }
}
```

### 5. Cleanup (on exit)

```typescript
await uninstrument();
```

## Complete Template

```typescript
/**
 * Agent with Aden instrumentation
 */
import "dotenv/config";
import OpenAI from "openai";
import {
  instrument,
  uninstrument,
  createConsoleEmitter,
  RequestCancelledError,
} from "aden";
import type { BeforeRequestResult } from "aden";

// Budget enforcement callback
function budgetCheck(
  params: unknown,
  context: { budget?: { exhausted?: boolean; percent_used?: number } }
): BeforeRequestResult {
  const budgetInfo = context.budget;
  if (budgetInfo?.exhausted) {
    return { action: "cancel", reason: "Budget exhausted" };
  }
  if (budgetInfo && budgetInfo.percent_used >= 95) {
    return { action: "throttle", delayMs: 2000 };
  }
  if (budgetInfo && budgetInfo.percent_used >= 80) {
    return { action: "degrade", toModel: "gpt-4o-mini", reason: "Approaching limit" };
  }
  return { action: "proceed" };
}

// Initialize Aden
await instrument({
  apiKey: process.env.ADEN_API_KEY,
  serverUrl: process.env.ADEN_API_URL,
  emitMetric: createConsoleEmitter({ pretty: true }),
  onAlert: (alert) => console.log(`[Aden ${alert.level}] ${alert.message}`),
  beforeRequest: budgetCheck,
  sdks: { OpenAI },
});

// === YOUR AGENT CODE HERE ===

async function runAgent(userInput: string): Promise<string> {
  try {
    const openai = new OpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: userInput }],
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (e) {
    if (e instanceof RequestCancelledError) {
      return `Sorry, you have used up your allowance. ${e.message}`;
    }
    throw e;
  }
}

// Main entry point
async function main() {
  try {
    const result = await runAgent("Hello, world!");
    console.log(result);
  } finally {
    await uninstrument();
  }
}

main();
```

## Budget Actions Reference

| Action | When | Behavior |
| --- | --- | --- |
| `{ action: "proceed" }` | Within budget | Request continues normally |
| `{ action: "cancel", reason: "..." }` | Budget exhausted | Throws `RequestCancelledError` |
| `{ action: "throttle", delayMs: N }` | Near limit | Delays request by N ms |
| `{ action: "degrade", toModel: "...", reason: "..." }` | Approaching limit | Switches to cheaper model |

## Key Points

- `emitMetric` is **required** - use `createConsoleEmitter({ pretty: true })` for dev
- `beforeRequest` callback enables budget enforcement
- Always wrap agent calls in `try/catch` for `RequestCancelledError`
- Call `await uninstrument()` on exit to flush remaining metrics
- Control agent connects automatically when `apiKey` + `serverUrl` are provided
- Pass SDK classes to `sdks` object (e.g., `{ OpenAI, Anthropic }`)

## Documentation

Full docs: [https://www.npmjs.com/package/aden](https://www.npmjs.com/package/aden)
