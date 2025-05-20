/**
 * Mapping of tool names to their documentation URLs
 */
export const TOOL_DOC_URLS: Record<string, string> = {
  // Bot tools
  joinMeeting: "https://docs.meetingbaas.com/docs/api/reference/join",
  leaveMeeting: "https://docs.meetingbaas.com/docs/api/reference/leave",
  getMeetingData: "https://docs.meetingbaas.com/docs/api/reference/get_meeting_data",
  deleteData: "https://docs.meetingbaas.com/docs/api/reference/delete_data",
  botsWithMetadata: "https://docs.meetingbaas.com/docs/api/reference/bots_with_metadata",
  
  // Calendar tools
  createCalendar: "https://docs.meetingbaas.com/docs/api/reference/calendars/create_calendar",
  listCalendars: "https://docs.meetingbaas.com/docs/api/reference/calendars/list_calendars",
  getCalendar: "https://docs.meetingbaas.com/docs/api/reference/calendars/get_calendar",
  deleteCalendar: "https://docs.meetingbaas.com/docs/api/reference/calendars/delete_calendar",
  resyncAllCalendars: "https://docs.meetingbaas.com/docs/api/reference/calendars/resync_all_calendars",
  listEvents: "https://docs.meetingbaas.com/docs/api/reference/calendars/list_events", 
  scheduleRecordEvent: "https://docs.meetingbaas.com/docs/api/reference/calendars/schedule_record_event",
  unscheduleRecordEvent: "https://docs.meetingbaas.com/docs/api/reference/calendars/unschedule_record_event",
  updateCalendar: "https://docs.meetingbaas.com/docs/api/reference/calendars/update_calendar",
}; 