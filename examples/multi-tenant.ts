/**
 * Multi-Tenant Usage Attribution Example
 *
 * Demonstrates how to:
 * 1. Track usage per tenant/user/organization
 * 2. Implement per-tenant rate limiting
 * 3. Generate usage reports by tenant
 */

import "dotenv/config";
import OpenAI from "openai";
import {
  makeMeteredOpenAI,
  createFilteredEmitter,
  type MetricEvent,
  type MetricEmitter,
} from "../src/index.js";

// Simulated tenant context (in real app, this comes from auth/session)
interface TenantContext {
  tenantId: string;
  userId: string;
  tier: "free" | "pro" | "enterprise";
}

// Store for tenant usage data
const tenantUsage: Record<
  string,
  {
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
    costEstimate: number;
    lastRequestAt: Date;
  }
> = {};

// Tier-based limits (tokens per day)
const TIER_LIMITS = {
  free: 10_000,
  pro: 100_000,
  enterprise: 1_000_000,
};

/**
 * Get or initialize tenant usage record
 */
function getTenantUsage(tenantId: string) {
  if (!tenantUsage[tenantId]) {
    tenantUsage[tenantId] = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      requestCount: 0,
      costEstimate: 0,
      lastRequestAt: new Date(),
    };
  }
  return tenantUsage[tenantId];
}

/**
 * Check if tenant has exceeded their tier limit
 */
function checkTenantLimit(context: TenantContext): boolean {
  const usage = getTenantUsage(context.tenantId);
  const limit = TIER_LIMITS[context.tier];
  const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
  return totalTokens < limit;
}

/**
 * Create a tenant-aware metric emitter
 */
function createTenantEmitter(getContext: () => TenantContext): MetricEmitter {
  return (event: MetricEvent) => {
    const context = getContext();
    const usage = getTenantUsage(context.tenantId);

    // Update usage stats
    usage.totalInputTokens += event.usage?.input_tokens ?? 0;
    usage.totalOutputTokens += event.usage?.output_tokens ?? 0;
    usage.requestCount++;
    usage.lastRequestAt = new Date();

    // Estimate cost (simplified)
    const inputCost = (event.usage?.input_tokens ?? 0) * 0.0000004;
    const outputCost = (event.usage?.output_tokens ?? 0) * 0.0000016;
    usage.costEstimate += inputCost + outputCost;

    console.log(`[Tenant: ${context.tenantId}] [User: ${context.userId}] [Tier: ${context.tier}]`);
    console.log(`  Tokens: ${event.usage?.input_tokens ?? 0} in / ${event.usage?.output_tokens ?? 0} out`);
    console.log(`  Total usage: ${usage.totalInputTokens + usage.totalOutputTokens} / ${TIER_LIMITS[context.tier]} tokens`);
  };
}

/**
 * Generate usage report for all tenants
 */
function generateUsageReport(): void {
  console.log("\n=== Tenant Usage Report ===\n");

  const sortedTenants = Object.entries(tenantUsage).sort(
    ([, a], [, b]) => b.totalInputTokens + b.totalOutputTokens - (a.totalInputTokens + a.totalOutputTokens)
  );

  for (const [tenantId, usage] of sortedTenants) {
    const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
    console.log(`Tenant: ${tenantId}`);
    console.log(`  Requests: ${usage.requestCount}`);
    console.log(`  Input tokens: ${usage.totalInputTokens.toLocaleString()}`);
    console.log(`  Output tokens: ${usage.totalOutputTokens.toLocaleString()}`);
    console.log(`  Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`  Est. cost: $${usage.costEstimate.toFixed(4)}`);
    console.log(`  Last request: ${usage.lastRequestAt.toISOString()}`);
    console.log("");
  }
}

// Simulate different tenant contexts
let currentContext: TenantContext = {
  tenantId: "tenant-001",
  userId: "user-abc",
  tier: "pro",
};

// Create tenant-aware metered client
const client = makeMeteredOpenAI(new OpenAI(), {
  emitMetric: createTenantEmitter(() => currentContext),
});

async function simulateTenantRequests() {
  console.log("=== Multi-Tenant Usage Example ===\n");

  // Tenant 1: Pro tier
  currentContext = { tenantId: "acme-corp", userId: "alice@acme.com", tier: "pro" };

  if (checkTenantLimit(currentContext)) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Explain microservices architecture",
      max_output_tokens: 200,
    });
  }

  console.log("");

  // Tenant 2: Free tier
  currentContext = { tenantId: "startup-xyz", userId: "bob@startup.xyz", tier: "free" };

  if (checkTenantLimit(currentContext)) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "What is REST API?",
      max_output_tokens: 100,
    });
  }

  console.log("");

  // Tenant 3: Enterprise tier
  currentContext = { tenantId: "bigcorp-inc", userId: "carol@bigcorp.com", tier: "enterprise" };

  if (checkTenantLimit(currentContext)) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Design a scalable notification system",
      max_output_tokens: 300,
    });
  }

  console.log("");

  // More requests from Tenant 1
  currentContext = { tenantId: "acme-corp", userId: "dave@acme.com", tier: "pro" };

  if (checkTenantLimit(currentContext)) {
    await client.responses.create({
      model: "gpt-5-mini-2025-08-07",
      input: "Best practices for API rate limiting",
      max_output_tokens: 150,
    });
  }

  // Generate final report
  generateUsageReport();
}

simulateTenantRequests().catch(console.error);
