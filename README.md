# Aden

**LLM Observability & Cost Control SDK**

Aden automatically tracks every LLM API call in your application—usage, latency, costs—and gives you real-time controls to prevent budget overruns. Works with OpenAI, Anthropic, and Google Gemini.

```typescript
import { instrument } from "aden";
import OpenAI from "openai";

// One line to start tracking everything
await instrument({ sdks: { OpenAI } });

// Use your SDK normally - metrics collected automatically
const openai = new OpenAI();
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

---

## Table of Contents

- [Why Aden?](#why-aden)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Sending Metrics to Your Backend](#sending-metrics-to-your-backend)
- [Cost Control](#cost-control)
  - [Setting Up the Control Server](#setting-up-the-control-server)
  - [Control Actions](#control-actions)
- [Multi-Provider Support](#multi-provider-support)
- [What Metrics Are Collected?](#what-metrics-are-collected)
- [Metric Emitters](#metric-emitters)
- [Call Relationship Tracking](#call-relationship-tracking)
- [Framework Integrations](#framework-integrations)
- [Advanced Configuration](#advanced-configuration)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

---

## Why Aden?

Building with LLMs is expensive and unpredictable:

- **No visibility**: You don't know which features or users consume the most tokens
- **Runaway costs**: One bug or bad prompt can blow through your budget in minutes
- **No control**: Once a request is sent, you can't stop it

Aden solves these problems:

| Problem | Aden Solution |
|---------|---------------|
| No visibility into LLM usage | Automatic metric collection for every API call |
| Unpredictable costs | Real-time budget tracking and enforcement |
| No per-user limits | Context-based controls (per user, per feature, per tenant) |
| Expensive models used unnecessarily | Automatic model degradation when approaching limits |
| Alert fatigue | Smart alerts based on spend thresholds |

---

## Installation

```bash
npm install aden
```

You'll also need at least one LLM SDK:

```bash
# Install the SDKs you use
npm install openai                  # For OpenAI/GPT models
npm install @anthropic-ai/sdk       # For Anthropic/Claude models
npm install @google/generative-ai   # For Google Gemini models
```

---

## Quick Start

### Step 1: Add Instrumentation

Add this **once** at your application startup (before creating any LLM clients):

```typescript
// app.ts or index.ts
import { instrument, createConsoleEmitter } from "aden";
import OpenAI from "openai";

await instrument({
  emitMetric: createConsoleEmitter({ pretty: true }),
  sdks: { OpenAI },
});
```

### Step 2: Use Your SDK Normally

That's it! Every API call is now tracked:

```typescript
const openai = new OpenAI();

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Explain quantum computing" }],
});

// Console output:
// [aden] openai/gpt-4o | 247 tokens | 1,234ms | $0.00742
```

### Step 3: Clean Up on Shutdown

```typescript
import { uninstrument } from "aden";

// In your shutdown handler
await uninstrument();
```

---

## Sending Metrics to Your Backend

For production, send metrics to your backend instead of the console:

### Option A: HTTP Endpoint

```typescript
import { instrument, createHttpTransport } from "aden";
import OpenAI from "openai";

const transport = createHttpTransport({
  apiUrl: "https://api.yourcompany.com/v1/metrics",
  apiKey: process.env.METRICS_API_KEY,
});

await instrument({
  emitMetric: transport.emit,
  sdks: { OpenAI },
});

// On shutdown
await transport.stop();
```

### Option B: Aden Control Server

For real-time cost control (budgets, throttling, model degradation), connect to an Aden control server:

```typescript
import { instrument } from "aden";
import OpenAI from "openai";

await instrument({
  apiKey: process.env.ADEN_API_KEY,        // Your Aden API key
  serverUrl: process.env.ADEN_API_URL,     // Control server URL
  sdks: { OpenAI },
});
```

This enables all the [Cost Control](#cost-control) features described below.

### Option C: Custom Handler

```typescript
await instrument({
  emitMetric: async (event) => {
    // event contains: model, tokens, latency, cost, etc.
    await myDatabase.insert("llm_metrics", event);
  },
  sdks: { OpenAI },
});
```

---

## Cost Control

Aden's cost control system lets you set budgets, throttle requests, and automatically downgrade to cheaper models—all in real-time.

### Setting Up the Control Server

1. **Get an API key** from your Aden control server (or deploy your own)

2. **Set environment variables**:
   ```bash
   ADEN_API_KEY=your-api-key
   ADEN_API_URL=https://your-control-server.com  # Optional, has default
   ```

3. **Instrument with cost control**:
   ```typescript
   import { instrument } from "aden";
   import OpenAI from "openai";

   await instrument({
     apiKey: process.env.ADEN_API_KEY,
     sdks: { OpenAI },

     // Track usage per user (required for per-user budgets)
     getContextId: () => getCurrentUserId(),

     // Get notified when alerts trigger
     onAlert: (alert) => {
       console.warn(`[${alert.level}] ${alert.message}`);
       // Send to Slack, PagerDuty, etc.
     },
   });
   ```

### Control Actions

The control server can apply these actions to requests:

| Action | What It Does | Use Case |
|--------|--------------|----------|
| **allow** | Request proceeds normally | Default when within limits |
| **block** | Request is rejected with an error | Budget exhausted |
| **throttle** | Request is delayed before proceeding | Rate limiting |
| **degrade** | Request uses a cheaper model | Approaching budget limit |
| **alert** | Request proceeds, notification sent | Warning threshold reached |

### Example: Budget with Degradation

Configure on your control server:

```bash
# Set a $10 budget for user_123
curl -X POST https://control-server/v1/control/policy/budgets \
  -H "Authorization: Bearer $ADEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "context_id": "user_123",
    "limit_usd": 10.00,
    "action_on_exceed": "block"
  }'

# Degrade gpt-4o to gpt-4o-mini when at 50% budget
curl -X POST https://control-server/v1/control/policy/degradations \
  -H "Authorization: Bearer $ADEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from_model": "gpt-4o",
    "to_model": "gpt-4o-mini",
    "trigger": "budget_threshold",
    "threshold_percent": 50,
    "context_id": "user_123"
  }'

# Alert when budget exceeds 80%
curl -X POST https://control-server/v1/control/policy/alerts \
  -H "Authorization: Bearer $ADEN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "context_id": "user_123",
    "trigger": "budget_threshold",
    "threshold_percent": 80,
    "level": "warning",
    "message": "User approaching budget limit"
  }'
```

**What happens in your app**:

```typescript
// User has spent $0 (0% of $10 budget)
await openai.chat.completions.create({ model: "gpt-4o", ... });
// → Uses gpt-4o ✓

// User has spent $5 (50% of budget)
await openai.chat.completions.create({ model: "gpt-4o", ... });
// → Automatically uses gpt-4o-mini instead (degraded)

// User has spent $8 (80% of budget)
await openai.chat.completions.create({ model: "gpt-4o", ... });
// → Uses gpt-4o-mini, triggers alert callback

// User has spent $10+ (100% of budget)
await openai.chat.completions.create({ model: "gpt-4o", ... });
// → Throws RequestCancelledError: "Budget exceeded"
```

---

## Multi-Provider Support

Aden works with all major LLM providers:

```typescript
import { instrument } from "aden";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Instrument all providers at once
await instrument({
  apiKey: process.env.ADEN_API_KEY,
  sdks: {
    OpenAI,
    Anthropic,
    GoogleGenerativeAI,
  },
});

// All SDKs are now tracked
const openai = new OpenAI();
const anthropic = new Anthropic();
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
```

### OpenAI

```typescript
const openai = new OpenAI();

// Chat completions
await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

// Streaming
const stream = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || "");
}
// Metrics emitted when stream completes
```

### Anthropic

```typescript
const anthropic = new Anthropic();

await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
```

### Google Gemini

```typescript
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = gemini.getGenerativeModel({ model: "gemini-pro" });

await model.generateContent("Explain quantum computing");
```

---

## What Metrics Are Collected?

Every LLM API call generates a `MetricEvent`:

```typescript
interface MetricEvent {
  // Identity
  trace_id: string;           // Unique ID for this request
  span_id: string;            // Span ID (OTel compatible)
  request_id: string | null;  // Provider's request ID

  // Request details
  provider: "openai" | "anthropic" | "gemini";
  model: string;              // e.g., "gpt-4o", "claude-3-5-sonnet"
  stream: boolean;
  timestamp: string;          // ISO timestamp

  // Performance
  latency_ms: number;
  status_code?: number;
  error?: string;

  // Token usage
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens: number;      // Prompt cache hits
  reasoning_tokens: number;   // For o1/o3 models

  // Rate limits (when available)
  rate_limit_remaining_requests?: number;
  rate_limit_remaining_tokens?: number;

  // Tool usage
  tool_call_count?: number;
  tool_names?: string;        // Comma-separated

  // Call relationship (when enabled)
  parent_span_id?: string;
  call_sequence?: number;
  agent_stack?: string[];
  call_site_file?: string;
  call_site_line?: number;

  // Custom metadata
  metadata?: Record<string, string>;
}
```

---

## Metric Emitters

Emitters determine where metrics go. You can use built-in emitters or create custom ones.

### Built-in Emitters

```typescript
import {
  createConsoleEmitter,      // Log to console (development)
  createHttpTransport,       // Send to HTTP endpoint
  createBatchEmitter,        // Batch before sending
  createMultiEmitter,        // Send to multiple destinations
  createFilteredEmitter,     // Filter events
  createTransformEmitter,    // Transform events
  createJsonFileEmitter,     // Write to JSON file
  createMemoryEmitter,       // Store in memory (testing)
  createNoopEmitter,         // Discard all events
} from "aden";
```

### Console Emitter (Development)

```typescript
await instrument({
  emitMetric: createConsoleEmitter({ pretty: true }),
  sdks: { OpenAI },
});

// Output:
// [aden] openai/gpt-4o | 247 tokens | 1,234ms
```

### HTTP Transport (Production)

```typescript
const transport = createHttpTransport({
  apiUrl: "https://api.yourcompany.com/v1/metrics",
  apiKey: process.env.METRICS_API_KEY,

  // Batching (optional)
  batchSize: 50,              // Events per batch
  flushInterval: 5000,        // ms between flushes

  // Reliability (optional)
  maxRetries: 3,
  timeout: 10000,
  maxQueueSize: 10000,

  // Error handling (optional)
  onSendError: (error, batch) => {
    console.error(`Failed to send ${batch.length} metrics:`, error);
  },
});

await instrument({
  emitMetric: transport.emit,
  sdks: { OpenAI },
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await transport.stop();  // Flushes remaining events
  process.exit(0);
});
```

### Multiple Destinations

```typescript
await instrument({
  emitMetric: createMultiEmitter([
    createConsoleEmitter({ pretty: true }),  // Log locally
    transport.emit,                           // Send to backend
  ]),
  sdks: { OpenAI },
});
```

### Filtering Events

```typescript
await instrument({
  emitMetric: createFilteredEmitter(
    transport.emit,
    (event) => event.total_tokens > 100  // Only large requests
  ),
  sdks: { OpenAI },
});
```

### Custom Emitter

```typescript
await instrument({
  emitMetric: async (event) => {
    // Calculate cost
    const cost = calculateCost(event.model, event.input_tokens, event.output_tokens);

    // Store in your database
    await db.llmMetrics.create({
      ...event,
      cost_usd: cost,
      user_id: getCurrentUserId(),
    });

    // Check for anomalies
    if (event.latency_ms > 30000) {
      alertOps(`Slow LLM call: ${event.latency_ms}ms`);
    }
  },
  sdks: { OpenAI },
});
```

---

## Call Relationship Tracking

Track relationships between LLM calls—useful for multi-agent systems, conversation threads, and debugging.

### Automatic Session Tracking

Related calls are automatically grouped:

```typescript
// These calls share a session automatically
await openai.chat.completions.create({ model: "gpt-4o", ... });
// → trace_id: "abc", call_sequence: 1

await openai.chat.completions.create({ model: "gpt-4o", ... });
// → trace_id: "abc", call_sequence: 2, parent_span_id: <first call>
```

### Named Agent Tracking

For multi-agent systems, track which agent made each call:

```typescript
import { withAgent } from "aden";

await withAgent("ResearchAgent", async () => {
  await openai.chat.completions.create({ ... });
  // → agent_stack: ["ResearchAgent"]

  await withAgent("WebSearchAgent", async () => {
    await openai.chat.completions.create({ ... });
    // → agent_stack: ["ResearchAgent", "WebSearchAgent"]
  });
});
```

### Request Context

Isolate sessions per HTTP request:

```typescript
import { enterMeterContext } from "aden";

app.post("/chat", async (req, res) => {
  // Create isolated session for this request
  enterMeterContext({
    sessionId: req.headers["x-request-id"],
    metadata: { userId: req.userId },
  });

  // All LLM calls here share this session
  const response = await openai.chat.completions.create({ ... });
  // → metadata includes userId
});
```

### Disabling Relationship Tracking

For high-throughput scenarios:

```typescript
await instrument({
  emitMetric: myEmitter,
  sdks: { OpenAI },
  trackCallRelationships: false,  // Slight performance boost
});
```

---

## Framework Integrations

### Vercel AI SDK

```typescript
import { instrument, instrumentFetch } from "aden";

// Instrument fetch for Vercel AI SDK
instrumentFetch({
  emitMetric: myEmitter,
  urlPatterns: [/api\.openai\.com/, /api\.anthropic\.com/],
});

// Now Vercel AI SDK calls are tracked
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

await generateText({
  model: openai("gpt-4o"),
  prompt: "Hello!",
});
```

### LangChain

```typescript
import { instrument } from "aden";
import OpenAI from "openai";

// Instrument the underlying SDK
await instrument({
  emitMetric: myEmitter,
  sdks: { OpenAI },
});

// LangChain uses OpenAI under the hood
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o" });
await model.invoke("Hello!");
// → Metrics captured automatically
```

### Express.js Middleware

```typescript
import express from "express";
import { enterMeterContext } from "aden";

const app = express();

// Add context to each request
app.use((req, res, next) => {
  enterMeterContext({
    sessionId: req.headers["x-request-id"] as string,
    metadata: {
      userId: req.userId,
      endpoint: req.path,
    },
  });
  next();
});

app.post("/chat", async (req, res) => {
  // LLM calls here include request metadata
  const response = await openai.chat.completions.create({ ... });
  res.json(response);
});
```

---

## Advanced Configuration

### Full Options Reference

```typescript
await instrument({
  // === Metrics Destination ===
  emitMetric: myEmitter,          // Required unless apiKey is set

  // === Control Server (enables cost control) ===
  apiKey: "aden_xxx",             // Your Aden API key
  serverUrl: "https://...",       // Control server URL (optional)
  failOpen: true,                 // Allow requests if server is down (default: true)

  // === Context Tracking ===
  getContextId: () => getUserId(), // For per-user budgets
  trackCallRelationships: true,    // Track call hierarchies (default: true)

  // === Alerts ===
  onAlert: (alert) => {            // Callback when alert triggers
    console.warn(`[${alert.level}] ${alert.message}`);
  },

  // === SDK Classes ===
  sdks: {                          // SDK classes to instrument
    OpenAI,
    Anthropic,
    GoogleGenerativeAI,
  },

  // === Advanced ===
  generateSpanId: () => uuid(),    // Custom span ID generator
  beforeRequest: async (params, context) => {
    // Custom pre-request logic
    return { action: "proceed" };
  },
  requestMetadata: {               // Passed to beforeRequest hook
    environment: "production",
  },
});
```

### beforeRequest Hook

Implement custom rate limiting or request modification:

```typescript
await instrument({
  emitMetric: myEmitter,
  sdks: { OpenAI },

  beforeRequest: async (params, context) => {
    // Check your own rate limits
    const allowed = await checkRateLimit(context.metadata?.userId);

    if (!allowed) {
      return { action: "cancel", reason: "Rate limit exceeded" };
    }

    // Optionally delay the request
    if (shouldThrottle()) {
      return { action: "throttle", delayMs: 1000 };
    }

    // Optionally switch to a cheaper model
    if (shouldDegrade()) {
      return {
        action: "degrade",
        toModel: "gpt-4o-mini",
        reason: "High load"
      };
    }

    return { action: "proceed" };
  },

  requestMetadata: {
    userId: getCurrentUserId(),
  },
});
```

### Manual Control Agent

For advanced scenarios, create the control agent manually:

```typescript
import { createControlAgent, instrument } from "aden";

const agent = createControlAgent({
  serverUrl: "https://control-server.com",
  apiKey: process.env.ADEN_API_KEY,

  // Polling options (for HTTP fallback)
  pollingIntervalMs: 30000,
  heartbeatIntervalMs: 10000,
  timeoutMs: 5000,

  // Behavior
  failOpen: true,               // Allow if server unreachable
  getContextId: () => getUserId(),

  // Alerts
  onAlert: (alert) => {
    sendToSlack(alert);
  },
});

await agent.connect();

await instrument({
  controlAgent: agent,
  sdks: { OpenAI },
});
```

### Per-Instance Wrapping

If you need different options for different clients:

```typescript
import { makeMeteredOpenAI } from "aden";

const internalClient = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: internalMetricsEmitter,
});

const customerClient = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: customerMetricsEmitter,
  beforeRequest: enforceCustomerLimits,
});
```

---

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `instrument(options)` | Instrument all LLM SDKs globally |
| `uninstrument()` | Remove instrumentation |
| `isInstrumented()` | Check if instrumented |
| `getInstrumentedSDKs()` | Get which SDKs are instrumented |

### Emitter Factories

| Function | Description |
|----------|-------------|
| `createConsoleEmitter(options?)` | Log to console |
| `createHttpTransport(options)` | Send to HTTP endpoint |
| `createBatchEmitter(handler, options?)` | Batch events |
| `createMultiEmitter(emitters)` | Multiple destinations |
| `createFilteredEmitter(emitter, filter)` | Filter events |
| `createJsonFileEmitter(options)` | Write to JSON file |
| `createMemoryEmitter()` | Store in memory |
| `createNoopEmitter()` | Discard events |

### Context Functions

| Function | Description |
|----------|-------------|
| `enterMeterContext(options?)` | Enter a tracking context |
| `withMeterContextAsync(fn, options?)` | Run in isolated context |
| `withAgent(name, fn)` | Run with named agent |
| `pushAgent(name)` / `popAgent()` | Manual agent stack |
| `getCurrentContext()` | Get current context |
| `setContextMetadata(key, value)` | Set context metadata |

### Control Agent

| Function | Description |
|----------|-------------|
| `createControlAgent(options)` | Create manual control agent |
| `createControlAgentEmitter(agent)` | Create emitter from agent |

### Types

```typescript
// Main types
import type {
  MetricEvent,
  MeterOptions,
  ControlPolicy,
  ControlDecision,
  AlertEvent,
  BeforeRequestResult,
} from "aden";
```

---

## Examples

Run examples with `npx tsx examples/<name>.ts`:

| Example | Description |
|---------|-------------|
| `openai-basic.ts` | Basic OpenAI instrumentation |
| `anthropic-basic.ts` | Basic Anthropic instrumentation |
| `gemini-basic.ts` | Basic Gemini instrumentation |
| `control-actions.ts` | All control actions: block, throttle, degrade, alert |
| `cost-control-local.ts` | Cost control without a server (offline mode) |
| `vercel-ai-sdk.ts` | Vercel AI SDK integration |
| `langchain-example.ts` | LangChain integration |
| `multi-agent-example.ts` | Multi-agent tracking |

---

## Troubleshooting

### Metrics not appearing

1. **Check instrumentation order**: Call `instrument()` before creating SDK clients
   ```typescript
   // Correct
   await instrument({ ... });
   const openai = new OpenAI();

   // Wrong - client created before instrumentation
   const openai = new OpenAI();
   await instrument({ ... });
   ```

2. **Verify SDK is passed**: Make sure you're passing the SDK class
   ```typescript
   import OpenAI from "openai";

   await instrument({
     sdks: { OpenAI },  // Pass the class, not an instance
   });
   ```

3. **Check emitter is async-safe**: If using a custom emitter, ensure it handles promises correctly

### Control server not connecting

1. **Check environment variables**:
   ```bash
   echo $ADEN_API_KEY
   echo $ADEN_API_URL
   ```

2. **Verify server is reachable**:
   ```bash
   curl $ADEN_API_URL/v1/control/health
   ```

3. **Enable debug logging**:
   ```typescript
   // Aden logs to console with [aden] prefix
   // Check for connection errors
   ```

### Budget not enforcing

1. **Ensure getContextId is set**: Budgets are per-context
   ```typescript
   await instrument({
     apiKey: process.env.ADEN_API_KEY,
     getContextId: () => getCurrentUserId(),  // Required!
   });
   ```

2. **Check policy on server**:
   ```bash
   curl -H "Authorization: Bearer $ADEN_API_KEY" \
     $ADEN_API_URL/v1/control/policy
   ```

### High memory usage

1. **Enable batching**: Don't send events one-by-one
   ```typescript
   const transport = createHttpTransport({
     batchSize: 100,
     flushInterval: 10000,
   });
   ```

2. **Disable relationship tracking** if not needed:
   ```typescript
   await instrument({
     trackCallRelationships: false,
   });
   ```

---

## License

MIT

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
