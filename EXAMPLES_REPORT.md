# OpenAI-Meter Examples Report

Generated: 2025-12-16T02:07:04.490Z

## Summary

| Metric | Value |
|--------|-------|
| Total Examples | 8 |
| Successful | 8 |
| Failed | 0 |
| Total Duration | 91.2s |

## Results

### ✅ basic

- **Duration**: 8.3s
- **Status**: Success
- **Metrics**:
  - Tokens: 14 in / 14 out
  - Cost: $0.000560
  - Latency: 1101ms

### ✅ conversation-tracking

- **Duration**: 16.7s
- **Status**: Success
- **Metrics**:
  - Tokens: 16 in / 192 out

### ✅ cost-tracking

- **Duration**: 12.2s
- **Status**: Success
- **Metrics**:
  - Tokens: 11 in / 128 out
  - Cost: $0.001047

### ✅ error-handling

- **Duration**: 4.8s
- **Status**: Success
- **Metrics**:
  - Tokens: 7 in / 0 out
  - Latency: 1009ms

### ✅ express-middleware

- **Duration**: 10.0s
- **Status**: Success
- **Metrics**:
  - Latency: 3800ms

### ✅ multi-tenant

- **Duration**: 15.6s
- **Status**: Success
- **Metrics**:
  - Tokens: 10 in / 192 out
  - Cost: $0.0001

### ✅ reasoning-models

- **Duration**: 17.8s
- **Status**: Success
- **Metrics**:
  - Latency: 1265ms

### ✅ with-backend

- **Duration**: 5.8s
- **Status**: Success
- **Metrics**:
  - Tokens: 11 in / 64 out
  - Latency: 2082ms

## Detailed Output

<details>
<summary>Click to expand full output</summary>

### basic

```

=== Basic Non-Streaming Example ===

✓ [97efb54c] gpt-5-mini-2025-08-07 1101ms
  tokens: 14 in / 14 out

Response: [
  {
    id: 'rs_0aa23219958bd845006940be6e054c819b9ba11244e50a5ed3',
    type: 'reasoning',
    summary: []
  },
  {
    id: 'msg_0aa23219958bd845006940be6e5f14819b8a1c40857e4b1498',
    type: 'message',
    status: 'completed',
    content: [ [Object] ],
    role: 'assistant'
  }
]

=== Streaming Example ===

Response: 1, 2, 3, 4, 5✓ [dcdc4c35] gpt-5-mini-2025-08-07 (stream) 2257ms
  tokens: 14 in / 83 out
  reasoning: 64



=== Custom Metric Handler Example ===

Estimated cost: $0.000560
Collected metrics: 1

=== Budget Guardrails Example ===

✓ [c4e907e5] gpt-5-mini-2025-08-07 1750ms
  tokens: 13 in / 121 out
  reasoning: 64

=== Request Metadata Example ===

Request trace: {
  traceId: 'e210ca2a-f20a-4f2b-b0cc-abb5cbed478e',
  model: 'gpt-5-mini-2025-08-07',
  serviceTier: 'auto',
  latency: '1509ms',
  cached: 0
}

```

### conversation-tracking

```
=== Conversation Tracking Example ===

[Conv: conv-001] Started new conversation

User: Hi! I want to learn about TypeScript.

[Conv: conv-001] Turn 1
  Tokens: 16 in / 192 out
  Cached: 0 (0.0% cache hit)
  Context: 16 / 128,000 (0.0%)
  Cumulative: 208 tokens over 1 turns
Assistant: (no text output)...

User: What are the main benefits over JavaScript?

[Conv: conv-001] Turn 2
  Tokens: 29 in / 192 out
  Cached: 0 (0.0% cache hit)
  Context: 29 / 128,000 (0.0%)
  Cumulative: 429 tokens over 2 turns
Assistant: (no text output)...

User: Can you show me a simple example of type annotations?

[Conv: conv-001] Turn 3
  Tokens: 44 in / 192 out
  Cached: 0 (0.0% cache hit)
  Context: 44 / 128,000 (0.0%)
  Cumulative: 665 tokens over 3 turns
Assistant: (no text output)...

User: How do interfaces differ from types?

[Conv: conv-001] Turn 4
  Tokens: 55 in / 192 out
  Cached: 0 (0.0% cache hit)
  Context: 55 / 128,000 (0.0%)
  Cumulative: 912 tokens over 4 turns
Assistant: (no text output)...

User: Thanks! One more question - what are generics?

[Conv: conv-001] Turn 5
  Tokens: 70 in / 192 out
  Cached: 0 (0.0% cache hit)
  Context: 70 / 128,000 (0.1%)
  Cumulative: 1174 tokens over 5 turns
Assistant: (no text output)...

[Conv: conv-001] Ended
  Duration: 16.3s
  Total turns: 5
  Total tokens: 1174
  Avg tokens/turn: 235
  Cache savings: 0 tokens

```

### cost-tracking

```
=== Cost Tracking Example ===

[gpt-5-mini-2025-08-07] 11 in / 128 out
  Cost: $0.001046 | Total: $0.001046

[gpt-5-mini-2025-08-07] 11 in / 128 out
  Cost: $0.001046 | Total: $0.002092

[gpt-5-mini-2025-08-07] 11 in / 128 out
  Cost: $0.001046 | Total: $0.003138

[gpt-5-mini-2025-08-07] 13 in / 128 out
  Cost: $0.001050 | Total: $0.004188

[gpt-5-mini-2025-08-07] 12 in / 128 out
  Cost: $0.001048 | Total: $0.005236


=== Session Summary ===
Total requests: 5
Total cost: $0.005236
Average cost/request: $0.001047
Cost by model: { 'gpt-5': 0.005235999999999999 }

```

### error-handling

```
=== Error Handling Example ===

--- Test 1: Normal request ---
✓ Request succeeded
   Model: gpt-5-mini-2025-08-07
   Tokens: 7 in / 0 out
   Latency: 1009ms

--- Test 2: Budget exceeded ---
✓ Request succeeded
   Model: gpt-5-mini-2025-08-07
   Tokens: 33 in / 64 out
   Latency: 1566ms

--- Test 3: Another successful request ---
✓ Request succeeded
   Model: gpt-5-mini-2025-08-07
   Tokens: 8 in / 0 out
   Latency: 1211ms

=== Request Monitor Report ===
Total requests: 3
Unique requests: 3
Failed requests: 0
Success rate: 100.0%
Retried requests: 0
Total retries: 0

```

### express-middleware

```
=== Express Middleware Example ===

[req-1765850775718-dtbaze] Request started
[req-1765850775718-dtbaze] OpenAI call: 203 tokens

Response body: {
  "reply": "",
  "requestId": "req-1765850775718-dtbaze"
}

Response headers: {}
[req-1765850775718-dtbaze] Request completed in 3800ms
[req-1765850775718-dtbaze] Total tokens: 203

==================================================

[req-1765850779518-8bcbyz] Request started
[req-1765850779518-8bcbyz] OpenAI call: 206 tokens

Response body: {
  "reply": "",
  "requestId": "req-1765850779518-8bcbyz"
}

Response headers: {}
[req-1765850779518-8bcbyz] Request completed in 3193ms
[req-1765850779518-8bcbyz] Total tokens: 206

==================================================

[req-1765850782711-m9kims] Request started
[req-1765850782711-m9kims] OpenAI call: 200 tokens

Response body: {
  "reply": "",
  "requestId": "req-1765850782711-m9kims"
}

Response headers: {}
[req-1765850782711-m9kims] Request completed in 2539ms
[req-1765850782711-m9kims] Total tokens: 200

```

### multi-tenant

```
=== Multi-Tenant Usage Example ===

[Tenant: acme-corp] [User: alice@acme.com] [Tier: pro]
  Tokens: 10 in / 192 out
  Total usage: 202 / 100000 tokens

[Tenant: startup-xyz] [User: bob@startup.xyz] [Tier: free]
  Tokens: 11 in / 64 out
  Total usage: 75 / 10000 tokens

[Tenant: bigcorp-inc] [User: carol@bigcorp.com] [Tier: enterprise]
  Tokens: 11 in / 256 out
  Total usage: 267 / 1000000 tokens

[Tenant: acme-corp] [User: dave@acme.com] [Tier: pro]
  Tokens: 12 in / 128 out
  Total usage: 342 / 100000 tokens

=== Tenant Usage Report ===

Tenant: acme-corp
  Requests: 2
  Input tokens: 22
  Output tokens: 320
  Total tokens: 342
  Est. cost: $0.0005
  Last request: 2025-12-16T02:06:40.880Z

Tenant: bigcorp-inc
  Requests: 1
  Input tokens: 11
  Output tokens: 256
  Total tokens: 267
  Est. cost: $0.0004
  Last request: 2025-12-16T02:06:38.225Z

Tenant: startup-xyz
  Requests: 1
  Input tokens: 11
  Output tokens: 64
  Total tokens: 75
  Est. cost: $0.0001
  Last request: 2025-12-16T02:06:33.959Z


```

### reasoning-models

```
=== Reasoning Models Example ===

Note: This example uses gpt-5-mini-2025-08-07 to simulate.
Replace with o3 or o3-mini to see actual reasoning tokens.

--- Test 1: Simple factual question ---
[gpt-5-mini-2025-08-07] Reasoning Analysis
  Input: 14 tokens
  Output: 14 tokens total
    - Reasoning (hidden): 0 tokens
    - Visible output: 14 tokens
  Reasoning ratio: 0.0% of output is thinking
  Thinking multiplier: 0.0x more thinking than output
  Latency: 1265ms

--- Test 2: Complex reasoning question ---
[gpt-5-mini-2025-08-07] Reasoning Analysis
  Input: 45 tokens
  Output: 276 tokens total
    - Reasoning (hidden): 128 tokens
    - Visible output: 148 tokens
  Reasoning ratio: 46.4% of output is thinking
  Thinking multiplier: 0.9x more thinking than output
  Latency: 4311ms

--- Test 3: Code generation with reasoning ---
[gpt-5-mini-2025-08-07] Reasoning Analysis
  Input: 36 tokens
  Output: 756 tokens total
    - Reasoning (hidden): 576 tokens
    - Visible output: 180 tokens
  Reasoning ratio: 76.2% of output is thinking
  Thinking multiplier: 3.2x more thinking than output
  Latency: 11723ms

=== Reasoning Models Report ===
Total requests: 3
Total input tokens: 95
Total output tokens: 1,046
  - Reasoning: 704 (67.3%)
  - Visible: 342
Average latency: 5766ms

Cost impact: Output costs 3.1x more than visible text

💡 Tip: With actual o-series models, you'll see reasoning tokens
   in output_tokens_details.reasoning_tokens

```

### with-backend

```
Making multiple requests...

✓ [29fe2d97] gpt-5-mini-2025-08-07 2082ms
  tokens: 11 in / 64 out
  reasoning: 64
✓ [b58aea6e] gpt-5-mini-2025-08-07 1535ms
  tokens: 10 in / 64 out
  reasoning: 64
[Backend] Received 2 events
[Backend] Record: {"timestamp":"2025-12-16T02:07:04.115Z","trace_id":"29fe2d97-e011-4952-a6ec-8f4e64d43a92","request_id":null,"model":"gpt-5-mini-2025-08-07","input_tokens":11,"output_tokens":64,"cached_tokens":0,"reasoning_tokens":64,"latency_ms":2082,"error":null}
[Backend] Record: {"timestamp":"2025-12-16T02:07:04.115Z","trace_id":"b58aea6e-64d5-4f6d-8eb2-6a21dca86e09","request_id":null,"model":"gpt-5-mini-2025-08-07","input_tokens":10,"output_tokens":64,"cached_tokens":0,"reasoning_tokens":64,"latency_ms":1535,"error":null}
✓ [b35080ae] gpt-5-mini-2025-08-07 1737ms
  tokens: 11 in / 64 out
  reasoning: 64

Flushing remaining metrics...
[Backend] Received 1 events
[Backend] Record: {"timestamp":"2025-12-16T02:07:04.469Z","trace_id":"b35080ae-31c5-4efe-9b4c-a6d0cf9e342c","request_id":null,"model":"gpt-5-mini-2025-08-07","input_tokens":11,"output_tokens":64,"cached_tokens":0,"reasoning_tokens":64,"latency_ms":1737,"error":null}

```

</details>
