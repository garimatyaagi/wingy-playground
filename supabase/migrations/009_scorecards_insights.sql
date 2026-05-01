-- Daily Scorecards: track daily execution metrics for pattern detection
CREATE TABLE IF NOT EXISTS agent_daily_scorecards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  date DATE NOT NULL,
  tasks_planned INT DEFAULT 0,
  tasks_completed INT DEFAULT 0,
  tasks_postponed INT DEFAULT 0,
  deep_work_minutes INT DEFAULT 0,
  admin_minutes INT DEFAULT 0,
  health_minutes INT DEFAULT 0,
  total_focus_minutes INT DEFAULT 0,
  completion_rate FLOAT DEFAULT 0,
  avoidance_types TEXT[] DEFAULT '{}',
  top_avoided_task TEXT,
  streak_days INT DEFAULT 0,
  energy_utilization FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_scorecards_user_date ON agent_daily_scorecards(user_id, date DESC);

-- User Insights: persistent pattern observations that evolve over time
CREATE TABLE IF NOT EXISTS agent_user_insights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('pattern', 'weakness', 'strength', 'preference', 'routine', 'trigger')),
  insight TEXT NOT NULL,
  evidence JSONB DEFAULT '[]',
  confidence FLOAT DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  first_observed DATE DEFAULT CURRENT_DATE,
  last_confirmed DATE DEFAULT CURRENT_DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insights_user_active ON agent_user_insights(user_id, active);
CREATE INDEX IF NOT EXISTS idx_insights_user_category ON agent_user_insights(user_id, category);
