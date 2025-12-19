/**
 * Fetch-based instrumentation for frameworks that bypass SDK classes
 *
 * Works with: Vercel AI SDK, LangChain, Mastra, and any framework
 * that makes direct HTTP calls to LLM APIs.
 */

import { randomUUID } from "crypto";
import { getCallRelationship, getFullAgentStack, getCurrentContext } from "./context.js";
import { DEFAULT_CONTROL_SERVER, type MetricEvent, type MeterOptions } from "./types.js";
import type { ControlDecision, IControlAgent } from "./control-types.js";
import { createControlAgent, createControlAgentEmitter } from "./control-agent.js";

/**
 * Safely emit a metric event, handling cases where emitMetric might be undefined
 */
async function safeEmit(options: MeterOptions, event: MetricEvent): Promise<void> {
  if (options.emitMetric) {
    await options.emitMetric(event);
  }
}

// Track if we've already instrumented
let isInstrumented = false;
let globalOptions: MeterOptions | null = null;
let originalFetch: typeof fetch | null = null;
let globalControlAgent: IControlAgent | null = null;

/**
 * Resolve options by setting up control agent when apiKey is provided
 */
async function resolveOptions(options: MeterOptions): Promise<MeterOptions> {
  // Check for API key (explicit or from environment)
  const apiKey = options.apiKey ?? process.env.ADEN_API_KEY;

  if (apiKey) {
    // Create control agent if not already provided
    if (!options.controlAgent) {
      globalControlAgent = createControlAgent({
        serverUrl: options.serverUrl ?? DEFAULT_CONTROL_SERVER,
        apiKey,
        failOpen: options.failOpen ?? true,
      });

      // Connect the control agent
      await globalControlAgent.connect();
    } else {
      globalControlAgent = options.controlAgent;
    }

    // Create emitter that sends to control agent
    const controlEmitter = createControlAgentEmitter(globalControlAgent);

    // If user also provided emitMetric, combine them
    const emitMetric: MeterOptions["emitMetric"] = options.emitMetric
      ? async (event) => {
          await Promise.all([
            options.emitMetric!(event),
            controlEmitter(event),
          ]);
        }
      : controlEmitter;

    return {
      ...options,
      emitMetric,
      controlAgent: globalControlAgent,
    };
  }

  // No API key - require emitMetric
  if (!options.emitMetric) {
    throw new Error(
      "aden: Either apiKey or emitMetric is required.\n" +
      "  Option 1: Set ADEN_API_KEY environment variable\n" +
      "  Option 2: Pass apiKey in options\n" +
      "  Option 3: Pass emitMetric for custom handling"
    );
  }

  return options;
}

type Provider = "openai" | "anthropic" | "gemini";

// API endpoint patterns to intercept
const API_PATTERNS: { provider: Provider; pattern: RegExp }[] = [
  { provider: "openai", pattern: /api\.openai\.com/ },
  { provider: "anthropic", pattern: /api\.anthropic\.com/ },
  { provider: "gemini", pattern: /generativelanguage\.googleapis\.com/ },
];

/**
 * Extract model from request/response based on provider
 */
function extractModel(provider: string, url: string, body: unknown, responseBody: unknown): string {
  try {
    const req = body as Record<string, unknown>;
    const res = responseBody as Record<string, unknown>;

    if (provider === "openai") {
      return (req?.model as string) ?? (res?.model as string) ?? "unknown";
    }
    if (provider === "anthropic") {
      return (req?.model as string) ?? (res?.model as string) ?? "unknown";
    }
    if (provider === "gemini") {
      // Model is in URL: /models/gemini-2.0-flash:generateContent
      const match = url.match(/models\/([^:/?]+)/);
      return match?.[1] ?? "unknown";
    }
  } catch {
    // Ignore parsing errors
  }
  return "unknown";
}

/**
 * Extract usage/tokens from response based on provider
 */
function extractUsage(provider: string, responseBody: unknown): {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
} {
  try {
    const res = responseBody as Record<string, unknown>;

    if (provider === "openai") {
      const usage = res?.usage as Record<string, unknown>;
      return {
        input: (usage?.prompt_tokens as number) ?? 0,
        output: (usage?.completion_tokens as number) ?? 0,
        cached: (usage?.prompt_tokens_details as Record<string, unknown>)?.cached_tokens as number ?? 0,
        reasoning: (usage?.completion_tokens_details as Record<string, unknown>)?.reasoning_tokens as number ?? 0,
      };
    }

    if (provider === "anthropic") {
      const usage = res?.usage as Record<string, unknown>;
      return {
        input: (usage?.input_tokens as number) ?? 0,
        output: (usage?.output_tokens as number) ?? 0,
        cached: (usage?.cache_read_input_tokens as number) ?? 0,
        reasoning: 0,
      };
    }

    if (provider === "gemini") {
      const usage = res?.usageMetadata as Record<string, unknown>;
      return {
        input: (usage?.promptTokenCount as number) ?? 0,
        output: (usage?.candidatesTokenCount as number) ?? 0,
        cached: (usage?.cachedContentTokenCount as number) ?? 0,
        reasoning: 0,
      };
    }
  } catch {
    // Ignore parsing errors
  }

  return { input: 0, output: 0, cached: 0, reasoning: 0 };
}

/**
 * Sleep helper for throttling
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get control decision from agent if available
 */
async function getControlDecision(
  options: MeterOptions,
  provider: Provider,
  model: string,
  spanId: string
): Promise<{ decision: ControlDecision; originalModel: string }> {
  const originalModel = model;

  if (!options.controlAgent) {
    return { decision: { action: "allow" }, originalModel };
  }

  const ctx = getCurrentContext();
  const decision = await options.controlAgent.getDecision({
    context_id: ctx.traceId,
    provider,
    model,
    metadata: options.requestMetadata,
  });

  // Report control event
  await options.controlAgent.reportControlEvent({
    trace_id: ctx.traceId,
    span_id: spanId,
    context_id: ctx.traceId,
    provider,
    original_model: originalModel,
    action: decision.action,
    reason: decision.reason,
    degraded_to: decision.degradeToModel,
    throttle_delay_ms: decision.throttleDelayMs,
  });

  return { decision, originalModel };
}

/**
 * Apply model degradation to request body
 */
function applyModelDegradation(body: unknown, newModel: string): unknown {
  if (body && typeof body === "object") {
    return { ...body as Record<string, unknown>, model: newModel };
  }
  return body;
}

/**
 * Build a metric event from fetch request/response
 */
function buildMetricEvent(
  spanId: string,
  provider: Provider,
  model: string,
  stream: boolean,
  latencyMs: number,
  usage: { input: number; output: number; cached: number; reasoning: number },
  _options: MeterOptions,
  relationship: ReturnType<typeof getCallRelationship> | null,
  error?: string
): MetricEvent {

  const event: MetricEvent = {
    trace_id: relationship?.traceId ?? spanId,
    span_id: spanId,
    request_id: null,
    provider,
    model,
    stream,
    timestamp: new Date().toISOString(),
    latency_ms: latencyMs,
    input_tokens: usage.input,
    output_tokens: usage.output,
    total_tokens: usage.input + usage.output,
    cached_tokens: usage.cached,
    reasoning_tokens: usage.reasoning,
  };

  if (error) {
    event.error = error;
  }

  if (relationship) {
    const agentStack = getFullAgentStack();
    if (relationship.parentSpanId) event.parent_span_id = relationship.parentSpanId;
    if (relationship.callSequence !== undefined) event.call_sequence = relationship.callSequence;
    if (agentStack.length > 0) event.agent_stack = agentStack;
    if (relationship.callSite) {
      event.call_site_file = relationship.callSite.file;
      event.call_site_line = relationship.callSite.line;
      event.call_site_column = relationship.callSite.column;
      if (relationship.callSite.function) event.call_site_function = relationship.callSite.function;
    }
    if (relationship.callStack?.length) event.call_stack = relationship.callStack;
  }

  return event;
}

/**
 * Instrument global fetch to capture LLM API calls
 */
export async function instrumentFetch(options: MeterOptions): Promise<boolean> {
  if (isInstrumented) {
    console.warn("[aden] Fetch already instrumented.");
    return true;
  }

  if (typeof globalThis.fetch !== "function") {
    console.warn("[aden] No global fetch available.");
    return false;
  }

  // Resolve options (create control agent if apiKey provided)
  globalOptions = await resolveOptions(options);
  originalFetch = globalThis.fetch;

  const controlStatus = globalControlAgent ? " + control agent" : "";
  console.log(`[aden] Instrumented: fetch${controlStatus}`);

  globalThis.fetch = async function instrumentedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;

    // Check if this is an LLM API call
    const matchedProvider = API_PATTERNS.find(p => p.pattern.test(url));
    if (!matchedProvider) {
      return originalFetch!(input, init);
    }

    const provider = matchedProvider.provider;
    const spanId = globalOptions?.generateSpanId?.() ?? randomUUID();
    const t0 = Date.now();

    // Parse request body
    let requestBody: unknown = null;
    if (init?.body) {
      try {
        requestBody = JSON.parse(init.body as string);
      } catch {
        // Not JSON body
      }
    }

    const isStream = (requestBody as Record<string, unknown>)?.stream === true;
    let model = extractModel(provider, url, requestBody, null);

    // Capture call relationship BEFORE the fetch (preserves call stack)
    const relationship = globalOptions?.trackCallRelationships !== false
      ? getCallRelationship(spanId)
      : null;

    // Get control decision if control agent is configured
    const { decision } = await getControlDecision(
      globalOptions!,
      provider,
      model,
      spanId
    );

    // Apply control decision
    let modifiedInit = init;
    switch (decision.action) {
      case "block":
        // Create a blocked error event
        const blockedEvent = buildMetricEvent(
          spanId,
          provider,
          model,
          isStream,
          0,
          { input: 0, output: 0, cached: 0, reasoning: 0 },
          globalOptions!,
          relationship,
          `Blocked: ${decision.reason ?? "Policy violation"}`
        );
        await safeEmit(globalOptions!, blockedEvent);

        // Also report to control agent
        if (globalOptions?.controlAgent) {
          await globalOptions.controlAgent.reportMetric(blockedEvent);
        }

        throw new Error(`Request blocked: ${decision.reason ?? "Policy violation"}`);

      case "throttle":
        if (decision.throttleDelayMs) {
          await sleep(decision.throttleDelayMs);
        }
        break;

      case "degrade":
        if (decision.degradeToModel) {
          model = decision.degradeToModel;
          requestBody = applyModelDegradation(requestBody, decision.degradeToModel);
          // Update the request init with new body
          if (init?.body) {
            modifiedInit = {
              ...init,
              body: JSON.stringify(requestBody),
            };
          }
        }
        break;
    }

    try {
      const response = await originalFetch!(input, modifiedInit);

      // Clone response to read body without consuming it
      const clonedResponse = response.clone();

      // For non-streaming responses, we can read the body
      if (!isStream && response.ok) {
        try {
          const responseBody = await clonedResponse.json();
          const model = extractModel(provider, url, requestBody, responseBody);
          const usage = extractUsage(provider, responseBody);

          const event = buildMetricEvent(
            spanId,
            provider,
            model,
            false,
            Date.now() - t0,
            usage,
            globalOptions!,
            relationship
          );

          await safeEmit(globalOptions!, event);
        } catch {
          // Failed to parse response, still emit basic metric
          const model = extractModel(provider, url, requestBody, null);
          const event = buildMetricEvent(
            spanId,
            provider,
            model,
            false,
            Date.now() - t0,
            { input: 0, output: 0, cached: 0, reasoning: 0 },
            globalOptions!,
            relationship
          );
          await safeEmit(globalOptions!, event);
        }
      } else if (isStream && response.ok && response.body) {
        // For streaming, wrap the body to capture when stream ends
        const model = extractModel(provider, url, requestBody, null);
        const originalBody = response.body;

        let streamedData = "";
        const transformStream = new TransformStream({
          transform(chunk, controller) {
            // Collect streamed data for final parsing
            const text = new TextDecoder().decode(chunk);
            streamedData += text;
            controller.enqueue(chunk);
          },
          async flush() {
            // Stream complete, try to extract final usage from SSE data
            let usage = { input: 0, output: 0, cached: 0, reasoning: 0 };

            try {
              // Look for usage in SSE events (OpenAI format)
              const lines = streamedData.split("\n");
              for (const line of lines.reverse()) {
                if (line.startsWith("data: ") && !line.includes("[DONE]")) {
                  const data = JSON.parse(line.slice(6));
                  if (data.usage) {
                    usage = extractUsage(provider, data);
                    break;
                  }
                }
              }
            } catch {
              // Ignore parsing errors
            }

            const event = buildMetricEvent(
              spanId,
              provider,
              model,
              true,
              Date.now() - t0,
              usage,
              globalOptions!,
              relationship
            );
            await safeEmit(globalOptions!, event);
          },
        });

        // Return new response with transformed body
        return new Response(originalBody.pipeThrough(transformStream), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } else if (!response.ok) {
        // Error response
        const model = extractModel(provider, url, requestBody, null);
        const event = buildMetricEvent(
          spanId,
          provider,
          model,
          isStream,
          Date.now() - t0,
          { input: 0, output: 0, cached: 0, reasoning: 0 },
          globalOptions!,
          relationship,
          `HTTP ${response.status}: ${response.statusText}`
        );
        await safeEmit(globalOptions!, event);
      }

      return response;
    } catch (error) {
      const model = extractModel(provider, url, requestBody, null);
      const event = buildMetricEvent(
        spanId,
        provider,
        model,
        isStream,
        Date.now() - t0,
        { input: 0, output: 0, cached: 0, reasoning: 0 },
        globalOptions!,
        relationship,
        error instanceof Error ? error.message : String(error)
      );
      await safeEmit(globalOptions!, event);
      throw error;
    }
  };

  isInstrumented = true;
  return true;
}

/**
 * Remove fetch instrumentation
 */
export async function uninstrumentFetch(): Promise<void> {
  if (!isInstrumented || !originalFetch) {
    return;
  }

  // Disconnect control agent if connected
  if (globalControlAgent) {
    await globalControlAgent.disconnect();
    globalControlAgent = null;
  }

  globalThis.fetch = originalFetch;
  originalFetch = null;
  globalOptions = null;
  isInstrumented = false;
}

/**
 * Check if fetch is instrumented
 */
export function isFetchInstrumented(): boolean {
  return isInstrumented;
}
