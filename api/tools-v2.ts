import {
  createBaasClient,
  V2Zod,
  V2ZodCalendars,
  type BaasClient
} from "@meeting-baas/sdk"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import axios from "axios"
import z from "zod"
import { redactArgs, toErrorText } from "../lib/utils"

// Helper to get the v2 client type
type V2Client = BaasClient<"v2">

// ---------------------------------------------------------------------------
// Focused MCP input schemas
//
// The SDK's Zod schemas (V2Zod.*) infer types with `null` for optional fields
// and `number` for validated enums, while the SDK's TypeScript interfaces use
// `undefined` and literal unions (e.g. 16000 | 24000 | 32000 | 48000).
// Both are auto-generated from the same OpenAPI spec; the mismatch is purely
// at the TypeScript level.
//
// Rather than casting between the two, we define concise MCP-facing schemas
// that produce types directly compatible with the SDK interfaces. This also
// gives MCP clients a cleaner, more focused input schema.
// ---------------------------------------------------------------------------

const streamingConfigSchema = z.object({
  audio_frequency: z.union([z.literal(16000), z.literal(24000), z.literal(32000), z.literal(48000)]).optional(),
  input_url: z.string().optional(),
  output_url: z.string().optional()
}).optional()

const transcriptionConfigSchema = z.object({
  provider: z.literal("gladia").optional(),
  api_key: z.string().optional(),
  custom_params: z.record(z.unknown()).optional()
}).optional()

const callbackConfigSchema = z.object({
  url: z.string(),
  secret: z.string().optional(),
  method: z.enum(["POST", "PUT"]).optional()
}).optional()

const timeoutConfigSchema = z.object({
  waiting_room_timeout: z.number().optional(),
  silence_timeout: z.number().optional(),
  no_one_joined_timeout: z.number().optional(),
  // grace_period added in @meeting-baas/sdk 6.1.x — extra time the bot waits
  // before leaving after a timeout condition is met.
  grace_period: z.number().optional()
}).optional()

const zoomConfigSchema = z.object({
  credential_id: z.string().optional()
}).optional()

const chatMessageSchema = z.string().min(1).max(500)

// Bot avatar image(s). Accepts a single HTTPS URL or an array of up to 5
// (JPEG/PNG/WebP). Multiple images are cycled per botImageConfigSchema.
const botImageSchema = z.union([
  z.string(),
  z.array(z.string()).min(1).max(5)
]).optional()

// Controls how multiple bot avatar images are displayed.
//   - auto:        cycle through images every image_duration seconds.
//   - bot_status:  image 1 on join, 2 when recording, 3 when paused (first 3 only).
const botImageConfigSchema = z.object({
  loop_mode: z.enum(["auto", "bot_status"]).optional(),
  image_duration: z.number().min(10).max(120).optional()
}).optional()

/** Core bot creation fields shared by createBot, createScheduledBot, and createCalendarBot. */
const botConfigShape = {
  bot_name: z.string().min(1).max(255).default("Meeting BaaS Bot"),
  meeting_url: z.string(),
  bot_image: z.union([z.string(), z.array(z.string()).min(1).max(5)]).optional().default("https://branding-template.s3.fr-par.scw.cloud/branding_template.png"),
  bot_image_config: botImageConfigSchema,
  recording_mode: z.enum(["speaker_view", "gallery_view", "audio_only"]).optional(),
  allow_multiple_bots: z.boolean().optional(),
  entry_message: z.string().max(500).optional(),
  extra: z.record(z.unknown()).optional(),
  timeout_config: timeoutConfigSchema,
  zoom_config: zoomConfigSchema,
  streaming_enabled: z.boolean().optional(),
  streaming_config: streamingConfigSchema,
  // .optional().default(true) order matters: ZodOptional must wrap ZodDefault so
  // an omitted field still resolves to true (the reverse order short-circuits to
  // undefined, and the API's own default is false — i.e. transcription off).
  // When enabled without a transcription_config, withTranscriptionDefaults
  // supplies the default Gladia provider config the API requires.
  transcription_enabled: z.boolean().optional().default(true),
  transcription_config: transcriptionConfigSchema,
  callback_enabled: z.boolean().optional(),
  callback_config: callbackConfigSchema,
  deduplication_key: z.string().optional()
}

/**
 * The v2 API rejects bot creation with `transcription_config is required when
 * transcription_enabled is true`. transcription_enabled defaults to true (see
 * botConfigShape), so supply a default Gladia config — the only supported
 * provider — when the caller enables transcription without specifying one.
 */
function withTranscriptionDefaults<T extends { transcription_enabled?: boolean; transcription_config?: unknown }>(
  args: T
): T {
  if (args.transcription_enabled !== false && !args.transcription_config) {
    return { ...args, transcription_config: { provider: "gladia" as const } }
  }
  return args
}

/**
 * Optional-everywhere variant of botConfigShape, used by update endpoints
 * (updateScheduledBot, updateCalendarBot) where every field is a patch.
 */
const botUpdateShape = {
  bot_name: z.string().min(1).max(255).optional(),
  meeting_url: z.string().optional(),
  bot_image: botImageSchema,
  bot_image_config: botImageConfigSchema,
  recording_mode: z.enum(["speaker_view", "gallery_view", "audio_only"]).optional(),
  allow_multiple_bots: z.boolean().optional(),
  entry_message: z.string().max(500).optional(),
  extra: z.record(z.unknown()).optional(),
  timeout_config: timeoutConfigSchema,
  zoom_config: zoomConfigSchema,
  streaming_enabled: z.boolean().optional(),
  streaming_config: streamingConfigSchema,
  transcription_enabled: z.boolean().optional(),
  transcription_config: transcriptionConfigSchema,
  callback_enabled: z.boolean().optional(),
  callback_config: callbackConfigSchema,
  deduplication_key: z.string().optional()
}

/** Zoom OAuth credential fields shared by createZoomCredential / updateZoomCredential. */
const zoomCredentialShape = {
  name: z.string().min(1).max(100),
  client_id: z.string(),
  client_secret: z.string(),
  authorization_code: z.string().optional(),
  redirect_uri: z.string().optional(),
  extra: z.record(z.unknown()).optional()
}

interface Utterance {
  speaker: string
  text: string
  start?: number
  end?: number
}

/** Extract utterances from various transcription provider formats. */
function extractUtterances(data: any): Utterance[] | null {
  // Gladia format: { result: { utterances: [...] } }
  if (data?.result?.utterances && Array.isArray(data.result.utterances)) {
    return data.result.utterances
  }
  // Direct format: { utterances: [...] }
  if (data?.utterances && Array.isArray(data.utterances)) {
    return data.utterances
  }
  // Plain array
  if (Array.isArray(data)) {
    return data
  }
  return null
}

export function registerV2Tools(server: McpServer, apiKey: string, baseUrl?: string): McpServer {
  console.log("Registering v2 tools")
  const baasClient: V2Client = createBaasClient({
    api_key: apiKey,
    api_version: "v2",
    base_url: baseUrl
  })

  // --- Bot Management ---

  // Create Bot (equivalent to v1 joinMeeting)
  server.tool(
    "createBot",
    "Create and send an AI bot to join a video meeting. The bot can record the meeting, transcribe speech (enabled by default using the Gladia provider), and provide real-time audio streams. Use this when you want to: 1) Record a meeting 2) Get meeting transcriptions 3) Stream meeting audio 4) Monitor meeting attendance",
    botConfigShape,
    async (args) => {
      console.log("Attempting to create bot", redactArgs(args))
      const result = await baasClient.createBot(withTranscriptionDefaults(args))
      if (!result.success) {
        console.error("Failed to create bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create bot: ${result.error}` }],
          isError: true
        }
      }
      console.log("Bot created successfully")
      return {
        content: [{ type: "text" as const, text: `Successfully created bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // List Bots (equivalent to v1 botsWithMetadata)
  server.tool(
    "listBots",
    "Get a list of all bots with their metadata. Use this when you want to: 1) View active bots 2) Check bot status 3) Monitor bot activity",
    V2Zod.listBotsQueryParams.shape,
    async (args) => {
      console.log("Attempting to list bots", redactArgs(args))
      const result = await baasClient.listBots(args)
      if (!result.success) {
        console.error("Failed to list bots", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list bots: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // Get Bot Details (equivalent to v1 getMeetingData)
  server.tool(
    "getBotDetails",
    "Get detailed information about a specific bot including recording data and transcripts. Use this when you want to: 1) Check meeting status 2) Get recording information 3) Access transcription data",
    { bot_id: z.string() },
    async (args) => {
      console.log("Attempting to get bot details", redactArgs(args))
      const result = await baasClient.getBotDetails({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to get bot details", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get bot details: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Get Bot Status
  server.tool(
    "getBotStatus",
    "Get the current status of a bot. Use this when you want to: 1) Check if a bot is still in a meeting 2) Monitor bot connection status 3) Get real-time bot state",
    { bot_id: z.string() },
    async (args) => {
      console.log("Attempting to get bot status", redactArgs(args))
      const result = await baasClient.getBotStatus({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to get bot status", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get bot status: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Leave Bot (equivalent to v1 leaveMeeting)
  server.tool(
    "leaveBot",
    "Remove an AI bot from a meeting. Use this when you want to: 1) End a meeting recording 2) Stop transcription 3) Disconnect the bot from the meeting",
    { bot_id: z.string() },
    async (args) => {
      console.log(`Attempting to remove bot ${args.bot_id} from meeting`)
      const result = await baasClient.leaveBot({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to leave meeting", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to leave meeting: ${result.error}` }],
          isError: true
        }
      }
      console.log("Meeting left successfully")
      return {
        content: [{ type: "text" as const, text: `Successfully removed bot ${args.bot_id} from meeting` }]
      }
    }
  )

  // Delete Bot Data (equivalent to v1 deleteData)
  server.tool(
    "deleteBotData",
    "Delete data associated with a meeting bot. Use this when you want to: 1) Remove meeting recordings 2) Delete transcription data 3) Clean up bot data",
    {
      bot_id: z.string(),
      delete_from_provider: z.boolean().optional()
    },
    async (args) => {
      console.log("Attempting to delete bot data", redactArgs(args))
      const result = await baasClient.deleteBotData(args)
      if (!result.success) {
        console.error("Failed to delete bot data", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to delete bot data: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: "Successfully deleted bot data" }]
      }
    }
  )

  // Batch Create Bots
  server.tool(
    "batchCreateBots",
    "Create multiple bots in a single request. Use this when you want to: 1) Send bots to several meetings at once 2) Bulk-record a set of meetings 3) Reduce round-trips when scheduling many bots",
    { bots: z.array(z.object(botConfigShape)).min(1).describe("Array of bot configurations to create") },
    async (args) => {
      console.log("Attempting to batch create bots", { count: args.bots.length })
      const result = await baasClient.batchCreateBots(args.bots.map(withTranscriptionDefaults))
      if (!result.success) {
        console.error("Failed to batch create bots", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to batch create bots: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, errors: result.errors }, null, 2) }]
      }
    }
  )

  // Get Bot Screenshots
  server.tool(
    "getBotScreenshots",
    "Get screenshots captured during a bot session. Use this when you want to: 1) Verify what the bot saw in the meeting 2) Inspect the meeting visually 3) Debug a recording",
    {
      bot_id: z.string(),
      limit: z.number().optional(),
      cursor: z.string().optional()
    },
    async (args) => {
      console.log("Attempting to get bot screenshots", redactArgs(args))
      const result = await baasClient.getBotScreenshots(args)
      if (!result.success) {
        console.error("Failed to get bot screenshots", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get bot screenshots: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // Resend Final Webhook
  server.tool(
    "resendFinalWebhook",
    "Resend the final webhook for a completed bot. Use this when you want to: 1) Recover from a missed webhook 2) Re-trigger downstream processing 3) Replay the end-of-meeting notification",
    { bot_id: z.string() },
    async (args) => {
      console.log("Attempting to resend final webhook", redactArgs(args))
      const result = await baasClient.resendFinalWebhook({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to resend final webhook", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to resend final webhook: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully resent final webhook: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Retry Callback
  server.tool(
    "retryCallback",
    "Retry the callback for a bot, optionally overriding the callback configuration. Use this when you want to: 1) Re-deliver a failed callback 2) Point a callback at a new URL 3) Recover from a callback outage",
    {
      bot_id: z.string(),
      callback_config: callbackConfigSchema
    },
    async (args) => {
      console.log("Attempting to retry callback", redactArgs(args))
      const result = await baasClient.retryCallback({ bot_id: args.bot_id, callbackConfig: args.callback_config })
      if (!result.success) {
        console.error("Failed to retry callback", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to retry callback: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully retried callback: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Update Bot Config
  server.tool(
    "updateBotConfig",
    "Update a running bot's extra metadata (shallow-merged with existing data). Use this when you want to: 1) Attach metadata to a live bot 2) Tag a recording in progress 3) Correlate a bot with external records",
    {
      bot_id: z.string(),
      extra: z.record(z.unknown()).describe("Custom metadata to merge with the bot's existing extra data")
    },
    async (args) => {
      console.log("Attempting to update bot config", { bot_id: args.bot_id })
      const result = await baasClient.updateBotConfig({ bot_id: args.bot_id, body: { extra: args.extra } })
      if (!result.success) {
        console.error("Failed to update bot config", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to update bot config: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully updated bot config: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Send Chat Message
  server.tool(
    "sendChatMessage",
    "Send a chat message into the meeting via the bot. Use this when you want to: 1) Post a message to participants 2) Share a link or instruction 3) Acknowledge something in the meeting chat",
    {
      bot_id: z.string(),
      message: chatMessageSchema.describe("The chat message text to send in the meeting (1-500 chars)")
    },
    async (args) => {
      console.log("Attempting to send chat message", { bot_id: args.bot_id })
      const result = await baasClient.sendChatMessage({ bot_id: args.bot_id, body: { message: args.message } })
      if (!result.success) {
        console.error("Failed to send chat message", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to send chat message: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: "Successfully sent chat message" }]
      }
    }
  )

  // Pause Bot Recording
  server.tool(
    "pauseBotRecording",
    "Pause an in-progress recording for a live bot, optionally posting a chat message to participants. Use this when you want to: 1) Temporarily stop recording sensitive discussion 2) Pause during a break 3) Control recording without removing the bot",
    {
      bot_id: z.string(),
      chat_message: chatMessageSchema.optional().describe("Optional message to post to participants when pausing")
    },
    async (args) => {
      console.log("Attempting to pause bot recording", { bot_id: args.bot_id })
      const body = args.chat_message ? { chat_message: args.chat_message } : undefined
      const result = await baasClient.pauseBotRecording({ bot_id: args.bot_id, body })
      if (!result.success) {
        console.error("Failed to pause bot recording", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to pause bot recording: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully paused bot recording: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Resume Bot Recording
  server.tool(
    "resumeBotRecording",
    "Resume a paused recording for a live bot, optionally posting a chat message to participants. Use this when you want to: 1) Continue recording after a pause 2) Resume after a break 3) Re-enable capture without re-joining",
    {
      bot_id: z.string(),
      chat_message: chatMessageSchema.optional().describe("Optional message to post to participants when resuming")
    },
    async (args) => {
      console.log("Attempting to resume bot recording", { bot_id: args.bot_id })
      const body = args.chat_message ? { chat_message: args.chat_message } : undefined
      const result = await baasClient.resumeBotRecording({ bot_id: args.bot_id, body })
      if (!result.success) {
        console.error("Failed to resume bot recording", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to resume bot recording: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully resumed bot recording: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // --- Scheduled Bots ---

  // Create Scheduled Bot
  server.tool(
    "createScheduledBot",
    "Schedule a bot to join a meeting at a future time. Use this when you want to: 1) Pre-schedule meeting recordings 2) Set up bots for upcoming meetings 3) Automate meeting attendance",
    {
      ...botConfigShape,
      join_at: z.string().describe("ISO8601 timestamp for when the bot should join the meeting")
    },
    async (args) => {
      console.log("Attempting to create scheduled bot", redactArgs(args))
      const result = await baasClient.createScheduledBot(withTranscriptionDefaults(args))
      if (!result.success) {
        console.error("Failed to create scheduled bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create scheduled bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully created scheduled bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // List Scheduled Bots
  server.tool(
    "listScheduledBots",
    "List all scheduled bots. Use this when you want to: 1) View upcoming scheduled recordings 2) Check scheduled bot status 3) Monitor planned bot activity",
    V2Zod.listScheduledBotsQueryParams.shape,
    async (args) => {
      console.log("Attempting to list scheduled bots", redactArgs(args))
      const result = await baasClient.listScheduledBots(args)
      if (!result.success) {
        console.error("Failed to list scheduled bots", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list scheduled bots: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // Get Scheduled Bot
  server.tool(
    "getScheduledBot",
    "Get details about a specific scheduled bot. Use this when you want to: 1) Check scheduled bot configuration 2) Verify scheduling details 3) Review bot settings before it joins",
    { bot_id: z.string() },
    async (args) => {
      console.log("Attempting to get scheduled bot", redactArgs(args))
      const result = await baasClient.getScheduledBot({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to get scheduled bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get scheduled bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Delete Scheduled Bot
  server.tool(
    "deleteScheduledBot",
    "Delete a scheduled bot. Use this when you want to: 1) Cancel a scheduled recording 2) Remove a planned bot 3) Stop a bot from joining a future meeting",
    { bot_id: z.string() },
    async (args) => {
      console.log("Attempting to delete scheduled bot", redactArgs(args))
      const result = await baasClient.deleteScheduledBot({ bot_id: args.bot_id })
      if (!result.success) {
        console.error("Failed to delete scheduled bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to delete scheduled bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: "Successfully deleted scheduled bot" }]
      }
    }
  )

  // Batch Create Scheduled Bots
  server.tool(
    "batchCreateScheduledBots",
    "Schedule multiple bots in a single request. Use this when you want to: 1) Pre-schedule recordings for many meetings at once 2) Bulk-automate future attendance 3) Reduce round-trips when scheduling",
    {
      bots: z.array(z.object({
        ...botConfigShape,
        join_at: z.string().describe("ISO8601 timestamp for when the bot should join the meeting")
      })).min(1).describe("Array of scheduled bot configurations")
    },
    async (args) => {
      console.log("Attempting to batch create scheduled bots", { count: args.bots.length })
      const result = await baasClient.batchCreateScheduledBots(args.bots.map(withTranscriptionDefaults))
      if (!result.success) {
        console.error("Failed to batch create scheduled bots", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to batch create scheduled bots: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, errors: result.errors }, null, 2) }]
      }
    }
  )

  // Update Scheduled Bot
  server.tool(
    "updateScheduledBot",
    "Update the configuration of a scheduled bot before it joins. Use this when you want to: 1) Change a scheduled bot's settings 2) Update the meeting URL 3) Adjust recording or timeout options",
    {
      bot_id: z.string(),
      ...botUpdateShape,
      join_at: z.string().optional().describe("ISO8601 timestamp for when the bot should join the meeting")
    },
    async (args) => {
      const { bot_id, ...body } = args
      console.log("Attempting to update scheduled bot", redactArgs(args))
      const result = await baasClient.updateScheduledBot({ bot_id, body })
      if (!result.success) {
        console.error("Failed to update scheduled bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to update scheduled bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully updated scheduled bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // --- Calendar Connections ---

  // Create Calendar Connection (equivalent to v1 createCalendar)
  server.tool(
    "createCalendarConnection",
    "Create a new calendar connection. Use this when you want to: 1) Set up automatic meeting recordings 2) Configure calendar-based bot scheduling 3) Enable recurring meeting coverage",
    V2ZodCalendars.createCalendarConnectionBody.shape,
    async (args) => {
      console.log("Attempting to create calendar connection", redactArgs(args))
      const result = await baasClient.createCalendarConnection(args)
      if (!result.success) {
        console.error("Failed to create calendar connection", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create calendar connection: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully created calendar connection: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // List Calendars
  server.tool(
    "listCalendars",
    "List all calendar connections. Use this when you want to: 1) View configured calendars 2) Check calendar status 3) Manage calendar integrations",
    V2ZodCalendars.listCalendarsQueryParams.shape,
    async (args) => {
      console.log("Attempting to list calendars", redactArgs(args))
      const result = await baasClient.listCalendars(args)
      if (!result.success) {
        console.error("Failed to list calendars", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list calendars: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // Get Calendar Details (equivalent to v1 getCalendar)
  server.tool(
    "getCalendarDetails",
    "Get details about a specific calendar connection. Use this when you want to: 1) View calendar configuration 2) Check calendar status 3) Verify calendar settings",
    { calendar_id: z.string() },
    async (args) => {
      console.log("Attempting to get calendar details", redactArgs(args))
      const result = await baasClient.getCalendarDetails({ calendar_id: args.calendar_id })
      if (!result.success) {
        console.error("Failed to get calendar details", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get calendar details: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Update Calendar Connection (equivalent to v1 updateCalendar)
  server.tool(
    "updateCalendarConnection",
    "Update a calendar connection configuration. Use this when you want to: 1) Modify calendar settings 2) Update OAuth credentials 3) Change calendar configuration",
    {
      calendar_id: z.string(),
      oauth_client_id: z.string(),
      oauth_client_secret: z.string(),
      oauth_refresh_token: z.string(),
      oauth_tenant_id: z.string().optional()
    },
    async (args) => {
      const { calendar_id, ...body } = args
      console.log("Attempting to update calendar connection", redactArgs(args))
      const result = await baasClient.updateCalendarConnection({ calendar_id, body })
      if (!result.success) {
        console.error("Failed to update calendar connection", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to update calendar connection: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully updated calendar connection: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Delete Calendar Connection (equivalent to v1 deleteCalendar)
  server.tool(
    "deleteCalendarConnection",
    "Delete a calendar connection. Use this when you want to: 1) Remove a calendar connection 2) Stop automatic recordings 3) Clean up calendar data",
    { calendar_id: z.string() },
    async (args) => {
      console.log("Attempting to delete calendar connection", redactArgs(args))
      const result = await baasClient.deleteCalendarConnection({ calendar_id: args.calendar_id })
      if (!result.success) {
        console.error("Failed to delete calendar connection", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to delete calendar connection: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: "Successfully deleted calendar connection" }]
      }
    }
  )

  // Sync Calendar (equivalent to v1 resyncAllCalendars but per-calendar)
  server.tool(
    "syncCalendar",
    "Synchronize a specific calendar to fetch the latest events. Use this when you want to: 1) Force a calendar sync 2) Update event data 3) Refresh calendar information",
    { calendar_id: z.string() },
    async (args) => {
      console.log("Attempting to sync calendar", redactArgs(args))
      const result = await baasClient.syncCalendar({ calendar_id: args.calendar_id })
      if (!result.success) {
        console.error("Failed to sync calendar", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to sync calendar: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully synced calendar: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Resubscribe Calendar
  server.tool(
    "resubscribeCalendar",
    "Resubscribe a calendar's push notifications. Use this when you want to: 1) Restore event updates after a subscription lapses 2) Recover from missed calendar webhooks 3) Refresh the provider subscription",
    { calendar_id: z.string() },
    async (args) => {
      console.log("Attempting to resubscribe calendar", redactArgs(args))
      const result = await baasClient.resubscribeCalendar({ calendar_id: args.calendar_id })
      if (!result.success) {
        console.error("Failed to resubscribe calendar", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to resubscribe calendar: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully resubscribed calendar: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // List Raw Calendars
  server.tool(
    "listRawCalendars",
    "List the raw calendars available from an OAuth provider before creating a connection. Use this when you want to: 1) Discover which calendars an account exposes 2) Find a calendar's id to connect 3) Verify OAuth credentials work",
    {
      calendar_platform: z.enum(["google", "microsoft"]).describe("The calendar platform: 'google' or 'microsoft'"),
      oauth_client_id: z.string(),
      oauth_client_secret: z.string(),
      oauth_refresh_token: z.string(),
      oauth_tenant_id: z.string().optional()
    },
    async (args) => {
      console.log("Attempting to list raw calendars", redactArgs(args))
      const result = await baasClient.listRawCalendars(args)
      if (!result.success) {
        console.error("Failed to list raw calendars", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list raw calendars: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // --- Calendar Events ---

  // List Events
  server.tool(
    "listEvents",
    "List calendar events. Use this when you want to: 1) View upcoming meetings 2) Check scheduled events 3) Browse calendar entries",
    {
      calendar_id: z.string(),
      limit: z.number().optional(),
      cursor: z.string().optional(),
      show_cancelled: z.boolean().optional(),
      start_date: z.string().optional(),
      end_date: z.string().optional()
    },
    async (args) => {
      const { calendar_id, ...query } = args
      console.log("Attempting to list events", redactArgs(args))
      const result = await baasClient.listEvents({ calendar_id, query })
      if (!result.success) {
        console.error("Failed to list events", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list events: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // Get Event Details
  server.tool(
    "getEventDetails",
    "Get detailed information about a specific calendar event. Use this when you want to: 1) View event details 2) Check attendees 3) See event configuration",
    { calendar_id: z.string(), event_id: z.string() },
    async (args) => {
      console.log("Attempting to get event details", redactArgs(args))
      const result = await baasClient.getEventDetails({
        calendar_id: args.calendar_id,
        event_id: args.event_id
      })
      if (!result.success) {
        console.error("Failed to get event details", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get event details: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // List Event Series
  server.tool(
    "listEventSeries",
    "List recurring event series for a calendar. Use this when you want to: 1) Find recurring meetings 2) Schedule a bot across all occurrences of a series 3) Browse repeating calendar entries",
    {
      calendar_id: z.string(),
      limit: z.number().optional(),
      cursor: z.string().optional(),
      event_type: z.string().optional(),
      show_cancelled: z.boolean().optional()
    },
    async (args) => {
      const { calendar_id, ...query } = args
      console.log("Attempting to list event series", redactArgs(args))
      const result = await baasClient.listEventSeries({ calendar_id, query })
      if (!result.success) {
        console.error("Failed to list event series", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list event series: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ data: result.data, cursor: result.cursor }, null, 2) }]
      }
    }
  )

  // --- Calendar Bots ---

  // Create Calendar Bot (equivalent to v1 scheduleRecordEvent)
  server.tool(
    "createCalendarBot",
    "Schedule a bot to record a calendar event. Use this when you want to: 1) Set up automatic recording for a calendar event 2) Schedule future transcriptions 3) Plan meeting recordings based on calendar",
    {
      calendar_id: z.string(),
      series_id: z.string().describe("UUID of the event series to schedule bots for"),
      all_occurrences: z.boolean().describe("Whether to schedule bots for all occurrences of the event series"),
      event_id: z.string().optional().describe("UUID of a specific event instance (required when all_occurrences is false)"),
      ...botConfigShape
    },
    async (args) => {
      if (!args.all_occurrences && !args.event_id) {
        return {
          content: [{ type: "text" as const, text: "event_id is required when all_occurrences is false" }],
          isError: true
        }
      }
      const { calendar_id, ...body } = args
      console.log("Attempting to create calendar bot", redactArgs(args))
      const result = await baasClient.createCalendarBot({ calendar_id, body: withTranscriptionDefaults(body) })
      if (!result.success) {
        console.error("Failed to create calendar bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create calendar bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully created calendar bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Delete Calendar Bot (equivalent to v1 unscheduleRecordEvent)
  server.tool(
    "deleteCalendarBot",
    "Cancel a scheduled calendar bot recording. Use this when you want to: 1) Cancel automatic recording 2) Stop planned transcription 3) Remove scheduled bot activity for an event",
    {
      calendar_id: z.string(),
      event_id: z.string()
    },
    async (args) => {
      console.log("Attempting to delete calendar bot", redactArgs(args))
      const result = await baasClient.deleteCalendarBot({
        calendar_id: args.calendar_id,
        event_id: args.event_id
      })
      if (!result.success) {
        console.error("Failed to delete calendar bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to delete calendar bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully deleted calendar bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Update Calendar Bot
  server.tool(
    "updateCalendarBot",
    "Update the configuration of a bot scheduled for a calendar event. Use this when you want to: 1) Change recording settings for a scheduled calendar bot 2) Adjust bot options before the event 3) Modify a calendar-driven recording",
    {
      calendar_id: z.string(),
      event_id: z.string().describe("UUID of the event instance whose bot configuration is being updated"),
      series_id: z.string().describe("UUID of the event series the bot is scheduled for"),
      all_occurrences: z.boolean().describe("Whether the update applies to all occurrences of the event series"),
      ...botUpdateShape
    },
    async (args) => {
      const { calendar_id, event_id, ...body } = args
      console.log("Attempting to update calendar bot", redactArgs(args))
      const result = await baasClient.updateCalendarBot({ calendar_id, event_id, body })
      if (!result.success) {
        console.error("Failed to update calendar bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to update calendar bot: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully updated calendar bot: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // --- Zoom Credentials ---

  // Create Zoom Credential
  server.tool(
    "createZoomCredential",
    "Store Zoom OAuth credentials for joining Zoom meetings with the Meeting SDK. Use this when you want to: 1) Enable Zoom SDK-based recording 2) Register a Zoom app's client credentials 3) Set up Zoom authentication",
    zoomCredentialShape,
    async (args) => {
      console.log("Attempting to create zoom credential", redactArgs(args))
      const result = await baasClient.createZoomCredential(args)
      if (!result.success) {
        console.error("Failed to create zoom credential", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create zoom credential: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully created zoom credential: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // List Zoom Credentials
  server.tool(
    "listZoomCredentials",
    "List stored Zoom credentials. Use this when you want to: 1) View configured Zoom apps 2) Find a credential id 3) Audit Zoom integration settings",
    {
      name: z.string().optional(),
      zoom_email: z.string().optional(),
      zoom_display_name: z.string().optional(),
      zoom_user_id: z.string().optional(),
      credential_type: z.string().optional(),
      state: z.string().optional(),
      extra: z.string().optional()
    },
    async (args) => {
      console.log("Attempting to list zoom credentials", redactArgs(args))
      const result = await baasClient.listZoomCredentials(args)
      if (!result.success) {
        console.error("Failed to list zoom credentials", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to list zoom credentials: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Get Zoom Credential
  server.tool(
    "getZoomCredential",
    "Get details about a specific Zoom credential. Use this when you want to: 1) Inspect a stored Zoom credential 2) Verify its configuration 3) Check the linked Zoom account",
    { id: z.string() },
    async (args) => {
      console.log("Attempting to get zoom credential", redactArgs(args))
      const result = await baasClient.getZoomCredential({ id: args.id })
      if (!result.success) {
        console.error("Failed to get zoom credential", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get zoom credential: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }]
      }
    }
  )

  // Update Zoom Credential
  server.tool(
    "updateZoomCredential",
    "Update a stored Zoom credential. Use this when you want to: 1) Rotate Zoom client secrets 2) Rename a credential 3) Re-authorize with a new authorization code",
    {
      id: z.string(),
      name: z.string().min(1).max(100).optional(),
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
      authorization_code: z.string().optional(),
      redirect_uri: z.string().optional(),
      extra: z.record(z.unknown()).optional()
    },
    async (args) => {
      const { id, ...body } = args
      console.log("Attempting to update zoom credential", redactArgs(args))
      const result = await baasClient.updateZoomCredential({ id, body })
      if (!result.success) {
        console.error("Failed to update zoom credential", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to update zoom credential: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: `Successfully updated zoom credential: ${JSON.stringify(result.data, null, 2)}` }]
      }
    }
  )

  // Delete Zoom Credential
  server.tool(
    "deleteZoomCredential",
    "Delete a stored Zoom credential. Use this when you want to: 1) Remove an unused Zoom credential 2) Revoke a compromised credential 3) Clean up Zoom integration settings",
    { id: z.string() },
    async (args) => {
      console.log("Attempting to delete zoom credential", redactArgs(args))
      const result = await baasClient.deleteZoomCredential({ id: args.id })
      if (!result.success) {
        console.error("Failed to delete zoom credential", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to delete zoom credential: ${result.error}` }],
          isError: true
        }
      }
      return {
        content: [{ type: "text" as const, text: "Successfully deleted zoom credential" }]
      }
    }
  )

  // --- AI Agent Tools ---

  // Get Transcript
  server.tool(
    "getTranscript",
    "Get a meeting transcript as a readable dialog or full JSON with metadata. Use this when you want to: 1) Read what was said in a meeting 2) Get a conversation summary 3) Access raw transcription data",
    {
      bot_id: z.string(),
      format: z.enum(["dialog", "full"]).default("dialog").describe("'dialog' returns a readable merged conversation, 'full' returns the raw transcription JSON")
    },
    async (args) => {
      console.log("Attempting to get transcript", { bot_id: args.bot_id, format: args.format })

      // 1. Get bot details for metadata and transcription URL
      const botResult = await baasClient.getBotDetails({ bot_id: args.bot_id })
      if (!botResult.success) {
        console.error("Failed to get bot details", botResult.error)
        return {
          content: [{ type: "text" as const, text: `Failed to get bot details: ${botResult.error}` }],
          isError: true
        }
      }

      const bot = botResult.data as any
      const transcriptionUrl = bot.transcription
      if (!transcriptionUrl) {
        return {
          content: [{ type: "text" as const, text: "No transcription available for this bot. The meeting may still be in progress or transcription was not enabled." }]
        }
      }

      // 2. Fetch transcription JSON from S3
      let transcriptionData: any
      try {
        const response = await axios.get(transcriptionUrl)
        transcriptionData = response.data
      } catch (err: any) {
        console.error("Failed to fetch transcription", err.message)
        return {
          content: [{ type: "text" as const, text: `Failed to fetch transcription: ${err.message}` }],
          isError: true
        }
      }

      // 3a. Full format — return raw JSON
      if (args.format === "full") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(transcriptionData, null, 2) }]
        }
      }

      // 3b. Dialog format — parse and merge utterances
      const utterances = extractUtterances(transcriptionData)
      if (!utterances || utterances.length === 0) {
        return {
          content: [{ type: "text" as const, text: "Transcription data found but no utterances could be extracted. Try format: \"full\" to inspect the raw data." }]
        }
      }

      // Merge consecutive same-speaker utterances
      const merged: { speaker: string; text: string }[] = []
      for (const u of utterances) {
        const speaker = u.speaker ?? "Unknown"
        const text = (u.text ?? "").trim()
        if (!text) continue
        const last = merged[merged.length - 1]
        if (last && last.speaker === speaker) {
          last.text += ` ${text}`
        } else {
          merged.push({ speaker, text })
        }
      }

      // Build header
      const durationMin = bot.duration_seconds ? Math.round(bot.duration_seconds / 60) : null
      const speakerNames = bot.speakers
        ? (bot.speakers as any[]).map((s: any) => s.name).join(", ")
        : [...new Set(merged.map(m => m.speaker))].join(", ")

      let header = `Transcript: ${bot.bot_name ?? args.bot_id}`
      if (bot.created_at || durationMin) {
        const parts: string[] = []
        if (bot.created_at) parts.push(`Date: ${bot.created_at}`)
        if (durationMin) parts.push(`Duration: ${durationMin} min`)
        header += `\n${parts.join(" | ")}`
      }
      if (speakerNames) header += `\nSpeakers: ${speakerNames}`
      header += "\n---"

      const body = merged.map(m => `${m.speaker}: ${m.text}`).join("\n\n")

      return {
        content: [{ type: "text" as const, text: `${header}\n${body}` }]
      }
    }
  )

  // Add echo tool for testing
  server.tool("echo", { message: z.string() }, async ({ message }: { message: string }) => ({
    content: [
      {
        type: "text" as const,
        text: `Tool echo: ${message}`
      }
    ]
  }))

  return server
}

export default registerV2Tools
