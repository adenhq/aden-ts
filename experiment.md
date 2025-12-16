Here are the **common + uncommon, bill-impacting usage metrics** you can collect (via lightweight **JS SDK code injection**) when using the **OpenAI JavaScript SDK**—plus a wrapper pattern you can drop into your codebase.

## 1) Metrics you can pull straight from the response (the "billable units")

### Core token totals (always log these)

For the **Responses API**, usage shows up on the completed response (or the `response.completed` streaming event) as:

- `usage.input_tokens`
- `usage.output_tokens`
- `usage.total_tokens` ([OpenAI Platform][1])

### "Hidden" token drivers (uncommon but very bill-relevant)

- **Reasoning tokens**: `usage.output_tokens_details.reasoning_tokens` (Responses streaming) ([OpenAI Platform][1])
- **Cache-hit tokens** (biggest "why is this cheaper?" signal): `usage.prompt_tokens_details.cached_tokens` (documented as present on the usage object when Prompt Caching is in play) ([OpenAI Platform][2])
- **Prediction-token breakdown** (rare, but explains weird usage deltas):

  - `usage.completion_tokens_details.accepted_prediction_tokens`
  - `usage.completion_tokens_details.rejected_prediction_tokens` ([OpenAI Platform][2])

> Practical note: the docs show **two usage "shapes"** depending on endpoint/object view (`input/output` vs `prompt/completion`). Your extractor should handle both and normalize into your own schema. ([OpenAI Platform][1])

## 2) Request-side fields that directly change cost (log them with every call)

These fields don't look like "usage", but they _control_ it and explain spend:

- **`model`** (obvious, but required for any cost calc / aggregation) ([OpenAI Platform][3])
- **`service_tier`** (`auto | default | flex | priority`) — tier can change pricing/perf, and the _actual_ tier used comes back in the response ([OpenAI Platform][3])
- **`max_output_tokens`** — hard cap on output spend; explicitly includes **reasoning tokens** ([OpenAI Platform][3])
- **`max_tool_calls`** — caps how many built-in tool calls can run (tool-heavy agents can explode spend without this) ([OpenAI Platform][3])
- **Prompt caching controls** (strong ROI levers):

  - `prompt_cache_key` (improves cache hit rates across similar workloads) ([OpenAI Platform][3])
  - `prompt_cache_retention` (`in_memory` vs `24h`) ([OpenAI Platform][3])

## 3) Streaming-specific: where usage lives (don't miss it)

If you stream with the JS SDK:

```js
import { OpenAI } from "openai";
const client = new OpenAI();

const stream = await client.responses.create({ model: "gpt-5", input: [...], stream: true });
for await (const event of stream) console.log(event);
```

Usage is **null** at `response.created`, then shows up in the `response.completed` event. ([OpenAI Platform][4])

So your meter needs to:

- accumulate deltas during the stream (optional), and
- finalize billing metrics on `event.type === "response.completed"`.

## 4) Pre-flight "budget guardrails" (estimate before you spend)

Use the **Input Token Counts** endpoint to compute input tokens _before_ sending the real request:

```js
const resp = await client.responses.inputTokens.count({
  model: "gpt-4.1-mini",
  input: "The quick brown fox jumped over the lazy dog",
});
console.log(resp.input_tokens);
```

([OpenAI Platform][5])

This enables:

- "reject if > X tokens"
- dynamic truncation
- routing to cheaper models when prompts balloon

## 5) Transport + retry metrics that prevent accidental double-charging

Even if you track tokens perfectly, **retries/timeouts** can silently duplicate spend. Log:

- `x-request-id` (OpenAI request ID) + `openai-processing-ms` ([OpenAI Platform][6])
- rate-limit headers (`x-ratelimit-remaining-*`, resets, etc.) ([OpenAI Platform][6])
- your own `X-Client-Request-Id` (critical for correlating "did the server receive it?" on timeouts) ([OpenAI Platform][6])

## 6) A minimal "code-injection" wrapper for the OpenAI JS SDK

You can inject metering without forking the SDK by wrapping the call:

```js
import { randomUUID } from "crypto";

/** Normalize both usage shapes (Responses vs Chat-style usage). */
function normalizeUsage(usage) {
  if (!usage) return null;

  // Responses shape
  if ("input_tokens" in usage || "output_tokens" in usage) {
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const reasoning = usage.output_tokens_details?.reasoning_tokens ?? 0;
    return {
      input_tokens: input,
      output_tokens: output,
      total_tokens: usage.total_tokens ?? input + output,
      reasoning_tokens: reasoning,
      cached_tokens: usage.input_tokens_details?.cached_tokens ?? 0, // if present in your org/models
    };
  }

  // Prompt/Completion shape (documented for prompt caching metrics)
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  return {
    input_tokens: prompt,
    output_tokens: completion,
    total_tokens: usage.total_tokens ?? prompt + completion,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    accepted_prediction_tokens:
      usage.completion_tokens_details?.accepted_prediction_tokens ?? 0,
    rejected_prediction_tokens:
      usage.completion_tokens_details?.rejected_prediction_tokens ?? 0,
  };
}

export function makeMeteredOpenAI(client, emitMetric) {
  const originalCreate = client.responses.create.bind(client.responses);

  client.responses.create = async (params, options) => {
    const traceId = randomUUID();
    const t0 = Date.now();

    // Log cost-relevant request knobs too (model, tier, caps, caching)
    const reqMeta = {
      traceId,
      model: params.model,
      service_tier: params.service_tier,
      max_output_tokens: params.max_output_tokens,
      max_tool_calls: params.max_tool_calls,
      prompt_cache_key: params.prompt_cache_key,
      prompt_cache_retention: params.prompt_cache_retention,
      stream: !!params.stream,
    };

    const res = await originalCreate(params, options);

    // SDKs expose x-request-id on top-level response objects per docs; log it when available.
    // (Exact property name can differ by SDK version—capture defensively.)
    const requestId = res?.request_id ?? res?.requestId ?? null;

    emitMetric({
      ...reqMeta,
      requestId,
      latency_ms: Date.now() - t0,
      usage: normalizeUsage(res.usage),
    });

    return res;
  };

  return client;
}
```

This gets you to a solid "billing observability v1" quickly:

- per-call tokens (+ reasoning/cache/prediction details when available)
- request knobs that explain variance (tier, caps, caching settings)
- correlation IDs to dedupe retries

If you want, next we can extend this wrapper to also meter:

- **tool call counts by type** (web/file/code interpreter) from streaming events,
- **per-tenant/per-agent attribution** using `metadata` (16 kv pairs) ([OpenAI Platform][3]),
- and a "budget enforcer" that uses `inputTokens.count()` to block oversize calls before they hit the model. ([OpenAI Platform][5])

[1]: https://platform.openai.com/docs/api-reference/responses-streaming "Streaming events | OpenAI API Reference"
[2]: https://platform.openai.com/docs/guides/prompt-caching "Prompt caching | OpenAI API"
[3]: https://platform.openai.com/docs/api-reference/responses/object "Responses | OpenAI API Reference"
[4]: https://platform.openai.com/docs/guides/streaming-responses "Streaming API responses | OpenAI API"
[5]: https://platform.openai.com/docs/api-reference/responses/get-input-token-counts "Responses | OpenAI API Reference"
[6]: https://platform.openai.com/docs/api-reference/introduction "API Reference - OpenAI API"
