// Calendar integration for the private T15 result area only.
function validateT15ResultInvitation(invitation) {
    if (invitation?.selectedModeCode !== 'T15') return;
    if (!Array.isArray(invitation.participants) || invitation.participants.length !== 8 || invitation.participants.some(p => !String(p.name || '').trim())) {
        throw new Error('Für T15 müssen acht Teilnehmer mit Namen feststehen.');
    }
    for (const field of ['playingTargetPoints','playingTargetInnings']) {
        if (!/^\d+$/.test(String(invitation[field] || '')) || Number(invitation[field]) < 1) throw new Error('Für die T15-Erfassung werden Punkte und Aufnahmen als positive ganze Zahlen benötigt.');
    }
    const seeds = invitation.participants.map((p,i) => Number(p.number || i + 1));
    if (new Set(seeds).size !== 8 || seeds.some(n => !Number.isInteger(n) || n < 1 || n > 8)) throw new Error('Die T15-Setzliste benötigt die Plätze 1 bis 8 genau einmal.');
}

async function persistInvitationForResults(invitation) {
    if (invitation?.selectedModeCode !== 'T15') return;
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
    if (invitation?.selectedModeCode !== 'T15') return null;
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
            if (invitation.selectedModeCode !== 'T15') throw new Error('Die private Ergebniserfassung ist zunächst für Modus T15 verfügbar.');
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
