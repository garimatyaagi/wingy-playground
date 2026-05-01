import { requireAuth } from "./_auth.js";
import { getAgentProfileByUserId } from "./_store.js";
import { refreshAccessToken } from "./_calendar.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function formatEventTime(dateTimeStr, timezone) {
  if (!dateTimeStr) return "All day";
  try {
    const d = new Date(dateTimeStr);
    return d.toLocaleTimeString("en-IN", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

async function getEventsForRange(refreshToken, timezone, startDate, endDate) {
  if (!refreshToken) return [];
  try {
    const tokens = await refreshAccessToken(refreshToken);
    const accessToken = tokens.access_token;

    const timeMin = new Date(`${startDate}T00:00:00`).toISOString();
    const timeMax = new Date(`${endDate}T23:59:59`).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
      timeZone: timezone,
    });

    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      console.error("Calendar API error:", await response.text());
      return [];
    }

    const data = await response.json();
    return (data.items || []).map((event) => ({
      id: event.id,
      summary: event.summary || "(no title)",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
      startTime: formatEventTime(event.start?.dateTime, timezone),
      endTime: formatEventTime(event.end?.dateTime, timezone),
      allDay: !event.start?.dateTime,
      location: event.location || "",
      description: (event.description || "").slice(0, 100),
      date: (event.start?.dateTime || event.start?.date || "").slice(0, 10),
    }));
  } catch (err) {
    console.error("getEventsForRange error:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const requestedUserId = String(req.body?.userId || "").trim();
  if (!requestedUserId)
    return res.status(400).json({ error: "Missing userId" });

  const userId = await requireAuth(req, res, requestedUserId);
  if (!userId) return;

  const startDate = req.body?.startDate;
  const endDate = req.body?.endDate;
  if (!startDate || !endDate)
    return res.status(400).json({ error: "Missing startDate or endDate" });

  const profile = await getAgentProfileByUserId(userId);
  if (!profile?.google_refresh_token) {
    return res.status(200).json({ ok: true, events: [], connected: false });
  }

  const timezone = profile?.timezone || "Asia/Kolkata";
  const events = await getEventsForRange(
    profile.google_refresh_token,
    timezone,
    startDate,
    endDate
  );

  return res.status(200).json({ ok: true, events, connected: true });
}
