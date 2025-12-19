/**
 * Unified instrumentation for LLM SDKs.
 *
 * Call `instrument()` once at startup, and all available LLM client instances
 * (OpenAI, Gemini, Anthropic) are automatically detected and metered.
 */

import { instrumentOpenAI, uninstrumentOpenAI, isOpenAIInstrumented } from "./instrument-openai.js";
import { instrumentGemini, uninstrumentGemini, isGeminiInstrumented } from "./instrument-gemini.js";
import { instrumentAnthropic, uninstrumentAnthropic, isAnthropicInstrumented } from "./instrument-anthropic.js";
import type { MeterOptions } from "./types.js";

/**
 * Result of instrumentation showing which SDKs were instrumented
 */
export interface InstrumentationResult {
  openai: boolean;
  gemini: boolean;
  anthropic: boolean;
}

// Track global options
let globalOptions: MeterOptions | null = null;

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
 * import { instrument, createHttpTransport } from "llm-meter";
 *
 * // Call once at startup - all available LLM clients are now metered
 * const result = instrument({
 *   emitMetric: createHttpTransport({ apiUrl: process.env.METER_API_URL }).emit,
 * });
 *
 * console.log(result);
 * // { openai: true, gemini: true, anthropic: false }
 *
 * // Use any LLM SDK normally - metrics collected automatically
 * const openai = new OpenAI();
 * const gemini = new GoogleGenerativeAI(apiKey);
 * ```
 */
export async function instrument(options: MeterOptions): Promise<InstrumentationResult> {
  globalOptions = options;

  // Run all instrumentations in parallel
  const [openai, gemini, anthropic] = await Promise.all([
    instrumentOpenAI(options),
    instrumentGemini(options),
    instrumentAnthropic(options),
  ]);

  const result: InstrumentationResult = { openai, gemini, anthropic };

  // Log which SDKs were instrumented
  const instrumented = Object.entries(result)
    .filter(([, success]) => success)
    .map(([name]) => name);

  if (instrumented.length > 0) {
    console.log(`[llm-meter] Instrumented: ${instrumented.join(", ")}`);
  } else {
    console.warn("[llm-meter] No LLM SDKs found to instrument");
  }

  return result;
}

/**
 * Remove instrumentation from all LLM SDKs.
 *
 * Restores original behavior for all clients.
 */
export async function uninstrument(): Promise<void> {
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
