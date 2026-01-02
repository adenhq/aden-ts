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
  // Fetch instrumentation (for frameworks like Vercel AI SDK, LangChain)
  instrumentFetch,
  uninstrumentFetch,
  isFetchInstrumented,
} from "./instrument.js";
export type { InstrumentationResult } from "./instrument.js";

// Google GenAI instrumentation (new SDK for Google ADK)
export {
  instrumentGenai,
  uninstrumentGenai,
  isGenaiInstrumented,
  getGenaiOptions,
} from "./instrument-genai.js";

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
export {
  normalizeUsage,
  normalizeOpenAIUsage,
  normalizeAnthropicUsage,
  normalizeGeminiUsage,
  emptyUsage,
  mergeUsage,
} from "./normalize.js";

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

// File-based logging
export { MetricFileLogger, createFileEmitter } from "./file-logger.js";
export type { MetricFileLoggerOptions } from "./file-logger.js";

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

// Constants
export { DEFAULT_CONTROL_SERVER, getControlServerUrl } from "./types.js";

// Logging configuration
export {
  configureLogging,
  getLoggingConfig,
  resetLoggingConfig,
  logger,
  metricsLogger,
} from "./logging.js";
export type { LogLevel, LoggingConfig, LogHandler } from "./logging.js";

// Control Agent (bidirectional server communication)
export {
  ControlAgent,
  createControlAgent,
  createControlAgentEmitter,
} from "./control-agent.js";
export type {
  ControlAction,
  ControlDecision,
  ControlEvent,
  ControlPolicy,
  ControlRequest,
  ControlAgentOptions,
  IControlAgent,
  BudgetRule,
  ThrottleRule,
  BlockRule,
  DegradeRule,
  AlertRule,
  AlertEvent,
  HeartbeatEvent,
  // Hybrid enforcement types
  BudgetValidationRequest,
  BudgetValidationResponse,
} from "./control-types.js";
