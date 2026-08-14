create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

alter table public.calendar_settings
  add column if not exists invitation_auto_send_last_run_at timestamptz null;

select cron.unschedule('send-nbv-invitation-reminders')
where exists (
  select 1
  from cron.job
  where jobname = 'send-nbv-invitation-reminders'
);

select cron.schedule(
  'send-nbv-invitation-reminders',
  '*/15 * * * *',
  $$
    select
      net.http_post(
        url := 'https://kstqhcaazuuxchqtnyfc.supabase.co/functions/v1/send-nbv-invitation-reminders',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', 'sb_publishable_0C-Hj42NxQ1UCHMkadC-Pw_KWDg6o2r'
        ),
        body := jsonb_build_object(
          'source', 'pg_cron',
          'scheduledAt', now()
        ),
        timeout_milliseconds := 30000
      ) as request_id;
  $$
);
