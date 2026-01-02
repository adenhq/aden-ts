/**
 * Logging configuration for the aden SDK.
 *
 * Provides a simple logging abstraction that can be configured via
 * environment variables or programmatically.
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Logging configuration options
 */
export interface LoggingConfig {
  /** Global log level for the SDK. Default: "info" or ADEN_LOG_LEVEL env var */
  level?: LogLevel;
  /** Log level for metrics-specific logs. Default: same as level */
  metricsLevel?: LogLevel;
  /** Custom log handler. Default: console */
  handler?: LogHandler;
}

/**
 * Log handler interface
 */
export interface LogHandler {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

// Log level priority (higher = more severe)
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Current configuration
let currentConfig: Required<LoggingConfig> = {
  level: parseLogLevel(process.env.ADEN_LOG_LEVEL) ?? "info",
  metricsLevel: parseLogLevel(process.env.ADEN_METRICS_LOG_LEVEL) ?? parseLogLevel(process.env.ADEN_LOG_LEVEL) ?? "info",
  handler: console,
};

/**
 * Parse a log level string
 */
function parseLogLevel(level: string | undefined): LogLevel | undefined {
  if (!level) return undefined;
  const normalized = level.toLowerCase() as LogLevel;
  if (normalized in LOG_LEVEL_PRIORITY) {
    return normalized;
  }
  return undefined;
}

/**
 * Check if a log level should be logged given the current configuration
 */
function shouldLog(level: LogLevel, configLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configLevel];
}

/**
 * Configure logging for the aden SDK.
 *
 * @example
 * ```typescript
 * import { configureLogging } from "aden";
 *
 * // Set log level to debug
 * configureLogging({ level: "debug" });
 *
 * // Quiet metrics logs but keep other logs
 * configureLogging({ level: "info", metricsLevel: "warn" });
 *
 * // Use a custom log handler
 * configureLogging({
 *   handler: {
 *     debug: (msg, ...args) => myLogger.debug(msg, ...args),
 *     info: (msg, ...args) => myLogger.info(msg, ...args),
 *     warn: (msg, ...args) => myLogger.warn(msg, ...args),
 *     error: (msg, ...args) => myLogger.error(msg, ...args),
 *   },
 * });
 * ```
 */
export function configureLogging(config: LoggingConfig): void {
  if (config.level !== undefined) {
    currentConfig.level = config.level;
    // If metricsLevel not explicitly set, inherit from level
    if (config.metricsLevel === undefined) {
      currentConfig.metricsLevel = config.level;
    }
  }
  if (config.metricsLevel !== undefined) {
    currentConfig.metricsLevel = config.metricsLevel;
  }
  if (config.handler !== undefined) {
    currentConfig.handler = config.handler;
  }
}

/**
 * Get the current logging configuration
 */
export function getLoggingConfig(): Readonly<Required<LoggingConfig>> {
  return { ...currentConfig };
}

/**
 * Reset logging configuration to defaults
 */
export function resetLoggingConfig(): void {
  currentConfig = {
    level: parseLogLevel(process.env.ADEN_LOG_LEVEL) ?? "info",
    metricsLevel: parseLogLevel(process.env.ADEN_METRICS_LOG_LEVEL) ?? parseLogLevel(process.env.ADEN_LOG_LEVEL) ?? "info",
    handler: console,
  };
}

/**
 * Logger for the aden SDK
 */
export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug", currentConfig.level)) {
      currentConfig.handler.debug(`[aden] ${message}`, ...args);
    }
  },
  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info", currentConfig.level)) {
      currentConfig.handler.info(`[aden] ${message}`, ...args);
    }
  },
  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn", currentConfig.level)) {
      currentConfig.handler.warn(`[aden] ${message}`, ...args);
    }
  },
  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error", currentConfig.level)) {
      currentConfig.handler.error(`[aden] ${message}`, ...args);
    }
  },
};

/**
 * Logger for metrics-specific logs
 */
export const metricsLogger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug", currentConfig.metricsLevel)) {
      currentConfig.handler.debug(`[aden.metrics] ${message}`, ...args);
    }
  },
  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info", currentConfig.metricsLevel)) {
      currentConfig.handler.info(`[aden.metrics] ${message}`, ...args);
    }
  },
  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn", currentConfig.metricsLevel)) {
      currentConfig.handler.warn(`[aden.metrics] ${message}`, ...args);
    }
  },
  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error", currentConfig.metricsLevel)) {
      currentConfig.handler.error(`[aden.metrics] ${message}`, ...args);
    }
  },
};
