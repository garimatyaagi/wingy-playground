-- ============================================================
-- Migration 008: Goal Branches
-- Adds a branch (life category) column to the tasks table
-- so goals can be grouped under Finance, Career, Health, etc.
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_branch
  ON tasks(branch) WHERE branch IS NOT NULL;
