/**
 * File-based metric logging for local storage and analysis.
 *
 * Writes raw metric data to JSONL files organized by date and session,
 * enabling offline analysis, debugging, and compliance auditing.
 */

import { existsSync, mkdirSync, appendFileSync } from "fs";
import { appendFile } from "fs/promises";
import { join } from "path";
import type { MetricEvent, MetricEmitter } from "./types.js";

// Default log directory (can be overridden via environment or parameter)
const DEFAULT_LOG_DIR = process.env.METER_LOG_DIR ?? "./meter_logs";

/**
 * Options for the MetricFileLogger
 */
export interface MetricFileLoggerOptions {
  /** Base directory for log files. Default: ./meter_logs or METER_LOG_DIR env var */
  logDir?: string;
  /** Whether to use async writes (default: true for better performance) */
  async?: boolean;
}

/**
 * Writes raw metric data to local JSONL files for analysis.
 *
 * Files are organized by date and session:
 *     meter_logs/
 *         2024-01-15/
 *             session_abc123.jsonl
 *             session_def456.jsonl
 *         2024-01-16/
 *             ...
 *
 * Each line in the JSONL file is a complete JSON object representing
 * one metric event (LLM request, TTS synthesis, STT transcription).
 *
 * @example
 * ```typescript
 * import { MetricFileLogger } from "aden";
 *
 * const logger = new MetricFileLogger({ logDir: "./my_logs" });
 * logger.writeLLMEvent({
 *   sessionId: "session_123",
 *   inputTokens: 100,
 *   outputTokens: 50,
 *   model: "gpt-4o-mini",
 * });
 * ```
 */
export class MetricFileLogger {
  private logDir: string;
  private useAsync: boolean;

  constructor(options: MetricFileLoggerOptions = {}) {
    this.logDir = options.logDir ?? DEFAULT_LOG_DIR;
    this.useAsync = options.async ?? true;
    this.ensureDirExists();
    console.log(`[aden] Metric file logger initialized: ${this.logDir}`);
  }

  /**
   * Create the log directory if it doesn't exist.
   */
  private ensureDirExists(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Get the log file path for a session.
   */
  private getSessionFile(sessionId: string): string {
    const date = new Date();
    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const dateDir = join(this.logDir, dateStr);

    // Ensure date directory exists
    if (!existsSync(dateDir)) {
      mkdirSync(dateDir, { recursive: true });
    }

    // Sanitize session_id for filename
    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(dateDir, `session_${safeSessionId}.jsonl`);
  }

  /**
   * Write a metric event to the session's log file.
   */
  async writeEvent(
    sessionId: string,
    eventType: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const filePath = this.getSessionFile(sessionId);

    const event = {
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      event_type: eventType,
      ...data,
    };

    const line = JSON.stringify(event) + "\n";

    try {
      if (this.useAsync) {
        await appendFile(filePath, line, "utf-8");
      } else {
        appendFileSync(filePath, line, "utf-8");
      }
    } catch (error) {
      console.error(`[aden] Failed to write metric to file: ${error}`);
    }
  }

  /**
   * Write a MetricEvent to the log file.
   */
  async writeMetricEvent(event: MetricEvent): Promise<void> {
    const sessionId =
      (event.metadata?.session_id as string) ?? "unknown";

    const data: Record<string, unknown> = {
      trace_id: event.trace_id,
      model: event.model,
      stream: event.stream,
      latency_ms: event.latency_ms,
    };

    if (event.total_tokens > 0) {
      data.usage = {
        input_tokens: event.input_tokens,
        output_tokens: event.output_tokens,
        total_tokens: event.total_tokens,
        reasoning_tokens: event.reasoning_tokens,
        cached_tokens: event.cached_tokens,
      };
    }

    if (event.error) {
      data.error = event.error;
    }

    if (event.metadata) {
      data.metadata = event.metadata;
    }

    await this.writeEvent(sessionId, "metric", data);
  }

  /**
   * Write an LLM metric event.
   */
  async writeLLMEvent(options: {
    sessionId: string;
    inputTokens: number;
    outputTokens: number;
    model: string;
    latencyMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.writeEvent(options.sessionId, "llm", {
      model: options.model,
      input_tokens: options.inputTokens,
      output_tokens: options.outputTokens,
      total_tokens: options.inputTokens + options.outputTokens,
      latency_ms: options.latencyMs ?? 0,
      ...(options.metadata ?? {}),
    });
  }

  /**
   * Write a TTS metric event.
   */
  async writeTTSEvent(options: {
    sessionId: string;
    characters: number;
    model: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.writeEvent(options.sessionId, "tts", {
      model: options.model,
      characters: options.characters,
      ...(options.metadata ?? {}),
    });
  }

  /**
   * Write an STT metric event.
   */
  async writeSTTEvent(options: {
    sessionId: string;
    audioSeconds: number;
    model: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.writeEvent(options.sessionId, "stt", {
      model: options.model,
      audio_seconds: options.audioSeconds,
      ...(options.metadata ?? {}),
    });
  }

  /**
   * Write session start event.
   */
  async writeSessionStart(options: {
    sessionId: string;
    roomName: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.writeEvent(options.sessionId, "session_start", {
      room_name: options.roomName,
      ...(options.metadata ?? {}),
    });
  }

  /**
   * Write session end event with final summary.
   */
  async writeSessionEnd(options: {
    sessionId: string;
    summary: Record<string, unknown>;
  }): Promise<void> {
    await this.writeEvent(options.sessionId, "session_end", {
      summary: options.summary,
    });
  }
}

/**
 * Create a file-based metric emitter.
 *
 * This creates a MetricEmitter that writes to session-organized JSONL files.
 *
 * @example
 * ```typescript
 * import { instrument, createFileEmitter } from "aden";
 *
 * instrument({
 *   emitMetric: createFileEmitter({ logDir: "./my_logs" }),
 * });
 * ```
 *
 * @param options - Options for the file logger
 * @returns A MetricEmitter function
 */
export function createFileEmitter(
  options: MetricFileLoggerOptions = {}
): MetricEmitter {
  const logger = new MetricFileLogger(options);

  return async (event: MetricEvent) => {
    await logger.writeMetricEvent(event);
  };
}
