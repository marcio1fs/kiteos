/**
 * Structured Logger Module
 * 
 * SECURITY FIX (#69, #70): Replaces console.log/error with structured logging
 * that includes correlation IDs and redacts sensitive data
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  userId?: string;
  officeId?: string;
  [key: string]: unknown;
}

// Sensitive field names that should be redacted
const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'apiKey', 'api_key',
  'accessToken', 'access_token', 'refreshToken', 'refresh_token',
  'webhookSecret', 'webhook_secret', 'mpAccessToken', 'mpWebhookSecret',
  'waApiToken', 'waWebhookSecret', 'authorization',
  'cpf', 'cnpj', 'cpfCnpj', 'creditCard', 'card_number',
];

/**
 * Redact sensitive fields from an object
 */
function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitive(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_FIELDS.some(f => lowerKey.includes(f.toLowerCase()))) {
        result[key] = value ? '***REDACTED***' : value;
      } else {
        result[key] = redactSensitive(value, depth + 1);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Create a structured log entry
 */
function createLogEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? redactSensitive(context) as Record<string, unknown> : {}),
  };
  return entry;
}

/**
 * Structured logger with sensitive data redaction
 */
export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    if (process.env.NODE_ENV === 'development') {
      console.debug(JSON.stringify(createLogEntry('debug', message, context)));
    }
  },

  info(message: string, context?: Record<string, unknown>) {
    console.log(JSON.stringify(createLogEntry('info', message, context)));
  },

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(JSON.stringify(createLogEntry('warn', message, context)));
  },

  error(message: string, context?: Record<string, unknown>) {
    console.error(JSON.stringify(createLogEntry('error', message, context)));
  },
};
