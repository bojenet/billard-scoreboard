delete from public.calendar_invitation_email_logs;

delete from public.calendar_club_reminders;

update public.calendar_settings
set invitation_auto_send_enabled = false,
    invitation_auto_send_last_run_at = null,
    updated_at = now()
where key = 'nbv_public_calendar';
