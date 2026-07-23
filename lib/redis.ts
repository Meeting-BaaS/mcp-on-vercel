import fs from "node:fs"
import Redis from "ioredis"

let client: Redis | null = null

/**
 * Lazy singleton Redis connection. OAuth (clients, codes, tokens, rate limits)
 * is the only consumer; the MCP session map stays in-memory. Throws if
 * REDIS_URL is unset so OAuth endpoints fail loudly instead of half-working.
 *
 * Managed Redis over TLS: use a rediss:// URL and, when the server uses a
 * private CA (e.g. Scaleway), point REDIS_CA_CERT_PATH at the mounted CA
 * certificate — same pattern as the api-server-v2 chart.
 */
export function getRedis(): Redis {
  if (!client) {
    const url = process.env.REDIS_URL
    if (!url) {
      throw new Error("REDIS_URL is not set — required for OAuth endpoints")
    }
    const caPath = process.env.REDIS_CA_CERT_PATH
    client = new Redis(url, {
      maxRetriesPerRequest: 2,
      ...(url.startsWith("rediss://") && caPath ? { tls: { ca: fs.readFileSync(caPath) } } : {})
    })
  }
  return client
}
