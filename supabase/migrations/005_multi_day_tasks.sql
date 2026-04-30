-- Multi-day task estimation fields
-- Supports intelligent time estimation and daily session splitting for books, projects, etc.

ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS total_estimated_minutes INTEGER;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS daily_allocated_minutes INTEGER;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS estimated_days INTEGER;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS estimation_reasoning TEXT;
