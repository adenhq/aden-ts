# openai-meter

Lightweight metering and observability wrapper for the OpenAI JavaScript SDK. Track usage metrics, billing data, and implement budget guardrails without modifying your existing code.

## Features

- **Zero-config metering** - Wrap your OpenAI client and start collecting metrics
- **Streaming support** - Metrics collected from streaming responses automatically
- **Usage normalization** - Consistent format across Responses API and Chat Completions API
- **Budget guardrails** - Pre-flight token counting to prevent runaway costs
- **Flexible emitters** - Console, batched, multi-destination, and custom emitters
- **Full TypeScript support** - Complete type definitions included

## Installation

```bash
npm install openai-meter openai
```

## Quick Start

```typescript
import OpenAI from "openai";
import { makeMeteredOpenAI, createConsoleEmitter } from "openai-meter";

const client = new OpenAI();

// Wrap with metering
const metered = makeMeteredOpenAI(client, {
  emitMetric: createConsoleEmitter({ pretty: true }),
});

// Use normally - metrics are collected automatically
const response = await metered.responses.create({
  model: "gpt-4.1",
  input: "Hello!",
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
import { withBudgetGuardrails } from "openai-meter";

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
import { makeMeteredOpenAI, createBatchEmitter } from "openai-meter";

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
| `createMultiEmitter()` | Send to multiple destinations |
| `createFilteredEmitter()` | Filter events before emitting |
| `createMemoryEmitter()` | Collect in memory (testing) |
| `createNoopEmitter()` | Disable metrics |

## API Reference

### `makeMeteredOpenAI(client, options)`

Wraps an OpenAI client with metering.

```typescript
interface MeterOptions {
  emitMetric: (event: MetricEvent) => void | Promise<void>;
  trackToolCalls?: boolean; // default: true
  generateTraceId?: () => string; // default: crypto.randomUUID
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
