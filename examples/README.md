# Aden Examples

Test matrix covering vendor SDKs and popular AI agent frameworks.

## Test Matrix

| Example | OpenAI | Anthropic | Gemini | Streaming | Tools | Multi-step |
|---------|:------:|:---------:|:------:|:---------:|:-----:|:----------:|
| **Vendor SDKs** |
| [openai-basic.ts](./openai-basic.ts) | ✅ | - | - | ✅ | ✅ | - |
| [anthropic-basic.ts](./anthropic-basic.ts) | - | ✅ | - | ✅ | ✅ | - |
| [gemini-basic.ts](./gemini-basic.ts) | - | - | ✅ | ✅ | - | - |
| **Agent Frameworks** |
| [vercel-ai-sdk.ts](./vercel-ai-sdk.ts) | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| [langchain-example.ts](./langchain-example.ts) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [llamaindex-example.ts](./llamaindex-example.ts) | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| [mastra-example.ts](./mastra-example.ts) | ✅ | ✅ | - | ✅ | ✅ | ✅ |
| [multi-agent-example.ts](./multi-agent-example.ts) | ✅ | ✅ | ✅ | - | - | ✅ |

## Quick Start

```bash
# Set API keys
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_API_KEY=...

# Run a specific example
npx tsx examples/openai-basic.ts
npx tsx examples/langchain-example.ts
npx tsx examples/multi-agent-example.ts
```

## Vendor SDK Examples

### OpenAI (`openai-basic.ts`)
- Chat Completions API (streaming & non-streaming)
- Responses API (streaming & non-streaming)
- Tool/function calls

### Anthropic (`anthropic-basic.ts`)
- Messages API (streaming & non-streaming)
- Tool use
- Prompt caching

### Gemini (`gemini-basic.ts`)
- generateContent (streaming & non-streaming)
- Chat sessions
- System instructions
- Different model tiers (flash-lite, flash, pro)

## Agent Framework Examples

### Vercel AI SDK (`vercel-ai-sdk.ts`)
- `generateText` with multiple providers
- `streamText`
- `generateObject` with Zod schema
- Multi-provider workflows

### LangChain (`langchain-example.ts`)
- ChatOpenAI, ChatAnthropic, ChatGoogleGenerativeAI
- Streaming
- LCEL chains
- Multi-model chains
- Tool binding

### LlamaIndex (`llamaindex-example.ts`)
- OpenAI, Anthropic, Gemini LLMs
- Chat interface
- Streaming
- RAG pipeline (requires embeddings)

### Mastra (`mastra-example.ts`)
- Agent with tools
- Multi-agent workflows
- Streaming agents
- `withAgent` context tracking

### Multi-Agent Patterns (`multi-agent-example.ts`)
- Sequential pipeline (Research → Analyze → Write → Review)
- Parallel research (concurrent agent calls)
- Debate workflow (Pro vs Con with Judge)
- Iterative refinement

## What Aden Captures

Each example demonstrates Aden capturing:

```
✓ [a1b2c3d4] openai gpt-4o-mini (stream) 1234ms
  tokens: 150 in / 89 out
  tools: 1 calls (get_weather)
```

Metrics include:
- **trace_id**: Groups related calls
- **span_id**: Unique per LLM call
- **parent_span_id**: Links nested calls
- **call_stack**: Full stack trace to caller
- **agent_stack**: Agent names in context
- **Tokens**: input, output, cached, reasoning
- **Latency**: Time to complete
- **Tools**: Tool calls made

## Dependencies

### Vendor SDKs
```bash
npm install openai @anthropic-ai/sdk @google/generative-ai
```

### Vercel AI SDK
```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google zod
```

### LangChain
```bash
npm install @langchain/openai @langchain/anthropic @langchain/google-genai @langchain/core
```

### LlamaIndex
```bash
npm install llamaindex
```

### Mastra
```bash
npm install @mastra/core @ai-sdk/openai @ai-sdk/anthropic zod
```

## Viewing Metrics

Examples write to JSONL files. Use the visualizer:

```bash
node visualize-metrics.js ./multi-agent-metrics.jsonl
```

Output:
```
════════════════════════════════════════════════════════════════════════════════
LLM USAGE VISUALIZATION
════════════════════════════════════════════════════════════════════════════════
Trace ID: abc123...
Total Calls: 8 | Total Tokens: 70,298 | Total Latency: 53.6s
────────────────────────────────────────────────────────────────────────────────

CALL TREE (by parent-child relationship)
────────────────────────────────────────────────────────────────────────────────
[#1] Researcher | gpt-4o-mini
    ████████ 7,896 tokens (11.2%) | 10397ms
└── [#2] Analyst | claude-3-5-haiku
        ███████████ 11,442 tokens (16.3%) | 16269ms
    └── [#3] Writer | gemini-2.0-flash
            ███████ 7,412 tokens (10.5%) | 737ms
```
