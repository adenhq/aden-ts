/**
 * JSON Schema types for comprehensive analytics reporting
 */

/**
 * Individual request/event within a pattern
 */
export interface PatternEvent {
  id: string;
  timestamp: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  reasoning_tokens: number;
  cost: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Multi-turn conversation pattern
 */
export interface ConversationPattern {
  type: "conversation";
  conversation_id: string;
  user_id?: string;
  started_at: string;
  ended_at?: string;
  turns: Array<{
    turn_number: number;
    role: "user" | "assistant";
    event: PatternEvent;
    context_tokens: number;
    context_utilization: number; // percentage of context window used
    cumulative_cost: number;
    cache_efficiency: number; // percentage of input from cache
  }>;
  summary: {
    total_turns: number;
    total_tokens: number;
    total_cost: number;
    avg_latency: number;
    avg_tokens_per_turn: number;
    context_growth_rate: number; // tokens added per turn on average
    cache_savings: number;
  };
}

/**
 * Tenant in multi-tenant pattern
 */
export interface TenantUsage {
  tenant_id: string;
  tenant_name?: string;
  tier: "free" | "pro" | "enterprise" | string;
  users: Array<{
    user_id: string;
    request_count: number;
    total_tokens: number;
    total_cost: number;
  }>;
  events: PatternEvent[];
  summary: {
    total_requests: number;
    total_tokens: number;
    total_cost: number;
    quota_used: number; // percentage
    quota_limit: number;
    avg_cost_per_request: number;
    peak_requests_per_minute: number;
  };
}

/**
 * Multi-tenant agent fleet pattern
 */
export interface MultiTenantPattern {
  type: "multi_tenant";
  period_start: string;
  period_end: string;
  tenants: TenantUsage[];
  summary: {
    total_tenants: number;
    total_requests: number;
    total_tokens: number;
    total_revenue?: number;
    total_cost: number;
    gross_margin?: number;
    top_tenant_by_usage: string;
    top_tenant_by_cost: string;
    tier_distribution: Record<string, number>;
  };
}

/**
 * Tool call within an agent
 */
export interface ToolCall {
  tool_name: string;
  tool_id: string;
  input: Record<string, unknown>;
  output?: unknown;
  duration_ms: number;
  success: boolean;
  error?: string;
}

/**
 * Agent execution within cascaded pattern
 */
export interface AgentExecution {
  agent_id: string;
  agent_name: string;
  agent_type: "orchestrator" | "worker" | "specialist";
  parent_agent_id?: string;
  depth: number; // 0 for root, 1 for first-level subagent, etc.
  started_at: string;
  ended_at: string;
  model: string;
  events: PatternEvent[];
  tool_calls: ToolCall[];
  subagents: AgentExecution[];
  summary: {
    total_llm_calls: number;
    total_tool_calls: number;
    total_tokens: number;
    total_cost: number;
    total_duration_ms: number;
    success: boolean;
    error?: string;
  };
}

/**
 * Multi-agent cascaded pattern
 */
export interface CascadedAgentPattern {
  type: "cascaded_agents";
  task_id: string;
  task_description?: string;
  started_at: string;
  ended_at: string;
  root_agent: AgentExecution;
  summary: {
    total_agents: number;
    max_depth: number;
    total_llm_calls: number;
    total_tool_calls: number;
    total_tokens: number;
    total_cost: number;
    total_duration_ms: number;
    parallelism_factor: number; // average concurrent agents
    cost_by_agent_type: Record<string, number>;
    tokens_by_depth: Record<number, number>;
    tool_usage: Record<string, { count: number; avg_duration_ms: number; success_rate: number }>;
  };
}

/**
 * Complete analytics report with all patterns
 */
export interface AnalyticsJSON {
  generated_at: string;
  period: {
    start: string;
    end: string;
    duration_hours: number;
  };

  // Overall summary
  summary: {
    total_requests: number;
    total_tokens: number;
    total_cost: number;
    projected_monthly_cost: number;
    cache_savings: number;
    success_rate: number;
    avg_latency_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    p99_latency_ms: number;
  };

  // Cost breakdown
  costs: {
    by_model: Record<string, { requests: number; tokens: number; cost: number }>;
    by_hour: Array<{ hour: string; cost: number; requests: number }>;
    by_pattern_type: Record<string, number>;
  };

  // Patterns observed
  patterns: {
    conversations: ConversationPattern[];
    multi_tenant: MultiTenantPattern | null;
    cascaded_agents: CascadedAgentPattern[];
  };

  // Recommendations
  recommendations: Array<{
    category: "cost" | "performance" | "efficiency" | "reliability";
    severity: "info" | "warning" | "critical";
    title: string;
    description: string;
    potential_savings?: number;
    action: string;
  }>;
}
