import type { NormalizedUsage } from "./types.js";

/**
 * Raw usage object from OpenAI API (either shape)
 */
interface RawUsage {
  // Responses API shape
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  // Chat Completions API shape
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
  };
}

/**
 * Normalizes usage data from both OpenAI API response shapes into a consistent format.
 *
 * The OpenAI API returns usage in two different shapes depending on the endpoint:
 * - Responses API: uses `input_tokens` / `output_tokens`
 * - Chat Completions API: uses `prompt_tokens` / `completion_tokens`
 *
 * This function handles both and normalizes into our standard schema.
 *
 * @param usage - Raw usage object from OpenAI API response
 * @returns Normalized usage metrics, or null if no usage data provided
 */
export function normalizeUsage(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const raw = usage as RawUsage;

  // Check if this is Responses API shape (input_tokens/output_tokens)
  if ("input_tokens" in raw || "output_tokens" in raw) {
    const input = raw.input_tokens ?? 0;
    const output = raw.output_tokens ?? 0;

    return {
      input_tokens: input,
      output_tokens: output,
      total_tokens: raw.total_tokens ?? input + output,
      reasoning_tokens: raw.output_tokens_details?.reasoning_tokens ?? 0,
      cached_tokens: raw.input_tokens_details?.cached_tokens ?? 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    };
  }

  // Chat Completions API shape (prompt_tokens/completion_tokens)
  const prompt = raw.prompt_tokens ?? 0;
  const completion = raw.completion_tokens ?? 0;

  return {
    input_tokens: prompt,
    output_tokens: completion,
    total_tokens: raw.total_tokens ?? prompt + completion,
    reasoning_tokens: raw.completion_tokens_details?.reasoning_tokens ?? 0,
    cached_tokens: raw.prompt_tokens_details?.cached_tokens ?? 0,
    accepted_prediction_tokens:
      raw.completion_tokens_details?.accepted_prediction_tokens ?? 0,
    rejected_prediction_tokens:
      raw.completion_tokens_details?.rejected_prediction_tokens ?? 0,
  };
}

/**
 * Creates an empty/zero usage object
 */
export function emptyUsage(): NormalizedUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    cached_tokens: 0,
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Merges two usage objects (useful for accumulating streaming deltas)
 */
export function mergeUsage(
  a: NormalizedUsage,
  b: NormalizedUsage
): NormalizedUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    reasoning_tokens: a.reasoning_tokens + b.reasoning_tokens,
    cached_tokens: a.cached_tokens + b.cached_tokens,
    accepted_prediction_tokens:
      a.accepted_prediction_tokens + b.accepted_prediction_tokens,
    rejected_prediction_tokens:
      a.rejected_prediction_tokens + b.rejected_prediction_tokens,
  };
}
