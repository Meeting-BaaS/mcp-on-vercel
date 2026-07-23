import crypto from "node:crypto"
import type { ServerOptions as McpServerOptions } from "@modelcontextprotocol/sdk/server/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { IncomingMessage, ServerResponse } from "http"
import type z from "zod"
import { MCP_URL } from "./constants"
import { buildWwwAuthenticate, handleOAuthRoute, isOAuthAccessToken, resolveAccessToken } from "./oauth"
import { getApiUrl } from "./utils"

interface ServerOptions extends McpServerOptions {
  parameters?: {
    schema: z.ZodSchema
  }
}

// How long a session may sit idle (no requests) before we evict it, and how
// often we sweep for idle sessions. A well-behaved client sends DELETE /mcp to
// terminate, which cleans up immediately via transport.onclose; this sweep is
// the backstop for clients that just disconnect, so the Map can't grow without
// bound on a long-running (non-serverless) host.
const SESSION_IDLE_MS = Number(process.env.MCP_SESSION_IDLE_MS) || 30 * 60 * 1000
const SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS) || 5 * 60 * 1000

export function initializeMcpApiHandler(
  initializeServer: (server: McpServer, apiKey: string, baseUrl?: string, apiVersion?: "v1" | "v2") => void,
  serverOptions: ServerOptions = {}
) {
  // Map session IDs to their transport plus last-activity timestamp
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; lastActive: number }>()

  // Backstop sweep: close any session idle longer than SESSION_IDLE_MS.
  // transport.close() fires onclose, which removes the entry. unref() so this
  // timer never keeps the process alive on shutdown.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - SESSION_IDLE_MS
    for (const [id, { transport, lastActive }] of sessions) {
      if (lastActive < cutoff) {
        console.log("Evicting idle MCP session:", id)
        void transport.close()
      }
    }
  }, SESSION_SWEEP_MS)
  sweep.unref?.()

  return async function mcpApiHandler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "", MCP_URL)

    // OAuth authorization server + metadata endpoints (marketplace clients)
    if (await handleOAuthRoute(req, res, url)) {
      return
    }

    if (url.pathname !== "/mcp") {
      res.statusCode = 404
      res.end("Not found")
      return
    }

    // Extract common headers
    let apiKey: string | null = null
    let baseUrl: string | undefined

    const environment = req.headers["x-environment"] || ""
    baseUrl = getApiUrl(Array.isArray(environment) ? environment[0] : environment)
    console.log("The environment is", environment)
    console.log("The API Base Url has been set to", baseUrl)

    // Extract API version from header (default to v1 for backward compatibility)
    const versionHeader = req.headers["x-api-version"]
    const versionValue = Array.isArray(versionHeader) ? versionHeader[0] : versionHeader
    let apiVersion: "v1" | "v2" = "v1"
    if (versionValue !== undefined) {
      if (versionValue === "v1" || versionValue === "v2") {
        apiVersion = versionValue
      } else {
        res.writeHead(400, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: `Unsupported API version: "${versionValue}". Supported versions are "v1" and "v2".`
            },
            id: null
          })
        )
        return
      }
    }
    console.log("API version:", apiVersion)

    // Extract credentials: an OAuth access token (marketplace clients) or a raw
    // API key in legacy headers. Opaque mbt_* tokens resolve to the user's
    // Meeting BaaS API key via Redis; any other Authorization value is treated
    // as a raw API key for backward compatibility.
    const bearer = (req.headers["authorization"] as string)?.replace(/^bearer\s+/i, "") || null
    if (bearer && isOAuthAccessToken(bearer)) {
      const record = await resolveAccessToken(bearer)
      if (!record) {
        res
          .writeHead(401, {
            "Content-Type": "application/json",
            "WWW-Authenticate": buildWwwAuthenticate("invalid_token")
          })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Invalid or expired access token." },
              id: null
            })
          )
        return
      }
      apiKey = record.api_key
      // OAuth clients come from the marketplaces and should always get the v2
      // tools unless they explicitly pin a version.
      if (versionValue === undefined) {
        apiVersion = "v2"
      }
    } else {
      apiKey =
        (req.headers["x-meeting-baas-api-key"] as string) ||
        (req.headers["x-meetingbaas-apikey"] as string) ||
        (req.headers["x-api-key"] as string) ||
        bearer ||
        (process.env.NODE_ENV === "development" ? process.env.BAAS_API_KEY : null) ||
        null
    }

    // No credentials at all: challenge with the resource metadata URL so OAuth
    // clients can discover the authorization server (RFC 9728).
    if (!apiKey && req.method === "POST") {
      res
        .writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": buildWwwAuthenticate()
        })
        .end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message:
                "Authentication required. Provide a Meeting BaaS API key header or complete the OAuth flow."
            },
            id: null
          })
        )
      return
    }

    // Route to existing session or create a new one
    const sessionId = req.headers["mcp-session-id"] as string | undefined
    const session = sessionId ? sessions.get(sessionId) : undefined

    if (session) {
      // Existing session — forward to its transport and mark it active
      session.lastActive = Date.now()
      await session.transport.handleRequest(req, res)
    } else if (!sessionId && req.method === "POST") {
      // New session — create transport + server
      console.log("Got new MCP connection", req.url, req.method)

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          console.log("New MCP session:", id)
          sessions.set(id, { transport, lastActive: Date.now() })
        },
        enableJsonResponse: true
      })

      const server = new McpServer(
        {
          name: "Meeting BaaS",
          version: "1.0.0"
        },
        serverOptions
      )

      try {
        initializeServer(server, apiKey || "", baseUrl, apiVersion)
      } catch (error) {
        console.error("Error initializing server:", error)
      }

      await server.connect(transport)

      transport.onclose = () => {
        if (transport.sessionId) {
          console.log("MCP session closed:", transport.sessionId)
          sessions.delete(transport.sessionId)
        }
      }

      await transport.handleRequest(req, res)
    } else if (sessionId) {
      // Stale / unknown session
      res.writeHead(404, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session not found. The client must start a new session." },
          id: null
        })
      )
    } else {
      res.writeHead(405, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null
        })
      )
    }
  }
}
