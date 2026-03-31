import {
  createBaasClient,
  V2Zod,
  V2ZodCalendars,
  type BaasClient
} from "@meeting-baas/sdk"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import z from "zod"

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
  no_one_joined_timeout: z.number().optional()
}).optional()

const zoomConfigSchema = z.object({
  credential_id: z.string().optional()
}).optional()

/** Core bot creation fields shared by createBot, createScheduledBot, and createCalendarBot. */
const botConfigShape = {
  bot_name: z.string().min(1).max(255),
  meeting_url: z.string(),
  bot_image: z.string().optional(),
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

// ---------------------------------------------------------------------------
// V2 Endpoints not yet exposed as MCP tools:
//
// Bot Management:
//   - batchCreateBots         (batch create multiple bots)
//   - getBotScreenshots       (get screenshots from a bot session)
//   - resendFinalWebhook      (resend the final webhook for a bot)
//   - retryCallback           (retry callback for a bot)
//   - updateBotConfig         (update a running bot's extra metadata)
//
// Scheduled Bots:
//   - batchCreateScheduledBots (batch create scheduled bots)
//   - updateScheduledBot       (update a scheduled bot's configuration)
//
// Calendar:
//   - resubscribeCalendar     (resubscribe calendar push notifications)
//   - listRawCalendars        (list raw calendars from OAuth provider)
//   - listEventSeries         (list recurring event series)
//   - updateCalendarBot       (update a calendar bot configuration)
//
// Zoom Credentials:
//   - createZoomCredential    (store Zoom OAuth credentials)
//   - listZoomCredentials     (list stored Zoom credentials)
//   - getZoomCredential       (get a specific Zoom credential)
//   - updateZoomCredential    (update a Zoom credential)
//   - deleteZoomCredential    (delete a Zoom credential)
// ---------------------------------------------------------------------------

export function registerV2Tools(server: McpServer, apiKey: string, baseUrl?: string): McpServer {
  console.log("Registering v2 tools with baseUrl", baseUrl)
  const baasClient: V2Client = createBaasClient({
    api_key: apiKey,
    api_version: "v2",
    base_url: baseUrl
  })

  // --- Bot Management ---

  // Create Bot (equivalent to v1 joinMeeting)
  server.tool(
    "createBot",
    "Create and send an AI bot to join a video meeting. The bot can record the meeting, transcribe speech, and provide real-time audio streams. Use this when you want to: 1) Record a meeting 2) Get meeting transcriptions 3) Stream meeting audio 4) Monitor meeting attendance",
    botConfigShape,
    async (args) => {
      console.log("Attempting to create bot", args)
      const result = await baasClient.createBot(args)
      if (!result.success) {
        console.error("Failed to create bot", result.error)
        return {
          content: [{ type: "text" as const, text: `Failed to create bot: ${result.error}` }],
          isError: true
        }
      }
      console.log("Bot created successfully", result.data)
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
      console.log("Attempting to list bots", args)
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
      console.log("Attempting to get bot details", args)
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
      console.log("Attempting to get bot status", args)
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
      console.log("Meeting left successfully", result.data)
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
      console.log("Attempting to delete bot data", args)
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
      console.log("Attempting to create scheduled bot", args)
      const result = await baasClient.createScheduledBot(args)
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
      console.log("Attempting to list scheduled bots", args)
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
      console.log("Attempting to get scheduled bot", args)
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
      console.log("Attempting to delete scheduled bot", args)
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

  // --- Calendar Connections ---

  // Create Calendar Connection (equivalent to v1 createCalendar)
  server.tool(
    "createCalendarConnection",
    "Create a new calendar connection. Use this when you want to: 1) Set up automatic meeting recordings 2) Configure calendar-based bot scheduling 3) Enable recurring meeting coverage",
    V2ZodCalendars.createCalendarConnectionBody.shape,
    async (args) => {
      console.log("Attempting to create calendar connection", args)
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
      console.log("Attempting to list calendars", args)
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
      console.log("Attempting to get calendar details", args)
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
      console.log("Attempting to update calendar connection", args)
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
      console.log("Attempting to delete calendar connection", args)
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
      console.log("Attempting to sync calendar", args)
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
      console.log("Attempting to list events", args)
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
      console.log("Attempting to get event details", args)
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
      const { calendar_id, ...body } = args
      console.log("Attempting to create calendar bot", args)
      const result = await baasClient.createCalendarBot({ calendar_id, body })
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
      console.log("Attempting to delete calendar bot", args)
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
