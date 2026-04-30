-- ============================================================
-- Migration 005: Long-Term Goals & Milestones
-- Separate system for yearly/quarterly goals that decomposes
-- into daily actionable tasks via the goal planner.
-- ============================================================

-- 1. Long-term goals table
CREATE TABLE IF NOT EXISTS long_term_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  scope TEXT DEFAULT 'yearly' CHECK (scope IN ('quarterly', 'yearly', 'custom')),
  target_date DATE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'achieved', 'archived')),
  priority INTEGER DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ltg_user_status
  ON long_term_goals(user_id, status);

-- 2. Milestones for each goal
CREATE TABLE IF NOT EXISTS goal_milestones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  goal_id UUID NOT NULL REFERENCES long_term_goals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  target_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gm_goal_status
  ON goal_milestones(goal_id, status);

-- 3. Link task_steps back to long-term goals
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS long_term_goal_id UUID REFERENCES long_term_goals(id) ON DELETE SET NULL;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES goal_milestones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ts_ltg
  ON task_steps(long_term_goal_id) WHERE long_term_goal_id IS NOT NULL;

-- 4. Weekly review time on profile
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS weekly_review_time TEXT DEFAULT '19:00';
ALTER TABLE agent_profiles ADD COLUMN IF NOT EXISTS weekly_review_day TEXT DEFAULT 'sun';
