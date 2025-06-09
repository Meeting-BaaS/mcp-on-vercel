import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { BaasClient } from "@meeting-baas/sdk/dist/baas/api/client";
import { registerJoinTool } from "./bots/join";
import { registerEchoTool } from "./utils/echo";

export function registerTools(server: McpServer, apiKey: string): McpServer {
  const baasClient = new BaasClient({
    apiKey: apiKey,
    baseUrl: `https://api.${process.env.BAAS_URL}/`,
  });
  let updatedServer = registerJoinTool(server, baasClient);
  return registerEchoTool(updatedServer);
}

export default registerTools;
