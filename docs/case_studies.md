# Aden Case Studies

## Case Study 1: Snapi Health

**Scaling AI-Powered Diagnostics Profitably: How Snapi Health Secured 12% Better Unit Margins with Aden**

### Executive Summary

Snapi Health, a pioneer in at-home infant health tracking, relies on advanced computer vision to analyze diagnostic panels via smartphone cameras. As their user base grew, so did their AI inference and cloud API costs, threatening the affordability of their core product. By integrating Aden's Cost Control Agent SDK, Snapi Health moved from reactive monthly audits to real-time "Financial Circuit Breakers," ensuring that every AI interaction remained profitable.

### The Customer

- **Industry:** Digital Health / Consumer Tech
- **Mission:** To provide affordable, hospital-grade health insights for babies using a low-cost diaper attachment and a smartphone app.
- **Tech Stack:** Mobile-first application relying on heavy cloud-based Computer Vision (CV) and GenAI models to interpret urinalysis results instantly.

### The Challenge: The "Black Box" of AI Costs

Snapi's business model depends on high volume and low margins. They sell physical testing kits at an affordable price point, assuming a fixed cost for the digital analysis. However, as they scaled, they encountered the "Runaway Inference" problem:

- **Unpredictable Spikes:** A single user retrying a failed photo upload 10 times would trigger 10x the cloud inference cost, wiping out the margin for that entire kit.
- **Delayed Visibility:** The engineering team only saw these cost spikes when the cloud bill arrived 30 days later.
- **Manual Reconciliation:** Finance had no way to map a $50,000 cloud bill back to specific user cohorts or feature usage.

> "We were flying blind. We knew our user base was growing, but our cloud bills were growing twice as fast. We couldn't tell which features were bleeding money." — CTO, Snapi Health

### The Solution: Aden Cost Control Agents

Snapi Health chose Aden to embed financial governance directly into their application code. Instead of just monitoring costs, they used Aden's Agent SDK to actively manage them.

**Key Capabilities Deployed:**
- **Unit Economics Modeling:** Mapping every API call (OpenAI/AWS) to a specific user_id and scan_event.
- **Financial Circuit Breakers:** Real-time logic to block or downgrade requests that exceed a specific profitability threshold.
- **Automated Anomaly Detection:** Agents that watch for "looping" behaviors (e.g., a phone stuck in a retry loop) and cut the connection instantly.

### Implementation

Snapi's engineering team integrated the Aden SDK directly into their backend microservices.

**Step 1: SDK Integration**

```typescript
// Snapi Backend - Application Bootstrap
import OpenAI from "openai";
import { instrument, setContextMetadata, withMeterContextAsync } from "aden";

// Single-line setup - connects to Aden control server automatically
await instrument({
  apiKey: process.env.ADEN_API_KEY,
  failOpen: false, // Fail closed for healthcare - safety first
  sdks: { OpenAI },
});

const openai = new OpenAI();
```

**Step 2: Context Tagging for Attribution**

```typescript
// Snapi Backend - Image Processing Service
async function analyzeUrinalysis(userId: string, imageData: Buffer) {
  return withMeterContextAsync(async () => {
    // Tag this context for cost attribution
    setContextMetadata({
      userId,
      feature: "urinalysis_scan_v2",
      costCenter: "diagnostics",
    });

    // The control agent evaluates policies before each LLM call
    // If user exceeds budget, it automatically degrades or blocks
    const result = await openai.chat.completions.create({
      model: "gpt-4o", // May be degraded to gpt-4o-mini by control agent
      messages: [{ role: "user", content: "Analyze this urinalysis..." }],
    });

    return result;
  });
}
```

**Step 3: Server-Side Policy Configuration**

Via the Aden Dashboard (or API), Snapi configured the following policy. The SDK fetches this from the server and enforces it automatically:

```json
// Policy returned from GET /v1/control/policy
{
  "version": "1.0",
  "budgets": [{
    "context_id": "user:*",
    "limit_usd": 0.50,
    "current_spend_usd": 0,
    "action_on_exceed": "degrade",
    "degrade_to_model": "gpt-4o-mini"
  }],
  "blocks": [{
    "context_id": "user:*",
    "threshold_percent": 120,
    "reason": "Session budget exceeded - please wait for reset"
  }]
}
```

| Rule Type | Configuration | Behavior |
|-----------|--------------|----------|
| **Budget** | $0.50 per user session | Track spend per userId |
| **Degrade** | At 80% of budget | Switch gpt-4o → gpt-4o-mini |
| **Block** | At 120% of budget | Reject with "Session budget exceeded" |

No code changes needed when policies are updated—the SDK fetches the latest policy from the server.

### Results & Business Impact

- **12% Improvement in Unit Margins:** By automatically downgrading expensive requests for non-critical retries, Snapi stabilized their cost-per-scan.
- **Elimination of Bill Shock:** The "Runaway Loop" protection caught a bug in the iOS app's retry logic that would have cost an estimated $12,000 in wasted API calls.
- **Audit-Ready Financials:** The Finance team now uses the Aden Dashboard to see a live P&L per feature, allowing them to price new premium tiers with 100% confidence.

### Conclusion

For Snapi Health, Aden wasn't just an accounting tool. It was an infrastructure necessity. By using the Aden SDK, they turned cost control from a monthly spreadsheet exercise into an automated, real-time function of their code, allowing them to scale their AI diagnostics without scaling their financial risk.

---

## Case Study 2: Alpha Vantage

**Defending Data Margins: How Alpha Vantage Used Aden to Turn API Rate Limits into Profit Engines**

### Executive Summary

Alpha Vantage, a leading provider of financial market APIs, faces a classic "freemium" infrastructure challenge: serving millions of free-tier requests daily without letting infrastructure costs cannibalize the revenue from premium subscribers. By deploying Aden's Cost Control Agents as an intelligent middleware layer, Alpha Vantage transitioned from static rate limiting to dynamic margin protection, reducing their cloud ingress/egress costs by 28% while improving uptime for their top-tier enterprise clients.

### The Customer

- **Industry:** Fintech / Market Data Provider
- **Product:** APIs for real-time and historical stock, forex, and crypto data.
- **Scale:** Millions of daily active requests, serving everything from student projects (Free Tier) to high-frequency hedge fund algos (Premium Tier).
- **Infrastructure:** Heavy read-volume architecture, caching layers, and expensive upstream data licensing fees (e.g., NASDAQ, NYSE feeds).

### The Challenge: The "Noisy Neighbor" & The Phantom Cost

Alpha Vantage's tiered pricing model (Free vs. Premium) created a hidden infrastructure conflict:

- **Inefficient Polling:** Free-tier users often wrote bad code (e.g., `while(true) { fetchStock() }`), slamming the servers with redundant requests.
- **Upstream Overage:** Alpha Vantage pays its own providers for data ingress. When a sudden market event occurred (e.g., a "meme stock" rally), data ingress volume spiked, but their fixed-price subscription revenue remained flat.
- **Margin Erosion:** The cost to serve complex queries (e.g., "Give me 20 years of adjusted intraday data") was treated the same as simple queries ("Current price of AAPL"), despite the former costing 50x more in compute.

> "We were effectively subsidizing bad code. A student scraping our API efficiently cost us pennies, but a student with a bad for-loop was costing us dollars in wasted compute cycles before we could even block them." — CTO, Alpha Vantage

### The Solution: Aden as the "Gatekeeper"

Alpha Vantage integrated the Aden Agent SDK directly into their API Gateway and Data Ingestion pipelines.

**Key Capabilities Deployed:**
- **Dynamic Query Costing:** Aden assigned a real-time dollar value to every request based on compute intensity and data egress size.
- **The "Penalty Box" Agent:** Identifies inefficient polling patterns and serves cached responses, bypassing the expensive backend.
- **Upstream Throttling:** Monitors bill from data exchanges and reduces Free Tier refresh rate when ingress costs spike.

### Implementation

**Step 1: SDK Integration**

```typescript
// Alpha Vantage API Gateway - Bootstrap
import { instrumentFetch, setContextMetadata, withMeterContextAsync } from "aden";

// Single-line setup for fetch instrumentation
await instrumentFetch({
  apiKey: process.env.ADEN_API_KEY,
  failOpen: true, // Don't block API requests if control server is down
});
```

**Step 2: Context Tagging per Request**

```typescript
// API Gateway Middleware
async function handleRequest(req: Request, user: User) {
  return withMeterContextAsync(async () => {
    // Tag context for per-user tracking
    setContextMetadata({
      userId: user.id,
      tier: user.tier,
      endpoint: req.path,
    });

    // Control agent policies are evaluated automatically
    // If user is throttled, the SDK adds delay before proceeding
    // If user is blocked, the SDK throws an error we can catch

    try {
      const result = await processQuery(req);
      return result;
    } catch (error) {
      if (error.message.includes("Request blocked")) {
        // Return helpful response instead of generic 429
        return new Response(JSON.stringify({
          error: "Rate limit exceeded",
          tip: "You are polling too fast. Use WebSockets for real-time data.",
          upsell: "Need higher limits? Upgrade to Premium.",
          cached_data: await getCachedPrice(req.symbol),
        }), {
          status: 429,
          headers: {
            "X-Retry-After": "60",
            "X-Upgrade-URL": "https://alphavantage.co/premium",
          },
        });
      }
      throw error;
    }
  });
}
```

**Step 3: Server-Side Policy Configuration**

Via the Aden Dashboard (or API), Alpha Vantage configured tier-based policies. The SDK fetches this from the server:

```json
// Policy returned from GET /v1/control/policy
{
  "version": "2.0",
  "throttles": [
    {
      "context_id": "tier:free",
      "requests_per_minute": 5,
      "delay_ms": 200
    },
    {
      "context_id": "tier:premium",
      "requests_per_minute": 100,
      "delay_ms": 0
    }
  ],
  "degradations": [
    {
      "from_model": "gpt-4o",
      "to_model": "gpt-4o-mini",
      "trigger": "rate_limit",
      "context_id": "tier:free"
    }
  ],
  "blocks": [
    {
      "context_id": "pattern:inefficient_polling",
      "reason": "Inefficient polling detected. Please use WebSockets."
    }
  ]
}
```

| User Tier | Requests/min | Delay | Model Degradation |
|-----------|-------------|-------|-------------------|
| **Free** | 5 | 200ms | gpt-4o → gpt-4o-mini during high load |
| **Premium** | 100 | 0ms | None |
| **Enterprise** | Unlimited | 0ms | None |

The server automatically detects inefficient polling patterns and triggers blocks with helpful error messages.

### Results & Business Impact

- **28% Reduction in Cloud Egress:** By catching redundant requests at the edge (the "Penalty Box" strategy), Alpha Vantage stopped paying AWS to transmit data that users had already received.
- **Premium SLA Protection:** During the "meme stock" volatility of late 2025, Aden automatically deprioritized Free Tier traffic to reserve bandwidth for paying customers, maintaining 99.95% uptime for Enterprise clients.
- **Profitable Complexity:** They realized that 5% of their users were generating 50% of their compute load via complex historical queries. Aden allowed them to introduce a "Complexity Surcharge" for those specific heavy queries, turning a loss leader into a new revenue stream.

### Conclusion

Alpha Vantage proved that in the API economy, not all requests are created equal. By using Aden to attach a dollar sign to every millisecond of compute and byte of data, they transformed their infrastructure from a passive cost center into an actively managed asset, ensuring that as their popularity grew, their margins grew with it.

---

## Case Study 3: Lextract.ai

**The Cost of Precision: How Lextract.ai Optimized M&A Due Diligence Margins with Aden**

### Executive Summary

Lextract.ai, a leader in AI-powered legal due diligence, faced a critical profitability hurdle: the immense computational cost of processing thousands of documents in Virtual Data Rooms (VDRs). Legal accuracy demands intensive computes from Large Language Models (LLMs), but standard "per-token" pricing was eroding margins on large enterprise deals. By implementing Aden's Cost Control Agents, Lextract transitioned from a flat-rate processing model to Context-Aware Routing, reducing inference costs by 42% while maintaining 100% accuracy on critical "Red Flag" reports.

### The Customer

- **Industry:** Legal Tech / M&A Automation
- **Mission:** To accelerate legal reviews by using AI to instantly identify risks, red flags, and missing clauses in deal documentation.
- **Workload:** Analyzing massive repositories of unstructured data (PDFs, scans, handwritten notes) in secure, GDPR-compliant environments.
- **The Stakes:** Unlike a chatbot, a legal AI cannot hallucinate. Missing a "Change of Control" clause in a merger agreement could cost a client millions, meaning Lextract defaults to the most powerful (and expensive) models available.

### The Challenge: The "Boilerplate" Tax

In M&A due diligence, 80% of documents are standard (boilerplate) and 20% contain the critical risks. However, Lextract's initial architecture treated every sentence with equal weight.

- **Indiscriminate Compute:** Processing a standard NDA required the same expensive compute power as analyzing a complex IP assignment agreement.
- **Uncapped Client Uploads:** A law firm might upload 5,000 pages of irrelevant "bulk data" into the system. Lextract was paying to process this "noise" before knowing it was irrelevant.
- **Margin Variance:** A "clean" deal was profitable; a "messy" deal with thousands of scanned, unstructured pages became a loss leader due to OCR and token re-processing costs.

> "We were paying GPT-4 prices to read standard 'Governing Law: New York' clauses that haven't changed in 20 years. We needed a way to use a scalpel instead of a sledgehammer." — Lead Machine Learning Engineer, Lextract.ai

### The Solution: Aden as the "Senior Partner"

Lextract integrated the Aden Agent SDK to act as an intelligent router and budget warden within their document processing pipeline.

**Key Capabilities Deployed:**
- **Semantic Complexity Routing:** Routes standard boilerplate to cheaper models; escalates complex text to flagship LLM.
- **Deal-Based Budgeting:** Tracks spend per Data Room. Alerts or throttles when approaching budget.
- **"Noise" Filtering:** Skips duplicate or non-legal documents before they hit the expensive inference layer.

### Implementation

**Step 1: SDK Integration**

```typescript
// Lextract Backend - Application Bootstrap
import OpenAI from "openai";
import { instrument, withMeterContextAsync, setContextMetadata, withAgent } from "aden";

// Single-line setup - strict control for legal documents
await instrument({
  apiKey: process.env.ADEN_API_KEY,
  failOpen: false, // Legal docs require strict control
  sdks: { OpenAI },
});

const openai = new OpenAI();
```

**Step 2: Document Analysis with Context**

```typescript
// Lextract Backend - Document Ingestion Pipeline
async function analyzeDocument(document: Document, dealId: string) {
  return withMeterContextAsync(async () => {
    // Tag this analysis for deal-based cost tracking
    setContextMetadata({
      dealId,
      docType: document.classification,
      clientTier: document.client.tier,
    });

    // Use withAgent to track the analysis pipeline
    return withAgent("document-analyzer", async () => {
      // The control agent automatically applies degradation rules
      // based on docType metadata - configured on the server
      const result = await openai.chat.completions.create({
        model: "gpt-4o", // May be degraded based on server policy
        messages: [{
          role: "system",
          content: "You are a legal document analyst. Identify risks and red flags.",
        }, {
          role: "user",
          content: `Analyze this ${document.classification}:\n\n${document.text}`,
        }],
      });

      return result.choices[0]?.message?.content;
    });
  });
}
```

**Step 3: Chat Interface with Budget Guardrails**

```typescript
// LexChat Service
async function handleChatQuery(user: User, query: string, sessionId: string) {
  return withMeterContextAsync(async () => {
    setContextMetadata({
      userId: user.id,
      sessionId,
      feature: "lexchat",
    });

    try {
      // Control agent enforces per-session query limits (configured server-side)
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: query }],
      });

      return response.choices[0]?.message?.content;
    } catch (error) {
      if (error.message.includes("Request blocked")) {
        return "You have reached the query limit for this document tier. Please upgrade to Deep Analysis mode.";
      }
      throw error;
    }
  });
}
```

**Step 4: Server-Side Policy Configuration**

Via the Aden Dashboard (or API), Lextract configured intelligent routing. The SDK fetches this from the server:

```json
// Policy returned from GET /v1/control/policy
{
  "version": "1.0",
  "degradations": [
    {
      "from_model": "gpt-4o",
      "to_model": "gpt-4o-mini",
      "trigger": "always",
      "context_id": "docType:NDA"
    },
    {
      "from_model": "gpt-4o",
      "to_model": "gpt-4o-mini",
      "trigger": "always",
      "context_id": "docType:Employment Agreement"
    }
  ],
  "budgets": [
    {
      "context_id": "deal:*",
      "limit_usd": 500.00,
      "action_on_exceed": "block"
    }
  ],
  "throttles": [
    {
      "context_id": "feature:lexchat",
      "requests_per_minute": 10,
      "delay_ms": 100
    }
  ]
}
```

| Document Type | Model Used | Rationale |
|--------------|------------|-----------|
| NDA, Employment Agreement | gpt-4o-mini | Standard boilerplate |
| IP Assignment, M&A Terms | gpt-4o | Complex legal reasoning required |
| Cover sheets, blank pages | Skipped | No inference cost |

**Budget Controls:**

| Scope | Limit | Action on Exceed |
|-------|-------|------------------|
| Per deal | $500 | Block new requests |
| LexChat per session | 50 queries | Show upgrade prompt |

### Results & Business Impact

- **42% Reduction in Inference Costs:** By routing boilerplate text to cheaper models, Lextract stopped "burning cash" on standard clauses. The expensive models are now reserved exclusively for complex legal reasoning.
- **Profitable "All-You-Can-Eat" Pricing:** With Aden's guardrails, Lextract could confidently offer flat-rate pricing to law firms, knowing that the "Noise Filtering" and "Routing" agents would protect them from abusive usage patterns.
- **Faster Processing Times:** The "Triage Agent" meant that 70% of documents were processed by lighter, faster models, reducing the "Time to First Insight" for lawyers by 3x.

### Conclusion

For Lextract.ai, Aden served as the bridge between technical capability and commercial viability. By making their software "cost-aware," they ensured that their AI could read every page of a merger agreement without reading their own bank account down to zero.
