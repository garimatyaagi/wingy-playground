-- Add onboarding state columns to agent_profiles
ALTER TABLE agent_profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_intent TEXT,
  ADD COLUMN IF NOT EXISTS peak_energy TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0;

-- Auto-complete onboarding for existing users who already configured WhatsApp
UPDATE agent_profiles
SET onboarding_completed = true
WHERE whatsapp_number IS NOT NULL AND whatsapp_number != '';
