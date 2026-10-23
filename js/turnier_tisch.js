/* Tournament-only display controller. Never reads or writes existing app matches. */
(async () => {
    'use strict';
    const table = new URLSearchParams(location.search).get('tisch');
    const validTables = ['tb01', 'tb02', 'tb03', 'tb04', 'mb01', 'mb02'];
    const el = id => document.getElementById(id);
    const text = (id, value) => { el(id).textContent = value; };
    function wait(message, title = '') {
        el('waiting').hidden = false;
        text('message', message);
        text('waiting-title', title);
    }
    if (!validTables.includes(table)) {
        wait('Ungültiger Tisch. Erlaubt: ' + validTables.join(', '));
        return;
    }
    text('table-name', table.toUpperCase());
    text('gameTime', table.toUpperCase());
    if (!await requireAdmin()) return;
    let busy = false;
    async function rpc(name, args) {
        const { data, error } = await supabaseClient.rpc(name, args);
        if (error) throw error;
        return data;
    }
    async function refresh() {
        if (busy) return;
        busy = true;
        try {
            const device = await rpc('tournament_operation', { p_action: 'heartbeat', p_table: table });
            const assignment = device.assignment;
            if (!device.event_id || !assignment) {
                wait(device.event_id ? 'Wartet auf die nächste Partie' : 'Bereit · Warte auf Turnierstart');
                return;
            }
            const event = await rpc('get_t15_result_event', { p_id: device.event_id });
            // Assignment keeps the roster snapshot that was fixed at tournament start.
            const snapshot = assignment.snapshot;
            const result = event.results?.[assignment.key];
            for (const side of [1, 2]) {
                const player = snapshot.participants.find(p => Number(p.seed) === Number(assignment['seed' + side]));
                text('player' + side + 'Name', player?.name || 'Spieler');
                text('player' + side + 'Info', snapshot.playingTargetPoints ? 'Ziel ' + snapshot.playingTargetPoints : '');
                text('score' + side, result?.['score' + side] ?? 0);
                const innings = Number(result?.['innings' + side] ?? 0);
                text('inn' + side + 'Display', innings);
                text('hs' + side, result?.['high' + side] ?? 0);
                text('avg' + side, innings ? (Number(result['score' + side]) / innings).toFixed(3).replace('.', ',') : '0,000');
                text('discipline' + side + 'Big', snapshot.discipline || '');
            }
            text('totalInnings', Math.max(Number(result?.innings1 ?? 0), Number(result?.innings2 ?? 0)));
            text('disciplineInfo', snapshot.playingTargetInnings ? 'Max. ' + snapshot.playingTargetInnings + ' Aufnahmen' : '');
            text('table-status', [assignment.title, assignment.roundLabel, assignment.label,
                device.paused ? 'PAUSIERT' : result ? 'Ergebnis gespeichert' : 'Partie bereit · Anzeige'].filter(Boolean).join(' · '));
            document.title = table.toUpperCase() + ' · ' + assignment.title;
            el('waiting').hidden = true;
        } catch (error) {
            wait('Verbindung unterbrochen · erneuter Versuch …', error.message);
        } finally {
            busy = false;
        }
    }
    await refresh();
    setInterval(refresh, 5000);
})();
