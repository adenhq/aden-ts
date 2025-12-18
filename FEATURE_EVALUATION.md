# Feature Evaluation: openai-meter Instrumentation

This document evaluates features based on their feasibility, setup complexity, scalability, customization requirements, and performance overhead.

---

## Evaluation Criteria

| Dimension | Description | Scale |
|-----------|-------------|-------|
| **Technically Feasible** | Can we implement this with current architecture? | Yes / Partial / No |
| **Initial Setup Work** | How much work for users to set up? | None / Low / Medium / High |
| **Vendor Scalability** | Does it work across OpenAI, Anthropic, Google, etc.? | Excellent / Good / Limited / Vendor-specific |
| **User Customization** | How much custom code does user need to write? | None / Config-only / Some code / Heavy |
| **Performance Overhead** | Impact on request latency and resource usage | Negligible (<0.1ms) / Low (<1ms) / Medium (<10ms) / High (>10ms) |

---

## Part 1: Currently Implemented Features

### Core Metering (TypeScript)

| Feature | Feasible | Setup | Vendor Scale | Customization | Perf Overhead |
|---------|----------|-------|--------------|---------------|---------------|
| **SDK Monkey-patching** | Yes | None | Good (OpenAI SDK pattern) | None | Negligible |
| **Token Tracking** | Yes | None | Good | None | Negligible |
| **Latency Tracking** | Yes | None | Excellent | None | Negligible |
| **beforeRequest Hook** | Yes | Low | Good | Some code | Low |
| **Custom Emitters** | Yes | Low | Excellent | Config-only | Negligible |
| **Batch Emitters** | Yes | Config-only | Excellent | Config-only | Negligible |
| **Request Metadata** | Yes | Low | Excellent | Config-only | Negligible |

### Core Metering (Python)

| Feature | Feasible | Setup | Vendor Scale | Customization | Perf Overhead |
|---------|----------|-------|--------------|---------------|---------------|
| **SDK Monkey-patching** | Yes | None | Good (OpenAI SDK pattern) | None | Negligible |
| **Token Tracking** | Yes | None | Good | None | Negligible |
| **Latency Tracking** | Yes | None | Excellent | None | Negligible |
| **beforeRequest Hook** | Yes | Low | Good | Some code | Low |
| **Async Stream Wrapping** | Yes | None | Good | None | Negligible |
| **Tool Call Extraction** | Yes | None | Good | None | Negligible |
| **Sample Rate Control** | Yes | Config-only | Excellent | Config-only | Negligible |
| **Custom Emitters** | Yes | Low | Excellent | Config-only | Negligible |
| **Batch Emitters** | Yes | Config-only | Excellent | Config-only | Negligible |
| **Memory Emitters** | Yes | None | Excellent | None | Negligible |
| **Fire-and-forget Emit** | Yes | Config-only | Excellent | Config-only | Negligible |

### LiveKit Integration (Python)

| Feature | Feasible | Setup | Vendor Scale | Customization | Perf Overhead |
|---------|----------|-------|--------------|---------------|---------------|
| **`instrument()` One-liner** | Yes | None | Limited (LiveKit only) | None | Negligible |
| **Session Cost Tracking** | Yes | None | Limited | None | Negligible |
| **Budget Enforcement** | Yes | Low | Limited | Config or callback | Low |
| **Auto-disconnect on Budget** | Yes | None | Limited | None | Negligible |
| **JSONL File Logging** | Yes | Config-only | Excellent | Config-only | Low |
| **Environment Variable Config** | Yes | None | Excellent | None | Negligible |
| **Custom Budget Callbacks** | Yes | Low | Limited | Some code | Low |

---

## Part 2: Planned Advanced Features

### From ADVANCED_FEATURES_PLAN.md

| Feature | Feasible | Setup | Vendor Scale | Customization | Perf Overhead |
|---------|----------|-------|--------------|---------------|---------------|
| **Pre-Request Cost Estimation** | Yes | Low | Good (needs pricing DB per vendor) | Config-only | Low (tiktoken) |
| **Cost Optimization Engine** | Partial | Medium | Limited (model-specific) | Config + rules | Medium (analysis) |
| **Anomaly Detection** | Yes | Medium | Excellent | Config + thresholds | Medium (stats) |
| **Model Router / Cascading** | Partial | High | Limited (quality metrics vendor-specific) | Heavy | Medium-High |
| **Prompt Economics / ROI** | Yes | High | Excellent | Heavy (business logic) | Low |
| **Policy Engine** | Yes | Medium | Excellent | Config (declarative) | Low |
| **Command Interface (CLI/API)** | Yes | Medium | Excellent | Some code | Negligible |
| **Approval Workflows** | Yes | High | Excellent | Heavy | Negligible |
| **Performance Modes** | Yes | None | Excellent | Config-only | Varies by mode |
| **Data Transmission (Batching)** | Yes | Low | Excellent | Config-only | Negligible |
| **Offline Queue** | Yes | Low | Excellent | Config-only | Low |
| **Compression (gzip/brotli)** | Yes | Config-only | Excellent | None | Low (CPU) |

---

## Part 3: User-Suggested Features

### Shadow Mode (Simulation)

| Feature | Feasible | Setup | Vendor Scale | Customization | Perf Overhead |
|---------|----------|-------|--------------|---------------|---------------|
| **Shadow Mode Toggle** | Yes | Config-only | Excellent | Config-only | Negligible |
| **Shadow Event Logging** | Yes | Config-only | Excellent | Config-only | Low |
| **Shadow Reports/Aggregation** | Yes | Low | Excellent | Config-only | Low |
| **Gradual Rollout (Shadow → %)** | Yes | Config-only | Excellent | Config-only | Negligible |

---

## Metrics Catalog: Available Data Points

### Universal Metrics (All Providers)

| Metric | OpenAI | Anthropic | Gemini | Azure | Description |
|--------|--------|-----------|--------|-------|-------------|
| `input_tokens` | ✅ `prompt_tokens` | ✅ `input_tokens` | ✅ `prompt_token_count` | ✅ | Tokens in prompt |
| `output_tokens` | ✅ `completion_tokens` | ✅ `output_tokens` | ✅ `candidates_token_count` | ✅ | Tokens generated |
| `total_tokens` | ✅ | — (compute) | ✅ | ✅ | Sum of in+out |
| `model` | ✅ | ✅ | ✅ | ✅ | Model identifier |
| `request_id` | ✅ `x-request-id` | ✅ `request-id` | ✅ | ✅ | Unique request ID |
| `latency_ms` | ✅ `openai-processing-ms` | — (compute) | — (compute) | ✅ `DurationMs` | Server processing time |

### Platform-Specific: OpenAI

| Metric | Field Path | Use Case |
|--------|------------|----------|
| `cached_tokens` | `usage.prompt_tokens_details.cached_tokens` | Cost savings |
| `reasoning_tokens` | `usage.completion_tokens_details.reasoning_tokens` | o1/thinking models |
| `audio_tokens` (in) | `usage.prompt_tokens_details.audio_tokens` | Realtime API |
| `audio_tokens` (out) | `usage.completion_tokens_details.audio_tokens` | Realtime API |
| `accepted_prediction_tokens` | `usage.completion_tokens_details.accepted_prediction_tokens` | Predicted outputs |
| `rejected_prediction_tokens` | `usage.completion_tokens_details.rejected_prediction_tokens` | Predicted outputs |
| `service_tier` | `response.service_tier` | Priority tier tracking |
| `system_fingerprint` | `response.system_fingerprint` | Model version tracking |

### Platform-Specific: Anthropic

| Metric | Field Path | Use Case |
|--------|------------|----------|
| `cache_creation_input_tokens` | `usage.cache_creation_input_tokens` | Cache write cost |
| `cache_read_input_tokens` | `usage.cache_read_input_tokens` | Cache read (discounted) |
| `stop_reason` | `response.stop_reason` | Why generation stopped |

### Platform-Specific: Google Gemini

| Metric | Field Path | Use Case |
|--------|------------|----------|
| `thoughts_token_count` | `usage_metadata.thoughts_token_count` | Thinking model tokens |
| `cached_content_token_count` | `usage_metadata.cached_content_token_count` | Context caching |

### Platform-Specific: Azure OpenAI

| Metric | Header/Field | Use Case |
|--------|--------------|----------|
| `x-ms-region` | Response header | Region routing tracking |
| `apim-request-id` | Response header | APIM correlation |
| `DurationMs` | Diagnostic logs | Latency analysis |
| `BackendTime` | APIM logs | Backend vs gateway time |

### Rate Limit Headers

| Header | OpenAI | Azure | Description |
|--------|--------|-------|-------------|
| `x-ratelimit-limit-requests` | ✅ | ✅ | Max RPM |
| `x-ratelimit-limit-tokens` | ✅ | ✅ | Max TPM |
| `x-ratelimit-remaining-requests` | ✅ | ✅ | Requests left |
| `x-ratelimit-remaining-tokens` | ✅ | ✅ | Tokens left |
| `x-ratelimit-reset-requests` | ✅ | ✅ | RPM reset time |
| `x-ratelimit-reset-tokens` | ✅ | ✅ | TPM reset time |
| `retry-after` | ✅ | ✅ | 429 backoff hint |
| `retry-after-ms` | — | ✅ | Azure-specific |

### Response Headers (Debugging)

| Header | Provider | Use Case |
|--------|----------|----------|
| `x-request-id` | OpenAI | Support tickets, debugging |
| `request-id` | Anthropic | Support tickets, debugging |
| `openai-processing-ms` | OpenAI | Server-side latency |
| `openai-model` | OpenAI | Actual model used |
| `openai-organization` | OpenAI | Org verification |
| `openai-version` | OpenAI | API version |
| `x-client-request-id` | OpenAI (custom) | Your trace ID passthrough |
| `cf-ray` | All (Cloudflare) | CDN debugging |

---

### Use-Case Specific: Chat/Completion

| Metric | Description | Cost Impact |
|--------|-------------|-------------|
| `prompt_tokens` | Input tokens | Per-token pricing |
| `completion_tokens` | Output tokens | Per-token pricing (often higher) |
| `stream` | Streaming enabled | Same cost, different UX |
| `finish_reason` | stop/length/tool_calls/content_filter | Debugging |
| `logprobs` | Token probabilities | No cost impact |

### Use-Case Specific: Audio (Realtime/TTS/STT)

| Metric | API | Description | Pricing |
|--------|-----|-------------|---------|
| `input_audio_tokens` | Realtime | Audio input tokens | $100/1M |
| `output_audio_tokens` | Realtime | Audio output tokens | $200/1M |
| `audio_duration` | Whisper/TTS | Duration in seconds | ~$0.006/min (Whisper) |
| `characters_count` | TTS | Input character count | $15-30/1M chars |
| `language` | Whisper | Detected language | — |
| `segments` | Whisper | Timestamped segments | — |
| `words` | Whisper | Word-level timestamps | — |

### Use-Case Specific: Image Generation

| Metric | Description | Pricing Impact |
|--------|-------------|----------------|
| `n` | Number of images | Multiplier |
| `size` | 1024x1024, 1792x1024, etc. | Higher = more cost |
| `quality` | standard/hd | HD costs more |
| `style` | vivid/natural | Same cost |
| `model` | dall-e-2/3, gpt-image-1 | Different tiers |
| `revised_prompt` | Actual prompt used | Debugging |

### Use-Case Specific: Embeddings

| Metric | Description | Notes |
|--------|-------------|-------|
| `prompt_tokens` | Input tokens | Only input charged |
| `dimensions` | Vector size | Configurable (v3+) |
| `encoding_format` | float/base64 | No cost impact |

### Use-Case Specific: Fine-Tuning

| Metric | Description | Use Case |
|--------|-------------|----------|
| `train_loss` | Training loss | Model quality |
| `train_mean_token_accuracy` | Training accuracy | Model quality |
| `valid_loss` | Validation loss | Overfitting check |
| `valid_mean_token_accuracy` | Validation accuracy | Overfitting check |
| `full_valid_loss` | Full validation loss | Final quality |
| `trained_tokens` | Tokens processed | Billing ($8/1M for gpt-4o-mini) |
| `epochs` | Training epochs | Cost multiplier |

### Use-Case Specific: Batch API

| Metric | Description | Use Case |
|--------|-------------|----------|
| `status` | validating/in_progress/completed/failed | Job tracking |
| `request_counts.total` | Total requests | Progress tracking |
| `request_counts.completed` | Completed requests | Progress tracking |
| `request_counts.failed` | Failed requests | Error tracking |
| `output_file_id` | Success output file | Results retrieval |
| `error_file_id` | Error output file | Debugging |

### Use-Case Specific: Assistants/Agents

| Metric | Description | Use Case |
|--------|-------------|----------|
| `run.usage.prompt_tokens` | Run input tokens | Cost tracking |
| `run.usage.completion_tokens` | Run output tokens | Cost tracking |
| `run_steps` | Steps in run | Debugging |
| `tool_calls` | Tools invoked | Feature usage |
| `max_prompt_tokens` | Token budget | Cost control |
| `max_completion_tokens` | Token budget | Cost control |

### Use-Case Specific: File Search / Vector Store

| Metric | Description | Use Case |
|--------|-------------|----------|
| `bytes` | Vector store size | Storage billing ($0.10/GB/day) |
| `file_counts.total` | Files in store | Capacity tracking |
| `file_counts.completed` | Processed files | Ingestion progress |
| `usage_bytes` | Per-file storage | Storage optimization |
| `chunk_count` | Chunks per file | Retrieval quality |

### Use-Case Specific: Moderation

| Metric | Description | Use Case |
|--------|-------------|----------|
| `flagged` | Any violation detected | Quick check |
| `categories.*` | Boolean per category | Policy enforcement |
| `category_scores.*` | 0-1 confidence per category | Threshold tuning |
| `category_applied_input_types` | Which inputs flagged | Multimodal debugging |

**Categories:** hate, harassment, self-harm, sexual, violence (with subcategories like /threatening, /graphic, /minors, /intent, /instructions)

---

### Error Types for Monitoring

| Error Type | HTTP Code | Description | Retry Strategy |
|------------|-----------|-------------|----------------|
| `rate_limit_error` | 429 | RPM/TPM exceeded | Exponential backoff |
| `context_length_exceeded` | 400 | Prompt too long | Truncate/summarize |
| `invalid_request_error` | 400 | Malformed request | Fix and retry |
| `authentication_error` | 401 | Invalid API key | Check credentials |
| `permission_error` | 403 | Access denied | Check permissions |
| `not_found_error` | 404 | Model/resource missing | Check endpoint |
| `server_error` | 500 | Provider issue | Retry with backoff |
| `service_unavailable` | 503 | Overloaded | Retry with backoff |
| `timeout_error` | 504/599 | Request timed out | Increase timeout/retry |
| `content_filter_error` | 400 | Policy violation | Modify content |
| `insufficient_quota` | 402 | Billing issue | Add credits |

---

### LiveKit Pipeline Metrics

| Metric Type | Fields | Description |
|-------------|--------|-------------|
| **LLMMetrics** | `prompt_tokens`, `completion_tokens`, `total_tokens`, `ttft`, `tokens_per_second`, `duration`, `cancelled`, `error` | Language model |
| **STTMetrics** | `audio_duration`, `duration`, `streamed`, `error` | Speech-to-text |
| **TTSMetrics** | `ttfb`, `audio_duration`, `characters_count`, `duration`, `streamed`, `cancelled`, `error` | Text-to-speech |
| **VADMetrics** | — | Voice activity detection |
| **EOUMetrics** | — | End-of-utterance |
| **PipelineMetrics** | `sequence_id` (correlates STT→LLM→TTS) | Full turn tracking |

---

### Cost Calculation Summary

| Use Case | Primary Metric | Pricing Model |
|----------|----------------|---------------|
| Chat/Completion | input_tokens, output_tokens | Per 1M tokens |
| Audio Realtime | audio_tokens (in/out) | Per 1M tokens |
| Whisper STT | audio_duration | Per minute |
| TTS | characters_count | Per 1M chars |
| Images | count × size × quality | Per image |
| Embeddings | input_tokens | Per 1M tokens |
| Fine-tuning | trained_tokens × epochs | Per 1M tokens |
| Vector Store | bytes | Per GB/day |
| Assistants Tools | tool_calls | Per 1K calls (some tools) |

**Sources:**
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)
- [OpenAI Rate Limits](https://platform.openai.com/docs/guides/rate-limits)
- [Anthropic API Docs](https://docs.anthropic.com/en/api)
- [Gemini Token Counting](https://ai.google.dev/gemini-api/docs/tokens)
- [LiveKit Metrics](https://docs.livekit.io/agents/build/metrics/)
- [Azure OpenAI Diagnostics](https://journeyofthegeek.com/2024/05/17/azure-openai-service-the-value-of-response-headers-and-log-correlation/)

---

## Performance Overhead Deep Dive

### Overhead Categories

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Performance Overhead Analysis                         │
├─────────────────────────────────────────────────────────────────────────┤
│  NEGLIGIBLE (<0.1ms)     │  LOW (<1ms)          │  MEDIUM (<10ms)       │
│                          │                       │                        │
│  • Object creation       │  • File I/O           │  • Token counting      │
│  • Timestamp capture     │  • Async callbacks    │  • HTTP transmission   │
│  • UUID generation       │  • Compression        │  • Complex analysis    │
│  • Memory emitters       │  • Batch flush        │  • Database queries    │
│                          │  • JSON serialization │                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Relative to API Latency

| Operation | Typical Latency | Metering Overhead | Relative Impact |
|-----------|-----------------|-------------------|-----------------|
| OpenAI GPT-4 call | 2000-10000ms | 0.1ms | 0.001-0.005% |
| OpenAI GPT-4o-mini call | 500-2000ms | 0.1ms | 0.005-0.02% |
| TTS synthesis | 200-500ms | 0.05ms | 0.01-0.025% |
| STT transcription | 100-300ms | 0.05ms | 0.017-0.05% |
| LiveKit metrics callback | N/A (async) | 0.1ms | Non-blocking |

### Overhead Mitigation Strategies

| Strategy | Overhead Reduction | Trade-off |
|----------|-------------------|-----------|
| Fire-and-forget emission | Eliminates blocking | No delivery guarantee |
| Sampling (10%) | 90% reduction | Incomplete data |
| Lazy token counting | Eliminates if unused | Delayed cost calc |
| Object pooling | Reduces GC | Memory usage |
| Batch transmission | Reduces I/O | Delayed reporting |

---

## Vendor Scalability Analysis

### SDK Instrumentation Patterns (Verified)

| SDK | Request Pattern | Response Usage Pattern | Monkey-Patch Difficulty |
|-----|-----------------|------------------------|------------------------|
| **OpenAI** | `client.chat.completions.create()` | `response.usage.prompt_tokens`, `completion_tokens` | Easy - clean class methods |
| **Anthropic** | `client.messages.create()` | `response.usage.input_tokens`, `output_tokens` | Easy - similar pattern |
| **Google Gemini** | `client.models.generate_content()` | `response.usage_metadata.prompt_token_count`, `candidates_token_count` | Medium - different field names |
| **HuggingFace** | `InferenceClient.chat_completion()` | OpenAI-compatible `usage` in final chunk | Medium - streaming focus |
| **OpenRouter** | OpenAI-compatible | OpenAI + `usage: {include: true}` for costs | Easy - same SDK + extras |
| **Together** | OpenAI-compatible | OpenAI-compatible | Easy - same SDK |
| **Groq** | OpenAI-compatible | OpenAI-compatible | Easy - same SDK |
| **Mistral** | `client.chat.complete()` | `response.usage.prompt_tokens`, `completion_tokens` | Easy - OpenAI-like |
| **Cohere** | `client.chat()` | `response.meta.tokens.input_tokens`, `output_tokens` (V2) | Medium - nested `meta` |
| **AWS Bedrock** | `invoke_model()` | Varies by underlying model | Hard - low-level API |

**Sources:**
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-python) - `usage.input_tokens`, `usage.output_tokens`
- [Google Gemini SDK](https://ai.google.dev/gemini-api/docs/tokens) - `usage_metadata.prompt_token_count`, `candidates_token_count`
- [HuggingFace Inference](https://huggingface.co/docs/inference-providers/en/tasks/chat-completion) - OpenAI-compatible output
- [Mistral SDK](https://docs.mistral.ai/getting-started/clients) - `prompt_tokens`, `completion_tokens`, `total_tokens`
- [Cohere SDK](https://docs.cohere.com/reference/chat) - `meta.tokens.input_tokens`, `output_tokens`
- [OpenRouter Usage Accounting](https://openrouter.ai/docs/use-cases/usage-accounting) - Built-in cost tracking

### Vendor Support Matrix (Verified)

| Vendor | SDK Metering | Token Tracking | Cost Estimation | Streaming | Notes |
|--------|--------------|----------------|-----------------|-----------|-------|
| **OpenAI** | ✅ Full | ✅ `usage.prompt_tokens` | ✅ | ✅ | Primary target |
| **Anthropic** | ⚠️ Thin adapter | ✅ `usage.input_tokens` | ✅ | ✅ | Nearly identical pattern |
| **Google Gemini** | ⚠️ Adapter needed | ✅ `usage_metadata.*_token_count` | ⚠️ | ✅ | Different field naming |
| **Azure OpenAI** | ✅ Same SDK | ✅ | ✅ | ✅ | Uses OpenAI SDK |
| **OpenRouter** | ✅ Same SDK | ✅ + native via `usage:{include:true}` | ✅ Built-in | ✅ | Has cost in response |
| **Together** | ✅ Same SDK | ✅ | ⚠️ | ✅ | OpenAI-compatible |
| **Groq** | ✅ Same SDK | ✅ | ✅ | ✅ | OpenAI-compatible |
| **Mistral** | ⚠️ Thin adapter | ✅ `usage.prompt_tokens` | ✅ | ✅ | OpenAI-like response |
| **HuggingFace** | ⚠️ Adapter needed | ✅ OpenAI-compatible final chunk | ⚠️ | ✅ | Inference Providers now standardized |
| **Cohere** | ⚠️ Adapter needed | ✅ `meta.tokens.*` | ⚠️ | ✅ | V2 API uses `input_tokens`/`output_tokens` |
| **AWS Bedrock** | ❌ Complex | ⚠️ Model-dependent | ⚠️ | ⚠️ | Low-level, varies by model |

### Implementation Strategy by Vendor Tier

**Tier 1: OpenAI-Compatible (Easy - same SDK)**
- OpenAI, Azure OpenAI, OpenRouter, Together, Groq, Anyscale
- Strategy: Works with current implementation
- Effort: None (already supported)

**Tier 2: Similar Pattern (Low effort - thin adapter)**
- Anthropic, Mistral, HuggingFace Inference
- Strategy: Thin wrapper normalizing response fields
- Effort: ~50-100 lines per SDK

```python
# Example: Anthropic adapter (verified field names)
def make_metered_anthropic(client, options):
    original_create = client.messages.create

    def metered_create(*args, **kwargs):
        start = time.time()
        response = original_create(*args, **kwargs)
        latency = (time.time() - start) * 1000

        # Anthropic uses: response.usage.input_tokens, output_tokens
        options.emit_metric(MetricEvent(
            model=kwargs.get('model'),
            usage=NormalizedUsage(
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            ),
            latency_ms=latency,
        ))
        return response

    client.messages.create = metered_create
    return client

# Example: Google Gemini adapter (verified field names)
def make_metered_gemini(client, options):
    original_generate = client.models.generate_content

    def metered_generate(*args, **kwargs):
        start = time.time()
        response = original_generate(*args, **kwargs)
        latency = (time.time() - start) * 1000

        # Gemini uses: response.usage_metadata.prompt_token_count, candidates_token_count
        meta = response.usage_metadata
        options.emit_metric(MetricEvent(
            model=kwargs.get('model'),
            usage=NormalizedUsage(
                input_tokens=meta.prompt_token_count,
                output_tokens=meta.candidates_token_count,
            ),
            latency_ms=latency,
        ))
        return response

    client.models.generate_content = metered_generate
    return client
```

**Tier 3: Complex / Low-level (Hard - significant effort)**
- AWS Bedrock, Custom local models
- Strategy: Model-specific implementations
- Effort: ~300-500 lines, varies by underlying model
- Note: Bedrock response format depends on which model (Claude, Mistral, Llama, etc.)

### Pricing Database Requirements

| Vendor | Pricing Model | Update Frequency | Complexity |
|--------|--------------|------------------|------------|
| OpenAI | Per 1M tokens (input/output) | Monthly | Low |
| Anthropic | Per 1M tokens (input/output) | Monthly | Low |
| Google Gemini | Per 1M chars + tokens | Monthly | Medium |
| OpenRouter | Pass-through + markup | Real-time | High (many models) |
| Together | Per 1M tokens | Monthly | Medium (many models) |
| HuggingFace | Per second / per request | Varies | High (model-dependent) |
| AWS Bedrock | Per 1K tokens | Monthly | Medium |

### What Multi-Vendor Means for Each Feature

| Feature | Multi-Vendor Impact | Implementation Notes |
|---------|--------------------|--------------------|
| **Token Tracking** | ⚠️ Response format differs | Need normalization layer |
| **Cost Estimation** | ⚠️ Pricing DB per vendor | Maintainable via config |
| **beforeRequest Hook** | ✅ Concept is universal | Params shape varies |
| **Budget Enforcement** | ✅ Universal concept | Works once tokens normalized |
| **Model Router** | ❌ Vendor-specific | Cross-vendor routing is complex |
| **Anomaly Detection** | ✅ Stats are universal | Baselines differ per model |
| **File Logging** | ✅ Universal | Same JSONL format |
| **Streaming** | ⚠️ Chunk format varies | Need per-vendor handling |

### What "Vendor Scale" Means for Each Feature

| Feature | Scales Well Because... | Scales Poorly Because... |
|---------|----------------------|-------------------------|
| Token Tracking | All vendors return usage | Response format differs |
| Cost Estimation | Just needs pricing table | Pricing structures vary |
| Budget Enforcement | Universal concept | Vendor-specific blocking |
| Model Router | — | Quality metrics vendor-specific |
| Anomaly Detection | Statistical (vendor-agnostic) | Baseline differs per model |

---

## Framework Scalability Analysis

### How Frameworks Make LLM Calls

| Framework | Internal LLM Client | SDK Monkey-Patch Works? | Alternative Approach |
|-----------|--------------------|-----------------------|---------------------|
| **LangChain/LangGraph** | OpenAI SDK directly | ✅ Yes | — |
| **OpenAI Agents SDK** | OpenAI SDK directly | ✅ Yes | — |
| **PydanticAI** | Vendor SDKs (OpenAI, etc.) | ✅ Yes | — |
| **AutoGen** | `autogen-ext` → OpenAI SDK | ✅ Yes | — |
| **Agno (Phidata)** | Model wrappers → native SDKs | ✅ Likely | — |
| **CrewAI** | LiteLLM → native SDKs or httpx | ⚠️ Partial | LiteLLM callbacks |
| **LiveKit Agents** | Own httpx client (not SDK) | ❌ No | `MetricsCollectedEvent` |
| **AWS Bedrock** | boto3 (not OpenAI SDK) | ❌ No | Bedrock-specific adapter |

### Framework Integration Strategies

| Framework | Strategy | Effort | Notes |
|-----------|----------|--------|-------|
| **LangChain/LangGraph** | SDK patch before agent init | None | Transparent - just patch client |
| **OpenAI Agents SDK** | SDK patch before agent init | None | Works out of the box |
| **PydanticAI** | SDK patch before agent init | None | Uses OpenAI SDK internally |
| **AutoGen** | SDK patch before agent init | Low | May need to patch `autogen-ext` client |
| **Agno** | SDK patch before agent init | Low | Patch `OpenAIChat` model |
| **CrewAI** | LiteLLM callback hooks | Medium | Use `litellm.success_callback` |
| **LiveKit Agents** | `MetricsCollectedEvent` listener | Low | Already implemented in our lib |
| **Custom/Bedrock** | Framework-specific adapter | High | Per-framework implementation |

### What "Framework Scale" Means for Each Feature

| Feature | Scales Well Because... | Scales Poorly Because... |
|---------|----------------------|-------------------------|
| SDK Monkey-patching | Most frameworks use native SDKs | Some use custom HTTP clients |
| Token Tracking | SDK patch captures `response.usage` | Frameworks with own clients bypass it |
| Budget Enforcement | Works if we intercept the call | Can't block if framework bypasses SDK |
| beforeRequest Hook | Intercepts at SDK level | No intercept = no hook |
| Latency Tracking | Time the SDK call | Same limitation |
| File Logging | Post-request logging works | Need metrics from somewhere |

### Framework Support Matrix

| Feature | LangChain | OpenAI SDK | PydanticAI | AutoGen | Agno | CrewAI | LiveKit |
|---------|-----------|------------|------------|---------|------|--------|---------|
| **SDK Metering** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| **Token Tracking** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅* |
| **beforeRequest Hook** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| **Budget Blocking** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️** |
| **Latency Tracking** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅* |
| **File Logging** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

\* Via `MetricsCollectedEvent` (post-hoc, not SDK intercept)
\*\* Graceful disconnect only, can't block individual calls

**Sources:**
- [LangChain ChatOpenAI](https://python.langchain.com/api_reference/openai/chat_models/langchain_openai.chat_models.base.ChatOpenAI.html) - wraps `openai.OpenAI.chat.completions.create()`
- [CrewAI LLMs](https://docs.crewai.com/en/concepts/llms) - uses LiteLLM under the hood
- [Agno GitHub](https://github.com/agno-agi/agno) - model-agnostic with native SDK wrappers
- [LiveKit Agents](https://docs.livekit.io/agents/) - uses own httpx client for Realtime API
- [PydanticAI OpenAI](https://ai.pydantic.dev/models/openai/) - wraps vendor SDKs, uses httpx internally
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) - uses OpenAI SDK directly

---

## Summary: Feature Viability Matrix

```
                    High Value + Easy
                           ▲
                           │
     ┌─────────────────────┼─────────────────────┐
     │                     │                     │
     │  • Policy Engine    │  • Anomaly Detection│
     │  • Budget Enforce   │  • Model Router     │
     │  • File Logging     │  • Prompt Economics │
     │  • instrument()     │                     │
     │                     │                     │
Low ◄──────────────────────┼──────────────────────► High
Effort                     │                     Effort
     │                     │                     │
     │  • Token Tracking   │  • Approval Workflows│
     │  • Latency Track    │  • Custom Routing   │
     │  • Batch Emit       │  • A/B Testing      │
     │                     │                     │
     └─────────────────────┼─────────────────────┘
                           │
                           ▼
                    Lower Value
```

---

## Part 4: Pricing Model Analysis

### The Cost Control Paradox

If the metering service charges per API request/trace passed through, **cost control features penalize the service's own revenue**:

```
Problem:
  Customer uses 100k requests/month → Service bills $X
  Cost control blocks 30k requests → Service bills $0.7X
  Better cost control = Less revenue 💀
```

This creates a misalignment: the service is incentivized to *not* block requests.

### Pricing Models Evaluated

| Model | Description | Alignment | Complexity | Predictability |
|-------|-------------|-----------|------------|----------------|
| **Per-Request (passed)** | Charge for each request that goes through | ❌ Perverse | Low | Medium |
| **Per-Request (all)** | Charge for each request (blocked or passed) | ✅ Aligned | Low | Medium |
| **% of Savings** | Take percentage of cost reduction | ✅ Aligned | High (prove baseline) | Low |
| **Budget Managed** | Charge based on budget pool size | ✅ Aligned | Low | High |
| **Subscription Tiers** | Fixed monthly fee by tier | ⚠️ Neutral | Low | High |
| **Value Features** | Free metering, charge for insights/alerts | ✅ Aligned | Medium | Medium |

### Recommended: Hybrid Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pricing Structure                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Base Platform Fee (per month)                                  │
│  └── Covers: Dashboard, storage, N requests included            │
│                                                                  │
│  Per-Request Fee (beyond included)                              │
│  └── Charged for ALL requests: passed AND blocked               │
│  └── Rationale: Blocked requests = protection delivered         │
│                                                                  │
│  Optional Add-ons                                                │
│  └── Anomaly detection alerts                                   │
│  └── Cost optimization recommendations                          │
│  └── Custom retention periods                                   │
│  └── Advanced analytics / exports                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Works

1. **Blocked requests = value delivered**
   - When we block a request, we prevented overspend
   - Customer should pay for that protection
   - "You pay us to protect you, whether by allowing or blocking"

2. **Base fee ensures minimum revenue**
   - Even if customer uses 0 requests, platform costs are covered
   - Covers dashboard, storage, support

3. **Usage-based scaling**
   - Large customers pay more (fair)
   - Small customers pay less (accessible)

4. **Upsell path via add-ons**
   - Core metering is commodity
   - Insights/optimization is where value compounds

### Example Pricing Tiers

| Tier | Base Fee | Included Requests | Overage | Target Customer |
|------|----------|-------------------|---------|-----------------|
| **Starter** | $0 | 10k/month | $0.001 per req | Indie developers |
| **Pro** | $49/mo | 100k/month | $0.0005 per req | Startups |
| **Business** | $199/mo | 1M/month | $0.0003 per req | Mid-market |
| **Enterprise** | Custom | Unlimited | Volume discounts | Large orgs |

### Key Insight

> **Charge for protection, not just passthrough.**
>
> A security service doesn't charge per attack that gets through—it charges for the protection.
> Cost control is the same: we charge for budget enforcement, whether that means
> allowing a request or blocking it.

---

## Next Steps

1. Add your creative feature ideas to Part 3
2. We'll evaluate each against the 5 dimensions
3. Prioritize based on value vs. effort
