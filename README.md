# 365 Tasks — WhatsApp Execution Control Room

A React + Vite app for daily task execution with an AI WhatsApp agent. Uses Clerk for auth, Supabase for persistence, Twilio for WhatsApp delivery, and OpenAI for message parsing.

## Quick start

```bash
npm install
npm run dev          # local dev at http://localhost:5173
npm run build        # production build
```

## Environment variables

### Frontend (browser-visible, `VITE_` prefix)

```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_WHATSAPP_TO=whatsapp:+91...         # optional, pre-fills settings UI
```

### Backend (server-only, set in Vercel Environment Variables)

```bash
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # service-role key for server writes

# Twilio WhatsApp delivery
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
WHATSAPP_TO=whatsapp:+91...              # fallback recipient

# Optional
SUPABASE_ANON_KEY=eyJ...                 # fallback if service-role key is not set
OPENAI_API_KEY=sk-proj-...               # for AI-powered parsing
AGENT_DEFAULT_USER_ID=user_xxx           # maps unknown inbound numbers to this user
AGENT_DEBUG_KEY=some-secret              # optional auth for /api/agent/debug
TWILIO_ENFORCE_WEBHOOK_SIGNATURE=false   # set true to enforce Twilio signature validation
```

## Database setup

Run the migration in Supabase SQL Editor:

```bash
supabase/migrations/001_agent_tables.sql
```

This creates:
- `agent_profiles` — user agent settings (timing, tone, WhatsApp number)
- `message_captures` — inbound WhatsApp message log
- `agent_messages` — outbound messages sent by the agent
- `task_events` — task lifecycle events (created, completed, snoozed, archived)
- `daily_plans` — cached daily plan per user per date
- `task_occurrences` — recurring task completion records
- `agent_notes` — captured notes from WhatsApp (optional)

## Clerk + Supabase

Create a Clerk JWT template named `supabase` and configure Supabase to trust Clerk-issued tokens. The frontend uses Clerk JWTs for authenticated Supabase requests.

## API endpoints

### Core messaging
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/whatsapp-send` | Send WhatsApp message via Twilio |
| POST | `/api/agent/whatsapp-webhook` | Twilio inbound webhook (processes messages, creates tasks) |

### Agent operations
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/agent/settings` | Read/write agent profile settings |
| POST/GET | `/api/agent/scheduler` | Trigger scheduled agent messages (also Vercel cron target) |
| GET | `/api/agent/debug?userId=...` | Fetch debug logs (captures, messages, events) |
| POST | `/api/agent/nudge` | Generate and send midday nudge |
| POST | `/api/agent/recompute` | Recompute daily plan for a user |

### Message formatting
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/parse` | Classify free-form text (task/goal/note/ambiguous) |
| POST | `/api/agent/morning-brief` | Format morning brief from plan payload |
| POST | `/api/agent/evening-followup` | Format evening check-in prompt |
| POST | `/api/agent/replan` | Generate replan adjustments from check-in outcomes |

## Vercel cron

The scheduler runs every 5 minutes via Vercel cron (configured in `vercel.json`):

```json
{
  "crons": [
    {
      "path": "/api/agent/scheduler",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

It checks each active user's configured time windows and sends the appropriate message (morning brief, midday nudge, afternoon follow-up, evening check-in).

## E2E testing

```bash
# Against local dev server
node scripts/e2e-webhook-test.mjs

# Against Vercel preview
node scripts/e2e-webhook-test.mjs https://your-preview.vercel.app
```

Covers 10 test cases: create task, create recurring, complete, reschedule, archive, goal, note, ambiguous, unknown user, empty body.

## Deployment checklist

1. Run `supabase/migrations/001_agent_tables.sql` in Supabase SQL Editor
2. Set all backend env vars in Vercel project settings
3. Deploy (`git push` or `vercel deploy`)
4. Set Twilio webhook URL to `https://your-domain.vercel.app/api/agent/whatsapp-webhook`
5. Run E2E test: `node scripts/e2e-webhook-test.mjs https://your-domain.vercel.app`
6. Verify cron is active in Vercel dashboard under Cron Jobs
