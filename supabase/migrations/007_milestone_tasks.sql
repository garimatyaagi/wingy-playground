-- ============================================================
-- Migration 007: Milestone Tasks + Goal Drafting Status
-- Stores LLM-generated daily task templates on milestones
-- and adds "drafting" status for goal refinement conversations.
-- ============================================================

-- 1. Store daily/weekly task templates from LLM decomposition on each milestone
--    Each item: {title, frequency, estimatedMinutes, effortType}
ALTER TABLE goal_milestones
  ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;

-- 2. Allow goals to be in "drafting" status during refinement conversation
ALTER TABLE long_term_goals
  DROP CONSTRAINT IF EXISTS long_term_goals_status_check;

ALTER TABLE long_term_goals
  ADD CONSTRAINT long_term_goals_status_check
  CHECK (status IN ('active', 'paused', 'achieved', 'archived', 'drafting'));
