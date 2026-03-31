import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import { registerV1Tools } from "./tools-v1"
import { registerV2Tools } from "./tools-v2"

export function registerTools(
  server: McpServer,
  apiKey: string,
  baseUrl?: string,
  apiVersion: "v1" | "v2" = "v1"
): McpServer {
  console.log(`Registering tools for API version: ${apiVersion}`)
  if (apiVersion === "v2") {
    return registerV2Tools(server, apiKey, baseUrl)
  }
  return registerV1Tools(server, apiKey, baseUrl)
}

export default registerTools
