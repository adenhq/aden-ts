# Advanced Features Plan: AI Cost ERP

This document outlines differentiated features that transform `openai-meter` from a simple metrics collector into a strategic AI Cost ERP system.

---

## 1. Pre-Request Cost Estimation

**Problem**: Organizations can't predict API costs before making requests. A single poorly-constructed prompt can burn through budgets unexpectedly.

**Solution**: Estimate costs BEFORE the request is sent, enabling proactive budget enforcement.

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Cost Estimator                           │
├─────────────────────────────────────────────────────────────┤
│  Input Tokens    │  tiktoken/approximation counting        │
│  Output Estimate │  Heuristics based on prompt type        │
│  Pricing Data    │  Model pricing lookup table             │
│  Confidence      │  Estimation confidence interval         │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Token Counter**
   - Use `tiktoken` for accurate GPT tokenization
   - Fallback to character-based approximation (4 chars ≈ 1 token)
   - Support for images (vision models) and tool definitions

2. **Pricing Database**
   - Maintained pricing table for all OpenAI models
   - Input vs output token pricing
   - Cached token discounts
   - Batch API pricing differentials

3. **Output Estimation Heuristics**
   - Classify prompt type (QA, generation, analysis, code)
   - Historical output ratios per model/prompt-type
   - `max_tokens` as upper bound

4. **Integration with `beforeRequest` Hook**
   ```typescript
   beforeRequest: async (params, ctx) => {
     const estimate = await estimateCost(params);
     if (estimate.maxCost > budget.remaining) {
       return { action: 'cancel', reason: 'Estimated cost exceeds budget' };
     }
     return { action: 'proceed' };
   }
   ```

### API Design

```typescript
interface CostEstimate {
  inputTokens: number;
  estimatedOutputTokens: { min: number; expected: number; max: number };
  cost: { min: number; expected: number; max: number };
  currency: 'USD';
  model: string;
  confidence: 'high' | 'medium' | 'low';
}

function estimateCost(params: RequestParams): CostEstimate;
```

---

## 2. Cost Optimization Engine

**Problem**: Developers pick models arbitrarily. They use GPT-4 for tasks where GPT-3.5 would suffice, or miss caching opportunities.

**Solution**: Real-time recommendations for cost reduction without quality loss.

### Optimization Strategies

```
┌─────────────────────────────────────────────────────────────┐
│              Optimization Recommendations                   │
├─────────────────────────────────────────────────────────────┤
│  Model Downgrade  │  "Consider gpt-4o-mini for this task"  │
│  Prompt Caching   │  "Enable caching - 73% content static" │
│  Batch Eligible   │  "This request qualifies for batch API"│
│  Token Reduction  │  "System prompt could be 40% shorter"  │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Model Suggestion Engine**
   - Analyze prompt complexity
   - Compare historical quality scores across models
   - Recommend cheapest model meeting quality threshold

2. **Prompt Cache Analysis**
   - Detect repeated system prompts
   - Calculate potential savings from caching
   - Suggest `prompt_cache_key` configuration

3. **Batch API Eligibility**
   - Identify non-time-sensitive requests
   - Calculate batch pricing savings (50% discount)
   - Queue management for batch operations

4. **Prompt Efficiency Scoring**
   - Analyze token waste (verbose instructions, redundancy)
   - Compare against optimized versions
   - Track prompt compression opportunities

### API Design

```typescript
interface OptimizationRecommendation {
  type: 'model_downgrade' | 'enable_caching' | 'use_batch' | 'reduce_tokens';
  description: string;
  estimatedSavings: number;
  confidence: number;
  implementation: string; // Code snippet or config change
}

interface OptimizationReport {
  currentCost: number;
  optimizedCost: number;
  savingsPercent: number;
  recommendations: OptimizationRecommendation[];
}

function analyzeOptimizations(history: MetricEvent[]): OptimizationReport;
```

---

## 3. Anomaly Detection with Root Cause Analysis

**Problem**: Cost spikes go unnoticed until the bill arrives. When detected, finding the root cause is manual and time-consuming.

**Solution**: Automatic anomaly detection with drill-down to specific requests/users/prompts.

### Detection Methods

```
┌─────────────────────────────────────────────────────────────┐
│                  Anomaly Detection                          │
├─────────────────────────────────────────────────────────────┤
│  Statistical     │  Z-score, IQR, moving averages          │
│  Pattern-based   │  Unusual model usage, time patterns     │
│  Threshold       │  Budget alerts, rate limit proximity    │
│  Behavioral      │  User/tenant deviation from baseline    │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Real-time Anomaly Scoring**
   - Per-request anomaly score (0-1)
   - Factors: cost, latency, token count, model choice
   - Rolling baseline per model/tenant/user

2. **Root Cause Drill-down**
   - Automatic attribution: which user/tenant/prompt caused spike
   - Diff against normal patterns
   - Timeline reconstruction

3. **Alert System**
   - Configurable thresholds
   - Webhook/callback integration
   - Severity levels (info, warning, critical)

4. **Pattern Recognition**
   - Detect retry storms
   - Identify runaway agents (infinite loops)
   - Spot prompt injection attempts (unusual output patterns)

### API Design

```typescript
interface Anomaly {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'critical';
  type: 'cost_spike' | 'volume_spike' | 'unusual_model' | 'retry_storm' | 'runaway_agent';
  description: string;
  affectedRequests: string[]; // request IDs
  rootCause: {
    dimension: 'user' | 'tenant' | 'model' | 'prompt' | 'time';
    value: string;
    contribution: number; // percentage
  };
  baseline: number;
  actual: number;
  deviation: number;
}

interface AnomalyDetector {
  ingest(event: MetricEvent): Anomaly | null;
  getAnomalies(timeRange: TimeRange): Anomaly[];
  configure(config: AnomalyConfig): void;
}
```

---

## 4. Model Router / Cascading

**Problem**: One-size-fits-all model selection. Either overpay for simple tasks or underperform on complex ones.

**Solution**: Intelligent routing that selects the optimal model based on task requirements, with quality-aware fallback chains.

### Routing Strategies

```
┌─────────────────────────────────────────────────────────────┐
│                    Model Router                             │
├─────────────────────────────────────────────────────────────┤
│  Complexity      │  Route by estimated task complexity     │
│  Cost Budget     │  Route by remaining budget              │
│  Quality Target  │  Route by required quality threshold    │
│  Fallback Chain  │  Cascade on failure/quality miss        │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Complexity Classifier**
   - Analyze prompt to estimate required capability
   - Categories: simple, moderate, complex, expert
   - Factors: instruction complexity, domain knowledge, reasoning depth

2. **Quality-Aware Routing**
   - Define quality requirements per use case
   - Route to cheapest model meeting threshold
   - A/B test model alternatives

3. **Cascading Fallback**
   - Start with cheap model
   - Evaluate response quality
   - Escalate to better model if quality insufficient
   - Track cascade patterns for optimization

4. **Cost-Quality Tradeoff Matrix**
   - Per-model quality scores (historical)
   - Cost efficiency: quality per dollar
   - Automatic rebalancing based on results

### API Design

```typescript
interface RoutingConfig {
  defaultModel: string;
  routes: RouteRule[];
  fallbackChain: string[]; // model cascade order
  qualityThreshold: number; // 0-1
}

interface RouteRule {
  condition: (params: RequestParams, context: RoutingContext) => boolean;
  model: string;
  priority: number;
}

interface RoutingDecision {
  selectedModel: string;
  reason: string;
  alternatives: { model: string; score: number }[];
  estimatedQuality: number;
  estimatedCost: number;
}

interface ModelRouter {
  route(params: RequestParams): RoutingDecision;
  recordOutcome(requestId: string, quality: number): void;
  getStats(): RoutingStats;
}
```

### Cascade Flow

```
Request → Complexity Analysis → Initial Model Selection
                                        │
                                        ▼
                              ┌─────────────────┐
                              │  gpt-4o-mini    │
                              │  (cheapest)     │
                              └────────┬────────┘
                                       │
                            Quality Check Failed?
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  gpt-4o         │
                              │  (balanced)     │
                              └────────┬────────┘
                                       │
                            Quality Check Failed?
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  gpt-4-turbo    │
                              │  (premium)      │
                              └─────────────────┘
```

---

## 5. Prompt Economics

**Problem**: Organizations don't know which prompts/features deliver ROI. Investment decisions are based on gut feeling.

**Solution**: Track ROI per prompt template, feature, and use case with business outcome correlation.

### Economic Metrics

```
┌─────────────────────────────────────────────────────────────┐
│                  Prompt Economics                           │
├─────────────────────────────────────────────────────────────┤
│  Cost per Call   │  Average cost for each prompt template  │
│  Success Rate    │  Task completion / quality scores       │
│  Business Value  │  Revenue/conversion attributed          │
│  ROI Score       │  (Value - Cost) / Cost                  │
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Prompt Template Registry**
   - Register named prompt templates
   - Track usage frequency and costs
   - Version history with cost comparison

2. **Business Outcome Tracking**
   - Link AI calls to business events
   - Attribute revenue/conversions
   - Calculate customer lifetime value contribution

3. **ROI Dashboard**
   - Cost vs value visualization
   - Identify high-ROI and negative-ROI prompts
   - Investment recommendations

4. **A/B Testing Framework**
   - Compare prompt variants
   - Statistical significance tracking
   - Auto-promote winners

### API Design

```typescript
interface PromptTemplate {
  id: string;
  name: string;
  version: string;
  systemPrompt?: string;
  category: string;
  expectedModel: string;
}

interface BusinessOutcome {
  requestId: string;
  outcomeType: 'conversion' | 'revenue' | 'engagement' | 'custom';
  value: number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

interface PromptEconomics {
  templateId: string;
  totalCost: number;
  totalValue: number;
  callCount: number;
  avgCostPerCall: number;
  successRate: number;
  roi: number; // (value - cost) / cost
  trend: 'improving' | 'stable' | 'declining';
}

interface EconomicsEngine {
  registerTemplate(template: PromptTemplate): void;
  trackOutcome(outcome: BusinessOutcome): void;
  getEconomics(templateId?: string): PromptEconomics[];
  getRecommendations(): EconomicsRecommendation[];
}
```

---

## Implementation Priority

| Feature | Complexity | Value | Priority |
|---------|------------|-------|----------|
| Pre-Request Cost Estimation | Medium | High | 1 |
| Model Router / Cascading | High | Very High | 2 |
| Anomaly Detection | High | High | 3 |
| Cost Optimization Engine | Medium | High | 4 |
| Prompt Economics | Medium | Medium | 5 |

### Recommended Build Order

1. **Phase 1: Foundation**
   - Cost Estimator (pricing data, token counting)
   - Basic Model Router (rule-based routing)

2. **Phase 2: Intelligence**
   - Cascading with quality evaluation
   - Anomaly detection (statistical methods)

3. **Phase 3: Optimization**
   - Cost Optimization recommendations
   - Prompt caching analysis

4. **Phase 4: Business Intelligence**
   - Prompt Economics tracking
   - ROI dashboards

---

## Integration Architecture

```
                    ┌─────────────────────────────┐
                    │      Application Code       │
                    └─────────────┬───────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                       openai-meter                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │Cost Estimator│  │ Model Router │  │ Anomaly Detector     │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 beforeRequest Hook                       │   │
│  │  • Estimate cost → enforce budget                        │   │
│  │  • Select model → modify params                          │   │
│  │  • Check anomaly score → alert/block                     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    OpenAI API Call                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   emitMetric Hook                        │   │
│  │  • Update cost actuals                                   │   │
│  │  • Feed anomaly detector                                 │   │
│  │  • Track prompt economics                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│         ┌────────────────────┼────────────────────┐            │
│         ▼                    ▼                    ▼            │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐       │
│  │Optimization│      │  Analytics │      │  Economics │       │
│  │  Engine    │      │   Engine   │      │   Engine   │       │
│  └────────────┘      └────────────┘      └────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Competitive Differentiation

| Feature | Typical Solutions | Our Approach |
|---------|-------------------|--------------|
| Cost Tracking | Post-hoc reporting | Pre-request estimation + enforcement |
| Model Selection | Manual/static | Intelligent routing with quality feedback |
| Anomaly Detection | Threshold alerts | Root cause analysis + pattern recognition |
| Optimization | Generic tips | Actionable, quantified recommendations |
| ROI Tracking | None | Business outcome attribution |

**Key Differentiator**: We intercept BEFORE the request, not just log AFTER. This enables prevention, not just reporting.

---

## 6. Policy Engine (Control Layer)

**Problem**: Analytics and detection are passive. Real ERP systems need active control - the ability to enforce policies, take automated actions, and provide human override capabilities.

**Solution**: A declarative policy engine that reacts to events and executes control actions.

### Control Philosophy

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ERP Control Spectrum                        │
├─────────────────────────────────────────────────────────────────────┤
│  OBSERVE          │  ALERT           │  ENFORCE         │  COMMAND │
│  (Analytics)      │  (Notifications) │  (Auto-actions)  │  (Human) │
│                   │                  │                  │          │
│  • Dashboards     │  • Webhooks      │  • Auto-block    │  • CLI   │
│  • Reports        │  • Slack/Email   │  • Auto-throttle │  • API   │
│  • Trends         │  • PagerDuty     │  • Auto-route    │  • UI    │
└─────────────────────────────────────────────────────────────────────┘
```

### Policy Definition Language

```typescript
// Declarative policies that trigger actions
interface Policy {
  id: string;
  name: string;
  description: string;
  enabled: boolean;

  // When to trigger
  trigger: PolicyTrigger;

  // What to do
  actions: PolicyAction[];

  // Escalation chain
  escalation?: EscalationConfig;
}

type PolicyTrigger =
  | { type: 'cost_threshold'; amount: number; window: Duration }
  | { type: 'request_rate'; count: number; window: Duration }
  | { type: 'error_rate'; percent: number; window: Duration }
  | { type: 'anomaly_detected'; severity: 'warning' | 'critical' }
  | { type: 'budget_percent'; percent: number; scope: 'tenant' | 'user' | 'global' }
  | { type: 'model_usage'; model: string; action: 'used' | 'exceeded_quota' }
  | { type: 'latency_threshold'; p95_ms: number }
  | { type: 'custom'; evaluator: (event: MetricEvent) => boolean };

type PolicyAction =
  | { type: 'block'; duration?: Duration; message?: string }
  | { type: 'throttle'; delayMs: number; duration?: Duration }
  | { type: 'downgrade_model'; to: string }
  | { type: 'route_to_queue'; queue: 'batch' | 'low_priority' }
  | { type: 'notify'; channels: NotificationChannel[] }
  | { type: 'webhook'; url: string; payload?: object }
  | { type: 'log'; level: 'info' | 'warn' | 'error' }
  | { type: 'custom'; handler: (context: PolicyContext) => Promise<void> };

interface EscalationConfig {
  levels: EscalationLevel[];
  cooldown: Duration; // Time before re-escalating
}

interface EscalationLevel {
  after: Duration;
  actions: PolicyAction[];
}
```

### Example Policies

```typescript
const policies: Policy[] = [
  // Auto-throttle when approaching budget
  {
    id: 'budget-warning',
    name: 'Budget Warning Throttle',
    description: 'Slow down requests when 80% of budget consumed',
    enabled: true,
    trigger: { type: 'budget_percent', percent: 80, scope: 'tenant' },
    actions: [
      { type: 'throttle', delayMs: 2000 },
      { type: 'notify', channels: ['slack', 'email'] }
    ]
  },

  // Hard block at budget limit
  {
    id: 'budget-exceeded',
    name: 'Budget Exceeded Block',
    description: 'Block all requests when budget exhausted',
    enabled: true,
    trigger: { type: 'budget_percent', percent: 100, scope: 'tenant' },
    actions: [
      { type: 'block', message: 'Monthly budget exhausted. Contact admin.' },
      { type: 'notify', channels: ['pagerduty'] }
    ],
    escalation: {
      levels: [
        { after: '1h', actions: [{ type: 'notify', channels: ['executive-email'] }] }
      ],
      cooldown: '24h'
    }
  },

  // Auto-downgrade expensive models during cost spikes
  {
    id: 'cost-spike-downgrade',
    name: 'Cost Spike Model Downgrade',
    description: 'Switch to cheaper model during anomalous spending',
    enabled: true,
    trigger: { type: 'anomaly_detected', severity: 'warning' },
    actions: [
      { type: 'downgrade_model', to: 'gpt-4o-mini' },
      { type: 'log', level: 'warn' }
    ]
  },

  // Runaway agent protection
  {
    id: 'runaway-protection',
    name: 'Runaway Agent Circuit Breaker',
    description: 'Kill agents making too many requests',
    enabled: true,
    trigger: { type: 'request_rate', count: 100, window: '1m' },
    actions: [
      { type: 'block', duration: '5m', message: 'Circuit breaker triggered' },
      { type: 'webhook', url: 'https://ops.example.com/incident' }
    ]
  }
];
```

### Policy Engine API

```typescript
interface PolicyEngine {
  // Policy management
  registerPolicy(policy: Policy): void;
  updatePolicy(id: string, updates: Partial<Policy>): void;
  enablePolicy(id: string): void;
  disablePolicy(id: string): void;
  removePolicy(id: string): void;

  // Evaluation
  evaluate(event: MetricEvent): PolicyDecision[];

  // Runtime state
  getActiveBlocks(): BlockState[];
  getActiveThrottles(): ThrottleState[];
  clearBlock(scope: string): void;
  clearThrottle(scope: string): void;

  // Audit
  getExecutionHistory(filter?: HistoryFilter): PolicyExecution[];
}

interface PolicyDecision {
  policyId: string;
  triggered: boolean;
  actions: PolicyAction[];
  context: PolicyContext;
}

interface PolicyContext {
  event: MetricEvent;
  tenant?: string;
  user?: string;
  currentBudget?: BudgetState;
  anomalyScore?: number;
  recentHistory: MetricEvent[];
}
```

---

## 7. Command Interface (Human Control)

**Problem**: Automated policies aren't enough. Operators need ability to take manual action - override policies, adjust budgets in real-time, investigate issues.

**Solution**: A command interface for human operators to control the system.

### Command Categories

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Command Categories                             │
├─────────────────────────────────────────────────────────────────────┤
│  BUDGET           │  POLICY          │  TENANT          │  DEBUG   │
│                   │                  │                  │          │
│  • set-budget     │  • enable        │  • block         │  • trace │
│  • adjust-budget  │  • disable       │  • unblock       │  • tail  │
│  • transfer       │  • override      │  • throttle      │  • replay│
│  • freeze         │  • simulate      │  • set-tier      │  • dump  │
└─────────────────────────────────────────────────────────────────────┘
```

### Command API

```typescript
interface CommandInterface {
  // Budget commands
  setBudget(scope: Scope, amount: number, period: 'daily' | 'monthly'): void;
  adjustBudget(scope: Scope, delta: number, reason: string): void;
  transferBudget(from: Scope, to: Scope, amount: number): void;
  freezeBudget(scope: Scope, until?: Date): void;
  unfreezeBudget(scope: Scope): void;

  // Policy commands
  enablePolicy(policyId: string): void;
  disablePolicy(policyId: string): void;
  overridePolicy(policyId: string, duration: Duration, reason: string): void;
  simulatePolicy(policy: Policy, events: MetricEvent[]): SimulationResult;

  // Tenant/User commands
  blockEntity(type: 'tenant' | 'user', id: string, reason: string, duration?: Duration): void;
  unblockEntity(type: 'tenant' | 'user', id: string): void;
  throttleEntity(type: 'tenant' | 'user', id: string, delayMs: number, duration?: Duration): void;
  setTier(tenantId: string, tier: string): void;
  setQuota(scope: Scope, quota: QuotaConfig): void;

  // Debug commands
  traceRequest(requestId: string): RequestTrace;
  tailEvents(filter: EventFilter, callback: (event: MetricEvent) => void): Subscription;
  replayEvents(timeRange: TimeRange, speed?: number): void;
  dumpState(): SystemState;

  // All commands are audited
  getCommandHistory(filter?: CommandFilter): CommandExecution[];
}

interface Scope {
  type: 'global' | 'tenant' | 'user' | 'model' | 'prompt_template';
  id?: string;
}

interface CommandExecution {
  id: string;
  command: string;
  params: Record<string, unknown>;
  executedBy: string;
  executedAt: Date;
  result: 'success' | 'failed';
  error?: string;
}
```

### CLI Examples

```bash
# Budget management
$ ai-meter budget set --tenant acme-corp --amount 500 --period monthly
$ ai-meter budget adjust --tenant acme-corp --delta +100 --reason "Q4 project"
$ ai-meter budget freeze --tenant suspicious-tenant --until 2024-01-15

# Policy control
$ ai-meter policy disable budget-exceeded --duration 1h --reason "scheduled maintenance"
$ ai-meter policy simulate cost-spike-downgrade --file events.json

# Tenant control
$ ai-meter tenant block bad-actor --reason "abuse detected" --duration 24h
$ ai-meter tenant throttle heavy-user --delay 5000 --duration 1h
$ ai-meter tenant set-tier startup-xyz --tier enterprise

# Debugging
$ ai-meter trace req_abc123
$ ai-meter tail --tenant acme-corp --model gpt-4
$ ai-meter replay --from "2024-01-10 14:00" --to "2024-01-10 15:00" --speed 10x
```

### Programmatic Control API

```typescript
// For integration into admin dashboards, chatbots, etc.
import { createControlClient } from 'openai-meter/control';

const control = createControlClient({
  apiKey: process.env.METER_ADMIN_KEY,
});

// React to Slack command
app.command('/ai-budget', async ({ command, ack, respond }) => {
  await ack();

  const [action, tenant, amount] = command.text.split(' ');

  if (action === 'add') {
    await control.adjustBudget(
      { type: 'tenant', id: tenant },
      parseFloat(amount),
      `Slack request by ${command.user_name}`
    );
    await respond(`Added $${amount} to ${tenant}'s budget`);
  }
});

// Automated incident response
anomalyDetector.on('critical', async (anomaly) => {
  // Auto-throttle affected tenant
  await control.throttleEntity('tenant', anomaly.rootCause.value, 5000, '30m');

  // Notify on-call
  await pagerduty.createIncident({
    title: `AI Cost Anomaly: ${anomaly.description}`,
    details: anomaly,
  });
});
```

---

## 8. Approval Workflows

**Problem**: Some actions (large budget increases, unblocking, tier changes) should require approval rather than immediate execution.

**Solution**: Workflow engine for multi-step approval processes.

### Workflow Types

```typescript
interface ApprovalWorkflow {
  id: string;
  name: string;
  description: string;

  // What triggers this workflow
  triggerOn: WorkflowTrigger[];

  // Approval requirements
  approvals: ApprovalRequirement[];

  // What happens after approval
  onApproved: PolicyAction[];

  // What happens if denied
  onDenied?: PolicyAction[];

  // Auto-expire
  expiresAfter?: Duration;
}

type WorkflowTrigger =
  | { type: 'budget_request'; minAmount: number }
  | { type: 'tier_upgrade' }
  | { type: 'unblock_request' }
  | { type: 'policy_override'; policyIds: string[] }
  | { type: 'manual' };

interface ApprovalRequirement {
  role: 'manager' | 'finance' | 'admin' | 'security';
  count: number; // Number of approvals needed from this role
  timeout?: Duration;
}

interface PendingApproval {
  id: string;
  workflowId: string;
  requestedBy: string;
  requestedAt: Date;
  request: ApprovalRequest;
  approvals: Approval[];
  status: 'pending' | 'approved' | 'denied' | 'expired';
}
```

### Workflow Examples

```typescript
const workflows: ApprovalWorkflow[] = [
  // Large budget increases need finance approval
  {
    id: 'large-budget-increase',
    name: 'Large Budget Increase',
    description: 'Budget increases over $1000 require finance approval',
    triggerOn: [{ type: 'budget_request', minAmount: 1000 }],
    approvals: [
      { role: 'finance', count: 1 }
    ],
    onApproved: [
      { type: 'custom', handler: async (ctx) => {
        await ctx.control.adjustBudget(ctx.request.scope, ctx.request.amount, 'Approved');
      }}
    ],
    expiresAfter: '48h'
  },

  // Unblocking requires security review
  {
    id: 'unblock-review',
    name: 'Unblock Request Review',
    description: 'Unblocking a tenant requires security approval',
    triggerOn: [{ type: 'unblock_request' }],
    approvals: [
      { role: 'security', count: 1 },
      { role: 'manager', count: 1 }
    ],
    onApproved: [
      { type: 'custom', handler: async (ctx) => {
        await ctx.control.unblockEntity('tenant', ctx.request.tenantId);
      }},
      { type: 'notify', channels: ['audit-log'] }
    ],
    onDenied: [
      { type: 'notify', channels: ['requester'] }
    ]
  },

  // Enterprise tier upgrade needs sales + finance
  {
    id: 'enterprise-upgrade',
    name: 'Enterprise Tier Upgrade',
    description: 'Upgrading to enterprise tier requires multiple approvals',
    triggerOn: [{ type: 'tier_upgrade' }],
    approvals: [
      { role: 'sales', count: 1 },
      { role: 'finance', count: 1 }
    ],
    onApproved: [
      { type: 'custom', handler: async (ctx) => {
        await ctx.control.setTier(ctx.request.tenantId, 'enterprise');
        await ctx.control.setBudget(
          { type: 'tenant', id: ctx.request.tenantId },
          10000,
          'monthly'
        );
      }}
    ]
  }
];
```

### Approval Interface

```typescript
interface ApprovalEngine {
  // Submit requests
  requestApproval(workflow: string, request: ApprovalRequest): Promise<PendingApproval>;

  // Approve/deny
  approve(approvalId: string, approver: string, comment?: string): Promise<void>;
  deny(approvalId: string, approver: string, reason: string): Promise<void>;

  // Query
  getPending(filter?: ApprovalFilter): PendingApproval[];
  getHistory(filter?: ApprovalFilter): PendingApproval[];

  // Notifications
  onPendingApproval(callback: (approval: PendingApproval) => void): void;
}
```

---

## Updated Integration Architecture

```
                                    ┌───────────────────────┐
                                    │    Admin Dashboard    │
                                    │    (Human Control)    │
                                    └───────────┬───────────┘
                                                │
                    ┌───────────────────────────┼───────────────────────────┐
                    │                           │                           │
                    ▼                           ▼                           ▼
           ┌────────────────┐         ┌────────────────┐         ┌────────────────┐
           │  Command API   │         │ Approval Engine │        │   Policy API   │
           └───────┬────────┘         └───────┬────────┘         └───────┬────────┘
                   │                          │                          │
                   └──────────────────────────┼──────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   Control Plane                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│  │  Policy Engine  │  │  Budget Manager │  │ Tenant Registry │  │ Audit Logger  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └───────┬───────┘  │
│           │                    │                    │                   │          │
│           └────────────────────┴────────────────────┴───────────────────┘          │
│                                         │                                           │
└─────────────────────────────────────────┼───────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                   Data Plane                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │Cost Estimator│  │ Model Router │  │ Anomaly Detector     │  │ Prompt Registry│  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  └───────┬────────┘  │
│         │                 │                      │                      │           │
│         ▼                 ▼                      ▼                      ▼           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                          beforeRequest Hook                                  │   │
│  │  • Check policies → block/throttle/proceed                                   │   │
│  │  • Estimate cost → enforce budget                                            │   │
│  │  • Select model → modify params                                              │   │
│  │  • Check anomaly score → alert/block                                         │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                            │
│                                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                            OpenAI API Call                                   │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                            │
│                                        ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │                            emitMetric Hook                                   │   │
│  │  • Update budget actuals                                                     │   │
│  │  • Feed anomaly detector                                                     │   │
│  │  • Evaluate policies                                                         │   │
│  │  • Trigger actions                                                           │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────┐
                              │  Notification System  │
                              │  (Slack/Email/PD/WH)  │
                              └───────────────────────┘
```

---

## 9. Performance & Minimal Overhead

**Problem**: Metering adds overhead to every API call. In high-throughput systems, even small inefficiencies compound. Users need confidence that the metering layer doesn't degrade their application performance.

**Solution**: Design for near-zero overhead with configurable performance modes, async-first patterns, and escape hatches.

### Overhead Analysis

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Overhead vs API Latency                               │
├─────────────────────────────────────────────────────────────────────────┤
│  OpenAI API Call    │  500ms - 10,000ms (500-10000ms)                   │
│  Metering Overhead  │  10µs - 50µs (0.01-0.05ms)                        │
│  Relative Overhead  │  0.0001% - 0.01%                                  │
│  Verdict            │  Negligible                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Overhead Sources & Mitigations

| Source | Overhead | Mitigation |
|--------|----------|------------|
| UUID generation | ~1-2µs | UUID pool / lazy generation |
| Timestamp | ~0.1µs | Batch timestamps |
| Object allocation | ~5-10µs | Object pooling / reuse |
| Async callbacks | ~10-20µs | Fire-and-forget pattern |
| Token counting | ~100-500µs | Lazy / on-demand only |

### Performance Strategies

#### 1. Fire-and-Forget Metric Emission

Don't await metric transmission on the hot path:

```typescript
// Fast path: fire-and-forget (default)
if (meterOptions.asyncEmit !== false) {
  Promise.resolve(meterOptions.emitMetric(event)).catch(err => {
    // Log but don't block
    console.error('[openai-meter] emit error:', err);
  });
} else {
  // Slow path: await for guaranteed delivery
  await meterOptions.emitMetric(event);
}
```

#### 2. Object Pooling & Reuse

Reduce GC pressure by reusing metric event objects:

```typescript
class MetricEventPool {
  private pool: MetricEvent[] = [];
  private maxSize = 1000;

  acquire(): MetricEvent {
    return this.pool.pop() || this.createEmpty();
  }

  release(event: MetricEvent): void {
    if (this.pool.length < this.maxSize) {
      this.reset(event);
      this.pool.push(event);
    }
  }

  private reset(event: MetricEvent): void {
    // Clear all fields for reuse
    event.id = '';
    event.timestamp = 0;
    // ... reset other fields
  }
}
```

#### 3. Lazy Context Building

Only compute expensive fields when actually needed:

```typescript
interface LazyMetricEvent {
  // Always computed (cheap)
  id: string;
  timestamp: number;
  model: string;

  // Lazily computed (expensive)
  get inputTokens(): number;  // Computed on first access
  get estimatedCost(): number;
}

// Implementation
const lazyEvent = {
  _inputTokens: null as number | null,
  get inputTokens() {
    if (this._inputTokens === null) {
      this._inputTokens = countTokens(this.input); // Expensive
    }
    return this._inputTokens;
  }
};
```

#### 4. Conditional Metering (Escape Hatch)

Skip metering entirely for specific requests:

```typescript
interface MeterOptions {
  // Skip metering if this returns false
  shouldMeter?: (params: RequestParams) => boolean;
}

// Usage: skip internal health checks
const client = meter(openai, {
  shouldMeter: (params) => {
    // Don't meter internal/health check requests
    if (params.messages?.[0]?.content === 'ping') return false;
    return true;
  }
});
```

#### 5. Performance Modes

Configurable presets for different use cases:

```typescript
type PerformanceMode = 'minimal' | 'standard' | 'strict';

interface MeterOptions {
  performanceMode?: PerformanceMode;
}

const PERFORMANCE_PRESETS = {
  minimal: {
    // Maximum performance, minimum features
    asyncEmit: true,
    skipTokenCounting: true,
    skipCostEstimation: true,
    sampleRate: 0.1, // Only meter 10% of requests
    batchEmit: true,
    batchSize: 100,
    batchFlushMs: 5000,
  },
  standard: {
    // Balanced (default)
    asyncEmit: true,
    skipTokenCounting: false,
    skipCostEstimation: false,
    sampleRate: 1.0,
    batchEmit: true,
    batchSize: 50,
    batchFlushMs: 1000,
  },
  strict: {
    // Maximum accuracy, some overhead
    asyncEmit: false, // Await emit completion
    skipTokenCounting: false,
    skipCostEstimation: false,
    sampleRate: 1.0,
    batchEmit: false, // Emit immediately
  }
};
```

#### 6. Streaming Optimization

Efficient streaming that doesn't buffer entire responses:

```typescript
// Bad: Buffering entire stream
const chunks: string[] = [];
for await (const chunk of stream) {
  chunks.push(chunk); // Memory grows unbounded
  yield chunk;
}
const fullText = chunks.join(''); // Another allocation

// Good: Incremental metrics
let tokenCount = 0;
for await (const chunk of stream) {
  tokenCount += estimateChunkTokens(chunk); // Incremental
  yield chunk;
}
// No full-response buffering needed for metrics
```

### Performance Mode Selection Guide

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Choosing a Performance Mode                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Use MINIMAL when:                                                       │
│    • High-throughput batch processing                                    │
│    • Cost tracking is nice-to-have, not critical                        │
│    • Running in resource-constrained environments                        │
│                                                                          │
│  Use STANDARD when:                                                      │
│    • Normal production workloads                                         │
│    • Need reliable cost tracking                                         │
│    • Want anomaly detection to work                                      │
│                                                                          │
│  Use STRICT when:                                                        │
│    • Financial auditing requirements                                     │
│    • Every request must be tracked                                       │
│    • Debugging metric delivery issues                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### API Design

```typescript
interface MeterOptions {
  // Performance tuning
  performanceMode?: 'minimal' | 'standard' | 'strict';
  asyncEmit?: boolean;
  sampleRate?: number; // 0.0-1.0, percentage of requests to meter
  shouldMeter?: (params: RequestParams) => boolean;

  // Batching
  batchEmit?: boolean;
  batchSize?: number;
  batchFlushMs?: number;

  // Feature flags
  skipTokenCounting?: boolean;
  skipCostEstimation?: boolean;
}
```

---

## 10. Data Transmission & Ingestion

**Problem**: Collected metrics need to reach the server reliably without blocking the application. Network issues, server downtime, and high volumes require robust handling.

**Solution**: Multi-layered transmission strategy with batching, compression, offline queuing, and multiple transport options.

### Transmission Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SDK (Client-side)                                │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌────────────┐  │
│  │   Meter     │ → │  Collector  │ → │   Batcher   │ → │ Transmitter│  │
│  │  (hot path) │   │  (in-memory)│   │  (compress) │   │  (async)   │  │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────┬──────┘  │
│                                                              │         │
│                    ┌─────────────────────────────────────────┤         │
│                    │                                         │         │
│                    ▼                                         ▼         │
│            ┌──────────────┐                          ┌──────────────┐  │
│            │ Offline Queue│                          │   Transport  │  │
│            │ (IndexedDB/  │                          │  (HTTP/WS/   │  │
│            │  file/memory)│                          │   gRPC)      │  │
│            └──────────────┘                          └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │         Network Layer          │
                    │  • Retry with backoff          │
                    │  • Circuit breaker             │
                    │  • Compression (gzip/brotli)   │
                    └───────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Server (Ingestion)                               │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌────────────┐  │
│  │  API Gateway│ → │  Validator  │ → │   Queue     │ → │  Processor │  │
│  │  (auth/rate)│   │  (schema)   │   │ (Kafka/SQS) │   │  (workers) │  │
│  └─────────────┘   └─────────────┘   └─────────────┘   └─────┬──────┘  │
│                                                              │         │
│                                                              ▼         │
│                                                      ┌──────────────┐  │
│                                                      │   Storage    │  │
│                                                      │ (TimeSeries/ │  │
│                                                      │  OLAP DB)    │  │
│                                                      └──────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Client-Side Strategies

#### 1. Batching

Group multiple events before transmission:

```typescript
interface BatchConfig {
  maxSize: number;      // Max events per batch (e.g., 100)
  maxWaitMs: number;    // Max time before flush (e.g., 5000ms)
  maxBytes: number;     // Max payload size (e.g., 1MB)
}

class EventBatcher {
  private batch: MetricEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  add(event: MetricEvent): void {
    this.batch.push(event);

    if (this.batch.length >= this.config.maxSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.config.maxWaitMs);
    }
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const toSend = this.batch;
    this.batch = [];

    await this.transmitter.send(toSend);
  }
}
```

#### 2. Compression

Reduce bandwidth with payload compression:

```typescript
interface TransmissionConfig {
  compression: 'none' | 'gzip' | 'brotli';
  compressionThreshold: number; // Min bytes to compress (e.g., 1024)
}

async function compress(payload: string, config: TransmissionConfig): Promise<Buffer> {
  const bytes = Buffer.from(payload);

  if (bytes.length < config.compressionThreshold) {
    return bytes; // Not worth compressing
  }

  switch (config.compression) {
    case 'gzip':
      return gzip(bytes);
    case 'brotli':
      return brotliCompress(bytes);
    default:
      return bytes;
  }
}

// Typical compression ratios for JSON metrics:
// gzip: 70-80% reduction
// brotli: 75-85% reduction
```

#### 3. Offline Queue (Resilience)

Store events locally when network is unavailable:

```typescript
interface OfflineQueue {
  // Store events when offline
  enqueue(events: MetricEvent[]): Promise<void>;

  // Retrieve stored events
  dequeue(limit: number): Promise<MetricEvent[]>;

  // Check queue status
  size(): Promise<number>;

  // Clear after successful transmission
  acknowledge(eventIds: string[]): Promise<void>;
}

// Implementation options by environment:
const createOfflineQueue = (env: 'browser' | 'node'): OfflineQueue => {
  if (env === 'browser') {
    return new IndexedDBQueue('openai-meter-queue');
  } else {
    return new FileQueue('/tmp/openai-meter-queue');
  }
};

// Automatic retry with backoff
class ResilientTransmitter {
  private queue: OfflineQueue;
  private online = true;

  async send(events: MetricEvent[]): Promise<void> {
    if (!this.online) {
      await this.queue.enqueue(events);
      return;
    }

    try {
      await this.transmit(events);
      await this.drainQueue(); // Try to send queued events
    } catch (error) {
      if (this.isNetworkError(error)) {
        this.online = false;
        await this.queue.enqueue(events);
        this.scheduleRetry();
      } else {
        throw error;
      }
    }
  }
}
```

#### 4. Transport Options

Multiple protocols for different needs:

```typescript
type TransportType = 'http' | 'websocket' | 'grpc' | 'custom';

interface TransportConfig {
  type: TransportType;

  // HTTP-specific
  endpoint?: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;

  // WebSocket-specific
  wsUrl?: string;
  reconnectIntervalMs?: number;

  // gRPC-specific
  grpcHost?: string;
  grpcPort?: number;

  // Custom transport
  customTransport?: (events: MetricEvent[]) => Promise<void>;
}

// HTTP (default, simplest)
const httpConfig: TransportConfig = {
  type: 'http',
  endpoint: 'https://api.yourerp.com/v1/ingest',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ${API_KEY}',
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  }
};

// WebSocket (persistent connection, lower latency)
const wsConfig: TransportConfig = {
  type: 'websocket',
  wsUrl: 'wss://stream.yourerp.com/v1/ingest',
  reconnectIntervalMs: 5000,
};

// Custom (for special requirements)
const customConfig: TransportConfig = {
  type: 'custom',
  customTransport: async (events) => {
    // Send to multiple destinations
    await Promise.all([
      sendToDatadog(events),
      sendToCustomBackend(events),
    ]);
  }
};
```

### Server-Side Ingestion

#### 1. API Gateway

```typescript
// Express example
app.post('/v1/ingest',
  authenticate,
  rateLimit({ windowMs: 60000, max: 1000 }),
  decompress,
  validateSchema,
  async (req, res) => {
    const events: MetricEvent[] = req.body;

    // Quick acknowledgment, async processing
    await queue.publish('metrics', events);

    res.status(202).json({ accepted: events.length });
  }
);
```

#### 2. Schema Validation

```typescript
const MetricEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  type: z.enum(['request', 'response', 'error', 'stream_chunk']),
  model: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cost: z.number().optional(),
  latencyMs: z.number().optional(),
  tenantId: z.string().optional(),
  userId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Batch validation with partial acceptance
function validateBatch(events: unknown[]): {
  valid: MetricEvent[];
  invalid: { index: number; error: string }[];
} {
  const valid: MetricEvent[] = [];
  const invalid: { index: number; error: string }[] = [];

  events.forEach((event, index) => {
    const result = MetricEventSchema.safeParse(event);
    if (result.success) {
      valid.push(result.data);
    } else {
      invalid.push({ index, error: result.error.message });
    }
  });

  return { valid, invalid };
}
```

#### 3. Processing Pipeline

```typescript
// Kafka consumer example
const consumer = kafka.consumer({ groupId: 'metrics-processor' });

await consumer.subscribe({ topic: 'metrics' });

await consumer.run({
  eachBatch: async ({ batch }) => {
    const events = batch.messages.map(m => JSON.parse(m.value));

    // Parallel processing
    await Promise.all([
      // Store raw events
      timescaleDB.insert('raw_metrics', events),

      // Update aggregations
      updateHourlyAggregations(events),

      // Feed real-time systems
      anomalyDetector.ingest(events),
      budgetTracker.update(events),

      // Trigger policies
      policyEngine.evaluate(events),
    ]);
  }
});
```

### Transmission Configuration

```typescript
interface DataTransmissionConfig {
  // Endpoint
  endpoint: string;
  apiKey: string;

  // Batching
  batch: {
    maxSize: number;       // Default: 100
    maxWaitMs: number;     // Default: 5000
    maxBytes: number;      // Default: 1MB
  };

  // Compression
  compression: 'none' | 'gzip' | 'brotli'; // Default: 'gzip'

  // Resilience
  retry: {
    maxAttempts: number;   // Default: 3
    baseDelayMs: number;   // Default: 1000
    maxDelayMs: number;    // Default: 30000
  };

  // Offline support
  offline: {
    enabled: boolean;      // Default: true
    maxQueueSize: number;  // Default: 10000 events
    storage: 'memory' | 'indexeddb' | 'file';
  };

  // Transport
  transport: 'http' | 'websocket' | 'grpc';
}

// Default configuration
const defaultConfig: DataTransmissionConfig = {
  endpoint: 'https://api.yourerp.com/v1/ingest',
  apiKey: process.env.ERP_API_KEY!,
  batch: {
    maxSize: 100,
    maxWaitMs: 5000,
    maxBytes: 1024 * 1024,
  },
  compression: 'gzip',
  retry: {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  },
  offline: {
    enabled: true,
    maxQueueSize: 10000,
    storage: 'memory',
  },
  transport: 'http',
};
```

### Security Considerations

```typescript
// API Key rotation support
interface AuthConfig {
  apiKey: string;
  rotateKey?: () => Promise<string>; // For automatic rotation
}

// Data privacy
interface PrivacyConfig {
  // Strip sensitive data before transmission
  redact?: {
    promptContent?: boolean;  // Remove actual prompts
    userIdentifiers?: boolean; // Hash user IDs
    ipAddresses?: boolean;
  };

  // Data residency
  region?: 'us' | 'eu' | 'ap';
}

// Encryption in transit is required (HTTPS/TLS)
// Optional: additional payload encryption for sensitive environments
interface EncryptionConfig {
  encryptPayload?: boolean;
  publicKey?: string; // For asymmetric encryption
}
```

### Monitoring the Transmission Layer

```typescript
interface TransmissionMetrics {
  // Throughput
  eventsQueued: number;
  eventsSent: number;
  batchesSent: number;

  // Latency
  avgTransmitMs: number;
  p99TransmitMs: number;

  // Reliability
  failedAttempts: number;
  retriesTotal: number;
  offlineQueueSize: number;

  // Efficiency
  bytesBeforeCompression: number;
  bytesAfterCompression: number;
  compressionRatio: number;
}

// Expose metrics for monitoring
meter.getTransmissionMetrics(): TransmissionMetrics;
```

---

## Updated Implementation Priority

| Feature | Complexity | Value | Priority |
|---------|------------|-------|----------|
| Pre-Request Cost Estimation | Medium | High | 1 |
| **Policy Engine** | High | **Very High** | **2** |
| **Data Transmission & Ingestion** | Medium | **Very High** | **3** |
| Model Router / Cascading | High | Very High | 4 |
| **Command Interface** | Medium | **High** | **5** |
| **Performance & Minimal Overhead** | Low | **High** | **6** |
| Anomaly Detection | High | High | 7 |
| **Approval Workflows** | Medium | **Medium** | **8** |
| Cost Optimization Engine | Medium | High | 9 |
| Prompt Economics | Medium | Medium | 10 |

### Updated Build Order

1. **Phase 1: Foundation + Control + Transmission**
   - Cost Estimator (pricing data, token counting)
   - Data Transmission layer (batching, compression, transport)
   - Policy Engine (declarative policies, auto-actions)
   - Basic Command Interface (budget, block/unblock)
   - Performance optimizations (fire-and-forget, async emit)

2. **Phase 2: Intelligence + Routing**
   - Model Router with quality evaluation
   - Anomaly detection feeding into policies

3. **Phase 3: Human Workflows**
   - Approval workflows for sensitive actions
   - Admin dashboard integration
   - Audit logging

4. **Phase 4: Optimization + Economics**
   - Cost Optimization recommendations
   - Prompt Economics tracking
   - ROI dashboards

---

## The ERP Value Proposition

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AI Cost ERP: Complete Control                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   PLAN          →    EXECUTE       →    MONITOR      →    CONTROL      │
│                                                                         │
│   • Budgets          • Route           • Track            • Policies   │
│   • Quotas           • Estimate        • Detect           • Commands   │
│   • Forecasts        • Optimize        • Alert            • Approvals  │
│                                                                         │
│   ─────────────────────────────────────────────────────────────────    │
│                                                                         │
│   "Not just watching AI spend —                                        │
│    actively controlling it."                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```
