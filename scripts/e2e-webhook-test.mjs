#!/usr/bin/env node
/**
 * End-to-end verification script for the WhatsApp webhook.
 *
 * Pre-requisites:
 *   1. Run the migration SQL in Supabase so all agent tables exist.
 *   2. Set env vars (or .env.local) for SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      TWILIO_AUTH_TOKEN (optional – signature is skipped when enforcement is off).
 *   3. Have at least one agent_profile row for the test user (or set AGENT_DEFAULT_USER_ID).
 *
 * Usage:
 *   node scripts/e2e-webhook-test.mjs [base_url]
 *
 *   base_url defaults to http://localhost:3000. For Vercel preview deploys pass the URL.
 *
 * All 10 test cases:
 *   1. create_task          – "Finish pitch deck by Friday"
 *   2. create_recurring     – "Run every morning at 7am"
 *   3. complete_task        – "Done with pitch deck"
 *   4. reschedule_task      – "Move pitch deck to next week"
 *   5. archive_task         – "Archive pitch deck"
 *   6. goal                 – "Goal: ship v2 by March"
 *   7. note                 – "Note: meeting went well"
 *   8. ambiguous            – "maybe later"
 *   9. unknown_user         – message from unregistered number
 *  10. malformed/empty body – empty message
 */

const BASE = process.argv[2] || "http://localhost:3000";
const WEBHOOK = `${BASE}/api/agent/whatsapp-webhook`;
const FROM = "whatsapp:+919999999999";

const CASES = [
  {
    name: "1. create_task",
    body: { From: FROM, Body: "Finish pitch deck by Friday" },
    expect: (xml) => xml.includes("Added") || xml.includes("task"),
  },
  {
    name: "2. create_recurring_task",
    body: { From: FROM, Body: "Run every morning at 7am" },
    expect: (xml) => xml.includes("Added") || xml.includes("task") || xml.includes("Captured"),
  },
  {
    name: "3. complete_task",
    body: { From: FROM, Body: "Done with pitch deck" },
    expect: (xml) =>
      xml.includes("done") ||
      xml.includes("Marked") ||
      xml.includes("could not find") ||
      xml.includes("Which"),
  },
  {
    name: "4. reschedule_task",
    body: { From: FROM, Body: "Move pitch deck to next week" },
    expect: (xml) =>
      xml.includes("Rescheduled") ||
      xml.includes("reschedule") ||
      xml.includes("Which"),
  },
  {
    name: "5. archive_task",
    body: { From: FROM, Body: "Archive pitch deck" },
    expect: (xml) =>
      xml.includes("Archived") ||
      xml.includes("archive") ||
      xml.includes("Which"),
  },
  {
    name: "6. goal",
    body: { From: FROM, Body: "Goal: ship v2 by March" },
    expect: (xml) => xml.includes("goal") || xml.includes("Captured"),
  },
  {
    name: "7. note",
    body: { From: FROM, Body: "Note: meeting with investors went well" },
    expect: (xml) => xml.includes("note") || xml.includes("Saved"),
  },
  {
    name: "8. ambiguous",
    body: { From: FROM, Body: "maybe later" },
    expect: (xml) =>
      xml.includes("clarification") ||
      xml.includes("detail") ||
      xml.includes("action") ||
      xml.includes("Captured"),
  },
  {
    name: "9. unknown_user",
    body: { From: "whatsapp:+10000000000", Body: "Hello" },
    expect: (xml) =>
      xml.includes("could not map") ||
      xml.includes("account") ||
      xml.includes("Added") || // falls back to AGENT_DEFAULT_USER_ID
      xml.includes("Captured"),
  },
  {
    name: "10. empty_body",
    body: { From: FROM, Body: "" },
    expect: (xml) =>
      xml.includes("detail") ||
      xml.includes("resend") ||
      xml.includes("action") ||
      xml.includes("trouble"),
  },
];

async function run() {
  console.log(`\n  WhatsApp webhook E2E verification`);
  console.log(`  Target: ${WEBHOOK}\n`);

  let passed = 0;
  let failed = 0;

  for (const tc of CASES) {
    const label = tc.name.padEnd(30);
    try {
      const formBody = new URLSearchParams(tc.body).toString();
      const res = await fetch(WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody,
      });
      const text = await res.text();
      const status = res.status;

      if (status !== 200) {
        console.log(`  FAIL  ${label} status=${status}`);
        failed++;
        continue;
      }

      const ok = tc.expect(text);
      if (ok) {
        const snippet = text.replace(/<[^>]+>/g, "").slice(0, 80);
        console.log(`  PASS  ${label} → ${snippet}`);
        passed++;
      } else {
        const snippet = text.replace(/<[^>]+>/g, "").slice(0, 120);
        console.log(`  FAIL  ${label} → unexpected: ${snippet}`);
        failed++;
      }
    } catch (err) {
      console.log(`  FAIL  ${label} → ${err.message}`);
      failed++;
    }
  }

  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${CASES.length}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
