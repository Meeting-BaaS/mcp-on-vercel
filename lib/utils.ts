import { PRE_PROD_ENVIRONMENT_SUFFIX } from "./constants"

// Define base domain
const BASE_DOMAIN = process.env.BAAS_URL || "meetingbaas.com"

// Helper to construct environment-aware API URL
export const getApiUrl = (environment: string | null) => {
  if (environment && environment === PRE_PROD_ENVIRONMENT_SUFFIX) {
    return `https://api.${environment}${BASE_DOMAIN}`
  }
  return `https://api.${BASE_DOMAIN}`
}

// Keys whose values are credentials or PII and must never reach logs. Matched at
// any depth (e.g. callback_config.secret, streaming_config.input_url).
const SENSITIVE_KEYS = new Set([
  "api_key", "oauth_client_secret", "oauth_refresh_token", "oauth_client_id",
  "secret", "input_url", "output_url", "meeting_url", "client_secret",
  "authorization_code", "entry_message", "bot_image", "url", "token",
  // PII from meeting/transcript/calendar payloads
  "speaker", "speakers", "email", "attendees", "transcript", "transcripts"
])

/**
 * Deep-redact sensitive values for safe logging. Recurses into nested objects
 * and arrays, replacing any value under a sensitive key with "[REDACTED]".
 * Returns a new structure; the input is never mutated.
 */
export function redactArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactArgs(item))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? "[REDACTED]" : redactArgs(val)
    }
    return out
  }
  return value
}

/** Normalize an unknown thrown/returned error value into a safe string. */
export function toErrorText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
