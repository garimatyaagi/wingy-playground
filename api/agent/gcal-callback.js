import { exchangeCode } from "./_calendar.js";
import { getSupabaseAdmin } from "./_store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { code, state: userId, error: authError } = req.query || {};

  if (authError) {
    return res.redirect("/?gcal=error&reason=" + encodeURIComponent(authError));
  }

  if (!code || !userId) {
    return res.status(400).json({ error: "Missing code or state (userId)" });
  }

  try {
    const tokens = await exchangeCode(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return res.redirect("/?gcal=error&reason=no_refresh_token");
    }

    const supabase = getSupabaseAdmin();
    const { error: dbError } = await supabase
      .from("agent_profiles")
      .update({
        google_refresh_token: refreshToken,
        google_calendar_connected: true,
      })
      .eq("user_id", userId);

    if (dbError) {
      console.error("Failed to save Google tokens:", dbError);
      return res.redirect("/?gcal=error&reason=db_error");
    }

    return res.redirect("/?gcal=connected");
  } catch (err) {
    console.error("gcal-callback error:", err);
    return res.redirect("/?gcal=error&reason=" + encodeURIComponent(err.message));
  }
}
