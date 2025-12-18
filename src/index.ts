// Core metering functionality
export { makeMeteredOpenAI, isMetered } from "./meter.js";

// Global instrumentation (preferred) - auto-detects all LLM SDKs
export {
  // Main entry point
  instrument,
  uninstrument,
  isInstrumented,
  getInstrumentedSDKs,
  getInstrumentationOptions,
  updateInstrumentationOptions,
  // Provider-specific (for advanced use)
  instrumentOpenAI,
  uninstrumentOpenAI,
  isOpenAIInstrumented,
  instrumentGemini,
  uninstrumentGemini,
  isGeminiInstrumented,
  instrumentAnthropic,
  uninstrumentAnthropic,
  isAnthropicInstrumented,
} from "./instrument.js";
export type { InstrumentationResult } from "./instrument.js";

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
  createJsonFileEmitter,
} from "./emitters.js";
export type { JsonFileEmitterOptions } from "./emitters.js";

// HTTP transport
export {
  HttpTransport,
  createHttpTransport,
  createHttpEmitter,
} from "./http-transport.js";
export type {
  HttpTransportOptions,
  TransportStats,
  QueueOverflowHandler,
  SendErrorHandler,
} from "./http-transport.js";

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
  SDKClasses,
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
