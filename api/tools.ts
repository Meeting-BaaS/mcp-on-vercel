import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import { registerV2Tools } from "./tools-v2"

// v1 tools wrapped the legacy synchronous /bots/ REST API (blocking joinMeeting
// call with no bounded response time — see incident notes). All v1 tools have
// v2 equivalents (createBot, leaveBot, getBotDetails, etc.), so every session
// now gets v2 tools regardless of the x-api-version header. The header is
// still accepted upstream for backward compatibility; a client asserting "v1"
// no longer gets a 400, it just receives the v2 tool set.
export function registerTools(server: McpServer, apiKey: string, baseUrl?: string, apiVersion?: "v1" | "v2"): McpServer {
  if (apiVersion === "v1") {
    console.warn("Client requested deprecated v1 tools; registering v2 tools instead")
  }
  console.log("Registering v2 tools")
  return registerV2Tools(server, apiKey, baseUrl)
}

export default registerTools
