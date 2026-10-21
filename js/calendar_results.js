// Calendar integration for the private tournament result area.
function validateT15ResultInvitation(invitation) {
    if (!ResultModes.supports(invitation?.selectedModeCode)) return;
    const mode=ResultModes.get(invitation.selectedModeCode);
    if (!Array.isArray(invitation.participants) || invitation.participants.length !== mode.count || invitation.participants.some(p => !String(p.name || '').trim())) {
        throw new Error(`Für ${invitation.selectedModeCode} müssen ${mode.count} Teilnehmer mit Namen feststehen.`);
    }
    for (const field of ['playingTargetPoints','playingTargetInnings']) {
        if (!/^\d+$/.test(String(invitation[field] || '')) || Number(invitation[field]) < 1) throw new Error('Für die Ergebniserfassung werden Punkte und Aufnahmen als positive ganze Zahlen benötigt.');
    }
    const seeds = invitation.participants.map((p,i) => Number(p.number || i + 1));
    if (new Set(seeds).size !== mode.count || seeds.some(n => !Number.isInteger(n) || n < 1 || n > mode.count)) throw new Error(`Die Setzliste benötigt die Plätze 1 bis ${mode.count} genau einmal.`);
}

async function persistInvitationForResults(invitation) {
    if (!ResultModes.supports(invitation?.selectedModeCode)) return;
    validateT15ResultInvitation(invitation);
    const { error } = await supabaseClient.from('calendar_invitation_drafts').upsert({
        source_url: invitation.sourceUrl,
        invitation,
        updated_by: currentUser.id,
        updated_at: new Date().toISOString()
    }, { onConflict: 'source_url' });
    if (error) throw error;
}

async function ensureT15ResultEvent(invitation) {
    if (!ResultModes.supports(invitation?.selectedModeCode)) return null;
    const { data, error } = await supabaseClient.rpc('create_t15_result_event', { p_invitation: invitation });
    if (error) throw error;
    return data;
}

async function openCalendarResultEntry(eventId) {
    const modal = !eventId;
    try {
        let invitation = modal ? currentInvitationDraft : null;
        const sourceUrl = modal ? invitation?.sourceUrl : getCalendarEventById(eventId)?.link;
        if (!sourceUrl) throw new Error('Für diesen Termin ist keine Einladung hinterlegt.');
        const { data: existing, error } = await supabaseClient.from('result_events').select('id').eq('source_url', sourceUrl).maybeSingle();
        if (error) throw error;
        let id = existing?.id;
        if (!id) {
            if (!invitation) {
                const { data: draft, error: draftError } = await supabaseClient.from('calendar_invitation_drafts').select('invitation').eq('source_url', sourceUrl).maybeSingle();
                if (draftError) throw draftError;
                invitation = draft?.invitation;
            }
            if (!invitation) throw new Error('Bitte zuerst die Einladung vorbereiten und versenden.');
            if (!ResultModes.supports(invitation.selectedModeCode)) throw new Error('Ergebniserfassung verfügbar für T3, T4/T5, T7/T8, T11/T12, T10 und T15.');
            validateT15ResultInvitation(invitation);
            id = await ensureT15ResultEvent(invitation);
        }
        window.location.href = `turnier_ergebnisse.html?turnier=${encodeURIComponent(id)}`;
    } catch (error) {
        const message = error.message || String(error);
        if (modal) setModalMessage('invitationEditorMessage', message, 'error');
        else showCalendarMessage(message, 'error');
    }
}
