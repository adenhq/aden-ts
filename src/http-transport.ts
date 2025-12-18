/**
 * HTTP transport for sending metrics to a central API endpoint.
 *
 * This is the recommended approach for production - clients send metrics
 * to your API, which handles storage, aggregation, and multi-tenancy.
 */

import type { MetricEvent, MetricEmitter } from "./types.js";

/**
 * Callback when metrics are dropped due to queue overflow
 */
export type QueueOverflowHandler = (droppedCount: number) => void;

/**
 * Callback when a batch send fails after all retries
 */
export type SendErrorHandler = (
  error: Error,
  batch: MetricEvent[],
  stats: TransportStats
) => void;

/**
 * Transport statistics for observability
 */
export interface TransportStats {
  /** Total metrics successfully sent */
  sent: number;
  /** Total metrics dropped due to queue overflow */
  dropped: number;
  /** Total metrics that failed to send after retries */
  errors: number;
  /** Current queue size */
  queued: number;
}

/**
 * Options for the HTTP transport
 */
export interface HttpTransportOptions {
  /** API endpoint URL */
  apiUrl: string;
  /** API key for authentication (sent as Bearer token) */
  apiKey?: string;
  /** Number of events to batch before sending (default: 50) */
  batchSize?: number;
  /** Milliseconds between automatic flushes (default: 5000) */
  flushInterval?: number;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Maximum queue size before dropping events (default: 10000) */
  maxQueueSize?: number;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
  /** Callback when events are dropped due to queue overflow */
  onQueueOverflow?: QueueOverflowHandler;
  /** Callback when a batch fails to send */
  onSendError?: SendErrorHandler;
}

/**
 * HTTP transport that batches and sends metrics to an API endpoint.
 *
 * Features:
 * - Batched sending for efficiency
 * - Automatic periodic flushing
 * - Retry with exponential backoff
 * - Queue overflow protection
 * - Observability via stats
 *
 * @example
 * ```typescript
 * const transport = createHttpTransport({
 *   apiUrl: "https://api.example.com/v1/metrics",
 *   apiKey: "your-api-key",
 * });
 *
 * const metered = makeMeteredOpenAI(client, {
 *   emitMetric: transport,
 * });
 *
 * // On shutdown
 * await transport.flush();
 * transport.stop();
 * ```
 */
export class HttpTransport {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly maxQueueSize: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly onQueueOverflow?: QueueOverflowHandler;
  private readonly onSendError?: SendErrorHandler;

  private queue: MetricEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isStopped = false;

  // Stats tracking
  private sentCount = 0;
  private droppedCount = 0;
  private errorCount = 0;

  constructor(options: HttpTransportOptions) {
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.batchSize = options.batchSize ?? 50;
    this.flushInterval = options.flushInterval ?? 5000;
    this.timeout = options.timeout ?? 10000;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxQueueSize = options.maxQueueSize ?? 10000;
    this.extraHeaders = options.headers ?? {};
    this.onQueueOverflow = options.onQueueOverflow;
    this.onSendError = options.onSendError;

    this.startFlushTimer();
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    this.flushTimer = setInterval(() => {
      this.flushAsync().catch((err) => {
        console.error("[HttpTransport] Error in flush timer:", err);
      });
    }, this.flushInterval);

    // Don't prevent process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Add an event to the send queue.
   * This is the MetricEmitter interface.
   */
  emit: MetricEmitter = (event: MetricEvent): void => {
    if (this.isStopped) {
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.droppedCount++;
      this.onQueueOverflow?.(this.droppedCount);
      return;
    }

    this.queue.push(event);

    // Flush if batch size reached
    if (this.queue.length >= this.batchSize) {
      this.flushAsync().catch((err) => {
        console.error("[HttpTransport] Error in batch flush:", err);
      });
    }
  };

  /**
   * Flush pending events (async version)
   */
  async flushAsync(): Promise<void> {
    if (this.queue.length === 0) {
      return;
    }

    const batch = this.queue.splice(0, this.batchSize);
    if (batch.length === 0) {
      return;
    }

    await this.sendBatch(batch);
  }

  /**
   * Flush pending events (sync-friendly, returns promise)
   */
  flush(): Promise<void> {
    return this.flushAsync();
  }

  /**
   * Flush all pending events (may require multiple batches)
   */
  async flushAll(): Promise<void> {
    while (this.queue.length > 0) {
      await this.flushAsync();
    }
  }

  private async sendBatch(batch: MetricEvent[]): Promise<void> {
    const payload = {
      metrics: batch,
      timestamp: Date.now(),
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "openai-meter/0.1.0",
      ...this.extraHeaders,
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const response = await fetch(this.apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (response.ok) {
            this.sentCount += batch.length;
            return;
          }

          // Server error - retry
          if (response.status >= 500) {
            lastError = new Error(
              `Server error: ${response.status} ${response.statusText}`
            );
            await this.sleep(Math.pow(2, attempt) * 1000);
            continue;
          }

          // Client error - don't retry
          lastError = new Error(
            `Client error: ${response.status} ${response.statusText}`
          );
          break;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Abort errors shouldn't retry
        if (lastError.name === "AbortError") {
          lastError = new Error(`Request timeout after ${this.timeout}ms`);
        }

        // Network errors - retry with backoff
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }

    // All retries failed
    this.errorCount += batch.length;
    this.onSendError?.(
      lastError ?? new Error("Unknown error"),
      batch,
      this.stats
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get transport statistics
   */
  get stats(): TransportStats {
    return {
      sent: this.sentCount,
      dropped: this.droppedCount,
      errors: this.errorCount,
      queued: this.queue.length,
    };
  }

  /**
   * Stop the transport and flush remaining events
   */
  async stop(): Promise<void> {
    this.isStopped = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushAll();
  }

  /**
   * Check if the transport is stopped
   */
  get stopped(): boolean {
    return this.isStopped;
  }
}

/**
 * Create an HTTP transport for sending metrics to an API.
 *
 * @example
 * ```typescript
 * // Using options
 * const transport = createHttpTransport({
 *   apiUrl: "https://api.example.com/v1/metrics",
 *   apiKey: "your-api-key",
 *   batchSize: 100,
 * });
 *
 * // Using environment variables
 * // Set METER_API_URL and optionally METER_API_KEY
 * const transport = createHttpTransport();
 * ```
 */
export function createHttpTransport(
  options?: Partial<HttpTransportOptions>
): HttpTransport {
  const apiUrl = options?.apiUrl ?? process.env.METER_API_URL;
  if (!apiUrl) {
    throw new Error(
      "API URL required. Pass apiUrl option or set METER_API_URL environment variable."
    );
  }

  const apiKey = options?.apiKey ?? process.env.METER_API_KEY;
  const batchSize = options?.batchSize ?? parseEnvInt("METER_BATCH_SIZE", 50);
  const flushInterval =
    options?.flushInterval ?? parseEnvInt("METER_FLUSH_INTERVAL", 5000);

  return new HttpTransport({
    ...options,
    apiUrl,
    apiKey,
    batchSize,
    flushInterval,
  });
}

/**
 * Parse an environment variable as an integer
 */
function parseEnvInt(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Create an HTTP transport emitter function.
 *
 * This is a convenience function that returns just the emit function,
 * suitable for use directly as a MetricEmitter.
 *
 * Note: The returned emitter cannot be stopped or flushed. For production use,
 * prefer createHttpTransport() which gives you access to stop() and flush().
 *
 * @example
 * ```typescript
 * const metered = makeMeteredOpenAI(client, {
 *   emitMetric: createHttpEmitter({
 *     apiUrl: "https://api.example.com/v1/metrics",
 *   }),
 * });
 * ```
 */
export function createHttpEmitter(
  options?: Partial<HttpTransportOptions>
): MetricEmitter {
  const transport = createHttpTransport(options);

  // Register cleanup on process exit
  if (typeof process !== "undefined") {
    const cleanup = () => {
      transport.stop().catch(() => {
        // Ignore errors during cleanup
      });
    };

    process.on("beforeExit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  }

  return transport.emit;
}
