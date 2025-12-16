import type OpenAI from "openai";
import type { BudgetConfig, BudgetExceededInfo, MeteredOpenAI } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

/**
 * Error thrown when a request exceeds the configured budget
 */
export class BudgetExceededError extends Error {
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number;
  readonly model: string;

  constructor(info: BudgetExceededInfo) {
    super(
      `Budget exceeded: estimated ${info.estimatedInputTokens} input tokens, ` +
        `max allowed is ${info.maxInputTokens} for model ${info.model}`
    );
    this.name = "BudgetExceededError";
    this.estimatedInputTokens = info.estimatedInputTokens;
    this.maxInputTokens = info.maxInputTokens;
    this.model = info.model;
  }
}

/**
 * Response from the input tokens counting endpoint
 * POST /v1/responses/input_tokens
 */
interface InputTokensResponse {
  object: "response.input_tokens";
  input_tokens: number;
}

/**
 * Counts input tokens using OpenAI's input token counting endpoint.
 *
 * Uses POST /v1/responses/input_tokens to get exact token counts
 * before making the actual API call.
 *
 * @param client - OpenAI client instance
 * @param model - Model to count tokens for
 * @param input - The input to count tokens for
 * @returns The estimated input token count
 *
 * @example
 * ```ts
 * const tokens = await countInputTokens(client, "gpt-4.1-mini", "Hello world");
 * console.log(`This prompt will use ${tokens} input tokens`);
 * ```
 */
export async function countInputTokens(
  client: OpenAI,
  model: string,
  input: unknown
): Promise<number> {
  // Use the internal client's post method to call the API directly
  // since the SDK may not expose this endpoint as a method yet
  const internalClient = client as unknown as {
    post: <T>(path: string, options: { body: unknown }) => Promise<T>;
  };

  const result = await internalClient.post<InputTokensResponse>(
    "/responses/input_tokens",
    {
      body: { model, input },
    }
  );

  return result.input_tokens;
}

/**
 * Creates a budget-enforced wrapper around the OpenAI client.
 *
 * This wrapper checks input token counts before making API calls and
 * can throw, warn, or truncate based on your configuration.
 *
 * @param client - OpenAI client instance (can be metered or not)
 * @param config - Budget configuration
 * @returns The client with budget enforcement
 *
 * @example
 * ```ts
 * import OpenAI from "openai";
 * import { withBudgetGuardrails } from "openai-meter";
 *
 * const client = new OpenAI();
 * const budgeted = withBudgetGuardrails(client, {
 *   maxInputTokens: 4000,
 *   onExceeded: "throw",
 * });
 *
 * // This will throw if input exceeds 4000 tokens
 * await budgeted.responses.create({
 *   model: "gpt-4.1",
 *   input: veryLongPrompt,
 * });
 * ```
 */
export function withBudgetGuardrails<T extends OpenAI>(
  client: T,
  config: BudgetConfig
): T {
  if (!config.maxInputTokens && !config.maxTotalTokens) {
    // No budget configured, return client unchanged
    return client;
  }

  const onExceeded = config.onExceeded ?? "throw";

  // Wrap responses.create if it exists
  if (client.responses?.create) {
    const originalCreate: AnyFunction = client.responses.create.bind(client.responses);

    (client.responses as unknown as Record<string, unknown>).create = async (
      params: Record<string, unknown>,
      ...opts: unknown[]
    ) => {
      const model = params.model as string;
      const input = params.input;

      // Check budget if maxInputTokens is configured
      if (config.maxInputTokens && input !== undefined) {
        try {
          const estimatedTokens = await countInputTokens(client, model, input);

          if (estimatedTokens > config.maxInputTokens) {
            const info: BudgetExceededInfo = {
              estimatedInputTokens: estimatedTokens,
              maxInputTokens: config.maxInputTokens,
              model,
              input,
            };

            // Call custom handler if provided
            if (config.onExceededHandler) {
              await config.onExceededHandler(info);
            }

            switch (onExceeded) {
              case "throw":
                throw new BudgetExceededError(info);
              case "warn":
                console.warn(
                  `[openai-meter] Budget warning: ${estimatedTokens} tokens exceeds limit of ${config.maxInputTokens}`
                );
                break;
              case "truncate":
                // Truncation is complex and depends on input format
                // For now, just warn and proceed
                console.warn(
                  `[openai-meter] Budget exceeded, truncation not implemented. Proceeding with ${estimatedTokens} tokens.`
                );
                break;
            }
          }
        } catch (error) {
          // If token counting fails, log warning and proceed
          if (!(error instanceof BudgetExceededError)) {
            console.warn(
              "[openai-meter] Failed to count input tokens:",
              error instanceof Error ? error.message : error
            );
          } else {
            throw error;
          }
        }
      }

      return originalCreate(params, ...opts);
    };
  }

  // Wrap chat.completions.create if it exists
  if (client.chat?.completions?.create) {
    const originalChatCreate: AnyFunction = client.chat.completions.create.bind(
      client.chat.completions
    );

    (client.chat.completions as unknown as Record<string, unknown>).create = async (
      params: Record<string, unknown>,
      ...opts: unknown[]
    ) => {
      // For chat completions, we'd need to count tokens differently
      // The responses input_tokens endpoint may not work directly
      // For now, just pass through
      if (config.maxInputTokens && params.messages !== undefined) {
        console.warn(
          "[openai-meter] Budget guardrails for chat.completions not fully implemented"
        );
      }

      return originalChatCreate(params, ...opts);
    };
  }

  return client;
}

/**
 * Convenience function to create a fully metered and budgeted client
 */
export function createBudgetedMeteredClient(
  client: MeteredOpenAI,
  budgetConfig: BudgetConfig
): MeteredOpenAI {
  return withBudgetGuardrails(client, budgetConfig) as MeteredOpenAI;
}
