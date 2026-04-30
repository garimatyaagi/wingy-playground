-- Enable pg_cron and pg_net extensions for calling the scheduler endpoint every 5 minutes.
-- This bypasses Vercel Hobby's once-per-day cron limit.
--
-- BEFORE RUNNING: Replace YOUR_CRON_SECRET with your actual CRON_SECRET env var value
-- and YOUR_DOMAIN with your Vercel deployment domain (e.g. 365tasks.online).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the nudge scheduler to run every 5 minutes
SELECT cron.schedule(
  'fire-nudges',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_DOMAIN/api/agent/scheduler',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    )
  );
  $$
);
