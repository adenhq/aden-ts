/**
 * Pattern Simulator for generating realistic analytics data
 * Simulates multi-turn conversations, multi-tenant fleets, and cascaded agents
 */

import type {
  PatternEvent,
  ConversationPattern,
  TenantUsage,
  MultiTenantPattern,
  AgentExecution,
  CascadedAgentPattern,
  ToolCall,
} from "./report-types.js";

// Model pricing per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number; cached: number }> = {
  "gpt-5": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-5-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "gpt-4.1": { input: 2.0, output: 8.0, cached: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cached: 0.1 },
  "o3": { input: 10.0, output: 40.0, cached: 2.5 },
  "o3-mini": { input: 1.1, output: 4.4, cached: 0.275 },
};

const CONTEXT_LIMITS: Record<string, number> = {
  "gpt-5": 1_000_000,
  "gpt-5-mini": 1_000_000,
  "gpt-4.1": 1_000_000,
  "gpt-4.1-mini": 1_000_000,
  "o3": 200_000,
  "o3-mini": 200_000,
};

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gpt-5-mini"];
  const uncachedInput = inputTokens - cachedTokens;
  return (
    (uncachedInput / 1_000_000) * pricing.input +
    (cachedTokens / 1_000_000) * pricing.cached +
    (outputTokens / 1_000_000) * pricing.output
  );
}

/**
 * Simulate a multi-turn conversation
 */
export function simulateConversation(options: {
  turns?: number;
  model?: string;
  userId?: string;
  enableCaching?: boolean;
}): ConversationPattern {
  const {
    turns = randomInt(3, 12),
    model = "gpt-5-mini",
    userId,
    enableCaching = true,
  } = options;

  const conversationId = `conv-${uuid().slice(0, 8)}`;
  const startTime = new Date();
  const turnData: ConversationPattern["turns"] = [];

  let cumulativeCost = 0;
  let totalTokens = 0;
  let totalLatency = 0;
  let previousContextSize = 0;
  let totalCacheSavings = 0;

  // System prompt tokens (constant across conversation)
  const systemPromptTokens = randomInt(200, 800);

  for (let i = 0; i < turns; i++) {
    const isUser = i % 2 === 0;
    const turnTimestamp = new Date(startTime.getTime() + i * randomInt(5000, 30000));

    // Simulate growing context
    const userMessageTokens = randomInt(20, 200);
    const assistantResponseTokens = randomInt(100, 600);

    // Context grows with each turn
    const contextTokens =
      systemPromptTokens + previousContextSize + (isUser ? userMessageTokens : 0);

    // Cache efficiency improves with conversation length if caching is enabled
    const cacheRatio = enableCaching ? Math.min(0.8, 0.3 + i * 0.05) : 0;
    const cachedTokens = Math.floor(contextTokens * cacheRatio);

    const inputTokens = contextTokens;
    const outputTokens = isUser ? 0 : assistantResponseTokens;
    const latency = randomInt(500, 3000) + outputTokens * randomInt(5, 15);

    const cost = calculateCost(model, inputTokens, outputTokens, cachedTokens);
    cumulativeCost += cost;
    totalTokens += inputTokens + outputTokens;
    totalLatency += latency;

    // Calculate cache savings
    if (cachedTokens > 0) {
      const pricing = MODEL_PRICING[model] ?? MODEL_PRICING["gpt-5-mini"];
      totalCacheSavings += (cachedTokens / 1_000_000) * (pricing.input - pricing.cached);
    }

    const contextLimit = CONTEXT_LIMITS[model] ?? 128_000;

    const event: PatternEvent = {
      id: `evt-${uuid().slice(0, 8)}`,
      timestamp: turnTimestamp.toISOString(),
      model,
      latency_ms: latency,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      reasoning_tokens: 0,
      cost,
    };

    turnData.push({
      turn_number: i + 1,
      role: isUser ? "user" : "assistant",
      event,
      context_tokens: contextTokens,
      context_utilization: (contextTokens / contextLimit) * 100,
      cumulative_cost: cumulativeCost,
      cache_efficiency: inputTokens > 0 ? (cachedTokens / inputTokens) * 100 : 0,
    });

    previousContextSize = contextTokens + outputTokens;
  }

  const endTime = new Date(
    startTime.getTime() + turnData.length * randomInt(10000, 60000)
  );

  return {
    type: "conversation",
    conversation_id: conversationId,
    user_id: userId,
    started_at: startTime.toISOString(),
    ended_at: endTime.toISOString(),
    turns: turnData,
    summary: {
      total_turns: turns,
      total_tokens: totalTokens,
      total_cost: cumulativeCost,
      avg_latency: totalLatency / turns,
      avg_tokens_per_turn: totalTokens / turns,
      context_growth_rate: previousContextSize / turns,
      cache_savings: totalCacheSavings,
    },
  };
}

/**
 * Simulate multi-tenant usage
 */
export function simulateMultiTenant(options: {
  tenantCount?: number;
  requestsPerTenant?: { min: number; max: number };
  tiers?: Array<{ name: string; quota: number; weight: number }>;
}): MultiTenantPattern {
  const {
    tenantCount = 5,
    requestsPerTenant = { min: 10, max: 100 },
    tiers = [
      { name: "free", quota: 10_000, weight: 0.5 },
      { name: "pro", quota: 100_000, weight: 0.35 },
      { name: "enterprise", quota: 1_000_000, weight: 0.15 },
    ],
  } = options;

  const periodStart = new Date();
  const tenants: TenantUsage[] = [];

  const tenantNames = [
    "Acme Corp",
    "TechStart Inc",
    "DataFlow Systems",
    "CloudNine AI",
    "InnovateLabs",
    "Quantum Solutions",
    "NexGen Software",
    "Pinnacle Tech",
    "Velocity AI",
    "Synapse Analytics",
  ];

  let totalRequests = 0;
  let totalTokens = 0;
  let totalCost = 0;
  const tierDistribution: Record<string, number> = {};

  for (let t = 0; t < tenantCount; t++) {
    // Assign tier based on weights
    const rand = Math.random();
    let cumWeight = 0;
    let tier = tiers[0];
    for (const tierOption of tiers) {
      cumWeight += tierOption.weight;
      if (rand <= cumWeight) {
        tier = tierOption;
        break;
      }
    }

    tierDistribution[tier.name] = (tierDistribution[tier.name] ?? 0) + 1;

    const tenantId = `tenant-${uuid().slice(0, 8)}`;
    const tenantName = tenantNames[t % tenantNames.length];
    const numRequests = randomInt(requestsPerTenant.min, requestsPerTenant.max);
    const numUsers = randomInt(1, 5);

    const events: PatternEvent[] = [];
    const userUsage: Map<string, { requests: number; tokens: number; cost: number }> =
      new Map();

    // Create users
    const userIds = Array.from({ length: numUsers }, () => `user-${uuid().slice(0, 6)}`);

    let tenantTokens = 0;
    let tenantCost = 0;
    let peakRpm = 0;
    const minuteBuckets: Record<number, number> = {};

    for (let r = 0; r < numRequests; r++) {
      const userId = userIds[randomInt(0, userIds.length - 1)];
      const model =
        tier.name === "enterprise"
          ? Math.random() > 0.3
            ? "gpt-5"
            : "gpt-5-mini"
          : "gpt-5-mini";

      const inputTokens = randomInt(50, 500);
      const outputTokens = randomInt(100, 800);
      const cachedTokens = Math.random() > 0.7 ? Math.floor(inputTokens * 0.5) : 0;
      const latency = randomInt(500, 3000);
      const cost = calculateCost(model, inputTokens, outputTokens, cachedTokens);

      const eventTime = new Date(
        periodStart.getTime() + r * randomInt(1000, 10000)
      );
      const minuteBucket = Math.floor(
        (eventTime.getTime() - periodStart.getTime()) / 60000
      );
      minuteBuckets[minuteBucket] = (minuteBuckets[minuteBucket] ?? 0) + 1;

      events.push({
        id: `evt-${uuid().slice(0, 8)}`,
        timestamp: eventTime.toISOString(),
        model,
        latency_ms: latency,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        reasoning_tokens: 0,
        cost,
        metadata: { user_id: userId },
      });

      const userStats = userUsage.get(userId) ?? { requests: 0, tokens: 0, cost: 0 };
      userStats.requests++;
      userStats.tokens += inputTokens + outputTokens;
      userStats.cost += cost;
      userUsage.set(userId, userStats);

      tenantTokens += inputTokens + outputTokens;
      tenantCost += cost;
    }

    peakRpm = Math.max(...Object.values(minuteBuckets), 0);

    const users = Array.from(userUsage.entries()).map(([user_id, stats]) => ({
      user_id,
      request_count: stats.requests,
      total_tokens: stats.tokens,
      total_cost: stats.cost,
    }));

    tenants.push({
      tenant_id: tenantId,
      tenant_name: tenantName,
      tier: tier.name,
      users,
      events,
      summary: {
        total_requests: numRequests,
        total_tokens: tenantTokens,
        total_cost: tenantCost,
        quota_used: (tenantTokens / tier.quota) * 100,
        quota_limit: tier.quota,
        avg_cost_per_request: tenantCost / numRequests,
        peak_requests_per_minute: peakRpm,
      },
    });

    totalRequests += numRequests;
    totalTokens += tenantTokens;
    totalCost += tenantCost;
  }

  // Sort tenants by usage
  const topByUsage = [...tenants].sort(
    (a, b) => b.summary.total_tokens - a.summary.total_tokens
  )[0];
  const topByCost = [...tenants].sort(
    (a, b) => b.summary.total_cost - a.summary.total_cost
  )[0];

  const periodEnd = new Date(periodStart.getTime() + 3600000); // 1 hour

  return {
    type: "multi_tenant",
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    tenants,
    summary: {
      total_tenants: tenantCount,
      total_requests: totalRequests,
      total_tokens: totalTokens,
      total_cost: totalCost,
      top_tenant_by_usage: topByUsage.tenant_name ?? topByUsage.tenant_id,
      top_tenant_by_cost: topByCost.tenant_name ?? topByCost.tenant_id,
      tier_distribution: tierDistribution,
    },
  };
}

/**
 * Simulate cascaded multi-agent execution
 */
export function simulateCascadedAgents(options: {
  taskDescription?: string;
  maxDepth?: number;
  avgSubagentsPerLevel?: number;
  toolsAvailable?: string[];
}): CascadedAgentPattern {
  const {
    taskDescription = "Complex research and analysis task",
    maxDepth = 3,
    avgSubagentsPerLevel = 2,
    toolsAvailable = [
      "web_search",
      "code_interpreter",
      "file_read",
      "file_write",
      "database_query",
      "api_call",
    ],
  } = options;

  const taskId = `task-${uuid().slice(0, 8)}`;
  const startTime = new Date();

  const agentTypes: Array<{ type: AgentExecution["agent_type"]; model: string }> = [
    { type: "orchestrator", model: "gpt-5" },
    { type: "worker", model: "gpt-5-mini" },
    { type: "specialist", model: "o3-mini" },
  ];

  const toolUsageStats: Record<
    string,
    { count: number; totalDuration: number; successes: number }
  > = {};
  const tokensByDepth: Record<number, number> = {};
  const costByAgentType: Record<string, number> = {};

  let totalAgents = 0;
  let totalLlmCalls = 0;
  let totalToolCalls = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let maxActualDepth = 0;

  function createAgent(
    depth: number,
    parentId?: string,
    forcedType?: AgentExecution["agent_type"]
  ): AgentExecution {
    totalAgents++;
    maxActualDepth = Math.max(maxActualDepth, depth);

    const agentConfig =
      depth === 0
        ? agentTypes[0]
        : forcedType
          ? agentTypes.find((a) => a.type === forcedType) ?? agentTypes[1]
          : agentTypes[randomInt(1, agentTypes.length - 1)];

    const agentId = `agent-${uuid().slice(0, 8)}`;
    const agentStartTime = new Date(
      startTime.getTime() + depth * randomInt(500, 2000)
    );

    // Generate LLM calls for this agent
    const numLlmCalls = depth === 0 ? randomInt(3, 6) : randomInt(1, 4);
    const events: PatternEvent[] = [];
    let agentTokens = 0;
    let agentCost = 0;
    let agentDuration = 0;

    for (let i = 0; i < numLlmCalls; i++) {
      totalLlmCalls++;
      const inputTokens = randomInt(200, 1500);
      const outputTokens = randomInt(100, 800);
      const reasoningTokens =
        agentConfig.model.startsWith("o3") ? randomInt(500, 2000) : 0;
      const cachedTokens = i > 0 ? Math.floor(inputTokens * 0.4) : 0;
      const latency = randomInt(800, 4000);

      const cost = calculateCost(
        agentConfig.model,
        inputTokens,
        outputTokens + reasoningTokens,
        cachedTokens
      );

      events.push({
        id: `evt-${uuid().slice(0, 8)}`,
        timestamp: new Date(agentStartTime.getTime() + agentDuration).toISOString(),
        model: agentConfig.model,
        latency_ms: latency,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        reasoning_tokens: reasoningTokens,
        cost,
      });

      agentTokens += inputTokens + outputTokens + reasoningTokens;
      agentCost += cost;
      agentDuration += latency;
    }

    // Generate tool calls
    const numToolCalls = randomInt(0, 4);
    const toolCalls: ToolCall[] = [];

    for (let i = 0; i < numToolCalls; i++) {
      totalToolCalls++;
      const toolName = toolsAvailable[randomInt(0, toolsAvailable.length - 1)];
      const duration = randomInt(100, 5000);
      const success = Math.random() > 0.1; // 90% success rate

      toolCalls.push({
        tool_name: toolName,
        tool_id: `tool-${uuid().slice(0, 8)}`,
        input: { query: `Sample ${toolName} input` },
        output: success ? { result: "Success" } : undefined,
        duration_ms: duration,
        success,
        error: success ? undefined : "Tool execution failed",
      });

      agentDuration += duration;

      // Track tool stats
      if (!toolUsageStats[toolName]) {
        toolUsageStats[toolName] = { count: 0, totalDuration: 0, successes: 0 };
      }
      toolUsageStats[toolName].count++;
      toolUsageStats[toolName].totalDuration += duration;
      if (success) toolUsageStats[toolName].successes++;
    }

    // Recursively create subagents
    const subagents: AgentExecution[] = [];
    if (depth < maxDepth - 1) {
      const numSubagents =
        depth === 0
          ? randomInt(2, avgSubagentsPerLevel + 1)
          : Math.random() > 0.5
            ? randomInt(1, avgSubagentsPerLevel)
            : 0;

      for (let i = 0; i < numSubagents; i++) {
        subagents.push(createAgent(depth + 1, agentId));
      }
    }

    // Calculate totals including subagents
    let totalSubagentTokens = 0;
    let totalSubagentCost = 0;
    let totalSubagentDuration = 0;
    let totalSubagentLlmCalls = 0;
    let totalSubagentToolCalls = 0;

    for (const sub of subagents) {
      totalSubagentTokens += sub.summary.total_tokens;
      totalSubagentCost += sub.summary.total_cost;
      totalSubagentDuration += sub.summary.total_duration_ms;
      totalSubagentLlmCalls += sub.summary.total_llm_calls;
      totalSubagentToolCalls += sub.summary.total_tool_calls;
    }

    const agentEndTime = new Date(agentStartTime.getTime() + agentDuration);

    // Update tracking
    tokensByDepth[depth] = (tokensByDepth[depth] ?? 0) + agentTokens;
    costByAgentType[agentConfig.type] =
      (costByAgentType[agentConfig.type] ?? 0) + agentCost;
    totalTokens += agentTokens;
    totalCost += agentCost;

    return {
      agent_id: agentId,
      agent_name: `${agentConfig.type.charAt(0).toUpperCase()}${agentConfig.type.slice(1)}-${depth}-${agentId.slice(-4)}`,
      agent_type: agentConfig.type,
      parent_agent_id: parentId,
      depth,
      started_at: agentStartTime.toISOString(),
      ended_at: agentEndTime.toISOString(),
      model: agentConfig.model,
      events,
      tool_calls: toolCalls,
      subagents,
      summary: {
        total_llm_calls: numLlmCalls + totalSubagentLlmCalls,
        total_tool_calls: numToolCalls + totalSubagentToolCalls,
        total_tokens: agentTokens + totalSubagentTokens,
        total_cost: agentCost + totalSubagentCost,
        total_duration_ms: agentDuration + totalSubagentDuration,
        success: true,
      },
    };
  }

  const rootAgent = createAgent(0);
  const endTime = new Date(startTime.getTime() + rootAgent.summary.total_duration_ms);

  // Build tool usage summary
  const toolUsage: Record<
    string,
    { count: number; avg_duration_ms: number; success_rate: number }
  > = {};
  for (const [name, stats] of Object.entries(toolUsageStats)) {
    toolUsage[name] = {
      count: stats.count,
      avg_duration_ms: stats.totalDuration / stats.count,
      success_rate: (stats.successes / stats.count) * 100,
    };
  }

  return {
    type: "cascaded_agents",
    task_id: taskId,
    task_description: taskDescription,
    started_at: startTime.toISOString(),
    ended_at: endTime.toISOString(),
    root_agent: rootAgent,
    summary: {
      total_agents: totalAgents,
      max_depth: maxActualDepth + 1,
      total_llm_calls: totalLlmCalls,
      total_tool_calls: totalToolCalls,
      total_tokens: totalTokens,
      total_cost: totalCost,
      total_duration_ms: rootAgent.summary.total_duration_ms,
      parallelism_factor: totalAgents / (maxActualDepth + 1),
      cost_by_agent_type: costByAgentType,
      tokens_by_depth: tokensByDepth,
      tool_usage: toolUsage,
    },
  };
}
