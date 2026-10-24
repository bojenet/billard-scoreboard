/* Separate administration entry for display operation; manual entry lives on its own page. */
(async () => {
    'use strict';
    const $ = id => document.getElementById(id);
    const eventId = new URLSearchParams(location.search).get('turnier');
    $('logoutBtn').onclick = signOutAndRedirect;
    const rpc = async (fn, args) => {
        const {data, error} = await supabaseClient.rpc(fn, args);
        if(error) throw error;
        return data;
    };
    try {
        if(!await requireAdmin()) return;
        if(!eventId) {
            const state = await rpc('tournament_operation', {p_action:'state'});
            for(const event of state.events) {
                const link = document.createElement('a');
                link.className = 'event-link';
                link.href = 'turnier_displaybetrieb.html?turnier=' + encodeURIComponent(event.id);
                const title = document.createElement('strong');title.textContent = event.title;
                const meta = document.createElement('span');
                meta.textContent = [event.status === 'completed' ? 'Abgeschlossen' : 'Offen', (event.tableIds || []).map(t=>t.toUpperCase()).join(', ') || 'Noch keine Tische hinterlegt'].join(' · ');
                link.append(title, meta);$('automaticEvents').append(link);
            }
            if(!state.events.length) $('automaticEvents').textContent = 'Noch keine Turniere angelegt.';
            $('automaticList').hidden = false;
        } else {
            const event = await rpc('get_t15_result_event', {p_id:eventId});
            if(event.can_delete !== true) throw new Error('Nur Administratoren dürfen den Displaybetrieb verwalten.');
            $('eventTitle').textContent = event.title;
            $('eventMeta').textContent = [event.event_date, event.snapshot.locationName, event.snapshot.discipline, `${event.snapshot.selectedModeCode} · ${event.snapshot.participants.length} Spieler`, `Ziel ${event.snapshot.playingTargetPoints} / ${event.snapshot.playingTargetInnings} Aufnahmen`].filter(Boolean).join(' · ');
            $('manualEntryLink').href = 'turnier_ergebnisse.html?turnier=' + encodeURIComponent(eventId);
            $('automaticEvent').hidden = false;
            window.TournamentDashboard.update(event, 'overview');
        }
        $('message').textContent = '';
    } catch(error) {
        $('automaticEvent').hidden = true;
        $('automaticList').hidden = true;
        $('message').textContent = error.message;
        $('message').classList.add('error');
    }
})();
