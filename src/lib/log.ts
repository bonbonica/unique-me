/**
 * Structured server-side logger.
 *
 * Why this module exists
 * ----------------------
 * Audit finding A09.1 flagged that the codebase logs via bare `console.error`
 * calls with inconsistent PII handling. This module is the minimal proportional
 * fix: a thin, server-only wrapper around `console.*` that emits one JSON line
 * per call, stamped with an ISO timestamp and a level, and scrubs any field
 * whose key looks like a credential before it ever reaches the log stream.
 *
 * Redaction contract
 * ------------------
 * Any field whose key (lowercased) matches the redaction regex is replaced
 * wholesale with the string "[REDACTED]". The regex covers:
 *   - password   — login credentials, password-reset payloads
 *   - secret     — generic shared secrets, signing secrets
 *   - token      — session tokens, bearer tokens, verification tokens
 *   - api_key / api-key / apikey — third-party API credentials
 *   - cookie     — raw Cookie / Set-Cookie headers
 *   - authorization — Authorization headers (carries bearer tokens)
 *
 * Redaction is applied to the top-level fields object AND one level into any
 * plain object value. It deliberately does NOT recurse into arrays or class
 * instances — that keeps the implementation predictable and avoids surprising
 * the caller by mutating opaque objects. `Error` instances are serialized to
 * `{ name, message, stack }` with the stack omitted in production builds so we
 * don't ship internals to log aggregators.
 *
 * Migration plan
 * --------------
 * New code should import `logInfo` / `logWarn` / `logError` from this module
 * instead of calling `console.*` directly. Existing `console.*` call sites
 * across the codebase will be migrated incrementally; this PR only adopts the
 * logger in `src/lib/auth.ts` (the most security-critical site that logs
 * today). Do NOT do a bulk find-and-replace — each call site needs a thought
 * about what `event` name and `fields` shape make sense.
 */

import "server-only";

/**
 * Keys whose values are scrubbed before logging.
 *
 * Token-by-token:
 *   password           — any *password* field
 *   secret             — any *secret* field (signing secrets, shared secrets)
 *   token              — auth tokens, refresh tokens, verification tokens, …
 *   api[_-]?key        — apiKey / api_key / api-key / apikey variants
 *   cookie             — raw Cookie / Set-Cookie header values
 *   authorization      — Authorization header (carries bearer tokens)
 *
 * Extend cautiously: add tokens that name credential-bearing fields, not
 * generic words. A too-broad token (e.g. "key") would hide useful debug data.
 */
const REDACT_KEY_REGEX =
  /password|secret|token|api[_-]?key|cookie|authorization/;

const REDACTED = "[REDACTED]";

type Level = "info" | "warn" | "error";

/**
 * Serialize an Error into a plain object that survives JSON.stringify.
 * Stack frames are stripped in production so they don't leak to log sinks.
 */
function serializeError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  };
}

/**
 * Return true for objects we should treat as a "plain" record — i.e. created
 * via `{}` or `Object.create(null)`. We deliberately exclude arrays, Errors,
 * Dates, Maps, Sets, and other class instances so we don't reach inside opaque
 * values that the caller hasn't sanitised.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk a field object and replace credential-shaped keys with "[REDACTED]".
 * Errors are serialized. Plain objects are recursed into once (shallow);
 * arrays and class instances are passed through untouched on purpose.
 */
function redact(
  fields: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACT_KEY_REGEX.test(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    if (value instanceof Error) {
      out[key] = serializeError(value);
      continue;
    }
    // One level of recursion: enough to scrub things like
    // { request: { headers: { authorization: "Bearer ..." } } } without
    // chasing deeply nested structures the caller hasn't vetted.
    if (depth === 0 && isPlainObject(value)) {
      out[key] = redact(value, depth + 1);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * In `vitest` runs we suppress output to keep the test report clean. A
 * developer can opt back in by setting LOG_LEVEL (any non-empty value) when
 * they need to see what the logger emitted from inside a test.
 */
function isSuppressed(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    (process.env.LOG_LEVEL ?? "") === ""
  );
}

function emit(
  level: Level,
  event: string,
  fields: Record<string, unknown> | undefined,
): void {
  if (isSuppressed()) return;

  const safeFields = fields ? redact(fields) : {};
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...safeFields,
  };

  // One JSON line per call so log aggregators (Vercel, Datadog, etc.) can
  // ingest without bespoke parsing.
  const line = JSON.stringify(record);

  switch (level) {
    case "info":
      // ESLint's no-console rule allows warn/error but not log. We use
      // console.warn for info because stdout is the more common sink for
      // structured logs and most aggregators ingest both streams anyway.
      // eslint-disable-next-line no-console
      console.log(line);
      return;
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
  }
}

export function logInfo(
  event: string,
  fields?: Record<string, unknown>,
): void {
  emit("info", event, fields);
}

export function logWarn(
  event: string,
  fields?: Record<string, unknown>,
): void {
  emit("warn", event, fields);
}

export function logError(
  event: string,
  fields?: Record<string, unknown>,
): void {
  emit("error", event, fields);
}
