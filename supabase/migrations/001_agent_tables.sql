-- 001_agent_tables.sql
-- Migration for WhatsApp agent tables used by api/agent/store.js
-- Run this in Supabase SQL Editor or via supabase db push.

------------------------------------------------------------
-- 1. agent_profiles
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_profiles (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT NOT NULL UNIQUE,
  whatsapp_number TEXT DEFAULT '',
  timezone      TEXT DEFAULT 'Asia/Kolkata',
  morning_brief_time  TEXT DEFAULT '08:00',
  midday_nudge_time   TEXT DEFAULT '12:30',
  afternoon_followup_time TEXT DEFAULT '16:00',
  evening_checkin_time TEXT DEFAULT '20:30',
  workday_start TEXT DEFAULT '09:00',
  workday_end   TEXT DEFAULT '18:00',
  tone          TEXT DEFAULT 'firm',
  nudge_intensity TEXT DEFAULT 'medium',
  weekends_enabled BOOLEAN DEFAULT TRUE,
  autoplan_enabled BOOLEAN DEFAULT TRUE,
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_whatsapp
  ON agent_profiles (whatsapp_number)
  WHERE whatsapp_number <> '';

CREATE INDEX IF NOT EXISTS idx_agent_profiles_active
  ON agent_profiles (active)
  WHERE active = TRUE;

------------------------------------------------------------
-- 2. message_captures
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_captures (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT,
  channel       TEXT DEFAULT 'whatsapp',
  raw_text      TEXT DEFAULT '',
  parsed_intent TEXT DEFAULT 'unknown',
  parse_confidence REAL DEFAULT 0,
  processed     BOOLEAN DEFAULT FALSE,
  created_task_ids TEXT[] DEFAULT '{}',
  updated_task_ids TEXT[] DEFAULT '{}',
  clarification_requested BOOLEAN DEFAULT FALSE,
  processing_result TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_captures_user_created
  ON message_captures (user_id, created_at DESC);

------------------------------------------------------------
-- 3. agent_messages
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_messages (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT NOT NULL,
  type          TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  related_task_ids TEXT[] DEFAULT '{}',
  metadata      JSONB DEFAULT '{}',
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_user_sent
  ON agent_messages (user_id, sent_at DESC);

------------------------------------------------------------
-- 4. task_events
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id       TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_events_created
  ON task_events (created_at DESC);

------------------------------------------------------------
-- 5. daily_plans
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_plans (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT NOT NULL,
  date          DATE NOT NULL,
  top_priority_task_ids TEXT[] DEFAULT '{}',
  next_best_task_id TEXT,
  due_today_task_ids TEXT[] DEFAULT '{}',
  overdue_task_ids TEXT[] DEFAULT '{}',
  nudge_candidate_task_ids TEXT[] DEFAULT '{}',
  deferred_task_ids TEXT[] DEFAULT '{}',
  plan_summary  TEXT DEFAULT '',
  plan_version  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_plans_user_date
  ON daily_plans (user_id, date DESC);

------------------------------------------------------------
-- 6. task_occurrences
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_occurrences (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_task_id TEXT NOT NULL,
  date          DATE NOT NULL,
  status        TEXT DEFAULT 'pending',
  actual_minutes INTEGER DEFAULT 0,
  skipped       BOOLEAN DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  rescheduled_to DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (parent_task_id, date)
);

CREATE INDEX IF NOT EXISTS idx_task_occurrences_parent_date
  ON task_occurrences (parent_task_id, date DESC);

------------------------------------------------------------
-- 7. agent_notes (optional)
------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_notes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  raw_source_text TEXT DEFAULT '',
  source        TEXT DEFAULT 'whatsapp',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_notes_user_created
  ON agent_notes (user_id, created_at DESC);

------------------------------------------------------------
-- RLS policies (optional - enable if you want row-level security)
-- Uncomment and adjust to your auth setup.
------------------------------------------------------------
-- ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE message_captures ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE task_occurrences ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE agent_notes ENABLE ROW LEVEL SECURITY;
