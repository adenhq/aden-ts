// Core metering functionality
export { makeMeteredOpenAI, isMetered } from "./meter.js";

// Context tracking for call relationships
export {
  // Context management
  createMeterContext,
  getCurrentContext,
  hasContext,
  withMeterContext,
  withMeterContextAsync,
  enterMeterContext,
  resetGlobalSession,
  // Agent tracking
  pushAgent,
  popAgent,
  withAgent,
  // Stack inspection
  extractCallSite,
  extractAgentStack,
  getFullAgentStack,
  generateStackFingerprint,
  // Context metadata
  setContextMetadata,
  getContextMetadata,
} from "./context.js";
export type { MeterContext, CallRelationship } from "./context.js";

// Usage normalization utilities
export { normalizeUsage, emptyUsage, mergeUsage } from "./normalize.js";

// Budget guardrails
export {
  withBudgetGuardrails,
  countInputTokens,
  createBudgetedMeteredClient,
  BudgetExceededError,
} from "./budget.js";

// Metric emitters
export {
  createConsoleEmitter,
  createBatchEmitter,
  createMultiEmitter,
  createFilteredEmitter,
  createTransformEmitter,
  createNoopEmitter,
  createMemoryEmitter,
} from "./emitters.js";

// Analytics engine
export { AnalyticsEngine, createAnalyticsEmitter } from "./analytics.js";
export type { AnalyticsReport } from "./analytics.js";

// Report builder & HTML generation
export { ReportBuilder, createReportEmitter } from "./report-builder.js";
export { generateHTMLReport } from "./html-report.js";
export {
  simulateConversation,
  simulateMultiTenant,
  simulateCascadedAgents,
} from "./pattern-simulator.js";

// Report types
export type {
  AnalyticsJSON,
  PatternEvent,
  ConversationPattern,
  TenantUsage,
  MultiTenantPattern,
  AgentExecution,
  CascadedAgentPattern,
  ToolCall,
} from "./report-types.js";

// Types
export type {
  NormalizedUsage,
  RequestMetadata,
  MetricEvent,
  RateLimitInfo,
  ToolCallMetric,
  MetricEmitter,
  MeterOptions,
  BudgetConfig,
  BudgetExceededInfo,
  StreamingEventType,
  MeteredOpenAI,
  BeforeRequestContext,
  BeforeRequestResult,
  BeforeRequestHook,
  CallSite,
} from "./types.js";

// Error classes
export { RequestCancelledError } from "./types.js";
