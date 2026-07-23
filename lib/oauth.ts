import crypto from "node:crypto"
import type { IncomingMessage, ServerResponse } from "http"
import getRawBody from "raw-body"
import { MCP_URL } from "./constants"
import { getRedis } from "./redis"

/**
 * OAuth 2.1 authorization server for the Meeting BaaS MCP server, per the MCP
 * authorization spec:
 *
 *  - RFC 9728 Protected Resource Metadata  (/.well-known/oauth-protected-resource)
 *  - RFC 8414 Authorization Server Metadata (/.well-known/oauth-authorization-server)
 *  - RFC 7591 Dynamic Client Registration   (POST /oauth/register)
 *  - Authorization Code + PKCE (S256 only)  (GET /oauth/authorize, POST /oauth/token)
 *  - Refresh token rotation
 *
 * User authentication is delegated to the Meeting BaaS dashboard: /oauth/authorize
 * parks the request in Redis and redirects the browser to OAUTH_CONSENT_URL. After
 * the user logs in and approves, the dashboard backend calls
 * POST /oauth/consent/complete (authenticated with OAUTH_CONSENT_SECRET) with the
 * user's Meeting BaaS API key; we mint the authorization code and hand back the
 * redirect URL. Access tokens are opaque and map to that API key in Redis, so the
 * MCP tools layer keeps receiving a plain API key and revocation is a key delete.
 */

const ISSUER = (process.env.OAUTH_ISSUER || MCP_URL).replace(/\/$/, "")
const CONSENT_URL = process.env.OAUTH_CONSENT_URL || ""
const CONSENT_SECRET = process.env.OAUTH_CONSENT_SECRET || ""

const AUTH_REQUEST_TTL_S = 10 * 60
const CODE_TTL_S = 2 * 60
const ACCESS_TOKEN_TTL_S = Number(process.env.OAUTH_ACCESS_TOKEN_TTL_S) || 60 * 60
const REFRESH_TOKEN_TTL_S = Number(process.env.OAUTH_REFRESH_TOKEN_TTL_S) || 30 * 24 * 60 * 60

const SCOPES = ["bots:read", "bots:write", "calendars:read", "calendars:write", "data:delete"]

interface OAuthClient {
  client_id: string
  client_name?: string
  redirect_uris: string[]
  token_endpoint_auth_method: "none"
  client_id_issued_at: number
}

interface AuthRequest {
  client_id: string
  redirect_uri: string
  code_challenge: string
  state?: string
  scope: string
}

interface CodeGrant extends AuthRequest {
  api_key: string
  user_id: string
}

interface TokenRecord {
  api_key: string
  user_id: string
  client_id: string
  scope: string
}

const randomToken = (prefix: string) => `${prefix}_${crypto.randomBytes(32).toString("hex")}`
const sha256b64url = (input: string) => crypto.createHash("sha256").update(input).digest("base64url")

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    ...headers
  })
  res.end(JSON.stringify(body))
}

function oauthError(res: ServerResponse, status: number, error: string, description: string) {
  sendJson(res, status, { error, error_description: description })
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await getRawBody(req, { limit: "64kb" })
  return JSON.parse(raw.toString("utf8"))
}

/** Token endpoint accepts application/x-www-form-urlencoded (spec) or JSON (lenient). */
async function readFormBody(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = (await getRawBody(req, { limit: "64kb" })).toString("utf8")
  if ((req.headers["content-type"] || "").includes("application/json")) {
    return JSON.parse(raw)
  }
  return Object.fromEntries(new URLSearchParams(raw))
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol === "https:") return true
    // Loopback redirects are allowed for native/CLI clients (OAuth 2.1 §8.4.2)
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")
  } catch {
    return false
  }
}

/** Fixed-window per-IP rate limit backed by Redis. Returns true when over limit. */
async function rateLimited(req: IncomingMessage, bucket: string, limitPerMinute: number): Promise<boolean> {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  const key = `oauth:rl:${bucket}:${ip}:${Math.floor(Date.now() / 60_000)}`
  const redis = getRedis()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  return count > limitPerMinute
}

export function buildWwwAuthenticate(error?: string): string {
  const parts = [`Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`]
  if (error) parts.push(`error="${error}"`)
  return parts.join(", ")
}

/**
 * Resolve an opaque access token (mbt_*) to its Meeting BaaS API key.
 * Returns null for unknown/expired tokens.
 */
export async function resolveAccessToken(token: string): Promise<TokenRecord | null> {
  const raw = await getRedis().get(`oauth:token:${token}`)
  return raw ? (JSON.parse(raw) as TokenRecord) : null
}

export function isOAuthAccessToken(token: string): boolean {
  return token.startsWith("mbt_")
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleProtectedResourceMetadata(res: ServerResponse) {
  sendJson(res, 200, {
    resource: `${ISSUER}/mcp`,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES,
    resource_name: "Meeting BaaS"
  })
}

function handleAuthServerMetadata(res: ServerResponse) {
  sendJson(res, 200, {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`,
    registration_endpoint: `${ISSUER}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES
  })
}

async function handleRegister(req: IncomingMessage, res: ServerResponse) {
  if (await rateLimited(req, "register", 10)) {
    return oauthError(res, 429, "slow_down", "Too many registration requests")
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req)
  } catch {
    return oauthError(res, 400, "invalid_client_metadata", "Body must be valid JSON")
  }

  const redirectUris = body.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string" && isAllowedRedirectUri(u))) {
    return oauthError(
      res,
      400,
      "invalid_redirect_uri",
      "redirect_uris must be a non-empty array of https:// (or http://localhost) URLs"
    )
  }

  const client: OAuthClient = {
    client_id: randomToken("mbc"),
    client_name: typeof body.client_name === "string" ? body.client_name.slice(0, 128) : undefined,
    redirect_uris: redirectUris as string[],
    token_endpoint_auth_method: "none",
    client_id_issued_at: Math.floor(Date.now() / 1000)
  }
  await getRedis().set(`oauth:client:${client.client_id}`, JSON.stringify(client))

  sendJson(res, 201, client)
}

async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!clientId) return null
  const raw = await getRedis().get(`oauth:client:${clientId}`)
  return raw ? (JSON.parse(raw) as OAuthClient) : null
}

async function handleAuthorize(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (!CONSENT_URL) {
    return oauthError(res, 503, "temporarily_unavailable", "OAUTH_CONSENT_URL is not configured")
  }

  const q = url.searchParams
  const client = await getClient(q.get("client_id") || "")
  const redirectUri = q.get("redirect_uri") || ""

  // Per OAuth 2.1, never redirect to an unvalidated redirect_uri.
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return oauthError(res, 400, "invalid_request", "Unknown client_id or unregistered redirect_uri")
  }

  const respondRedirectError = (error: string, description: string) => {
    const target = new URL(redirectUri)
    target.searchParams.set("error", error)
    target.searchParams.set("error_description", description)
    const state = q.get("state")
    if (state) target.searchParams.set("state", state)
    res.writeHead(302, { Location: target.toString() }).end()
  }

  if (q.get("response_type") !== "code") {
    return respondRedirectError("unsupported_response_type", "Only response_type=code is supported")
  }
  if (!q.get("code_challenge") || q.get("code_challenge_method") !== "S256") {
    return respondRedirectError("invalid_request", "PKCE with code_challenge_method=S256 is required")
  }

  const requestedScopes = (q.get("scope") || "").split(" ").filter(Boolean)
  const unknown = requestedScopes.filter((s) => !SCOPES.includes(s))
  if (unknown.length > 0) {
    return respondRedirectError("invalid_scope", `Unknown scope(s): ${unknown.join(", ")}`)
  }

  const request: AuthRequest = {
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: q.get("code_challenge") as string,
    state: q.get("state") || undefined,
    scope: requestedScopes.length > 0 ? requestedScopes.join(" ") : SCOPES.join(" ")
  }
  const requestId = randomToken("mbar")
  await getRedis().set(`oauth:req:${requestId}`, JSON.stringify(request), "EX", AUTH_REQUEST_TTL_S)

  const consent = new URL(CONSENT_URL)
  consent.searchParams.set("request_id", requestId)
  consent.searchParams.set("client_name", client.client_name || client.client_id)
  consent.searchParams.set("scope", request.scope)
  res.writeHead(302, { Location: consent.toString() }).end()
}

/**
 * Server-to-server callback from the Meeting BaaS dashboard after the user
 * logs in and approves (or denies) the consent screen. Authenticated with the
 * shared OAUTH_CONSENT_SECRET. Responds with the URL the dashboard should
 * redirect the user's browser to.
 */
async function handleConsentComplete(req: IncomingMessage, res: ServerResponse) {
  if (!CONSENT_SECRET) {
    return oauthError(res, 503, "temporarily_unavailable", "OAUTH_CONSENT_SECRET is not configured")
  }
  const provided = req.headers["x-consent-secret"]
  const secretOk =
    typeof provided === "string" &&
    provided.length === CONSENT_SECRET.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(CONSENT_SECRET))
  if (!secretOk) {
    return oauthError(res, 401, "access_denied", "Invalid consent secret")
  }

  let body: Record<string, unknown>
  try {
    body = await readJsonBody(req)
  } catch {
    return oauthError(res, 400, "invalid_request", "Body must be valid JSON")
  }

  const requestId = typeof body.request_id === "string" ? body.request_id : ""
  const redis = getRedis()
  const rawRequest = await redis.get(`oauth:req:${requestId}`)
  if (!rawRequest) {
    return oauthError(res, 400, "invalid_request", "Unknown or expired request_id")
  }
  const request = JSON.parse(rawRequest) as AuthRequest
  await redis.del(`oauth:req:${requestId}`)

  const redirect = new URL(request.redirect_uri)
  if (request.state) redirect.searchParams.set("state", request.state)

  if (body.approved !== true) {
    redirect.searchParams.set("error", "access_denied")
    return sendJson(res, 200, { redirect_url: redirect.toString() })
  }

  const apiKey = typeof body.api_key === "string" ? body.api_key : ""
  const userId = typeof body.user_id === "string" ? body.user_id : ""
  if (!apiKey || !userId) {
    return oauthError(res, 400, "invalid_request", "api_key and user_id are required when approved")
  }

  const grant: CodeGrant = { ...request, api_key: apiKey, user_id: userId }
  const code = randomToken("mbac")
  await redis.set(`oauth:code:${code}`, JSON.stringify(grant), "EX", CODE_TTL_S)

  redirect.searchParams.set("code", code)
  sendJson(res, 200, { redirect_url: redirect.toString() })
}

async function issueTokens(res: ServerResponse, record: TokenRecord) {
  const redis = getRedis()
  const accessToken = randomToken("mbt")
  const refreshToken = randomToken("mbr")
  await redis.set(`oauth:token:${accessToken}`, JSON.stringify(record), "EX", ACCESS_TOKEN_TTL_S)
  await redis.set(`oauth:refresh:${refreshToken}`, JSON.stringify(record), "EX", REFRESH_TOKEN_TTL_S)
  sendJson(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: record.scope
  })
}

async function handleToken(req: IncomingMessage, res: ServerResponse) {
  if (await rateLimited(req, "token", 30)) {
    return oauthError(res, 429, "slow_down", "Too many token requests")
  }

  let body: Record<string, string>
  try {
    body = await readFormBody(req)
  } catch {
    return oauthError(res, 400, "invalid_request", "Malformed request body")
  }

  const redis = getRedis()

  if (body.grant_type === "authorization_code") {
    const rawGrant = body.code ? await redis.get(`oauth:code:${body.code}`) : null
    if (!rawGrant) {
      return oauthError(res, 400, "invalid_grant", "Unknown or expired authorization code")
    }
    // Single use — delete before validating so a replay always fails.
    await redis.del(`oauth:code:${body.code}`)
    const grant = JSON.parse(rawGrant) as CodeGrant

    if (body.client_id !== grant.client_id) {
      return oauthError(res, 400, "invalid_grant", "client_id mismatch")
    }
    if (body.redirect_uri && body.redirect_uri !== grant.redirect_uri) {
      return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch")
    }
    if (!body.code_verifier || sha256b64url(body.code_verifier) !== grant.code_challenge) {
      return oauthError(res, 400, "invalid_grant", "PKCE verification failed")
    }

    return issueTokens(res, {
      api_key: grant.api_key,
      user_id: grant.user_id,
      client_id: grant.client_id,
      scope: grant.scope
    })
  }

  if (body.grant_type === "refresh_token") {
    const rawRecord = body.refresh_token ? await redis.get(`oauth:refresh:${body.refresh_token}`) : null
    if (!rawRecord) {
      return oauthError(res, 400, "invalid_grant", "Unknown or expired refresh token")
    }
    const record = JSON.parse(rawRecord) as TokenRecord
    if (body.client_id !== record.client_id) {
      return oauthError(res, 400, "invalid_grant", "client_id mismatch")
    }
    // Rotation: old refresh token dies with this exchange.
    await redis.del(`oauth:refresh:${body.refresh_token}`)
    return issueTokens(res, record)
  }

  return oauthError(res, 400, "unsupported_grant_type", "Supported: authorization_code, refresh_token")
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Handle OAuth/metadata routes. Returns true when the request was handled,
 * false when it should fall through to the MCP handler.
 */
export async function handleOAuthRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname
  const isOAuthPath =
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp" ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/oauth/register" ||
    path === "/oauth/authorize" ||
    path === "/oauth/consent/complete" ||
    path === "/oauth/token"
  if (!isOAuthPath) return false

  if (req.method === "OPTIONS") {
    res
      .writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version"
      })
      .end()
    return true
  }

  try {
    if (path.startsWith("/.well-known/oauth-protected-resource") && req.method === "GET") {
      handleProtectedResourceMetadata(res)
    } else if (path === "/.well-known/oauth-authorization-server" && req.method === "GET") {
      handleAuthServerMetadata(res)
    } else if (path === "/oauth/register" && req.method === "POST") {
      await handleRegister(req, res)
    } else if (path === "/oauth/authorize" && req.method === "GET") {
      await handleAuthorize(req, res, url)
    } else if (path === "/oauth/consent/complete" && req.method === "POST") {
      await handleConsentComplete(req, res)
    } else if (path === "/oauth/token" && req.method === "POST") {
      await handleToken(req, res)
    } else {
      oauthError(res, 405, "invalid_request", "Method not allowed")
    }
  } catch (error) {
    console.error("OAuth route error:", error)
    if (!res.headersSent) {
      oauthError(res, 500, "server_error", "Internal error")
    }
  }
  return true
}
