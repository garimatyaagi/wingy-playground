-- 003_enable_rls.sql
-- CRITICAL SECURITY FIX: Enable Row Level Security on all tables.
--
-- Without RLS, anyone with the anon key (exposed in the frontend) can
-- read, edit, and delete ALL data in every table.
--
-- Auth model:
--   - Frontend uses Clerk JWTs (role = "authenticated", user ID in jwt->>'sub')
--   - Backend uses SUPABASE_SERVICE_ROLE_KEY which BYPASSES RLS entirely
--   - Tables only accessed by the backend get RLS enabled with NO policies,
--     which means only the service role key can access them.
--
-- Safe to re-run: drops existing policies before creating them.

------------------------------------------------------------
-- 1. tasks (goals) — frontend reads, creates, updates, deletes own goals
------------------------------------------------------------
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can insert own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update own tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete own tasks" ON tasks;

CREATE POLICY "Users can select own tasks"
  ON tasks FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can insert own tasks"
  ON tasks FOR INSERT
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can update own tasks"
  ON tasks FOR UPDATE
  USING (user_id = (auth.jwt()->>'sub'))
  WITH CHECK (user_id = (auth.jwt()->>'sub'));

CREATE POLICY "Users can delete own tasks"
  ON tasks FOR DELETE
  USING (user_id = (auth.jwt()->>'sub'));


------------------------------------------------------------
-- 2. task_steps — frontend CRUD, scoped via parent task ownership
------------------------------------------------------------
ALTER TABLE task_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own task_steps" ON task_steps;
DROP POLICY IF EXISTS "Users can insert own task_steps" ON task_steps;
DROP POLICY IF EXISTS "Users can update own task_steps" ON task_steps;
DROP POLICY IF EXISTS "Users can delete own task_steps" ON task_steps;

CREATE POLICY "Users can select own task_steps"
  ON task_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_steps.task_id
        AND tasks.user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Users can insert own task_steps"
  ON task_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_steps.task_id
        AND tasks.user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Users can update own task_steps"
  ON task_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_steps.task_id
        AND tasks.user_id = (auth.jwt()->>'sub')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_steps.task_id
        AND tasks.user_id = (auth.jwt()->>'sub')
    )
  );

CREATE POLICY "Users can delete own task_steps"
  ON task_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_steps.task_id
        AND tasks.user_id = (auth.jwt()->>'sub')
    )
  );


------------------------------------------------------------
-- 3. message_captures — frontend can only READ own captures
------------------------------------------------------------
ALTER TABLE message_captures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can select own message_captures" ON message_captures;

CREATE POLICY "Users can select own message_captures"
  ON message_captures FOR SELECT
  USING (user_id = (auth.jwt()->>'sub'));

-- No INSERT/UPDATE/DELETE policies for authenticated role.
-- Only backend (service role) writes to this table.


------------------------------------------------------------
-- 4. agent_profiles — BACKEND ONLY (contains Google refresh tokens)
------------------------------------------------------------
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
-- No policies = no access via anon/authenticated keys.
-- Service role key bypasses RLS.


------------------------------------------------------------
-- 5. agent_messages — BACKEND ONLY
------------------------------------------------------------
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
-- No policies for frontend. Service role key bypasses RLS.


------------------------------------------------------------
-- 6. task_events — BACKEND ONLY
------------------------------------------------------------
ALTER TABLE task_events ENABLE ROW LEVEL SECURITY;
-- No policies for frontend. Service role key bypasses RLS.


------------------------------------------------------------
-- 7. daily_plans — BACKEND ONLY
------------------------------------------------------------
ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;
-- No policies for frontend. Service role key bypasses RLS.


------------------------------------------------------------
-- 8. task_occurrences — BACKEND ONLY
------------------------------------------------------------
ALTER TABLE task_occurrences ENABLE ROW LEVEL SECURITY;
-- No policies for frontend. Service role key bypasses RLS.


------------------------------------------------------------
-- 9. agent_notes — BACKEND ONLY
------------------------------------------------------------
ALTER TABLE agent_notes ENABLE ROW LEVEL SECURITY;
-- No policies for frontend. Service role key bypasses RLS.


------------------------------------------------------------
-- 10. parsed_message_actions — BACKEND ONLY (if table exists)
------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parsed_message_actions'
  ) THEN
    ALTER TABLE parsed_message_actions ENABLE ROW LEVEL SECURITY;
  END IF;
END
$$;


------------------------------------------------------------
-- Verify: list all tables and their RLS status
------------------------------------------------------------
-- Run this query after to confirm RLS is enabled:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' ORDER BY tablename;
