import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import type { CallSite } from "./types.js";

// Re-export CallSite for convenience
export type { CallSite } from "./types.js";

/**
 * Context for tracking related LLM calls within a trace (OTel-compatible)
 */
export interface MeterContext {
  /** Trace ID grouping related operations (OTel standard) */
  traceId: string;
  /** Current call sequence number within trace */
  callSequence: number;
  /** Stack of agent/function names for nested calls */
  agentStack: string[];
  /** Parent span ID for hierarchical tracking (OTel standard) */
  parentSpanId?: string;
  /** Custom metadata attached to this context */
  metadata?: Record<string, unknown>;
  /** Stack fingerprint for heuristic grouping */
  stackFingerprint?: string;
}

/**
 * Extended metric event with call relationship tracking (OTel-compatible)
 */
export interface CallRelationship {
  /** Trace ID grouping related operations (OTel standard) */
  traceId: string;
  /** Parent span ID if this is a nested call (OTel standard) */
  parentSpanId?: string;
  /** Sequence number within the trace */
  callSequence: number;
  /** Stack of agent names leading to this call */
  agentStack: string[];
  /** Where in the code this call originated (immediate caller) */
  callSite?: CallSite;
  /** Full call stack for detailed tracing */
  callStack?: string[];
}

// AsyncLocalStorage for automatic context propagation
const meterContextStorage = new AsyncLocalStorage<MeterContext>();

// Global session for auto-init mode
let globalSession: MeterContext | null = null;

/**
 * Patterns to identify agent/handler functions from stack traces
 */
const AGENT_PATTERNS = [
  /(\w+Agent)\./i,
  /(\w+Handler)\./i,
  /(\w+Service)\./i,
  /(\w+Controller)\./i,
  /handle(\w+)/i,
  /process(\w+)/i,
  /run(\w+)/i,
  /execute(\w+)/i,
];

/**
 * Files/patterns to skip when parsing stack traces
 */
const SKIP_PATTERNS = [
  /node_modules/,
  /node:internal/,
  /llm-meter/,
  /openai-meter/,
  /arp-ingress-exp/,
  /dist\/index\.(m?js|cjs)/,
  /<anonymous>/,
  /^native /,
];

/**
 * Parse a V8 stack trace line into a CallSite
 */
function parseStackLine(line: string): CallSite | null {
  // V8 format: "    at functionName (file:line:column)"
  // or: "    at file:line:column"
  const match = line.match(
    /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/
  );

  if (!match) return null;

  const [, func, file, lineStr, colStr] = match;

  // Skip internal/library frames
  if (SKIP_PATTERNS.some((p) => p.test(file))) {
    return null;
  }

  return {
    file,
    line: parseInt(lineStr, 10),
    column: parseInt(colStr, 10),
    function: func || undefined,
  };
}

/**
 * Extract the first user-code call site from the current stack
 */
export function extractCallSite(): CallSite | undefined {
  const err = new Error();
  const stack = err.stack?.split("\n") ?? [];

  // Skip first line ("Error") and internal frames
  for (let i = 1; i < stack.length; i++) {
    const site = parseStackLine(stack[i]);
    if (site) {
      return site;
    }
  }

  return undefined;
}

/**
 * Default max frames to capture in call stack
 */
const DEFAULT_MAX_STACK_FRAMES = 10;

/**
 * Extract multiple call stack frames from the current stack.
 * Returns an array of formatted strings: "file:line:function" or "file:line"
 *
 * @param maxFrames - Maximum number of frames to capture (default: 10)
 */
export function extractCallStack(maxFrames: number = DEFAULT_MAX_STACK_FRAMES): string[] {
  const err = new Error();
  const stack = err.stack?.split("\n") ?? [];
  const frames: string[] = [];

  // Skip first line ("Error") and internal frames
  for (let i = 1; i < stack.length && frames.length < maxFrames; i++) {
    const site = parseStackLine(stack[i]);
    if (site) {
      // Format: "file:line:function" or "file:line" if no function
      const frame = site.function
        ? `${site.file}:${site.line}:${site.function}`
        : `${site.file}:${site.line}`;
      frames.push(frame);
    }
  }

  return frames;
}

/**
 * Extract agent names from the current call stack
 */
export function extractAgentStack(): string[] {
  const err = new Error();
  const stack = err.stack?.split("\n") ?? [];
  const agents: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < stack.length; i++) {
    const line = stack[i];

    // Skip internal frames
    if (SKIP_PATTERNS.some((p) => p.test(line))) {
      continue;
    }

    // Try to extract agent name from function/class name
    for (const pattern of AGENT_PATTERNS) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const agent = match[1];
        if (!seen.has(agent)) {
          seen.add(agent);
          agents.push(agent);
        }
        break;
      }
    }
  }

  return agents;
}

/**
 * Generate a fingerprint from the call stack for grouping related calls
 */
export function generateStackFingerprint(): string {
  const err = new Error();
  const stack = err.stack?.split("\n") ?? [];
  const significantFrames: string[] = [];

  for (let i = 1; i < stack.length && significantFrames.length < 5; i++) {
    const site = parseStackLine(stack[i]);
    if (site) {
      // Create a stable identifier from file + line
      significantFrames.push(`${site.file}:${site.line}`);
    }
  }

  // Create a simple hash
  const str = significantFrames.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Create a new meter context
 */
export function createMeterContext(options?: {
  traceId?: string;
  metadata?: Record<string, unknown>;
}): MeterContext {
  return {
    traceId: options?.traceId ?? randomUUID(),
    callSequence: 0,
    agentStack: [],
    metadata: options?.metadata,
    stackFingerprint: generateStackFingerprint(),
  };
}

/**
 * Get the current meter context, creating one automatically if needed
 *
 * This enables zero-wrapper usage - the first LLM call will auto-create
 * a session context that subsequent calls will inherit.
 */
export function getCurrentContext(): MeterContext {
  // First, check AsyncLocalStorage
  const stored = meterContextStorage.getStore();
  if (stored) {
    return stored;
  }

  // Fall back to global session (for auto-init mode)
  if (!globalSession) {
    globalSession = createMeterContext();
  }

  return globalSession;
}

/**
 * Check if we're currently inside a meter context
 */
export function hasContext(): boolean {
  return meterContextStorage.getStore() !== undefined || globalSession !== null;
}

/**
 * Run a function within a new meter context (trace)
 *
 * @example
 * ```ts
 * await withMeterContext(async () => {
 *   // All LLM calls here share the same trace
 *   await client.responses.create({ ... });
 *   await client.responses.create({ ... });
 * }, { metadata: { userId: "123" } });
 * ```
 */
export function withMeterContext<T>(
  fn: () => T,
  options?: {
    traceId?: string;
    metadata?: Record<string, unknown>;
  }
): T {
  const ctx = createMeterContext(options);
  return meterContextStorage.run(ctx, fn);
}

/**
 * Run an async function within a new meter context (trace)
 */
export async function withMeterContextAsync<T>(
  fn: () => Promise<T>,
  options?: {
    traceId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<T> {
  const ctx = createMeterContext(options);
  return meterContextStorage.run(ctx, fn);
}

/**
 * Enter a meter context that persists across awaits without explicit wrapping
 *
 * This is the zero-wrapper approach - call once at the start of your
 * request/session handler, and all subsequent LLM calls will be tracked.
 *
 * @example
 * ```ts
 * app.post('/chat', async (req, res) => {
 *   enterMeterContext({ metadata: { userId: req.userId } });
 *
 *   // All LLM calls in this request are now tracked together
 *   const response = await client.responses.create({ ... });
 *   res.json(response);
 * });
 * ```
 */
export function enterMeterContext(options?: {
  traceId?: string;
  metadata?: Record<string, unknown>;
}): MeterContext {
  const ctx = createMeterContext(options);
  meterContextStorage.enterWith(ctx);
  return ctx;
}

/**
 * Push an agent name onto the current context's agent stack
 *
 * Use this when entering a named agent/handler to track nesting.
 */
export function pushAgent(name: string): void {
  const ctx = getCurrentContext();
  ctx.agentStack.push(name);
}

/**
 * Pop an agent name from the current context's agent stack
 */
export function popAgent(): string | undefined {
  const ctx = getCurrentContext();
  return ctx.agentStack.pop();
}

/**
 * Run a function within a named agent context
 *
 * @example
 * ```ts
 * await withAgent("ResearchAgent", async () => {
 *   // LLM calls here will have "ResearchAgent" in their agentStack
 *   await client.responses.create({ ... });
 * });
 * ```
 */
export async function withAgent<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  pushAgent(name);
  try {
    return await fn();
  } finally {
    popAgent();
  }
}

/**
 * Get call relationship info for the current context
 *
 * This is called internally by the meter to attach relationship
 * data to each metric event.
 * @param spanId - The span ID of the current operation
 */
export function getCallRelationship(spanId: string): CallRelationship {
  const ctx = getCurrentContext();

  // Increment call sequence
  ctx.callSequence++;

  // Build relationship info
  const relationship: CallRelationship = {
    traceId: ctx.traceId,
    callSequence: ctx.callSequence,
    agentStack: [...ctx.agentStack],
    parentSpanId: ctx.parentSpanId,
    callSite: extractCallSite(),
    callStack: extractCallStack(),
  };

  // Update parent span for next call (if nesting)
  // The current call becomes the parent of subsequent calls
  ctx.parentSpanId = spanId;

  return relationship;
}

/**
 * Reset the global session (useful for testing)
 */
export function resetGlobalSession(): void {
  globalSession = null;
}

/**
 * Set custom metadata on the current context
 */
export function setContextMetadata(
  key: string,
  value: unknown
): void {
  const ctx = getCurrentContext();
  if (!ctx.metadata) {
    ctx.metadata = {};
  }
  ctx.metadata[key] = value;
}

/**
 * Get custom metadata from the current context
 */
export function getContextMetadata(key: string): unknown {
  const ctx = getCurrentContext();
  return ctx.metadata?.[key];
}

/**
 * Merge stack-detected agents with explicit agent stack
 */
export function getFullAgentStack(): string[] {
  const ctx = getCurrentContext();
  const detected = extractAgentStack();

  // Combine explicit agents with detected ones, explicit first
  const combined = [...ctx.agentStack];
  for (const agent of detected) {
    if (!combined.includes(agent)) {
      combined.push(agent);
    }
  }

  return combined;
}
