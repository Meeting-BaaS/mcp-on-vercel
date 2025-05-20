import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
// @ts-ignore
import axios, { AxiosError } from "axios";
import { z } from "zod";

// Define the persona types based on the new schema
const SPEAKING_API_URL = "https://speaking.meetingbaas.com";

// Hardcoded list of available personas
const AVAILABLE_PERSONAS = [
  "1940s_noir_detective",
  "academic_warlord",
  "ancient_alien_theorist",
  "ancient_roman_general",
  "arctic_prospector",
  "artisan_magnate",
  "astral_plane_uber_driver",
  "baas_onboarder",
  "bitcoin_maximalist",
  "buddhist_monk",
  "climate_engineer",
  "corporate_girlboss",
  "cpp_veteran",
  "crypto_patriarch",
  "cyberpunk_grandma",
  "data_baron",
  "debate_champion",
  "deep_sea_therapist",
  "environmental_activist",
  "factory_patriarch",
  "fading_diplomat",
  "forensic_accountant",
  "french_renaissance_painter",
  "futuristic_ai_philosopher",
  "genetic_aristocrat",
  "gladiator_chef",
  "golang_minimalist",
  "grafana_guru",
  "haskell_purist",
  "hospital_administrator",
  "immigration_maximalist",
  "intelligence_officer",
  "interdimensional_therapist",
  "intergalactic_barista",
  "interviewer",
  "kgb_ballerina",
  "lisp_enlightened",
  "master_sommelier",
  "media_cardinal",
  "medieval_crypto_trader",
  "medieval_plague_doctor",
  "memory_merchant",
  "military_strategist",
  "mongolian_shepherd",
  "neural_interface_mogul",
  "ninja_librarian",
  "oligarch_widow",
  "pair_programmer",
  "pharma_patriarch",
  "pirate_queen",
  "poker_champion",
  "port_master",
  "prehistoric_foodie",
  "quantum_financier",
  "quantum_mechanic",
  "quantum_physicist",
  "renaissance_gym_bro",
  "renaissance_soundcloud_rapper",
  "revolutionary_hacker",
  "rust_evangelist",
  "southern_grandma",
  "space_exploration_robot",
  "space_industrialist",
  "stoic_philosopher",
  "stone_age_tech_support",
  "synthetic_food_baron",
  "time_traveling_influencer",
  "underground_banker",
  "urban_mining_tycoon",
  "vatican_cybersecurity_officer",
  "victorian_etiquette_coach",
  "victorian_serial_killer",
  "war_correspondent",
  "waste_baron",
  "water_merchant",
];

// Define types based on the OpenAPI specification
interface BotRequest {
  meeting_url: string;
  bot_name?: string;
  personas?: string[] | null;
  bot_image?: string | null;
  entry_message?: string | null;
  extra?: Record<string, unknown> | null;
  enable_tools?: boolean;
}

interface JoinResponse {
  bot_id: string;
}

interface LeaveBotRequest {
  bot_id: string | null;
}

/**
 * Generate a curl command for debugging purposes
 */
function generateCurlCommand(
  method: string, 
  url: string, 
  data: Record<string, any>,
  headers: Record<string, string>
): string {
  // Mask the API key in the headers for security
  const maskedHeaders = { ...headers };
  if (maskedHeaders['x-meeting-baas-api-key']) {
    const prefix = maskedHeaders['x-meeting-baas-api-key'].split('_').slice(0, 2).join('_');
    maskedHeaders['x-meeting-baas-api-key'] = `${prefix}_${'*'.repeat(20)}`;
  }
  
  const headersStr = Object.entries(maskedHeaders)
    .map(([key, value]) => `-H "${key}: ${value}"`)
    .join(' \\\n  ');
  
  return `curl -X ${method} ${url} \\
  ${headersStr} \\
  -d '${JSON.stringify(data, null, 2)}'`;
}

export function registerJoinSpeakingTool(server: McpServer): McpServer {
  // For Join Speaking Meeting
  server.tool(
    "joinSpeakingMeeting",
    "Send an AI speaking bot to join a video meeting. The bot can assist in meetings with voice AI capabilities.",
    {
      meetingUrl: z.string().url().describe("URL of the meeting to join"),
      botName: z
        .string()
        .optional()
        .describe("Name to display for the bot in the meeting"),
      meetingBaasApiKey: z
        .string()
        .describe("Your MeetingBaas API key for authentication"),
      personas: z
        .array(z.string())
        .optional()
        .describe(
          `List of persona names to use. The first available will be selected. Available personas: ${AVAILABLE_PERSONAS.join(
            ", "
          )}`
        ),
      botImage: z
        .string()
        .url()
        .optional()
        .describe("The image to use for the bot, must be a URL."),
      entryMessage: z
        .string()
        .optional()
        .describe("Message to send when joining the meeting."),
      enableTools: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to enable tools for the bot."),
      extra: z
        .record(z.unknown())
        .optional()
        .describe(
          "A JSON object that allows you to add custom data to a bot for your convenience."
        ),
    },
    async (params) => {
      try {
        console.log("Joining speaking meeting with params:", JSON.stringify(params, null, 2));
        
        // Create a minimal request with just the required fields
        const botRequest: BotRequest = {
          meeting_url: params.meetingUrl,
        };

        // Add optional fields only if they are provided
        if (params.botName) botRequest.bot_name = params.botName;
        if (params.personas) botRequest.personas = params.personas;
        if (params.botImage) botRequest.bot_image = params.botImage;
        if (params.entryMessage) botRequest.entry_message = params.entryMessage;
        if (params.enableTools !== undefined) botRequest.enable_tools = params.enableTools;
        if (params.extra) botRequest.extra = params.extra;

        console.log(`Making request to ${SPEAKING_API_URL}/bots`);
        
        // Make a direct API call to the endpoint with API key in header
        const response = await axios.post<JoinResponse>(
          `${SPEAKING_API_URL}/bots`,
          botRequest,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-meeting-baas-api-key': params.meetingBaasApiKey,
            },
          }
        );

        console.log("Response from speaking API:", JSON.stringify(response.data, null, 2));

        if (response.data.bot_id) {
          return {
            content: [
              {
                type: "text",
                text: `Successfully joined meeting with speaking bot ID: ${response.data.bot_id}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "No bot ID received in the response",
            },
          ],
          isError: true,
        };
      } catch (error: unknown) {
        console.error("Failed to join meeting with speaking bot:", error);

        // Generate curl command for debugging with API key in header
        const curlCommand = generateCurlCommand(
          'POST', 
          `${SPEAKING_API_URL}/bots`,
          {
            meeting_url: params.meetingUrl,
            bot_name: params.botName,
            personas: params.personas,
            bot_image: params.botImage,
            entry_message: params.entryMessage,
            enable_tools: params.enableTools,
            extra: params.extra,
          },
          {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': params.meetingBaasApiKey,
          }
        );

        let errorMessage = "Failed to join meeting with speaking bot: ";
        // Handle axios errors more specifically
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          errorMessage += `${axiosError.message}`;
          if (axiosError.response) {
            errorMessage += ` - Status: ${axiosError.response.status}`;
            if (axiosError.response.data) {
              errorMessage += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
            }
          }
        } else if (error instanceof Error) {
          errorMessage += error.message;
        } else if (typeof error === "string") {
          errorMessage += error;
        } else {
          errorMessage += "Unknown error occurred";
        }

        return {
          content: [
            {
              type: "text",
              text: errorMessage,
            },
            {
              type: "text",
              text: "\n\nFor debugging, you can try this curl command:\n\n" + curlCommand,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Leave Speaking Meeting
  server.tool(
    "leaveSpeakingMeeting",
    "Remove a speaking bot from a meeting by its ID.",
    {
      botId: z
        .string()
        .describe("The MeetingBaas bot ID to remove from the meeting"),
      meetingBaasApiKey: z
        .string()
        .describe("Your MeetingBaas API key for authentication"),
    },
    async (params) => {
      try {
        console.log("Leaving speaking meeting with params:", JSON.stringify(params, null, 2));
        
        const leaveRequest: LeaveBotRequest = {
          bot_id: params.botId,
        };

        console.log(`Making request to ${SPEAKING_API_URL}/bots/${params.botId}`);

        await axios.delete(`${SPEAKING_API_URL}/bots/${params.botId}`, {
          data: leaveRequest,
          headers: {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': params.meetingBaasApiKey,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: `Successfully removed speaking bot ID: ${params.botId} from the meeting`,
            },
          ],
        };
      } catch (error: unknown) {
        console.error("Failed to remove speaking bot from meeting:", error);

        // Generate curl command for debugging with API key in header
        const curlCommand = generateCurlCommand(
          'DELETE', 
          `${SPEAKING_API_URL}/bots/${params.botId}`,
          {
            bot_id: params.botId,
          },
          {
            'Content-Type': 'application/json',
            'x-meeting-baas-api-key': params.meetingBaasApiKey,
          }
        );

        let errorMessage = "Failed to remove speaking bot: ";
        // Handle axios errors more specifically
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          errorMessage += `${axiosError.message}`;
          if (axiosError.response) {
            errorMessage += ` - Status: ${axiosError.response.status}`;
            if (axiosError.response.data) {
              errorMessage += ` - Details: ${JSON.stringify(axiosError.response.data)}`;
            }
          }
        } else if (error instanceof Error) {
          errorMessage += error.message;
        } else if (typeof error === "string") {
          errorMessage += error;
        } else {
          errorMessage += "Unknown error occurred";
        }

        return {
          content: [
            {
              type: "text",
              text: errorMessage,
            },
            {
              type: "text",
              text: "\n\nFor debugging, you can try this curl command:\n\n" + curlCommand,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
