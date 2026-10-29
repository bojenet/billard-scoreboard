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
            if (!ResultModes.supports(invitation.selectedModeCode)) throw new Error('Ergebniserfassung verfügbar für T3, T4/T5, T7/T8, T11/T12, T10, T15 und T18/T19.');
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


function updateInvitationResultOption() {
    if(!currentInvitationDraft)return;
    const input=document.getElementById('invitationEditorResultEntry');
    if(!input)return;
    const supported=ResultModes.supports(currentInvitationDraft.selectedModeCode);
    input.disabled=!supported;
    const update=document.getElementById('invitationEditorResultUpdate');
    if(update)update.disabled=!supported || update.dataset.locked==='true';
    document.getElementById('invitationResultModeHint').hidden=supported;
}
async function renderInvitationResultEntry(invitation) {
    const link=document.getElementById('invitationResultLink');
    if(!link)return;
    link.hidden=true;link.textContent='';
    document.getElementById('invitationEditorResultEntry').hidden=false;
    const update=document.getElementById('invitationEditorResultUpdate');
    update.hidden=true;delete update.dataset.eventId;delete update.dataset.version;
    updateInvitationResultOption();
    const source=invitation?.sourceUrl;if(!source)return;
    try {
        const {data,error}=await supabaseClient.from('result_events').select('id,version,status,results').eq('source_url',source).maybeSingle();
        if(currentInvitationDraft?.sourceUrl!==source)return;
        if(error)throw error;
        if(!data)return;
        const anchor=document.createElement('a');anchor.href=`turnier_ergebnisse.html?turnier=${encodeURIComponent(data.id)}`;anchor.textContent='Zum angelegten Turnier · Ergebnisse erfassen';
        link.replaceChildren(anchor);link.hidden=false;
        document.getElementById('invitationEditorResultEntry').hidden=true;
        update.dataset.eventId=data.id;update.dataset.version=String(data.version);
        update.dataset.locked=String(data.status!=='open' || Object.keys(data.results || {}).length>0);
        update.hidden=false;updateInvitationResultOption();
    }catch(error){link.textContent='Verknüpfung zur Ergebniserfassung konnte nicht geladen werden.';link.hidden=false;}
}
async function readInvitationResultOutcome(reminderId) {
    try {
        const {data,error}=await supabaseClient.from('calendar_club_reminders').select('result_sync_outcome').eq('id',reminderId).maybeSingle();
        if(error)throw error;return data?.result_sync_outcome;
    }catch(error){return {status:'error',message:'Der Versand war erfolgreich; der Stand der Ergebniserfassung konnte nicht geladen werden.'};}
}

async function createInvitationResultTournament() {
    if(!isCalendarAdmin || !currentInvitationDraft)return;
    const button=document.getElementById('invitationEditorResultEntry');
    const message=document.getElementById('invitationResultMessage');
    if(button.disabled)return;
    button.disabled=true;message.hidden=false;message.textContent='Turnier wird angelegt …';
    try {
        const invitation=JSON.parse(JSON.stringify(currentInvitationDraft));
        if(!ResultModes.supports(invitation.selectedModeCode))throw new Error('Ergebniserfassung für diesen Modus noch nicht verfügbar.');
        validateT15ResultInvitation(invitation);
        await persistInvitationForResults(invitation);
        await ensureT15ResultEvent(invitation);
        if(currentInvitationDraft?.sourceUrl!==invitation.sourceUrl)return;
        await renderInvitationResultEntry(currentInvitationDraft);
        message.textContent='Turnier zur Ergebniserfassung angelegt. Es wurde keine Einladung versendet.';
    }catch(error){message.textContent=error.message || String(error);}finally{updateInvitationResultOption();}
}

async function updateInvitationResultTournament() {
    if(!isCalendarAdmin || !currentInvitationDraft)return;
    const button=document.getElementById('invitationEditorResultUpdate');
    const message=document.getElementById('invitationResultMessage');
    if(button.disabled || !button.dataset.eventId)return;
    const id=button.dataset.eventId,version=Number(button.dataset.version);
    button.disabled=true;message.hidden=false;message.textContent='Turnierdaten werden aktualisiert …';
    try {
        const invitation=JSON.parse(JSON.stringify(currentInvitationDraft));
        if(!ResultModes.supports(invitation.selectedModeCode))throw new Error('Ergebniserfassung für diesen Modus noch nicht verfügbar.');
        validateT15ResultInvitation(invitation);
        await persistInvitationForResults(invitation);
        const {error}=await supabaseClient.rpc('update_result_from_invitation',{p_id:id,p_invitation:invitation,p_version:version});
        if(error)throw error;
        if(currentInvitationDraft?.sourceUrl!==invitation.sourceUrl)return;
        await renderInvitationResultEntry(currentInvitationDraft);
        message.textContent='Turnierdaten aktualisiert: Teilnehmer, Modus und Spielziel wurden übernommen. Es wurde keine Einladung versendet.';
    }catch(error){message.textContent=error.message || String(error);}finally{updateInvitationResultOption();}
}
