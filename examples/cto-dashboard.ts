/**
 * CTO Dashboard - Real API Calls Report Generator
 *
 * Generates an interactive HTML report with REAL data from:
 * - Multi-turn conversation patterns (actual API calls with context chaining)
 * - Multi-tenant agent fleet analytics (attributed usage)
 * - Cascaded multi-agent with tool call tracking
 *
 * Requires: OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/cto-dashboard.ts
 * Output: Opens CTO_REPORT.html in browser
 */

import "dotenv/config";
import * as fs from "fs";
import { exec } from "child_process";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  ReportBuilder,
  createReportEmitter,
  type ConversationPattern,
  type MultiTenantPattern,
  type CascadedAgentPattern,
  type PatternEvent,
  type TenantUsage,
  type AgentExecution,
  type ToolCall,
} from "../src/index.js";

// =========================================
// Helper: Create PatternEvent from API response
// =========================================
function createPatternEvent(
  response: OpenAI.Responses.Response,
  model: string,
  latencyMs: number
): PatternEvent {
  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;

  // Calculate cost based on model
  const pricing: Record<string, { input: number; output: number; cached: number }> = {
    "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
    "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
    "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.6, cached: 0.075 },
  };

  const p = pricing[model] ?? pricing["gpt-4o-mini"];
  const uncachedInput = inputTokens - cachedTokens;
  const cost =
    (uncachedInput / 1_000_000) * p.input +
    (cachedTokens / 1_000_000) * p.cached +
    (outputTokens / 1_000_000) * p.output;

  return {
    id: response.id,
    timestamp: new Date().toISOString(),
    model,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    reasoning_tokens: 0,
    cost,
  };
}

// =========================================
// Pattern 1: Real Multi-Turn Conversations
// =========================================
async function runRealConversation(
  client: OpenAI,
  topic: string,
  turnCount: number,
  model: string,
  userId: string
): Promise<ConversationPattern> {
  console.log(`   Starting conversation: "${topic}" (${turnCount} turns)`);

  const conversationId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  const turns: ConversationPattern["turns"] = [];

  // Conversation prompts that build on each other
  const conversationFlow = [
    `You are a helpful assistant. The user wants to discuss: ${topic}. Start by introducing the topic briefly.`,
    "Great, can you elaborate on the main points?",
    "What are the potential challenges or downsides?",
    "How would you recommend getting started?",
    "Can you summarize the key takeaways in bullet points?",
    "Any final tips or resources you'd recommend?",
    "Thanks! One more question - what's the most common mistake people make?",
    "And how can that be avoided?",
  ];

  let previousResponseId: string | undefined;
  let cumulativeCost = 0;
  let contextTokens = 0;

  for (let i = 0; i < Math.min(turnCount, conversationFlow.length); i++) {
    const prompt = conversationFlow[i];
    const startTime = Date.now();

    try {
      const response = await client.responses.create({
        model,
        input: prompt,
        max_output_tokens: 800,
        ...(previousResponseId && { previous_response_id: previousResponseId }),
      });

      const latencyMs = Date.now() - startTime;
      const event = createPatternEvent(response, model, latencyMs);

      contextTokens += event.input_tokens;
      cumulativeCost += event.cost;

      const contextWindow = model.includes("mini") ? 128000 : 128000;
      const cacheEfficiency = event.cached_tokens > 0
        ? (event.cached_tokens / event.input_tokens) * 100
        : 0;

      turns.push({
        turn_number: i + 1,
        role: i % 2 === 0 ? "user" : "assistant",
        event,
        context_tokens: contextTokens,
        context_utilization: (contextTokens / contextWindow) * 100,
        cumulative_cost: cumulativeCost,
        cache_efficiency: cacheEfficiency,
      });

      previousResponseId = response.id;
      console.log(`      Turn ${i + 1}: ${event.input_tokens} in / ${event.output_tokens} out (${latencyMs}ms)`);
    } catch (error) {
      console.log(`      Turn ${i + 1}: Error - ${error}`);
      break;
    }
  }

  const totalTokens = turns.reduce((sum, t) => sum + t.event.input_tokens + t.event.output_tokens, 0);
  const avgLatency = turns.reduce((sum, t) => sum + t.event.latency_ms, 0) / turns.length;
  const cacheSavings = turns.reduce((sum, t) => {
    const p = model.includes("mini") ? 0.15 : 2.5;
    return sum + (t.event.cached_tokens / 1_000_000) * (p * 0.5);
  }, 0);

  return {
    type: "conversation",
    conversation_id: conversationId,
    user_id: userId,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    turns,
    summary: {
      total_turns: turns.length,
      total_tokens: totalTokens,
      total_cost: cumulativeCost,
      avg_latency: avgLatency,
      avg_tokens_per_turn: totalTokens / turns.length,
      context_growth_rate: contextTokens / turns.length,
      cache_savings: cacheSavings,
    },
  };
}

// =========================================
// Pattern 2: Real Multi-Tenant Usage
// =========================================
async function runRealMultiTenant(
  client: OpenAI,
  tenants: Array<{ name: string; tier: string; requestCount: number }>
): Promise<MultiTenantPattern> {
  console.log("   Running multi-tenant requests...");

  const periodStart = new Date().toISOString();
  const tenantUsages: TenantUsage[] = [];

  const prompts = [
    "Explain the key architectural differences between monolithic and microservices applications, including trade-offs for scalability, maintainability, and deployment complexity.",
    "Describe best practices for implementing secure authentication in a web application, covering OAuth 2.0, JWT tokens, session management, and CSRF protection.",
    "What are the main strategies for optimizing database performance in high-traffic applications? Include indexing, query optimization, connection pooling, and read replicas.",
    "Explain the principles of observability in distributed systems, covering the three pillars: metrics, logs, and traces, along with recommended tooling.",
    "Describe containerization best practices with Docker and Kubernetes, including image optimization, resource limits, health checks, and rolling deployments.",
    "What are the key considerations when designing a RESTful API? Cover versioning strategies, error handling, pagination, rate limiting, and documentation.",
    "Explain event-driven architecture patterns including event sourcing, CQRS, and saga patterns for managing distributed transactions.",
    "Describe strategies for implementing caching at different layers of an application stack, from CDN to application cache to database query cache.",
    "What are the best practices for CI/CD pipelines? Cover testing strategies, artifact management, environment promotion, and rollback procedures.",
    "Explain cloud-native security best practices including least privilege access, network segmentation, secrets management, and compliance monitoring.",
  ];

  for (const tenant of tenants) {
    console.log(`      Tenant: ${tenant.name} (${tenant.tier}) - ${tenant.requestCount} requests`);

    const events: PatternEvent[] = [];
    const users = [`${tenant.name}-user-1`, `${tenant.name}-user-2`];
    const userStats: Record<string, { requests: number; tokens: number; cost: number }> = {};

    for (let i = 0; i < tenant.requestCount; i++) {
      const prompt = prompts[i % prompts.length];
      const userId = users[i % users.length];
      const startTime = Date.now();

      try {
        const response = await client.responses.create({
          model: "gpt-4o-mini",
          input: prompt,
          max_output_tokens: 500,
        });

        const latencyMs = Date.now() - startTime;
        const event = createPatternEvent(response, "gpt-4o-mini", latencyMs);
        events.push(event);

        if (!userStats[userId]) {
          userStats[userId] = { requests: 0, tokens: 0, cost: 0 };
        }
        userStats[userId].requests++;
        userStats[userId].tokens += event.input_tokens + event.output_tokens;
        userStats[userId].cost += event.cost;
      } catch (error) {
        console.log(`         Request ${i + 1} failed: ${error}`);
      }
    }

    const totalCost = events.reduce((sum, e) => sum + e.cost, 0);
    const totalTokens = events.reduce((sum, e) => sum + e.input_tokens + e.output_tokens, 0);
    const quotaLimit = tenant.tier === "enterprise" ? 1_000_000 : tenant.tier === "pro" ? 100_000 : 10_000;

    tenantUsages.push({
      tenant_id: tenant.name.toLowerCase().replace(/\s+/g, "-"),
      tenant_name: tenant.name,
      tier: tenant.tier,
      users: Object.entries(userStats).map(([userId, stats]) => ({
        user_id: userId,
        request_count: stats.requests,
        total_tokens: stats.tokens,
        total_cost: stats.cost,
      })),
      events,
      summary: {
        total_requests: events.length,
        total_tokens: totalTokens,
        total_cost: totalCost,
        quota_used: (totalTokens / quotaLimit) * 100,
        quota_limit: quotaLimit,
        avg_cost_per_request: events.length > 0 ? totalCost / events.length : 0,
        peak_requests_per_minute: events.length, // Simplified
      },
    });
  }

  const periodEnd = new Date().toISOString();
  const allTenantCost = tenantUsages.reduce((sum, t) => sum + t.summary.total_cost, 0);
  const allTenantTokens = tenantUsages.reduce((sum, t) => sum + t.summary.total_tokens, 0);
  const allTenantRequests = tenantUsages.reduce((sum, t) => sum + t.summary.total_requests, 0);

  const tierDistribution: Record<string, number> = {};
  for (const t of tenantUsages) {
    tierDistribution[t.tier] = (tierDistribution[t.tier] ?? 0) + 1;
  }

  const topByUsage = tenantUsages.reduce((a, b) => a.summary.total_tokens > b.summary.total_tokens ? a : b);
  const topByCost = tenantUsages.reduce((a, b) => a.summary.total_cost > b.summary.total_cost ? a : b);

  return {
    type: "multi_tenant",
    period_start: periodStart,
    period_end: periodEnd,
    tenants: tenantUsages,
    summary: {
      total_tenants: tenantUsages.length,
      total_requests: allTenantRequests,
      total_tokens: allTenantTokens,
      total_cost: allTenantCost,
      top_tenant_by_usage: topByUsage.tenant_name ?? topByUsage.tenant_id,
      top_tenant_by_cost: topByCost.tenant_name ?? topByCost.tenant_id,
      tier_distribution: tierDistribution,
    },
  };
}

// =========================================
// Pattern 3: Real Cascaded Agent with Tools
// =========================================
async function runRealCascadedAgent(
  client: OpenAI,
  taskDescription: string
): Promise<CascadedAgentPattern> {
  console.log(`   Running agent task: "${taskDescription}"`);

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();

  // Define tools for the agent
  const tools: OpenAI.Responses.Tool[] = [
    {
      type: "function",
      name: "search_knowledge_base",
      description: "Search internal knowledge base for information",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      strict: false,
    },
    {
      type: "function",
      name: "analyze_data",
      description: "Analyze data and return insights",
      parameters: {
        type: "object",
        properties: {
          data_type: { type: "string", description: "Type of data to analyze" },
        },
        required: ["data_type"],
      },
      strict: false,
    },
  ];

  // Run orchestrator agent
  const orchestratorEvents: PatternEvent[] = [];
  const orchestratorTools: ToolCall[] = [];
  const subagents: AgentExecution[] = [];

  // First call: orchestrator decides what to do
  const orchestratorStart = Date.now();
  const orchestratorResponse = await client.responses.create({
    model: "gpt-4o-mini",
    input: `You are an orchestrator agent. Your task: ${taskDescription}\n\nAnalyze this task comprehensively and decide what steps are needed. Provide a detailed breakdown of the approach and use the available tools to gather information.`,
    tools,
    max_output_tokens: 600,
  });

  orchestratorEvents.push(
    createPatternEvent(orchestratorResponse, "gpt-4o-mini", Date.now() - orchestratorStart)
  );
  console.log(`      Orchestrator: ${orchestratorEvents[0].input_tokens} in / ${orchestratorEvents[0].output_tokens} out`);

  // Check for tool calls in orchestrator response
  for (const item of orchestratorResponse.output) {
    if (item.type === "function_call") {
      const toolStart = Date.now();
      orchestratorTools.push({
        tool_name: item.name,
        tool_id: item.call_id,
        input: JSON.parse(item.arguments),
        output: { result: "Simulated tool result for " + item.name },
        duration_ms: Date.now() - toolStart + 50,
        success: true,
      });
      console.log(`      Tool call: ${item.name}`);
    }
  }

  // Run worker subagents with more detailed tasks
  const workerTasks = [
    "Research phase: Gather comprehensive information about industry best practices, common pitfalls, and recommended approaches for this task. Provide detailed findings with specific examples.",
    "Analysis phase: Analyze the gathered information and create actionable recommendations with implementation priorities and trade-off considerations.",
    "Implementation phase: Create a detailed implementation roadmap with specific steps, required resources, and success criteria for each phase.",
  ];

  for (let i = 0; i < workerTasks.length; i++) {
    const workerEvents: PatternEvent[] = [];
    const workerTools: ToolCall[] = [];

    const workerStart = Date.now();
    const workerResponse = await client.responses.create({
      model: "gpt-4o-mini",
      input: `You are a specialist worker agent. Your subtask: ${workerTasks[i]}\n\nOriginal task context: ${taskDescription}\n\nProvide thorough and actionable output.`,
      tools,
      max_output_tokens: 500,
    });

    workerEvents.push(
      createPatternEvent(workerResponse, "gpt-4o-mini", Date.now() - workerStart)
    );
    console.log(`      Worker ${i + 1}: ${workerEvents[0].input_tokens} in / ${workerEvents[0].output_tokens} out`);

    // Check for tool calls
    for (const item of workerResponse.output) {
      if (item.type === "function_call") {
        workerTools.push({
          tool_name: item.name,
          tool_id: item.call_id,
          input: JSON.parse(item.arguments),
          output: { result: "Simulated result" },
          duration_ms: 30,
          success: true,
        });
      }
    }

    const workerCost = workerEvents.reduce((sum, e) => sum + e.cost, 0);
    const workerTokens = workerEvents.reduce((sum, e) => sum + e.input_tokens + e.output_tokens, 0);

    subagents.push({
      agent_id: `worker-${i + 1}`,
      agent_name: `Worker-${i + 1}`,
      agent_type: "worker",
      parent_agent_id: "orchestrator",
      depth: 1,
      started_at: new Date(workerStart).toISOString(),
      ended_at: new Date().toISOString(),
      model: "gpt-4o-mini",
      events: workerEvents,
      tool_calls: workerTools,
      subagents: [],
      summary: {
        total_llm_calls: workerEvents.length,
        total_tool_calls: workerTools.length,
        total_tokens: workerTokens,
        total_cost: workerCost,
        total_duration_ms: Date.now() - workerStart,
        success: true,
      },
    });
  }

  const endedAt = new Date();
  const totalAgents = 1 + subagents.length;
  const totalLLMCalls = orchestratorEvents.length + subagents.reduce((sum, s) => sum + s.events.length, 0);
  const totalToolCalls = orchestratorTools.length + subagents.reduce((sum, s) => sum + s.tool_calls.length, 0);
  const totalTokens =
    orchestratorEvents.reduce((sum, e) => sum + e.input_tokens + e.output_tokens, 0) +
    subagents.reduce((sum, s) => sum + s.summary.total_tokens, 0);
  const totalCost =
    orchestratorEvents.reduce((sum, e) => sum + e.cost, 0) +
    subagents.reduce((sum, s) => sum + s.summary.total_cost, 0);

  const rootAgent: AgentExecution = {
    agent_id: "orchestrator",
    agent_name: "Orchestrator",
    agent_type: "orchestrator",
    depth: 0,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    model: "gpt-4o-mini",
    events: orchestratorEvents,
    tool_calls: orchestratorTools,
    subagents,
    summary: {
      total_llm_calls: orchestratorEvents.length,
      total_tool_calls: orchestratorTools.length,
      total_tokens: orchestratorEvents.reduce((sum, e) => sum + e.input_tokens + e.output_tokens, 0),
      total_cost: orchestratorEvents.reduce((sum, e) => sum + e.cost, 0),
      total_duration_ms: endedAt.getTime() - startedAt.getTime(),
      success: true,
    },
  };

  return {
    type: "cascaded_agents",
    task_id: taskId,
    task_description: taskDescription,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    root_agent: rootAgent,
    summary: {
      total_agents: totalAgents,
      max_depth: 1,
      total_llm_calls: totalLLMCalls,
      total_tool_calls: totalToolCalls,
      total_tokens: totalTokens,
      total_cost: totalCost,
      total_duration_ms: endedAt.getTime() - startedAt.getTime(),
      parallelism_factor: 1,
      cost_by_agent_type: {
        orchestrator: rootAgent.summary.total_cost,
        worker: subagents.reduce((sum, s) => sum + s.summary.total_cost, 0),
      },
      tokens_by_depth: {
        0: rootAgent.summary.total_tokens,
        1: subagents.reduce((sum, s) => sum + s.summary.total_tokens, 0),
      },
      tool_usage: (() => {
        const allToolCalls = [...orchestratorTools, ...subagents.flatMap((s) => s.tool_calls)];
        const toolStats = new Map<string, { count: number; totalDuration: number; successes: number }>();

        for (const t of allToolCalls) {
          const existing = toolStats.get(t.tool_name) ?? { count: 0, totalDuration: 0, successes: 0 };
          existing.count++;
          existing.totalDuration += t.duration_ms;
          if (t.success) existing.successes++;
          toolStats.set(t.tool_name, existing);
        }

        const result: Record<string, { count: number; avg_duration_ms: number; success_rate: number }> = {};
        for (const [name, stats] of toolStats.entries()) {
          result[name] = {
            count: stats.count,
            avg_duration_ms: stats.totalDuration / stats.count,
            success_rate: (stats.successes / stats.count) * 100,
          };
        }
        return result;
      })(),
    },
  };
}

// =========================================
// Main Report Generator
// =========================================
async function generateCTOReport() {
  console.log("=== CTO Dashboard - Real API Calls ===\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is required");
    console.error("Set it in .env file or export OPENAI_API_KEY=sk-...");
    process.exit(1);
  }

  // Create metered OpenAI client
  const builder = new ReportBuilder({
    pricing: {
      "gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075 },
      "gpt-4o": { input: 2.5, output: 10, cached: 1.25 },
    },
  });

  const openai = makeMeteredOpenAI(new OpenAI(), {
    emitMetric: createReportEmitter(builder),
  });

  // =========================================
  // Pattern 1: Real Multi-Turn Conversations
  // =========================================
  console.log("1. Running real multi-turn conversations...");

  const conversationTopics = [
    { topic: "comprehensive guide to REST API design including versioning, pagination, error handling, authentication methods, and rate limiting strategies", turns: 8, model: "gpt-4o-mini", userId: "dev-1" },
    { topic: "microservices architecture patterns including service mesh, event-driven design, saga patterns, and distributed tracing", turns: 8, model: "gpt-4o-mini", userId: "dev-2" },
    { topic: "database optimization strategies covering indexing, query optimization, sharding, replication, and caching layers", turns: 7, model: "gpt-4o-mini", userId: "dev-3" },
    { topic: "Kubernetes deployment strategies including blue-green deployments, canary releases, rolling updates, and GitOps workflows", turns: 7, model: "gpt-4o-mini", userId: "dev-4" },
    { topic: "CI/CD pipeline best practices with testing strategies, artifact management, environment promotion, and security scanning", turns: 6, model: "gpt-4o-mini", userId: "dev-5" },
    { topic: "cloud security best practices including IAM, network security, encryption at rest and in transit, and compliance frameworks", turns: 6, model: "gpt-4o-mini", userId: "dev-6" },
    { topic: "observability and monitoring strategies covering metrics, logs, traces, alerting, and SLO/SLI management", turns: 6, model: "gpt-4o-mini", userId: "dev-7" },
    { topic: "API gateway design patterns including rate limiting, authentication, request transformation, and load balancing", turns: 5, model: "gpt-4o-mini", userId: "dev-8" },
  ];

  for (const conv of conversationTopics) {
    const conversation = await runRealConversation(
      openai,
      conv.topic,
      conv.turns,
      conv.model,
      conv.userId
    );
    builder.addConversation(conversation);
  }

  console.log(`   Completed ${conversationTopics.length} conversations\n`);

  // =========================================
  // Pattern 2: Real Multi-Tenant Usage
  // =========================================
  console.log("2. Running real multi-tenant requests...");

  const tenants = [
    { name: "Acme Corp", tier: "enterprise", requestCount: 20 },
    { name: "TechGiant Inc", tier: "enterprise", requestCount: 18 },
    { name: "GlobalFinance Ltd", tier: "enterprise", requestCount: 15 },
    { name: "StartupXYZ", tier: "pro", requestCount: 12 },
    { name: "DevShop Pro", tier: "pro", requestCount: 10 },
    { name: "InnovateTech", tier: "pro", requestCount: 8 },
    { name: "FreeTier User", tier: "free", requestCount: 5 },
    { name: "Hobbyist Dev", tier: "free", requestCount: 4 },
    { name: "StudentProject", tier: "free", requestCount: 3 },
  ];

  const multiTenant = await runRealMultiTenant(openai, tenants);
  builder.setMultiTenant(multiTenant);

  console.log(`   Completed ${tenants.length} tenant simulations\n`);

  // =========================================
  // Pattern 3: Real Cascaded Agent Tasks
  // =========================================
  console.log("3. Running real cascaded agent tasks...");

  const agentTasks = [
    "Research and provide a comprehensive analysis of best practices for implementing a multi-tier caching layer including Redis, Memcached, and CDN strategies with failover mechanisms",
    "Analyze the trade-offs between SQL and NoSQL databases for a high-traffic e-commerce platform handling millions of daily transactions with complex querying needs",
    "Design a scalable authentication and authorization system for a multi-tenant SaaS platform supporting SSO, MFA, and fine-grained RBAC with audit logging",
    "Evaluate monitoring and observability tools for a microservices architecture with 50+ services, comparing Prometheus/Grafana, Datadog, and New Relic",
    "Create a comprehensive disaster recovery and business continuity plan for a cloud-native application spanning multiple AWS regions",
    "Design a real-time data pipeline architecture for processing and analyzing IoT sensor data at scale with sub-second latency requirements",
    "Develop a security assessment framework for evaluating third-party API integrations including OAuth flows, data handling, and compliance requirements",
    "Architect a multi-region deployment strategy for a globally distributed application with data sovereignty requirements and low-latency access",
  ];

  for (const task of agentTasks) {
    const cascaded = await runRealCascadedAgent(openai, task);
    builder.addCascadedAgent(cascaded);
  }

  console.log(`   Completed ${agentTasks.length} agent tasks\n`);

  // =========================================
  // Generate Reports
  // =========================================
  console.log("4. Generating reports...");

  // Generate JSON report
  const jsonReport = builder.buildJSON();
  const jsonPath = "CTO_REPORT.json";
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`   JSON report saved to: ${jsonPath}`);

  // Generate HTML report
  const htmlReport = builder.buildHTML();
  const htmlPath = "CTO_REPORT.html";
  fs.writeFileSync(htmlPath, htmlReport);
  console.log(`   HTML report saved to: ${htmlPath}`);

  // =========================================
  // Print Summary
  // =========================================
  console.log("\n" + "=".repeat(60));
  console.log("                    REPORT SUMMARY");
  console.log("=".repeat(60));

  console.log(`
Total Requests:        ${jsonReport.summary.total_requests.toLocaleString()}
Total Tokens:          ${jsonReport.summary.total_tokens.toLocaleString()}
Total Cost:            $${jsonReport.summary.total_cost.toFixed(4)}
Projected Monthly:     $${jsonReport.summary.projected_monthly_cost.toFixed(2)}
Cache Savings:         $${jsonReport.summary.cache_savings.toFixed(4)}
Success Rate:          ${jsonReport.summary.success_rate.toFixed(1)}%
Avg Latency:           ${jsonReport.summary.avg_latency_ms.toFixed(0)}ms
P95 Latency:           ${jsonReport.summary.p95_latency_ms.toFixed(0)}ms
`);

  console.log("Patterns Included:");
  console.log(`  - Conversations:      ${jsonReport.patterns.conversations.length}`);
  console.log(`  - Tenants:            ${jsonReport.patterns.multi_tenant?.tenants.length ?? 0}`);
  console.log(`  - Agent Tasks:        ${jsonReport.patterns.cascaded_agents.length}`);

  console.log("\nRecommendations:");
  for (const rec of jsonReport.recommendations) {
    const icon = rec.severity === "critical" ? "!!!" : rec.severity === "warning" ? " ! " : "   ";
    console.log(`  [${icon}] ${rec.title}`);
  }

  console.log("\n" + "=".repeat(60));

  // Try to open HTML report in browser
  console.log("\nOpening HTML report in browser...");
  const openCommand =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  exec(`${openCommand} ${htmlPath}`, (error) => {
    if (error) {
      console.log(`Could not auto-open browser. Please open ${htmlPath} manually.`);
    }
  });
}

generateCTOReport().catch(console.error);
