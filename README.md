# llm-meter

Lightweight metering and observability for LLM SDKs (OpenAI, Gemini, Anthropic). Track usage metrics, billing data, and implement budget guardrails without modifying your existing code.

## Features

- **Multi-provider support** - Automatically detects and instruments OpenAI, Gemini, and Anthropic SDKs
- **Zero-config metering** - Call `instrument()` once and start collecting metrics
- **Streaming support** - Metrics collected from streaming responses automatically
- **Usage normalization** - Consistent format across all providers and API shapes
- **Budget guardrails** - Pre-flight token counting to prevent runaway costs
- **Call relationship tracking** - Automatic session grouping, agent hierarchies, and call site detection
- **Flexible emitters** - Console, batched, multi-destination, and custom emitters
- **Full TypeScript support** - Complete type definitions included

## Installation

```bash
npm install llm-meter
```

Optional peer dependencies (install the ones you use):
```bash
npm install openai                  # For OpenAI
npm install @google/generative-ai   # For Gemini
npm install @anthropic-ai/sdk       # For Anthropic/Claude
```

## Quick Start

```typescript
import { instrument, createConsoleEmitter } from "llm-meter";

// Call once at startup - all available LLM clients are now metered
const result = instrument({
  emitMetric: createConsoleEmitter({ pretty: true }),
});

console.log(result);
// { openai: true, gemini: true, anthropic: false }

// Use any LLM SDK normally - metrics collected automatically
import OpenAI from "openai";
const openai = new OpenAI();
await openai.chat.completions.create({ model: "gpt-4", messages: [...] });

import { GoogleGenerativeAI } from "@google/generative-ai";
const gemini = new GoogleGenerativeAI(apiKey);
const model = gemini.getGenerativeModel({ model: "gemini-pro" });
await model.generateContent("Hello!");
```

### Per-Instance Wrapping (Alternative)

If you need different options per client, use `makeMeteredOpenAI`:

```typescript
import { makeMeteredOpenAI } from "llm-meter";

const client = new OpenAI();
const metered = makeMeteredOpenAI(client, {
  emitMetric: myEmitter,
});
```

## Metrics Collected

Every API call emits a `MetricEvent` with:

| Field | Description |
|-------|-------------|
| `traceId` | Unique ID for correlation |
| `requestId` | OpenAI's request ID |
| `model` | Model used |
| `latency_ms` | Request duration |
| `usage.input_tokens` | Input/prompt tokens |
| `usage.output_tokens` | Output/completion tokens |
| `usage.cached_tokens` | Tokens served from cache |
| `usage.reasoning_tokens` | Reasoning tokens (o1/o3 models) |
| `service_tier` | Service tier used |
| `tool_calls` | Tool calls made |
| `error` | Error message if failed |

## Budget Guardrails

Prevent runaway costs with pre-flight token counting:

```typescript
import { withBudgetGuardrails } from "llm-meter";

const budgeted = withBudgetGuardrails(metered, {
  maxInputTokens: 4000,
  onExceeded: "throw", // or "warn"
});

// Throws BudgetExceededError if input > 4000 tokens
await budgeted.responses.create({
  model: "gpt-4.1",
  input: veryLongPrompt,
});
```

## Custom Metric Handlers

Send metrics to your backend:

```typescript
import { makeMeteredOpenAI, createBatchEmitter } from "llm-meter";

const batchEmitter = createBatchEmitter(
  async (events) => {
    await fetch("/api/metrics", {
      method: "POST",
      body: JSON.stringify(events),
    });
  },
  { maxBatchSize: 100, flushInterval: 5000 }
);

const metered = makeMeteredOpenAI(client, {
  emitMetric: batchEmitter,
});

// Don't forget to flush on shutdown
process.on("beforeExit", () => batchEmitter.stop());
```

## Streaming

Metrics are automatically collected when streaming completes:

```typescript
const stream = await metered.responses.create({
  model: "gpt-4.1",
  input: "Count to 10",
  stream: true,
});

for await (const event of stream) {
  // Process events...
}
// Metrics emitted automatically when stream ends
```

## Available Emitters

| Emitter | Description |
|---------|-------------|
| `createConsoleEmitter()` | Log to console (dev/debug) |
| `createBatchEmitter()` | Batch and flush periodically |
| `createHttpTransport()` | Send to HTTP API endpoint |
| `createMultiEmitter()` | Send to multiple destinations |
| `createFilteredEmitter()` | Filter events before emitting |
| `createMemoryEmitter()` | Collect in memory (testing) |
| `createNoopEmitter()` | Disable metrics |

## HTTP Transport

Send metrics to a central API endpoint for storage and aggregation. This is the recommended approach for production deployments.

### Basic Usage

```typescript
import { makeMeteredOpenAI, createHttpTransport } from "llm-meter";

const transport = createHttpTransport({
  apiUrl: "https://api.example.com/v1/metrics",
  apiKey: "your-api-key",
});

const metered = makeMeteredOpenAI(client, {
  emitMetric: transport.emit,
});

// On shutdown - flush remaining metrics
await transport.stop();
```

### Environment Variable Configuration

```typescript
// Set environment variables:
// METER_API_URL=https://api.example.com/v1/metrics
// METER_API_KEY=your-api-key (optional)
// METER_BATCH_SIZE=50 (optional)
// METER_FLUSH_INTERVAL=5000 (optional, in ms)

const transport = createHttpTransport(); // Uses env vars
```

### Advanced Options

```typescript
const transport = createHttpTransport({
  apiUrl: "https://api.example.com/v1/metrics",
  apiKey: "your-api-key",
  batchSize: 100,           // Events per batch (default: 50)
  flushInterval: 10000,     // ms between flushes (default: 5000)
  timeout: 15000,           // Request timeout in ms (default: 10000)
  maxRetries: 5,            // Retry attempts (default: 3)
  maxQueueSize: 50000,      // Max queued events (default: 10000)
  headers: {                // Additional headers
    "X-Tenant-ID": "tenant-123",
  },
  onQueueOverflow: (dropped) => {
    console.warn(`Dropped ${dropped} metrics due to queue overflow`);
  },
  onSendError: (error, batch, stats) => {
    console.error(`Failed to send ${batch.length} metrics:`, error);
    // Optionally save to fallback storage
  },
});
```

### Monitoring Transport Health

```typescript
// Check transport stats
const stats = transport.stats;
console.log(`Sent: ${stats.sent}, Dropped: ${stats.dropped}, Errors: ${stats.errors}`);

// Manual flush
await transport.flush();

// Flush all remaining events
await transport.flushAll();

// Graceful shutdown
await transport.stop();
```

### API Endpoint Format

The transport sends POST requests with this payload:

```json
{
  "metrics": [
    {
      "traceId": "uuid",
      "requestId": "req_xxx",
      "model": "gpt-4.1",
      "latency_ms": 1234,
      "usage": {
        "input_tokens": 100,
        "output_tokens": 50,
        "total_tokens": 150
      },
      "sessionId": "session-uuid",
      "callSequence": 1,
      "agentStack": ["OrchestratorAgent"],
      "callSite": { "file": "src/app.ts", "line": 42 }
    }
  ],
  "timestamp": 1702847123456
}
```

## Call Relationship Tracking

Automatically track relationships between LLM calls using AsyncLocalStorage. Related calls are grouped by session, with parent/child relationships, agent hierarchies, and source locations detected automatically.

### Additional Metrics Collected

| Field | Description |
|-------|-------------|
| `sessionId` | Groups related calls together |
| `parentTraceId` | Parent call for nested/hierarchical tracking |
| `callSequence` | Order of calls within a session (1, 2, 3...) |
| `agentStack` | Names of agents/handlers in the call chain |
| `callSite` | Source location (file, line, column, function) |

### Usage Pattern 1: Zero-Config (Auto-Session)

The simplest approach - related calls are automatically grouped:

```typescript
import { makeMeteredOpenAI, createConsoleEmitter } from "llm-meter";

const metered = makeMeteredOpenAI(client, {
  emitMetric: createConsoleEmitter({ pretty: true }),
  // trackCallRelationships: true (default)
});

// These calls automatically share a session
await metered.responses.create({ model: "gpt-4.1", input: "Hello" });
// → sessionId: "abc-123", callSequence: 1

await metered.responses.create({ model: "gpt-4.1", input: "Follow up" });
// → sessionId: "abc-123", callSequence: 2, parentTraceId: <first-call-trace>
```

### Usage Pattern 2: Explicit Session with Metadata

For request handlers where you want isolated sessions with custom metadata:

```typescript
import { enterMeterContext } from "llm-meter";

app.post("/chat", async (req, res) => {
  // Create a new session for this request
  enterMeterContext({
    sessionId: req.headers["x-request-id"], // optional custom ID
    metadata: { userId: req.userId, tenantId: req.tenantId },
  });

  // All LLM calls in this request share the session
  const response = await metered.responses.create({
    model: "gpt-4.1",
    input: req.body.message,
  });
  // → sessionId tied to this request, metadata available

  res.json(response);
});
```

### Usage Pattern 3: Scoped Sessions

Use `withMeterContext` for explicit session boundaries:

```typescript
import { withMeterContextAsync } from "llm-meter";

// All calls inside share a session, isolated from outside
const result = await withMeterContextAsync(async () => {
  await metered.responses.create({ ... }); // callSequence: 1
  await metered.responses.create({ ... }); // callSequence: 2
  return processResults();
}, { metadata: { workflow: "summarization" } });
```

### Usage Pattern 4: Named Agent Tracking

Track nested agent hierarchies for multi-agent systems:

```typescript
import { withAgent, pushAgent, popAgent } from "llm-meter";

// Option A: Using withAgent wrapper
async function researchAgent() {
  await withAgent("ResearchAgent", async () => {
    await metered.responses.create({ ... });
    // → agentStack: ["ResearchAgent"]

    await withAgent("WebSearchAgent", async () => {
      await metered.responses.create({ ... });
      // → agentStack: ["ResearchAgent", "WebSearchAgent"]
    });
  });
}

// Option B: Manual push/pop for complex flows
async function orchestratorAgent() {
  pushAgent("OrchestratorAgent");
  try {
    await metered.responses.create({ ... });
    // → agentStack: ["OrchestratorAgent"]

    pushAgent("SubAgent");
    await metered.responses.create({ ... });
    // → agentStack: ["OrchestratorAgent", "SubAgent"]
    popAgent();

  } finally {
    popAgent();
  }
}
```

### Usage Pattern 5: Automatic Agent Detection

Agent names are automatically detected from your call stack:

```typescript
class ResearchAgent {
  async execute() {
    // "ResearchAgent" automatically detected from class name
    await metered.responses.create({ ... });
    // → agentStack: ["ResearchAgent"] (auto-detected)
  }
}

async function handleUserRequest() {
  // "handleUserRequest" detected as handler
  await metered.responses.create({ ... });
}
```

Detected patterns: `*Agent`, `*Handler`, `*Service`, `*Controller`, `handle*`, `process*`, `run*`, `execute*`

### Usage Pattern 6: Context Metadata

Attach and retrieve metadata from the current context:

```typescript
import { setContextMetadata, getContextMetadata, getCurrentContext } from "llm-meter";

// Set metadata
setContextMetadata("userId", "user-123");
setContextMetadata("experiment", "variant-a");

// Get metadata
const userId = getContextMetadata("userId");

// Get full context
const ctx = getCurrentContext();
console.log(ctx.sessionId, ctx.callSequence, ctx.metadata);
```

### Usage Pattern 7: Disabling Relationship Tracking

For high-throughput scenarios where you don't need relationship data:

```typescript
const metered = makeMeteredOpenAI(client, {
  emitMetric: myEmitter,
  trackCallRelationships: false, // Disable for performance
});
```

### Full Example: Multi-Agent Orchestrator

```typescript
import {
  makeMeteredOpenAI,
  enterMeterContext,
  withAgent,
  createBatchEmitter,
} from "llm-meter";

const metered = makeMeteredOpenAI(client, {
  emitMetric: createBatchEmitter(async (events) => {
    // All events have sessionId, agentStack, callSequence, callSite
    await sendToAnalytics(events);
  }),
});

app.post("/agent/run", async (req, res) => {
  // Start a new tracked session
  enterMeterContext({
    metadata: { userId: req.userId, taskId: req.body.taskId },
  });

  // Orchestrator decides which agents to run
  await withAgent("OrchestratorAgent", async () => {
    const plan = await metered.responses.create({
      model: "gpt-4.1",
      input: `Plan for: ${req.body.task}`,
    });
    // → callSequence: 1, agentStack: ["OrchestratorAgent"]

    // Execute sub-agents based on plan
    for (const step of plan.steps) {
      await withAgent(step.agentName, async () => {
        await metered.responses.create({
          model: "gpt-4.1",
          input: step.prompt,
        });
        // → callSequence: 2+, agentStack: ["OrchestratorAgent", step.agentName]
        // → parentTraceId: previous call's traceId
      });
    }
  });

  res.json({ status: "complete" });
});
```

## API Reference

### `instrument(options)`

**Recommended.** Instrument OpenAI globally. Call once at startup.

```typescript
import { instrument, createHttpTransport } from "llm-meter";

instrument({
  emitMetric: createHttpTransport({ apiUrl: process.env.METER_API_URL }).emit,
});

// All OpenAI clients are now metered
const client = new OpenAI();
```

### `uninstrument()`

Remove global instrumentation. Restores original behavior.

```typescript
import { uninstrument } from "llm-meter";

uninstrument(); // Metrics no longer collected
```

### `updateInstrumentationOptions(updates)`

Update options at runtime without re-instrumenting.

```typescript
import { updateInstrumentationOptions } from "llm-meter";

// Change emitter at runtime
updateInstrumentationOptions({
  emitMetric: newEmitter,
});
```

### `makeMeteredOpenAI(client, options)`

Wraps a single OpenAI client with metering. Use when you need different options per client.

```typescript
interface MeterOptions {
  emitMetric: (event: MetricEvent) => void | Promise<void>;
  trackToolCalls?: boolean; // default: true
  trackCallRelationships?: boolean; // default: true
  generateTraceId?: () => string; // default: crypto.randomUUID
  beforeRequest?: BeforeRequestHook; // pre-request hook for rate limiting
  requestMetadata?: Record<string, unknown>; // passed to beforeRequest
}
```

### `withBudgetGuardrails(client, config)`

Adds budget enforcement to a client.

```typescript
interface BudgetConfig {
  maxInputTokens?: number;
  onExceeded?: "throw" | "warn" | "truncate";
  onExceededHandler?: (info: BudgetExceededInfo) => void;
}
```

### `countInputTokens(client, model, input)`

Count tokens before making a request.

```typescript
const tokens = await countInputTokens(client, "gpt-4.1", myPrompt);
console.log(`Will use ${tokens} input tokens`);
```

### `normalizeUsage(usage)`

Normalize usage from either API shape.

```typescript
const normalized = normalizeUsage(response.usage);
// { input_tokens, output_tokens, cached_tokens, reasoning_tokens, ... }
```

### Context Tracking Functions

#### `enterMeterContext(options?)`

Enter a context that persists across awaits (zero-wrapper approach).

```typescript
enterMeterContext({
  sessionId?: string,    // optional custom session ID
  metadata?: Record<string, unknown>,
});
```

#### `withMeterContextAsync(fn, options?)`

Run an async function within an isolated session context.

```typescript
await withMeterContextAsync(async () => {
  // Calls here share a session
}, { metadata: { userId: "123" } });
```

#### `withAgent(name, fn)`

Run a function within a named agent context.

```typescript
await withAgent("ResearchAgent", async () => {
  // Calls here have "ResearchAgent" in agentStack
});
```

#### `pushAgent(name)` / `popAgent()`

Manually manage the agent stack for complex flows.

#### `getCurrentContext()`

Get the current meter context (creates one if none exists).

```typescript
interface MeterContext {
  sessionId: string;
  callSequence: number;
  agentStack: string[];
  parentTraceId?: string;
  metadata?: Record<string, unknown>;
}
```

#### `setContextMetadata(key, value)` / `getContextMetadata(key)`

Get/set metadata on the current context.

#### `extractCallSite()`

Get the current call site (file, line, column, function).

#### `extractAgentStack()`

Get auto-detected agent names from the call stack.

## Examples

Run examples with `npx tsx examples/<name>.ts`:

| Example | Description |
|---------|-------------|
| `basic.ts` | Simple metering, streaming, budget guardrails |
| `with-backend.ts` | Batched metrics to a backend service |
| `cost-tracking.ts` | Per-request cost calculation with model pricing |
| `multi-tenant.ts` | Usage attribution per tenant/user with tier limits |
| `conversation-tracking.ts` | Multi-turn conversation token tracking |
| `error-handling.ts` | Error classification and retry detection |
| `reasoning-models.ts` | Reasoning token tracking for o-series models |
| `express-middleware.ts` | Express.js integration with request context |

## License

MIT
