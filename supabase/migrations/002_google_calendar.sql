-- Add Google Calendar integration columns to agent_profiles
ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS google_calendar_connected BOOLEAN DEFAULT false;
