import { exchangeCode, verifyOAuthState } from "./_calendar.js";
import { getSupabaseAdmin } from "./_store.js";

const ALLOWED_ORIGIN = process.env.APP_ORIGIN || "https://365tasks.online";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, state, error: authError } = req.query || {};

  if (authError) {
    return sendResult(res, false, "auth_error");
  }

  if (!code || !state) {
    return res.status(400).json({ error: "Missing code or state" });
  }

  const userId = verifyOAuthState(state);
  if (!userId) {
    return res.status(403).json({ error: "Invalid OAuth state" });
  }

  try {
    const tokens = await exchangeCode(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return sendResult(res, false, "no_refresh_token");
    }

    const supabase = getSupabaseAdmin();

    // Use upsert so it works even if the user hasn't saved settings yet
    const { error: dbError } = await supabase
      .from("agent_profiles")
      .upsert(
        {
          user_id: userId,
          google_refresh_token: refreshToken,
          google_calendar_connected: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (dbError) {
      console.error("Failed to save Google tokens:", dbError);
      return sendResult(res, false, "db_error");
    }

    return sendResult(res, true);
  } catch (err) {
    console.error("gcal-callback error:", err);
    return sendResult(res, false, "connection_failed");
  }
}

function sendResult(res, success, reason) {
  // Return an HTML page that notifies the opener tab and closes itself
  const status = success ? "connected" : "error";
  const safeReason = String(reason || "").replace(/[<>"'&]/g, "");
  const origin = JSON.stringify(ALLOWED_ORIGIN);
  const html = `<!DOCTYPE html>
<html>
<head><title>Google Calendar</title></head>
<body>
<p>${success ? "Google Calendar connected! This window will close." : "Connection failed."}</p>
<script>
  try {
    if (window.opener) {
      window.opener.postMessage({ type: "gcal_result", status: "${status}", reason: "${safeReason}" }, ${origin});
    }
  } catch (e) {}
  setTimeout(function() { window.close(); }, 1500);
</script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(html);
}
