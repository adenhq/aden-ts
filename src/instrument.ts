/**
 * Unified instrumentation for LLM SDKs.
 *
 * Call `instrument()` once at startup, and all available LLM client instances
 * (OpenAI, Gemini, Anthropic) are automatically detected and metered.
 */

import { instrumentOpenAI, uninstrumentOpenAI, isOpenAIInstrumented } from "./instrument-openai.js";
import { instrumentGemini, uninstrumentGemini, isGeminiInstrumented } from "./instrument-gemini.js";
import { instrumentAnthropic, uninstrumentAnthropic, isAnthropicInstrumented } from "./instrument-anthropic.js";
import { createControlAgent, createControlAgentEmitter } from "./control-agent.js";
import { getControlServerUrl, type MeterOptions, type BeforeRequestHook, type BeforeRequestContext } from "./types.js";
import type { IControlAgent } from "./control-types.js";

/**
 * Result of instrumentation showing which SDKs were instrumented
 */
export interface InstrumentationResult {
  openai: boolean;
  gemini: boolean;
  anthropic: boolean;
  controlAgent: IControlAgent | null;
}

// Track global options and control agent
let globalOptions: MeterOptions | null = null;
let globalControlAgent: IControlAgent | null = null;

/**
 * Creates a beforeRequest hook that integrates with the control agent
 * to enforce budget limits, throttling, and model degradation
 */
function createControlBeforeRequestHook(
  controlAgent: IControlAgent,
  getContextId?: () => string | undefined,
  userHook?: BeforeRequestHook
): BeforeRequestHook {
  return async (params: Record<string, unknown>, context: BeforeRequestContext) => {
    // First, call user's hook if provided
    if (userHook) {
      const userResult = await userHook(params, context);
      if (userResult.action === "cancel") {
        return userResult;
      }
      if (userResult.action === "throttle") {
        // Apply user's throttle, but continue to check control agent
        await new Promise((r) => setTimeout(r, userResult.delayMs));
      }
      if (userResult.action === "degrade") {
        // User's degrade takes precedence
        return userResult;
      }
    }

    // Get decision from control agent
    const contextId = getContextId?.();
    const decision = await controlAgent.getDecision({
      context_id: contextId,
      provider: "openai", // TODO: detect provider from SDK
      model: params.model as string,
      // Don't estimate cost - let the decision be based on current spend only
      // The server will calculate actual cost after the request
    });

    // Map control decision to beforeRequest result
    switch (decision.action) {
      case "block":
        return { action: "cancel", reason: decision.reason || "Budget exceeded" };

      case "throttle":
        console.log(`[aden] Request throttled: ${decision.reason}`);
        return { action: "throttle", delayMs: decision.throttleDelayMs || 1000 };

      case "degrade":
        console.log(`[aden] Model degraded: ${params.model} → ${decision.degradeToModel} (${decision.reason})`);
        if (decision.throttleDelayMs) {
          console.log(`[aden] Request also throttled: ${decision.throttleDelayMs}ms delay`);
        }
        return {
          action: "degrade",
          toModel: decision.degradeToModel!,
          reason: decision.reason,
          ...(decision.throttleDelayMs && { delayMs: decision.throttleDelayMs }),
        };

      case "alert":
        // Alerts allow the request to proceed but log the alert
        console.log(`[aden] Alert [${decision.alertLevel}]: ${decision.reason}`);
        if (decision.throttleDelayMs) {
          console.log(`[aden] Request also throttled: ${decision.throttleDelayMs}ms delay`);
        }
        return {
          action: "alert",
          level: decision.alertLevel || "warning",
          message: decision.reason || "Alert triggered",
          ...(decision.throttleDelayMs && { delayMs: decision.throttleDelayMs }),
        };

      case "allow":
      default:
        return { action: "proceed" };
    }
  };
}

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
        serverUrl: getControlServerUrl(options.serverUrl),
        apiKey,
        failOpen: options.failOpen ?? true,
        getContextId: options.getContextId,
        onAlert: options.onAlert,
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

    // Create beforeRequest hook that checks with control agent
    const beforeRequest = createControlBeforeRequestHook(
      globalControlAgent,
      options.getContextId,
      options.beforeRequest
    );

    return {
      ...options,
      emitMetric,
      beforeRequest,
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

/**
 * Instrument all available LLM SDKs globally.
 *
 * Call once at application startup. All detected LLM client instances
 * (OpenAI, Gemini, Anthropic) will automatically be metered.
 *
 * The function auto-detects which SDKs are installed and instruments them.
 * SDKs that aren't installed are silently skipped.
 *
 * @example
 * ```typescript
 * import { instrument } from "aden";
 * import OpenAI from "openai";
 *
 * // Simplest setup - just provide API key
 * await instrument({
 *   apiKey: process.env.ADEN_API_KEY,
 *   sdks: { OpenAI },
 * });
 *
 * // Or use ADEN_API_KEY environment variable
 * await instrument({ sdks: { OpenAI } });
 *
 * // Use any LLM SDK normally - metrics collected automatically
 * const openai = new OpenAI();
 * ```
 */
export async function instrument(options: MeterOptions): Promise<InstrumentationResult> {
  // Resolve options (create control agent if apiKey provided)
  const resolvedOptions = await resolveOptions(options);
  globalOptions = resolvedOptions;

  // Run all instrumentations in parallel
  const [openai, gemini, anthropic] = await Promise.all([
    instrumentOpenAI(resolvedOptions),
    instrumentGemini(resolvedOptions),
    instrumentAnthropic(resolvedOptions),
  ]);

  const result: InstrumentationResult = {
    openai,
    gemini,
    anthropic,
    controlAgent: globalControlAgent,
  };

  // Log which SDKs were instrumented
  const instrumented = Object.entries(result)
    .filter(([key, success]) => key !== "controlAgent" && success)
    .map(([name]) => name);

  if (instrumented.length > 0) {
    const controlStatus = globalControlAgent ? " + control agent" : "";
    console.log(`[aden] Instrumented: ${instrumented.join(", ")}${controlStatus}`);
  } else {
    console.warn("[aden] No LLM SDKs found to instrument");
  }

  return result;
}

/**
 * Remove instrumentation from all LLM SDKs.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrument(): Promise<void> {
  // Disconnect control agent if connected
  if (globalControlAgent) {
    await globalControlAgent.disconnect();
    globalControlAgent = null;
  }

  await Promise.all([
    uninstrumentOpenAI(),
    uninstrumentGemini(),
    uninstrumentAnthropic(),
  ]);
  globalOptions = null;
}

/**
 * Check which SDKs are currently instrumented
 */
export function getInstrumentedSDKs(): InstrumentationResult {
  return {
    openai: isOpenAIInstrumented(),
    gemini: isGeminiInstrumented(),
    anthropic: isAnthropicInstrumented(),
    controlAgent: globalControlAgent,
  };
}

/**
 * Check if any SDK is currently instrumented
 */
export function isInstrumented(): boolean {
  return isOpenAIInstrumented() || isGeminiInstrumented() || isAnthropicInstrumented();
}

/**
 * Get the current instrumentation options
 */
export function getInstrumentationOptions(): MeterOptions | null {
  return globalOptions;
}

/**
 * Update instrumentation options without re-instrumenting.
 *
 * Useful for changing emitters or settings at runtime.
 */
export function updateInstrumentationOptions(
  updates: Partial<MeterOptions>
): void {
  if (!globalOptions) {
    throw new Error(
      "Cannot update options: No LLM SDK is instrumented. Call instrument() first."
    );
  }

  globalOptions = { ...globalOptions, ...updates };
}

// Re-export provider-specific functions for advanced use cases
export {
  instrumentOpenAI,
  uninstrumentOpenAI,
  isOpenAIInstrumented,
} from "./instrument-openai.js";

export {
  instrumentGemini,
  uninstrumentGemini,
  isGeminiInstrumented,
} from "./instrument-gemini.js";

export {
  instrumentAnthropic,
  uninstrumentAnthropic,
  isAnthropicInstrumented,
} from "./instrument-anthropic.js";

export {
  instrumentFetch,
  uninstrumentFetch,
  isFetchInstrumented,
} from "./instrument-fetch.js";
