import Redis from "ioredis"

let client: Redis | null = null

/**
 * Lazy singleton Redis connection. OAuth (clients, codes, tokens, rate limits)
 * is the only consumer; the MCP session map stays in-memory. Throws if
 * REDIS_URL is unset so OAuth endpoints fail loudly instead of half-working.
 */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL
    if (!url) {
      throw new Error("REDIS_URL is not set — required for OAuth endpoints")
    }
    client = new Redis(url, { maxRetriesPerRequest: 2 })
  }
  return client
}
