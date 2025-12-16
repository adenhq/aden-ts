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
      `${prefix} [${event.traceId.slice(0, 8)}]`,
      event.model,
      event.stream ? "(stream)" : "",
      `${event.latency_ms}ms`,
    ]
      .filter(Boolean)
      .join(" ");

    if (pretty && event.usage) {
      console.log(summary);
      console.log(
        `  tokens: ${event.usage.input_tokens} in / ${event.usage.output_tokens} out`
      );
      if (event.usage.cached_tokens > 0) {
        console.log(`  cached: ${event.usage.cached_tokens}`);
      }
      if (event.usage.reasoning_tokens > 0) {
        console.log(`  reasoning: ${event.usage.reasoning_tokens}`);
      }
      if (event.tool_calls?.length) {
        console.log(
          `  tools: ${event.tool_calls.map((t) => t.name ?? t.type).join(", ")}`
        );
      }
      if (event.error) {
        console.log(`  error: ${event.error}`);
      }
    } else {
      console.log(summary, pretty ? "" : JSON.stringify(event));
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
