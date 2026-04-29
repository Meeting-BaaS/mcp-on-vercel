import crypto from "node:crypto"
import type { ServerOptions as McpServerOptions } from "@modelcontextprotocol/sdk/server/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { IncomingMessage, ServerResponse } from "http"
import type z from "zod"
import { MCP_URL } from "./constants"
import { getApiUrl } from "./utils"

interface ServerOptions extends McpServerOptions {
  parameters?: {
    schema: z.ZodSchema
  }
}

export function initializeMcpApiHandler(
  initializeServer: (server: McpServer, apiKey: string, baseUrl?: string, apiVersion?: "v1" | "v2") => void,
  serverOptions: ServerOptions = {}
) {
  // Map session IDs to their transports
  const transports = new Map<string, StreamableHTTPServerTransport>()

  return async function mcpApiHandler(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "", MCP_URL)

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

    // Extract API key from headers
    apiKey =
      (req.headers["x-meeting-baas-api-key"] as string) ||
      (req.headers["x-meetingbaas-apikey"] as string) ||
      (req.headers["x-api-key"] as string) ||
      (req.headers["authorization"] as string)?.replace(/bearer\s+/i, "") ||
      (process.env.NODE_ENV === "development" ? process.env.BAAS_API_KEY : null) ||
      null

    // Route to existing session or create a new one
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (sessionId && transports.has(sessionId)) {
      // Existing session — forward to its transport
      await transports.get(sessionId)!.handleRequest(req, res)
    } else if (!sessionId && req.method === "POST") {
      // New session — create transport + server
      console.log("Got new MCP connection", req.url, req.method)

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          console.log("New MCP session:", id)
          transports.set(id, transport)
        },
        enableJsonResponse: true
      })

      const server = new McpServer(
        {
          name: "mcp-typescript server on vercel",
          version: "0.1.0"
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
          transports.delete(transport.sessionId)
        }
      }

      await transport.handleRequest(req, res)
    } else if (sessionId && !transports.has(sessionId)) {
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
