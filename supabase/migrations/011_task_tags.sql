-- Add focus depth and context tags to task_steps for smarter optimizer scoring
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS focus_depth TEXT;
ALTER TABLE task_steps ADD COLUMN IF NOT EXISTS context_tags JSONB;
