import {
  getAgentProfileByUserId,
  upsertAgentProfile,
  createLongTermGoal,
  createGoalMilestone,
} from "./_store.js";
import { getAuthUrl, getTodayEvents } from "./_calendar.js";
import { requireAuth } from "./_auth.js";
import { sendWhatsAppMessage } from "./_twilio.js";
import { llmDecomposeGoal } from "./_llm.js";
import { recomputeDailyPlan } from "./_engine.js";

const ONBOARDING_INTRO = `Hey! I'm your personal productivity PA. 🤝

Before I start planning your days, I want to learn a bit about you so I can be genuinely useful.

Let's start — *what do you do?* (your role, work context — freelance, corporate, student, etc.)`;

export default async function handler(req, res) {
  if (req.method === "GET") {
    // Handle Google Calendar auth redirect
    if (req.query?.gcal_auth === "1") {
      const requestedUserId = String(req.query?.userId || "").trim();
      const authedUserId = await requireAuth(req, res, requestedUserId);
      if (!authedUserId) return;
      const authUrl = getAuthUrl(authedUserId);
      if (!authUrl) {
        return res.status(500).json({ error: "Google Calendar not configured." });
      }
      return res.redirect(authUrl);
    }

    const requestedUserId = String(req.query?.userId || "").trim();
    if (!requestedUserId) return res.status(400).json({ error: "Missing userId" });
    const userId = await requireAuth(req, res, requestedUserId);
    if (!userId) return;
    const profile = await getAgentProfileByUserId(userId);
    // Expose the agent's WhatsApp number so the frontend can build a wa.me connect link
    const agentWhatsAppNumber = (process.env.TWILIO_WHATSAPP_FROM || "").replace(/^whatsapp:/, "");
    return res.status(200).json({ profile, agentWhatsAppNumber });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  const requestedUserId = String(body.userId || "").trim();
  if (!requestedUserId) return res.status(400).json({ error: "Missing userId" });
  const userId = await requireAuth(req, res, requestedUserId);
  if (!userId) return;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("settings_save_blocked: SUPABASE_SERVICE_ROLE_KEY not configured");
    return res.status(500).json({ error: "Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY" });
  }

  const action = String(body.action || "").trim();

  // ─── Onboarding: Start WhatsApp conversation ───
  if (action === "start_whatsapp") {
    const profile = await getAgentProfileByUserId(userId);
    if (!profile?.whatsAppNumber) {
      return res.status(400).json({ error: "WhatsApp number not configured" });
    }

    await upsertAgentProfile({
      userId,
      whatsappNumber: profile.whatsAppNumber,
      timezone: profile.timezone,
      morningBriefTime: profile.morningBriefTime,
      middayNudgeTime: profile.middayNudgeTime,
      afternoonFollowupTime: profile.afternoonFollowupTime,
      eveningCheckinTime: profile.eveningCheckinTime,
      workdayStart: profile.workdayStart,
      workdayEnd: profile.workdayEnd,
      tone: profile.tone,
      nudgeIntensity: profile.nudgeIntensity,
      weekendsEnabled: profile.weekendsEnabled,
      autoplanEnabled: profile.autoplanEnabled,
      onboardingStep: 1,
    });

    const result = await sendWhatsAppMessage({
      to: profile.whatsAppNumber,
      text: ONBOARDING_INTRO,
    });

    return res.status(200).json({ ok: true, sent: result.sent, sid: result.sid });
  }

  // ─── Onboarding: Create goals and decompose them ───
  if (action === "create_goals") {
    const goals = body.goals || [];
    if (!Array.isArray(goals) || goals.length === 0) {
      return res.status(400).json({ error: "No goals provided" });
    }

    const results = [];
    for (const goal of goals.slice(0, 3)) {
      const title = String(goal.title || "").trim();
      if (!title) continue;

      const created = await createLongTermGoal(userId, {
        title,
        description: goal.description || "",
        scope: goal.scope || "yearly",
        targetDate: goal.targetDate || null,
        priority: goal.priority || 2,
      });

      if (created) {
        llmDecomposeGoal(title, goal.description || "", goal.targetDate || null, userId)
          .then(async (decomposition) => {
            if (!decomposition?.milestones) return;
            for (let i = 0; i < decomposition.milestones.length; i++) {
              const m = decomposition.milestones[i];
              await createGoalMilestone(created.id, userId, {
                title: m.title,
                description: m.description || "",
                orderIndex: i,
                targetDate: m.targetWeek
                  ? new Date(Date.now() + m.targetWeek * 7 * 86400000).toISOString().split("T")[0]
                  : null,
              });
            }
            console.log(`onboarding: decomposed goal "${title}" into ${decomposition.milestones.length} milestones`);
          })
          .catch((err) => console.error("onboarding goal decomposition failed:", err.message));

        results.push({ id: created.id, title });
      }
    }

    return res.status(200).json({ ok: true, goals: results });
  }

  // ─── Onboarding: Generate first day plan ───
  if (action === "generate_first_day") {
    const profile = await getAgentProfileByUserId(userId);

    let calendarEvents = [];
    if (profile?.googleCalendarConnected && profile?.google_refresh_token) {
      try {
        calendarEvents = await getTodayEvents(profile.google_refresh_token, profile.timezone);
      } catch (err) {
        console.error("onboarding: calendar fetch failed", err.message);
      }
    }

    const planResult = await recomputeDailyPlan({
      userId,
      date: new Date(),
      calendarEvents,
      profile: profile || {},
    });

    const topPriorities = (planResult?.topPriorities || []).map((t) => ({
      id: t.id,
      title: t.title || t.text,
      estimatedMinutes: t.estimatedMinutes || t.estimated_minutes || 30,
      effortType: t.effortType || t.effort_type || "deep_work",
      goalTitle: t.goalTitle || "",
      scheduledTime: t.scheduledTime || null,
    }));

    const schedule = (planResult?.optimizedSchedule?.time_blocks || []).map((block) => ({
      start: block.start,
      end: block.end,
      title: block.title,
      type: block.type,
    }));

    return res.status(200).json({
      ok: true,
      plan: {
        topPriorities,
        schedule,
        calendarEvents: calendarEvents.slice(0, 6).map((e) => ({
          time: e.time || e.start,
          title: e.summary || e.title,
        })),
        summary: planResult?.plan?.plan_summary || "",
      },
    });
  }

  // ─── Default: Save settings ───
  const result = await upsertAgentProfile({
    userId,
    whatsappNumber: body.whatsAppTo || "",
    timezone: body.timezone || "Asia/Kolkata",
    morningBriefTime: body.morningBriefTime,
    middayNudgeTime: body.middayNudgeTime,
    afternoonFollowupTime: body.afternoonFollowupTime,
    eveningCheckinTime: body.eveningCheckinTime,
    workdayStart: body.workdayStart,
    workdayEnd: body.workdayEnd,
    tone: body.tone || "firm",
    nudgeIntensity: body.nudgeIntensity || "medium",
    weekendsEnabled: body.weekendsEnabled ?? true,
    autoplanEnabled: body.autoplanEnabled ?? true,
    onboardingCompleted: body.onboardingCompleted,
    onboardingIntent: body.onboardingIntent,
    peakEnergy: body.peakEnergy,
    onboardingStep: body.onboardingStep,
  });

  if (!result.ok) {
    return res.status(500).json({ error: "Could not save agent settings", reason: result.reason || "unknown" });
  }
  return res.status(200).json({ ok: true, profile: result.profile });
}
