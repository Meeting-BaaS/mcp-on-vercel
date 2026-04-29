import type { IncomingMessage, ServerResponse } from "node:http"
import * as http from "node:http"
import handler from "./api/server"

const PORT = process.env.PORT || 3000

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    // Add CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-meeting-baas-api-key, x-meetingbaas-apikey, x-api-key, x-environment, x-api-version"
    )

    if (req.method === "OPTIONS") {
      res.writeHead(200)
      res.end()
      return
    }

    // Call the Vercel handler
    await handler(req, res)
  } catch (error) {
    console.error("Server error:", error)
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Internal server error" }))
  }
})

server.listen(PORT, () => {
  console.log(`MCP Server running on port ${PORT}`)
  console.log("Available endpoints:")
  console.log("  - POST /mcp - MCP Streamable HTTP endpoint")
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully")
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})
