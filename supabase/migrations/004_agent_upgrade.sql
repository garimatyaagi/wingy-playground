-- ============================================================
-- Migration 004: Agent Upgrade
-- Core Memory, Voice Messages, Debounce/Sessions,
-- Proactive Pulses, Message Locks, Bot Pause
-- ============================================================

-- 1. Core Memory (MemGPT-inspired persistent memory)
CREATE TABLE IF NOT EXISTS agent_core_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, key)
);

-- 2. Voice message support
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS transcription TEXT;
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS media_type TEXT;

-- 3. Message debounce + session expiry
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS batch_processed BOOLEAN DEFAULT false;
ALTER TABLE message_captures ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS session_timeout_minutes INTEGER DEFAULT 30;

-- 4. Proactive pulse system
CREATE TABLE IF NOT EXISTS agent_scheduled_pulses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  context TEXT NOT NULL,
  pulse_type TEXT DEFAULT 'followup',
  fired BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pulses_pending
  ON agent_scheduled_pulses(fired, fire_at) WHERE fired = false;

-- 5. Per-user message queue (DB-level locking)
CREATE TABLE IF NOT EXISTS agent_message_locks (
  user_id TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ DEFAULT now(),
  message_sid TEXT
);

-- 6. Bot pause
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS bot_paused_until TIMESTAMPTZ;
