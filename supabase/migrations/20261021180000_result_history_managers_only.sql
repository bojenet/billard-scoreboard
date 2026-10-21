-- Only tournament managers/admins may inspect the full change history.
alter policy result_history_private_read on public.result_event_history
 using (public.result_can_manage(event_id));
