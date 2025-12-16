# AI Usage Analytics Report

Generated: 2025-12-16T02:15:33.242Z

## Executive Summary

| Metric | Value |
|--------|-------|
| Total Spend | $0.0196 |
| Projected Monthly | $1316.02 |
| Cache Savings | $0.0000 |
| Success Rate | 100.0% |
| Avg Latency | 3852ms |

## Cost Analysis

### Spend by Model
- **gpt-5**: $0.0196

### Cost Efficiency
- Average cost per request: $0.001956
- Average cost per 1K tokens: $0.007653
- Cache hit rate: 0.0%
- Cache savings: $0.0000

## Performance Metrics

| Percentile | Latency |
|------------|---------|
| p50 | 2086ms |
| p95 | 7784ms |
| p99 | 7784ms |

- Requests per minute: 10.00
- Tokens per second: 66.3

## Token Efficiency

- Average input tokens: 15
- Average output tokens: 241
- Input/Output ratio: 0.06:1
- Reasoning overhead: 98.3%

## Reliability

- Success rate: 100.0%
- Error rate: 0.0%


## Usage Patterns

- Total requests: 10
- Total tokens: 2,556
- Peak requests/min: 10

### Model Distribution
- gpt-5: 10 (100.0%)

---

## Recommendations

🔄 **Enable prompt caching**: Your cache hit rate is low. Use `prompt_cache_key` to improve cache hits and reduce costs by up to 75% on repeated prompts.

💰 **Consider model optimization**: Your projected monthly spend is significant. Evaluate if smaller models (e.g., gpt-4.1-mini instead of gpt-4.1) can handle simpler tasks.

⚡ **Optimize latency**: P95 latency is high. Consider streaming responses for better UX, or reducing `max_output_tokens` where possible.

🧠 **Tune reasoning effort**: Reasoning tokens are consuming >50% of output. For simpler tasks, use `reasoning: { effort: 'low' }` to reduce costs.
