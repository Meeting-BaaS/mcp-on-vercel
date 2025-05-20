import { BaasClient } from "@meeting-baas/sdk/dist/baas/api/client";
import { Provider } from "@meeting-baas/sdk/dist/baas/models/provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import z from "zod";
import { registerBotTools } from "./tools/bots/index";
import { registerEchoTool } from "./tools/utils/echo";
import { registerJoinSpeakingTool } from "./tools/bots/join-speaking";

export function registerTools(server: McpServer, apiKey: string): McpServer {
  const baasClient = new BaasClient({
    apiKey: apiKey,
    baseUrl: "https://api.meetingbaas.com/",
  });

  // Register bot tools
  let updatedServer = registerBotTools(server, baasClient);

  // Register speaking tools
  updatedServer = registerJoinSpeakingTool(updatedServer);

  // For Leave Meeting
  updatedServer.tool(
    "leaveMeeting",
    "Remove an AI bot from a meeting. Use this when you want to: 1) End a meeting recording 2) Stop transcription 3) Disconnect the bot from the meeting",
    { botId: z.string() },
    async ({ botId }: { botId: string }) => {
      try {
        console.log(`Attempting to remove bot ${botId} from meeting...`);
        const response = await baasClient.defaultApi.leave({
          data: { botId }
        });
        console.log(
          "Leave meeting response:",
          JSON.stringify(response.data, null, 2)
        );

        if (!response.data) {
          console.error("Leave meeting response missing data");
          return {
            content: [
              {
                type: "text",
                text: "Failed to leave meeting: No response data received",
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully removed bot ${botId} from meeting`,
            },
          ],
        };
      } catch (error) {
        console.error("Failed to leave meeting:", error);
        let errorMessage = "Failed to leave meeting";

        if (error instanceof Error) {
          console.error("Error details:", {
            name: error.name,
            message: error.message,
            stack: error.stack,
          });
          errorMessage += `: ${error.message}`;
        } else if (typeof error === "object" && error !== null) {
          console.error("Error object:", JSON.stringify(error, null, 2));
        }

        return {
          content: [
            {
              type: "text",
              text: errorMessage,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Get Meeting Data
  updatedServer.tool(
    "getMeetingData",
    "Get data about a meeting that a bot has joined. Use this when you want to: 1) Check meeting status 2) Get recording information 3) Access transcription data",
    { botId: z.string() },
    async ({ botId }: { botId: string }) => {
      try {
        //
        const response = await baasClient.defaultApi.getMeetingData({ botId });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Failed to get meeting data:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to get meeting data",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Delete Data
  updatedServer.tool(
    "deleteData",
    "Delete data associated with a meeting bot. Use this when you want to: 1) Remove meeting recordings 2) Delete transcription data 3) Clean up bot data",
    { botId: z.string() },
    async ({ botId }: { botId: string }) => {
      try {
        const response = await baasClient.defaultApi.deleteData({
          data: { botId }
        });
        return {
          content: [
            {
              type: "text",
              text: "Successfully deleted meeting data",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to delete meeting data:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to delete meeting data",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Create Calendar
  updatedServer.tool(
    "createCalendar",
    "Create a new calendar integration. Use this when you want to: 1) Set up automatic meeting recordings 2) Configure calendar-based bot scheduling 3) Enable recurring meeting coverage",
    {
      oauthClientId: z.string(),
      oauthClientSecret: z.string(),
      oauthRefreshToken: z.string(),
      platform: z.enum(["Google", "Microsoft"]),
      rawCalendarId: z.string().optional(),
    },
    async ({
      oauthClientId,
      oauthClientSecret,
      oauthRefreshToken,
      platform,
      rawCalendarId,
    }) => {
      try {
        const calendarParams = {
          oauthClientId,
          oauthClientSecret,
          oauthRefreshToken,
          platform:
            platform === "Google" ? Provider.google : Provider.microsoft,
          rawCalendarId,
        };

        const response = await baasClient.calendarsApi.createCalendar({
          createCalendarParams: calendarParams,
        });

        return {
          content: [
            {
              type: "text",
              text: "Successfully created calendar",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to create calendar:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to create calendar",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For List Calendar
  updatedServer.tool(
    "listCalendars",
    "List all calendar integrations. Use this when you want to: 1) View configured calendars 2) Check calendar status 3) Manage calendar integrations",
    {},
    async () => {
      try {
        const response = await baasClient.calendarsApi.listCalendars();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Failed to list calendars:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to list calendars",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Get Calendar
  updatedServer.tool(
    "getCalendar",
    "Get details about a specific calendar integration. Use this when you want to: 1) View calendar configuration 2) Check calendar status 3) Verify calendar settings",
    { calendarId: z.string() },
    async ({ calendarId }: { calendarId: string }) => {
      try {
        const response = await baasClient.calendarsApi.getCalendar({
          data: { calendarId }
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Failed to get calendar:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to get calendar",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Delete Calendar
  updatedServer.tool(
    "deleteCalendar",
    "Delete a calendar integration. Use this when you want to: 1) Remove a calendar connection 2) Stop automatic recordings for a calendar 3) Clean up calendar data",
    { calendarId: z.string() },
    async ({ calendarId }: { calendarId: string }) => {
      try {
        const response = await baasClient.calendarsApi.deleteCalendar({
          data: { calendarId }
        });
        return {
          content: [
            {
              type: "text",
              text: "Successfully deleted calendar",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to delete calendar:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to delete calendar",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Schedule Record Event
  updatedServer.tool(
    "scheduleRecordEvent",
    "Schedule a meeting to be recorded automatically. Use this when you want to: 1) Set up recording for a future meeting 2) Configure AI bot attendance for an upcoming event 3) Enable transcription for a scheduled meeting",
    {
      calendarId: z.string(),
      eventUuid: z.string(),
      params: z
        .object({
          enableScreenshare: z.boolean().optional(),
          enableTranscription: z.boolean().optional(),
          enableCaptions: z.boolean().optional(),
          enableSpeakerIdentification: z.boolean().optional(),
          forceReload: z.boolean().optional(),
          enableBitrate: z.boolean().optional(),
          waitForAttendees: z.boolean().optional(),
        })
        .optional(),
    },
    async ({
      calendarId, 
      eventUuid,
      params,
    }: {
      calendarId: string;
      eventUuid: string;
      params?: {
        enableScreenshare?: boolean;
        enableTranscription?: boolean;
        enableCaptions?: boolean;
        enableSpeakerIdentification?: boolean;
        forceReload?: boolean;
        enableBitrate?: boolean;
        waitForAttendees?: boolean;
      };
    }) => {
      try {
        const response = await baasClient.calendarsApi.scheduleRecordEvent({
          botParam2: {
            botName: "MeetingBot", // or make this dynamic if you want
            extra: {}, // or pass real extra data if you have it
            ...(params || {})
          }
        });
        return {
          content: [
            {
              type: "text",
              text: "Successfully scheduled recording",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to schedule recording:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to schedule recording",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Unschedule Record Event
  updatedServer.tool(
    "unscheduleRecordEvent",
    "Cancel a scheduled recording. Use this when you want to: 1) Stop an automatic recording from happening 2) Cancel AI bot attendance for an event 3) Disable transcription for a meeting",
    { calendarId: z.string(), eventUuid: z.string() },
    async ({
      calendarId,
      eventUuid,
    }: {
      calendarId: string;
      eventUuid: string;
    }) => {
      try {
        // If unscheduleRecordEvent does not require botParam2, call with empty object
        const response = await baasClient.calendarsApi.unscheduleRecordEvent({});
        return {
          content: [
            {
              type: "text",
              text: "Successfully unscheduled recording",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to unschedule recording:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to unschedule recording",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Refresh Calendar
  updatedServer.tool(
    "refreshCalendar",
    "Update a calendar's events and settings. Use this when you want to: 1) Sync latest calendar events 2) Refresh meeting schedule information 3) Update recording configurations",
    { calendarId: z.string() },
    async ({ calendarId }: { calendarId: string }) => {
      try {
        const response = await baasClient.calendarsApi.updateCalendar({
          updateCalendarParams: {
            oauthClientId: '',
            oauthClientSecret: '',
            oauthRefreshToken: '',
            platform: Provider.google
          }
        });
        return {
          content: [
            {
              type: "text",
              text: "Successfully refreshed calendar",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to refresh calendar:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to refresh calendar",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Bots with meta data
  updatedServer.tool(
    "botsWithMetadata",
    "Get a list of all bots with their metadata. Use this when you want to: 1) View active bots 2) Check bot status 3) Monitor bot activity",
    {},
    async () => {
      try {
        //
        const response = await baasClient.defaultApi.botsWithMetadata();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Failed to get bots with metadata:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to get bots with metadata",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For List All Events
  updatedServer.tool(
    "listEvents",
    "List all scheduled events. Use this when you want to: 1) View upcoming recordings 2) Check scheduled transcriptions 3) Monitor planned bot activity",
    { calendarId: z.string() },
    async ({ calendarId }) => {
      try {
        //
        const response = await baasClient.calendarsApi.listEvents({
          calendarId,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response.data, null, 2),
            },
          ],
        };
      } catch (error) {
        console.error("Failed to list events:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to list events",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // For Update Calendar
  updatedServer.tool(
    "updateCalendar",
    "Update a calendar integration configuration. Use this when you want to: 1) Modify calendar settings 2) Update connection details 3) Change calendar configuration",
    {
      calendarId: z.string(),
      oauthClientId: z.string(),
      oauthClientSecret: z.string(),
      oauthRefreshToken: z.string(),
      platform: z.enum(["Google", "Microsoft"]),
    },
    async ({
      calendarId,
      oauthClientId,
      oauthClientSecret,
      oauthRefreshToken,
      platform,
    }) => {
      try {
        const updateParams = {
          oauthClientId,
          oauthClientSecret,
          oauthRefreshToken,
          platform:
            platform === "Google" ? Provider.google : Provider.microsoft,
        };

        const response = await baasClient.calendarsApi.updateCalendar({
          updateCalendarParams: updateParams
        });

        return {
          content: [
            {
              type: "text",
              text: "Successfully updated calendar",
            },
          ],
        };
      } catch (error) {
        console.error("Failed to update calendar:", error);
        return {
          content: [
            {
              type: "text",
              text: "Failed to update calendar",
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Add echo tool for testing
  const finalServer = registerEchoTool(updatedServer);

  return finalServer;
}

export default registerTools;
