#!/usr/bin/env node
/**
 * Visualize LLM metrics from JSONL file
 * Usage: node visualize-metrics.js <path-to-jsonl>
 */

const fs = require("fs");

const filePath = process.argv[2] || "/home/timothy/aden/aden-mcp/packages/api-server/llm-metrics.jsonl";

// Parse JSONL
const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
const events = lines.map(line => JSON.parse(line));

// Build span map
const spanMap = new Map();
events.forEach(e => spanMap.set(e.span_id, e));

// Find root spans (no parent)
const roots = events.filter(e => !e.parent_span_id);

// Extract function name from call stack entry
function extractFn(stackEntry) {
  const match = stackEntry.match(/:(\d+):(.+)$/);
  if (match) return match[2].replace("async ", "");
  return stackEntry.split(":").pop() || "unknown";
}

// Build simplified call path from call_stack
function getCallPath(event) {
  if (!event.call_stack || event.call_stack.length === 0) return "unknown";
  // Skip the first entry (gemini-llm.js) and get the meaningful caller
  const meaningful = event.call_stack.slice(1, 4).map(extractFn);
  return meaningful.join(" → ");
}

// Print tree structure
function printTree(spanId, depth = 0, isLast = true, prefix = "") {
  const event = spanMap.get(spanId);
  if (!event) return;

  const connector = depth === 0 ? "" : (isLast ? "└── " : "├── ");
  const childPrefix = depth === 0 ? "" : (isLast ? "    " : "│   ");

  // Format model name
  const model = event.model.replace("models/", "");

  // Get call path
  const callPath = getCallPath(event);

  // Token bar
  const tokenBar = "█".repeat(Math.min(20, Math.round(event.total_tokens / 1000)));
  const tokenPct = ((event.total_tokens / totalTokens) * 100).toFixed(1);

  console.log(
    `${prefix}${connector}[#${event.call_sequence}] ${event.agent_stack?.join("→") || "?"} | ${model}` +
    `\n${prefix}${childPrefix}    ${callPath}` +
    `\n${prefix}${childPrefix}    ${tokenBar} ${event.total_tokens.toLocaleString()} tokens (${tokenPct}%) | ${event.latency_ms}ms`
  );

  // Find children
  const children = events.filter(e => e.parent_span_id === spanId);
  children.forEach((child, i) => {
    const isChildLast = i === children.length - 1;
    printTree(child.span_id, depth + 1, isChildLast, prefix + childPrefix);
  });
}

// Calculate totals
const totalTokens = events.reduce((sum, e) => sum + e.total_tokens, 0);
const totalLatency = events.reduce((sum, e) => sum + e.latency_ms, 0);
const totalCalls = events.length;

console.log("\n" + "═".repeat(80));
console.log("LLM USAGE VISUALIZATION");
console.log("═".repeat(80));
console.log(`Trace ID: ${events[0]?.trace_id}`);
console.log(`Total Calls: ${totalCalls} | Total Tokens: ${totalTokens.toLocaleString()} | Total Latency: ${(totalLatency/1000).toFixed(1)}s`);
console.log("─".repeat(80) + "\n");

console.log("CALL TREE (by parent-child relationship)");
console.log("─".repeat(80));
roots.forEach((root, i) => printTree(root.span_id, 0, i === roots.length - 1, ""));

// Aggregate by agent
console.log("\n" + "─".repeat(80));
console.log("USAGE BY AGENT");
console.log("─".repeat(80));

const byAgent = {};
events.forEach(e => {
  const agent = e.agent_stack?.[0] || "Unknown";
  if (!byAgent[agent]) {
    byAgent[agent] = { calls: 0, tokens: 0, latency: 0 };
  }
  byAgent[agent].calls++;
  byAgent[agent].tokens += e.total_tokens;
  byAgent[agent].latency += e.latency_ms;
});

Object.entries(byAgent)
  .sort((a, b) => b[1].tokens - a[1].tokens)
  .forEach(([agent, stats]) => {
    const bar = "█".repeat(Math.round((stats.tokens / totalTokens) * 30));
    const pct = ((stats.tokens / totalTokens) * 100).toFixed(1);
    console.log(`${agent.padEnd(20)} ${bar.padEnd(30)} ${stats.tokens.toLocaleString().padStart(8)} tokens (${pct}%) | ${stats.calls} calls | ${(stats.latency/1000).toFixed(1)}s`);
  });

// Aggregate by call path
console.log("\n" + "─".repeat(80));
console.log("USAGE BY CALL PATH (what function initiated the LLM call)");
console.log("─".repeat(80));

const byPath = {};
events.forEach(e => {
  const path = getCallPath(e);
  if (!byPath[path]) {
    byPath[path] = { calls: 0, tokens: 0, latency: 0, models: new Set() };
  }
  byPath[path].calls++;
  byPath[path].tokens += e.total_tokens;
  byPath[path].latency += e.latency_ms;
  byPath[path].models.add(e.model.replace("models/", ""));
});

Object.entries(byPath)
  .sort((a, b) => b[1].tokens - a[1].tokens)
  .forEach(([path, stats]) => {
    const bar = "█".repeat(Math.round((stats.tokens / totalTokens) * 30));
    const pct = ((stats.tokens / totalTokens) * 100).toFixed(1);
    console.log(`\n${path}`);
    console.log(`  ${bar} ${stats.tokens.toLocaleString()} tokens (${pct}%) | ${stats.calls} calls | ${(stats.latency/1000).toFixed(1)}s`);
    console.log(`  Models: ${[...stats.models].join(", ")}`);
  });

// Model breakdown
console.log("\n" + "─".repeat(80));
console.log("USAGE BY MODEL");
console.log("─".repeat(80));

const byModel = {};
events.forEach(e => {
  const model = e.model.replace("models/", "");
  if (!byModel[model]) {
    byModel[model] = { calls: 0, tokens: 0, latency: 0 };
  }
  byModel[model].calls++;
  byModel[model].tokens += e.total_tokens;
  byModel[model].latency += e.latency_ms;
});

Object.entries(byModel)
  .sort((a, b) => b[1].tokens - a[1].tokens)
  .forEach(([model, stats]) => {
    const bar = "█".repeat(Math.round((stats.tokens / totalTokens) * 30));
    const pct = ((stats.tokens / totalTokens) * 100).toFixed(1);
    console.log(`${model.padEnd(25)} ${bar.padEnd(30)} ${stats.tokens.toLocaleString().padStart(8)} tokens (${pct}%) | ${stats.calls} calls | ${(stats.latency/1000).toFixed(1)}s`);
  });

console.log("\n" + "═".repeat(80) + "\n");
