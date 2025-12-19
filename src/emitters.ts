import { appendFileSync, writeFileSync, existsSync } from "fs";
import { appendFile } from "fs/promises";
import type { MetricEvent, MetricEmitter } from "./types.js";

/**
 * A simple console emitter for development/debugging
 */
export function createConsoleEmitter(
  options: {
    /** Log level: "info" logs all events, "warn" logs only errors */
    level?: "info" | "warn";
    /** Whether to pretty-print the output */
    pretty?: boolean;
  } = {}
): MetricEmitter {
  const { level = "info", pretty = true } = options;

  return (event: MetricEvent) => {
    if (level === "warn" && !event.error) {
      return;
    }

    const prefix = event.error ? "❌" : "✓";
    const summary = [
      `${prefix} [${event.span_id.slice(0, 8)}]`,
      event.provider,
      event.model,
      event.stream ? "(stream)" : "",
      `${event.latency_ms}ms`,
    ]
      .filter(Boolean)
      .join(" ");

    if (pretty) {
      console.log(summary);
      console.log(
        `  tokens: ${event.input_tokens} in / ${event.output_tokens} out`
      );
      if (event.cached_tokens > 0) {
        console.log(`  cached: ${event.cached_tokens}`);
      }
      if (event.reasoning_tokens > 0) {
        console.log(`  reasoning: ${event.reasoning_tokens}`);
      }
      if (event.tool_call_count && event.tool_call_count > 0) {
        console.log(`  tools: ${event.tool_call_count} calls (${event.tool_names})`);
      }
      if (event.error) {
        console.log(`  error: ${event.error}`);
      }
    } else {
      console.log(summary, JSON.stringify(event));
    }
  };
}

/**
 * Creates an emitter that batches metrics and flushes periodically
 */
export function createBatchEmitter(
  flush: (events: MetricEvent[]) => void | Promise<void>,
  options: {
    /** Maximum batch size before auto-flush */
    maxBatchSize?: number;
    /** Maximum time (ms) to wait before flushing */
    flushInterval?: number;
  } = {}
): MetricEmitter & { flush: () => Promise<void>; stop: () => void } {
  const { maxBatchSize = 100, flushInterval = 5000 } = options;

  let batch: MetricEvent[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  const doFlush = async () => {
    if (batch.length === 0) return;
    const toFlush = batch;
    batch = [];
    await flush(toFlush);
  };

  // Start periodic flush timer
  timer = setInterval(() => {
    doFlush().catch(console.error);
  }, flushInterval);

  const emitter = async (event: MetricEvent) => {
    batch.push(event);
    if (batch.length >= maxBatchSize) {
      await doFlush();
    }
  };

  emitter.flush = doFlush;
  emitter.stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    doFlush().catch(console.error);
  };

  return emitter;
}

/**
 * Creates an emitter that writes to multiple destinations
 */
export function createMultiEmitter(
  emitters: MetricEmitter[]
): MetricEmitter {
  return async (event: MetricEvent) => {
    await Promise.all(emitters.map((emit) => emit(event)));
  };
}

/**
 * Creates an emitter that filters events before passing to another emitter
 */
export function createFilteredEmitter(
  emitter: MetricEmitter,
  filter: (event: MetricEvent) => boolean
): MetricEmitter {
  return (event: MetricEvent) => {
    if (filter(event)) {
      return emitter(event);
    }
  };
}

/**
 * Creates an emitter that transforms events before passing to another emitter
 */
export function createTransformEmitter<T>(
  emitter: (transformed: T) => void | Promise<void>,
  transform: (event: MetricEvent) => T
): MetricEmitter {
  return (event: MetricEvent) => {
    return emitter(transform(event));
  };
}

/**
 * Creates a no-op emitter (useful for testing or disabling metrics)
 */
export function createNoopEmitter(): MetricEmitter {
  return () => {};
}

/**
 * Helper to collect metrics in memory (useful for testing)
 */
export function createMemoryEmitter(): MetricEmitter & {
  events: MetricEvent[];
  clear: () => void;
} {
  const events: MetricEvent[] = [];

  const emitter = (event: MetricEvent) => {
    events.push(event);
  };

  emitter.events = events;
  emitter.clear = () => {
    events.length = 0;
  };

  return emitter;
}

/**
 * Options for the JSON file emitter
 */
export interface JsonFileEmitterOptions {
  /** File path to write metrics to */
  filePath: string;
  /** Format: "jsonl" for JSON Lines (one event per line), "json" for array */
  format?: "jsonl" | "json";
  /** Whether to use async writes (default: true for better performance) */
  async?: boolean;
  /** Whether to pretty-print JSON (default: false) */
  pretty?: boolean;
}

/**
 * Creates an emitter that writes metrics to a local JSON/JSONL file.
 *
 * JSONL format (default) is recommended - one JSON object per line:
 * - Efficient for appending
 * - Easy to stream/parse line by line
 * - Works well with tools like jq
 *
 * @example
 * ```typescript
 * // JSONL format (recommended)
 * const emitter = createJsonFileEmitter({
 *   filePath: "./metrics.jsonl",
 * });
 *
 * // JSON array format
 * const emitter = createJsonFileEmitter({
 *   filePath: "./metrics.json",
 *   format: "json",
 *   pretty: true,
 * });
 *
 * instrument({ emitMetric: emitter });
 * ```
 */
export function createJsonFileEmitter(
  options: JsonFileEmitterOptions
): MetricEmitter & { flush: () => Promise<void> } {
  const {
    filePath,
    format = "jsonl",
    async: useAsync = true,
    pretty = false,
  } = options;

  // For JSON array format, we need to track events and write on flush
  const pendingEvents: MetricEvent[] = [];

  // Initialize file for JSON array format
  if (format === "json" && !existsSync(filePath)) {
    writeFileSync(filePath, "[]", "utf-8");
  }

  const emitter = async (event: MetricEvent) => {
    if (format === "jsonl") {
      const line = JSON.stringify(event) + "\n";
      if (useAsync) {
        await appendFile(filePath, line, "utf-8");
      } else {
        appendFileSync(filePath, line, "utf-8");
      }
    } else {
      // JSON array format - collect and write on flush
      pendingEvents.push(event);
    }
  };

  emitter.flush = async () => {
    if (format === "json" && pendingEvents.length > 0) {
      // Read existing, merge, and write
      let existing: MetricEvent[] = [];
      if (existsSync(filePath)) {
        try {
          const content = await import("fs/promises").then((fs) =>
            fs.readFile(filePath, "utf-8")
          );
          existing = JSON.parse(content);
        } catch {
          existing = [];
        }
      }
      const merged = [...existing, ...pendingEvents];
      const content = pretty
        ? JSON.stringify(merged, null, 2)
        : JSON.stringify(merged);
      await import("fs/promises").then((fs) =>
        fs.writeFile(filePath, content, "utf-8")
      );
      pendingEvents.length = 0;
    }
  };

  return emitter;
}
