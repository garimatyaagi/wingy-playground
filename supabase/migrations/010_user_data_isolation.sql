-- 010_user_data_isolation.sql
-- FIX: Add user_id to task_events and task_occurrences, enable RLS on all
-- tables that were created after 003_enable_rls.sql, and backfill user_id
-- from the tasks table.
--
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards.

------------------------------------------------------------
-- 1. Add user_id to task_events, backfill from tasks
------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_events' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE task_events ADD COLUMN user_id TEXT;

    -- Backfill: task_events.task_id may reference tasks.id or task_steps.id
    UPDATE task_events te
    SET user_id = COALESCE(
      (SELECT t.user_id FROM tasks t WHERE t.id = te.task_id LIMIT 1),
      (SELECT ts.user_id FROM task_steps ts WHERE ts.id = te.task_id LIMIT 1)
    )
    WHERE te.user_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_task_events_user_id
      ON task_events (user_id, created_at DESC);
  END IF;
END $$;

------------------------------------------------------------
-- 2. Add user_id to task_occurrences, backfill from tasks
------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_occurrences' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE task_occurrences ADD COLUMN user_id TEXT;

    UPDATE task_occurrences toc
    SET user_id = COALESCE(
      (SELECT t.user_id FROM tasks t WHERE t.id = toc.parent_task_id LIMIT 1),
      (SELECT ts.user_id FROM task_steps ts WHERE ts.id = toc.parent_task_id LIMIT 1)
    )
    WHERE toc.user_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_task_occurrences_user_id
      ON task_occurrences (user_id, date DESC);
  END IF;
END $$;

------------------------------------------------------------
-- 3. Enable RLS on tables from migration 004
------------------------------------------------------------
ALTER TABLE agent_core_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_scheduled_pulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_message_locks ENABLE ROW LEVEL SECURITY;

------------------------------------------------------------
-- 4. Enable RLS on tables from migration 005
------------------------------------------------------------
ALTER TABLE long_term_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_milestones ENABLE ROW LEVEL SECURITY;

------------------------------------------------------------
-- 5. Enable RLS on tables from migration 009
------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_daily_scorecards'
  ) THEN
    ALTER TABLE agent_daily_scorecards ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'agent_user_insights'
  ) THEN
    ALTER TABLE agent_user_insights ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- All tables above are BACKEND ONLY (service role key bypasses RLS).
-- RLS with no policies = zero access via anon/authenticated keys,
-- which is the correct behavior for backend-only tables.
