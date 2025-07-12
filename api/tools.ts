import {
  botsWithMetadataQueryParams,
  createBaasClient,
  createCalendarBody,
  getMeetingDataQueryParams,
  joinBody,
  listEventsQueryParams,
  retranscribeBotBody,
  scheduleRecordEventBody,
  updateCalendarBody
} from "@meeting-baas/sdk"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp"
import z from "zod"

export function registerTools(server: McpServer, apiKey: string, baseUrl?: string): McpServer {
  console.log("Registering tools with baseUrl", baseUrl)
  const baasClient = createBaasClient({
    api_key: apiKey,
    base_url: baseUrl
  })

  // For Join Meeting
  server.tool(
    "joinMeeting",
    "Send an AI bot to join a video meeting. The bot can record the meeting, transcribe speech (enabled by default using Gladia), and provide real-time audio streams. Use this when you want to: 1) Record a meeting 2) Get meeting transcriptions 3) Stream meeting audio 4) Monitor meeting attendance",
    joinBody.shape,
    async (args) => {
      console.log("Attempting to join meeting", args)
      const { data, success, error } = await baasClient.joinMeeting(args)
      if (!success) {
        console.error("Failed to join meeting", error)
        return {
          content: [{ type: "text", text: `Failed to join meeting: ${error.message}` }],
          isError: true
        }
      }
      console.log("Joined meeting successfully", data)
      return {
        content: [{ type: "text", text: `Successfully joined meeting, bot_id: ${data.bot_id}` }]
      }
    }
  )

  // For Leave Meeting
  server.tool(
    "leaveMeeting",
    "Remove an AI bot from a meeting. Use this when you want to: 1) End a meeting recording 2) Stop transcription 3) Disconnect the bot from the meeting",
    { bot_id: z.string() },
    async (args) => {
      const { bot_id } = args
      console.log(`Attempting to remove bot ${bot_id} from meeting`)
      const { data, success, error } = await baasClient.leaveMeeting({ uuid: bot_id })

      if (!success) {
        console.error("Failed to leave meeting", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to leave meeting: ${error.message}`
            }
          ],
          isError: true
        }
      }

      console.log("Meeting left successfully", data)
      return {
        content: [
          {
            type: "text",
            text: `Successfully removed bot ${bot_id} from meeting`
          }
        ]
      }
    }
  )

  // For Get Meeting Data
  server.tool(
    "getMeetingData",
    "Get data about a meeting that a bot has joined. Use this when you want to: 1) Check meeting status 2) Get recording information 3) Access transcription data",
    getMeetingDataQueryParams.shape,
    async (args) => {
      console.log("Attempting to get meeting data", args)
      const { data, success, error } = await baasClient.getMeetingData(args)

      if (!success) {
        console.error("Failed to get meeting data", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to get meeting data: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For Delete Data
  server.tool(
    "deleteData",
    "Delete data associated with a meeting bot. Use this when you want to: 1) Remove meeting recordings 2) Delete transcription data 3) Clean up bot data",
    { bot_id: z.string() },
    async (args) => {
      const { bot_id } = args
      console.log("Attempting to delete meeting data", args)
      const { success, error } = await baasClient.deleteBotData({ uuid: bot_id })

      if (!success) {
        console.error("Failed to delete meeting data", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete meeting data: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: "Successfully deleted meeting data"
          }
        ]
      }
    }
  )

  // For Re-Transcribe Bot
  server.tool(
    "retranscribeBot",
    "Transcribe or retranscribe a bot recording using the Default or provided Speech to Text Provider. Use this when you want to: 1) Transcribe a bot recording 2) Retranscribe if you want to improve the transcription",
    retranscribeBotBody.shape,
    async (args) => {
      console.log("Attempting to retranscribe bot", args)
      const { data, success, error } = await baasClient.retranscribeBot(args)

      if (!success) {
        console.error("Failed to retranscribe bot", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to retranscribe bot: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For Create Calendar
  server.tool(
    "createCalendar",
    "Create a new calendar integration. Use this when you want to: 1) Set up automatic meeting recordings 2) Configure calendar-based bot scheduling 3) Enable recurring meeting coverage",
    createCalendarBody.shape,
    async (args) => {
      console.log("Attempting to create calendar", args)
      const { data, success, error } = await baasClient.createCalendar(args)

      if (!success) {
        console.error("Failed to create calendar", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to create calendar: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully created calendar: ${JSON.stringify(data, null, 2)}`
          }
        ]
      }
    }
  )

  // For List Calendar
  server.tool(
    "listCalendars",
    "List all calendar integrations. Use this when you want to: 1) View configured calendars 2) Check calendar status 3) Manage calendar integrations",
    {},
    async () => {
      console.log("Attempting to list calendars")
      const { data, success, error } = await baasClient.listCalendars()

      if (!success) {
        console.error("Failed to list calendars", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to list calendars: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For Get Calendar
  server.tool(
    "getCalendar",
    "Get details about a specific calendar integration. Use this when you want to: 1) View calendar configuration 2) Check calendar status 3) Verify calendar settings",
    { calendar_id: z.string() },
    async (args) => {
      const { calendar_id } = args
      console.log("Attempting to get calendar", args)
      const { data, success, error } = await baasClient.getCalendar({ uuid: calendar_id })

      if (!success) {
        console.error("Failed to get calendar", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to get calendar: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For delete Calendar
  server.tool(
    "deleteCalendar",
    "Delete a calendar integration. Use this when you want to: 1) Remove a calendar connection 2) Stop automatic recordings 3) Clean up calendar data",
    { calendar_id: z.string() },
    async (args) => {
      const { calendar_id } = args
      console.log("Attempting to delete calendar", args)
      const { success, error } = await baasClient.deleteCalendar({ uuid: calendar_id })

      if (!success) {
        console.error("Failed to delete calendar", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to delete calendar: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: "Successfully deleted calendar"
          }
        ]
      }
    }
  )

  // For Bots with meta data
  server.tool(
    "botsWithMetadata",
    "Get a list of all bots with their metadata. Use this when you want to: 1) View active bots 2) Check bot status 3) Monitor bot activity",
    botsWithMetadataQueryParams.shape,
    async (args) => {
      console.log("Attempting to get bots with metadata", args)
      const { data, success, error } = await baasClient.listBots(args)

      if (!success) {
        console.error("Failed to get bots with metadata", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to get bots with metadata: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For List All Events
  server.tool(
    "listEvents",
    "List all scheduled events. Use this when you want to: 1) View upcoming recordings 2) Check scheduled transcriptions 3) Monitor planned bot activity",
    listEventsQueryParams.shape,
    async (args) => {
      console.log("Attempting to list events", args)
      const { data, success, error } = await baasClient.listCalendarEvents(args)

      if (!success) {
        console.error("Failed to list events", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to list events: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2)
          }
        ]
      }
    }
  )

  // For Schedule Record Events
  server.tool(
    "scheduleRecordEvent",
    "Schedule a recording. Use this when you want to: 1) Set up automatic recording 2) Schedule future transcriptions 3) Plan meeting recordings",
    {
      calendar_id: z.string(),
      all_occurrences: z.boolean().optional(),
      ...scheduleRecordEventBody.shape
    },
    async (args) => {
      const { calendar_id, all_occurrences, ...body } = args
      console.log("Attempting to schedule event recording", args)

      const params = {
        uuid: calendar_id,
        body,
        query: { all_occurrences: all_occurrences || false }
      }

      const { data, success, error } = await baasClient.scheduleCalendarRecordEvent(params)

      if (!success) {
        console.error("Failed to schedule event recording", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to schedule event recording: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully scheduled event recording, events: ${JSON.stringify(data, null, 2)}`
          }
        ]
      }
    }
  )

  // For Un-Schedule Record Events
  server.tool(
    "unscheduleRecordEvent",
    "Cancel a scheduled recording. Use this when you want to: 1) Cancel automatic recording 2) Stop planned transcription 3) Remove scheduled bot activity",
    {
      event_uuid: z.string(),
      all_occurrences: z.boolean().optional()
    },
    async (args) => {
      const { event_uuid, all_occurrences } = args
      console.log("Attempting to unschedule event recording", args)
      const { data, success, error } = await baasClient.unscheduleCalendarRecordEvent({
        uuid: event_uuid,
        query: { all_occurrences: all_occurrences || false }
      })

      if (!success) {
        console.error("Failed to unschedule event recording", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to unschedule event recording: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully unscheduled event recording, removed events: ${JSON.stringify(data, null, 2)}`
          }
        ]
      }
    }
  )

  // For Update Calendar
  server.tool(
    "updateCalendar",
    "Update a calendar integration configuration. Use this when you want to: 1) Modify calendar settings 2) Update connection details 3) Change calendar configuration",
    {
      calendar_id: z.string(),
      ...updateCalendarBody.shape
    },
    async (args) => {
      const { calendar_id, ...body } = args
      console.log("Attempting to update calendar", args)
      const { data, success, error } = await baasClient.updateCalendar({
        uuid: calendar_id,
        body
      })

      if (!success) {
        console.error("Failed to update calendar", error)
        return {
          content: [
            {
              type: "text",
              text: `Failed to update calendar: ${error.message}`
            }
          ],
          isError: true
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Successfully updated calendar, updated calendar: ${JSON.stringify(data, null, 2)}`
          }
        ]
      }
    }
  )

  // Add echo tool for testing
  server.tool("echo", { message: z.string() }, async ({ message }: { message: string }) => ({
    content: [
      {
        type: "text",
        text: `Tool echo: ${message}`
      }
    ]
  }))

  return server
}

export default registerTools
