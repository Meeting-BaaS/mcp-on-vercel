import { initializeMcpApiHandler } from "../lib/mcp-api-handler"
import registerTools from "./tools"

const handler = initializeMcpApiHandler(
  (server, apiKey, baseUrl, apiVersion) => {
    // Register Meeting BaaS SDK tools with the provided API key and version
    registerTools(server, apiKey, baseUrl, apiVersion)
  },
  {
    capabilities: {
      tools: {
        // V1 Meeting Management Category
        joinMeeting: {
          description:
            "Send an AI bot to join a video meeting. The bot can record the meeting, transcribe speech (enabled by default using Gladia), and provide real-time audio streams.",
          category: "Meeting Management",
          apiVersion: "v1"
        },
        leaveMeeting: {
          description: "Remove an AI bot from a meeting.",
          category: "Meeting Management",
          apiVersion: "v1"
        },
        getMeetingData: {
          description: "Get data about a meeting that a bot has joined.",
          category: "Meeting Management",
          apiVersion: "v1"
        },
        deleteData: {
          description: "Delete data associated with a meeting bot.",
          category: "Meeting Management",
          apiVersion: "v1"
        },
        retranscribeBot: {
          description: "Transcribe or retranscribe a bot recording.",
          category: "Meeting Management",
          apiVersion: "v1"
        },

        // V1 Calendar Management Category
        createCalendar: {
          description: "Create a new calendar integration.",
          category: "Calendar Management",
          apiVersion: "v1"
        },
        listCalendars: {
          description: "List all calendar integrations.",
          category: "Calendar Management",
          apiVersion: "v1/v2"
        },
        getCalendar: {
          description: "Get details about a specific calendar integration.",
          category: "Calendar Management",
          apiVersion: "v1"
        },
        deleteCalendar: {
          description: "Delete a calendar integration.",
          category: "Calendar Management",
          apiVersion: "v1"
        },
        listEvents: {
          description: "List all scheduled events.",
          category: "Calendar Management",
          apiVersion: "v1/v2"
        },
        scheduleRecordEvent: {
          description: "Schedule a recording.",
          category: "Calendar Management",
          apiVersion: "v1"
        },
        unscheduleRecordEvent: {
          description: "Cancel a scheduled recording.",
          category: "Calendar Management",
          apiVersion: "v1"
        },
        updateCalendar: {
          description: "Update a calendar integration configuration.",
          category: "Calendar Management",
          apiVersion: "v1"
        },

        // V1 Bot Management Category
        botsWithMetadata: {
          description: "Get a list of all bots with their metadata.",
          category: "Bot Management",
          apiVersion: "v1"
        },

        // V2 Bot Management Category
        createBot: {
          description:
            "Create and send an AI bot to join a video meeting with recording, transcription, and streaming capabilities.",
          category: "Bot Management",
          apiVersion: "v2"
        },
        listBots: {
          description: "Get a list of all bots with their metadata.",
          category: "Bot Management",
          apiVersion: "v2"
        },
        getBotDetails: {
          description:
            "Get detailed information about a specific bot including recording data and transcripts.",
          category: "Bot Management",
          apiVersion: "v2"
        },
        getBotStatus: {
          description: "Get the current status of a bot.",
          category: "Bot Management",
          apiVersion: "v2"
        },
        leaveBot: {
          description: "Remove an AI bot from a meeting.",
          category: "Bot Management",
          apiVersion: "v2"
        },
        deleteBotData: {
          description: "Delete data associated with a meeting bot.",
          category: "Bot Management",
          apiVersion: "v2"
        },

        // V2 Scheduled Bots Category
        createScheduledBot: {
          description: "Schedule a bot to join a meeting at a future time.",
          category: "Scheduled Bots",
          apiVersion: "v2"
        },
        listScheduledBots: {
          description: "List all scheduled bots.",
          category: "Scheduled Bots",
          apiVersion: "v2"
        },
        getScheduledBot: {
          description: "Get details about a specific scheduled bot.",
          category: "Scheduled Bots",
          apiVersion: "v2"
        },
        deleteScheduledBot: {
          description: "Delete a scheduled bot.",
          category: "Scheduled Bots",
          apiVersion: "v2"
        },

        // V2 Calendar Management Category
        createCalendarConnection: {
          description: "Create a new calendar connection.",
          category: "Calendar Management",
          apiVersion: "v2"
        },
        getCalendarDetails: {
          description: "Get details about a specific calendar connection.",
          category: "Calendar Management",
          apiVersion: "v2"
        },
        updateCalendarConnection: {
          description: "Update a calendar connection configuration.",
          category: "Calendar Management",
          apiVersion: "v2"
        },
        deleteCalendarConnection: {
          description: "Delete a calendar connection.",
          category: "Calendar Management",
          apiVersion: "v2"
        },
        syncCalendar: {
          description: "Synchronize a specific calendar to fetch the latest events.",
          category: "Calendar Management",
          apiVersion: "v2"
        },

        // V2 Calendar Events Category
        getEventDetails: {
          description: "Get detailed information about a specific calendar event.",
          category: "Calendar Events",
          apiVersion: "v2"
        },

        // V2 Calendar Bots Category
        createCalendarBot: {
          description: "Schedule a bot to record a calendar event.",
          category: "Calendar Bots",
          apiVersion: "v2"
        },
        deleteCalendarBot: {
          description: "Cancel a scheduled calendar bot recording.",
          category: "Calendar Bots",
          apiVersion: "v2"
        },

        // V2 AI Agent Tools Category
        getTranscript: {
          description: "Get a meeting transcript as a readable dialog or full JSON with metadata.",
          category: "AI Agent Tools",
          apiVersion: "v2"
        },

        // Utility Category
        echo: {
          description: "Echo a message back.",
          category: "Utility"
        }
      }
    }
  }
)

export default handler
