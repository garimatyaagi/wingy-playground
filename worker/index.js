// ─── 365Tasks Always-On Worker ───
// A lightweight, always-running process that triggers the scheduler
// at precise intervals. Replaces unreliable GitHub Actions cron.
//
// Deploy to: Fly.io (free tier) or Railway ($5/mo)
//
// Required env vars:
//   SCHEDULER_URL - Full URL to scheduler endpoint (e.g. https://365tasks.online/api/agent/scheduler)
//   CRON_SECRET   - Bearer token for scheduler auth
//   PULSE_URL     - (optional) Separate pulse-firing endpoint

import cron from "node-cron";

const SCHEDULER_URL = process.env.SCHEDULER_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const PULSE_URL = process.env.PULSE_URL || null;

if (!SCHEDULER_URL || !CRON_SECRET) {
  console.error("FATAL: SCHEDULER_URL and CRON_SECRET must be set");
  process.exit(1);
}

async function triggerScheduler() {
  const start = Date.now();
  try {
    const response = await fetch(SCHEDULER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(55000), // 55s timeout
    });

    const body = await response.json().catch(() => null);
    const elapsed = Date.now() - start;

    if (response.ok) {
      const actions = (body?.report || []).flatMap((r) => r.actions || []);
      const sent = actions.filter((a) => a.sent?.sent === true || a.sent === true);
      console.log(`[${new Date().toISOString()}] scheduler OK (${elapsed}ms) — ${sent.length} messages sent, ${body?.pulses || 0} pulses`);
      if (sent.length > 0) {
        for (const action of sent) {
          console.log(`  → ${action.type}`);
        }
      }
    } else {
      console.error(`[${new Date().toISOString()}] scheduler FAILED (${response.status}, ${elapsed}ms):`, body?.error || "unknown");
    }
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[${new Date().toISOString()}] scheduler ERROR (${elapsed}ms):`, err.message);
  }
}

async function triggerPulses() {
  if (!PULSE_URL) return;
  try {
    const response = await fetch(PULSE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      console.error(`[${new Date().toISOString()}] pulse trigger FAILED:`, body?.error || response.status);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] pulse trigger ERROR:`, err.message);
  }
}

// ─── Cron Schedule ───
// Run scheduler every 5 minutes
cron.schedule("*/5 * * * *", () => {
  triggerScheduler();
});

// Run pulse check every 2 minutes (more frequent for timely delivery)
if (PULSE_URL) {
  cron.schedule("*/2 * * * *", () => {
    triggerPulses();
  });
}

// ─── Startup ───
console.log(`[${new Date().toISOString()}] 365Tasks worker started`);
console.log(`  Scheduler URL: ${SCHEDULER_URL}`);
console.log(`  Pulse URL: ${PULSE_URL || "(disabled)"}`);
console.log(`  Cron: */5 * * * * (scheduler), ${PULSE_URL ? "*/2 * * * * (pulses)" : "no pulse cron"}`);

// Trigger immediately on startup to catch any missed messages
triggerScheduler();

// Health check — log heartbeat every hour
cron.schedule("0 * * * *", () => {
  console.log(`[${new Date().toISOString()}] heartbeat — worker alive`);
});

// Keep process alive
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  process.exit(0);
});
