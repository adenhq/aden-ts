import type { NormalizedUsage } from "./types.js";

/**
 * Raw usage object from OpenAI API (either shape)
 */
interface RawOpenAIUsage {
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
 * Raw usage object from Anthropic API
 */
interface RawAnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Raw usage metadata from Gemini API
 */
interface RawGeminiUsage {
  // camelCase (SDK)
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  // snake_case (REST)
  prompt_token_count?: number;
  candidates_token_count?: number;
  total_token_count?: number;
  cached_content_token_count?: number;
}

/**
 * Helper to convert an object to a plain dictionary for easier field access.
 */
function toDict(obj: unknown): Record<string, unknown> {
  if (!obj) return {};
  if (typeof obj !== "object") return {};
  // Handle objects with toJSON or model_dump methods (Pydantic-like)
  if ("model_dump" in obj && typeof (obj as { model_dump: unknown }).model_dump === "function") {
    return (obj as { model_dump: () => Record<string, unknown> }).model_dump();
  }
  return obj as Record<string, unknown>;
}

/**
 * Normalizes usage data from OpenAI API responses.
 *
 * Handles both API shapes:
 * - Responses API: uses `input_tokens` / `output_tokens`
 * - Chat Completions API: uses `prompt_tokens` / `completion_tokens`
 *
 * @param usage - Raw usage object from OpenAI API response
 * @returns Normalized usage metrics, or null if no usage data provided
 */
export function normalizeOpenAIUsage(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const raw = toDict(usage) as RawOpenAIUsage;

  // Check if this is Responses API shape (input_tokens/output_tokens)
  if ("input_tokens" in raw || "output_tokens" in raw) {
    const input = raw.input_tokens ?? 0;
    const output = raw.output_tokens ?? 0;

    // Extract nested details
    const inputDetails = (raw.input_tokens_details ?? {}) as Record<string, unknown>;
    const outputDetails = (raw.output_tokens_details ?? {}) as Record<string, unknown>;

    return {
      input_tokens: input,
      output_tokens: output,
      total_tokens: raw.total_tokens ?? input + output,
      reasoning_tokens: (outputDetails.reasoning_tokens as number) ?? 0,
      cached_tokens: (inputDetails.cached_tokens as number) ?? 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    };
  }

  // Chat Completions API shape (prompt_tokens/completion_tokens)
  const prompt = raw.prompt_tokens ?? 0;
  const completion = raw.completion_tokens ?? 0;

  // Extract nested details
  const promptDetails = (raw.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const completionDetails = (raw.completion_tokens_details ?? {}) as Record<string, unknown>;

  return {
    input_tokens: prompt,
    output_tokens: completion,
    total_tokens: raw.total_tokens ?? prompt + completion,
    reasoning_tokens: (completionDetails.reasoning_tokens as number) ?? 0,
    cached_tokens: (promptDetails.cached_tokens as number) ?? 0,
    accepted_prediction_tokens: (completionDetails.accepted_prediction_tokens as number) ?? 0,
    rejected_prediction_tokens: (completionDetails.rejected_prediction_tokens as number) ?? 0,
  };
}

/**
 * Normalizes usage data from Anthropic API responses.
 *
 * Anthropic Messages API usage fields:
 * - input_tokens: Input tokens consumed
 * - output_tokens: Output tokens generated
 * - cache_read_input_tokens: Tokens served from cache (optional)
 * - cache_creation_input_tokens: Tokens used to create cache (optional)
 *
 * @param usage - Raw usage object from Anthropic API response
 * @returns Normalized usage metrics, or null if no usage data provided
 */
export function normalizeAnthropicUsage(usage: unknown): NormalizedUsage | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const raw = toDict(usage) as RawAnthropicUsage;

  const inputTokens = raw.input_tokens ?? 0;
  const outputTokens = raw.output_tokens ?? 0;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cached_tokens: raw.cache_read_input_tokens ?? 0,
    reasoning_tokens: 0, // Anthropic doesn't have reasoning tokens yet
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Normalizes usage data from Google Gemini API responses.
 *
 * Gemini GenerateContent usage_metadata fields:
 * - promptTokenCount: Input tokens
 * - candidatesTokenCount: Output tokens
 * - totalTokenCount: Total tokens
 * - cachedContentTokenCount: Cached tokens (optional)
 *
 * @param usageMetadata - Raw usage_metadata from Gemini API response
 * @returns Normalized usage metrics, or null if no usage data provided
 */
export function normalizeGeminiUsage(usageMetadata: unknown): NormalizedUsage | null {
  if (!usageMetadata || typeof usageMetadata !== "object") {
    return null;
  }

  const raw = toDict(usageMetadata) as RawGeminiUsage;

  // Handle both camelCase (SDK) and snake_case (REST) field names
  const inputTokens = raw.promptTokenCount ?? raw.prompt_token_count ?? 0;
  const outputTokens = raw.candidatesTokenCount ?? raw.candidates_token_count ?? 0;
  const totalTokens = raw.totalTokenCount ?? raw.total_token_count ?? inputTokens + outputTokens;
  const cachedTokens = raw.cachedContentTokenCount ?? raw.cached_content_token_count ?? 0;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    cached_tokens: cachedTokens,
    reasoning_tokens: 0, // Gemini doesn't expose reasoning tokens
    accepted_prediction_tokens: 0,
    rejected_prediction_tokens: 0,
  };
}

/**
 * Normalizes usage data from any supported LLM provider.
 *
 * @param usage - Raw usage object from API response
 * @param provider - The provider the usage came from (default: "openai")
 * @returns Normalized usage metrics, or null if no usage data provided
 *
 * @example
 * ```typescript
 * // OpenAI
 * const response = await openai.chat.completions.create({ ... });
 * const normalized = normalizeUsage(response.usage, "openai");
 *
 * // Anthropic
 * const response = await anthropic.messages.create({ ... });
 * const normalized = normalizeUsage(response.usage, "anthropic");
 *
 * // Gemini
 * const response = await model.generateContent({ ... });
 * const normalized = normalizeUsage(response.usageMetadata, "gemini");
 * ```
 */
export function normalizeUsage(
  usage: unknown,
  provider: "openai" | "anthropic" | "gemini" = "openai"
): NormalizedUsage | null {
  switch (provider) {
    case "anthropic":
      return normalizeAnthropicUsage(usage);
    case "gemini":
      return normalizeGeminiUsage(usage);
    default:
      return normalizeOpenAIUsage(usage);
  }
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
