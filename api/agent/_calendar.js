// Google Calendar integration using raw REST API (no googleapis dependency)

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function getCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function getAuthUrl(userId) {
  const creds = getCredentials();
  if (!creds) return null;

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
    state: userId,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const creds = getCredentials();
  if (!creds) throw new Error("Missing Google credentials");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken) {
  const creds = getCredentials();
  if (!creds) throw new Error("Missing Google credentials");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  return response.json();
}

export async function getTodayEvents(refreshToken, timezone = "Asia/Kolkata") {
  if (!refreshToken) return [];

  try {
    const tokens = await refreshAccessToken(refreshToken);
    const accessToken = tokens.access_token;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const todayStr = formatter.format(now);

    const timeMin = new Date(`${todayStr}T00:00:00`).toISOString();
    const timeMax = new Date(`${todayStr}T23:59:59`).toISOString();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "20",
      timeZone: timezone,
    });

    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
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
      time: formatEventTime(event.start?.dateTime, timezone),
      allDay: !event.start?.dateTime,
      location: event.location || "",
      description: (event.description || "").slice(0, 100),
    }));
  } catch (err) {
    console.error("getTodayEvents error:", err.message);
    return [];
  }
}

export async function getUpcomingEvents(refreshToken, timezone = "Asia/Kolkata", hours = 2) {
  if (!refreshToken) return [];

  try {
    const tokens = await refreshAccessToken(refreshToken);
    const accessToken = tokens.access_token;

    const now = new Date();
    const later = new Date(now.getTime() + hours * 3600000);

    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: later.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "10",
      timeZone: timezone,
    });

    const response = await fetch(
      `${CALENDAR_API}/calendars/primary/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.items || []).map((event) => ({
      id: event.id,
      summary: event.summary || "(no title)",
      start: event.start?.dateTime || event.start?.date || "",
      time: formatEventTime(event.start?.dateTime, timezone),
      allDay: !event.start?.dateTime,
    }));
  } catch (err) {
    console.error("getUpcomingEvents error:", err.message);
    return [];
  }
}

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
