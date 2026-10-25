/* Isolated table scoring: tournament or free play. Original app matches are untouched. */
(async () => {
    'use strict';
    const table = new URLSearchParams(location.search).get('tisch');
    const validTables = ['tb01', 'tb02', 'tb03', 'tb04', 'mb01', 'mb02'];
    const el = id => document.getElementById(id);
    const text = (id, value) => { el(id).textContent = value; };
    let device, event, reading = false, writing = false, connected = false, generation = 0, readyAt = 0, transitionTimer;
    let endscreen = null;
    const warmupStorage = 'tournament-warmup-' + table;
    let warmup = null;
    try { warmup = JSON.parse(sessionStorage.getItem(warmupStorage)); } catch (_) {}
    const overlay = document.createElement('div');
    overlay.id = 'table-warmup';overlay.hidden = true;
    const warmupCard = document.createElement('div');
    const warmupLabel = document.createElement('div');warmupLabel.textContent = 'Einspielzeit';
    const warmupPlayer = document.createElement('strong');
    const warmupTime = document.createElement('div');warmupTime.className = 'warmup-countdown';
    warmupCard.append(warmupLabel, warmupPlayer, warmupTime);overlay.appendChild(warmupCard);document.body.appendChild(overlay);
    function storeWarmup() {
        try { if (warmup) sessionStorage.setItem(warmupStorage, JSON.stringify(warmup));else sessionStorage.removeItem(warmupStorage); } catch (_) {}
    }
    function updateWarmup() {
        overlay.hidden = true;
        if (!warmup || endscreen) return;
        if (!device?.event_id || event?.status === 'completed') { warmup = null;storeWarmup();return; }
        const key = device.event_id + ':' + device.assignment?.key;
        if (!device.assignment) return;
        if (!warmup.key) { warmup = { key, started: Date.now() };storeWarmup(); }
        if (warmup.key !== key) { warmup = null;storeWarmup();return; }
        const elapsed = Math.max(0, Date.now() - warmup.started);
        if (elapsed >= 600000) { warmup = null;storeWarmup();render();return; }
        const side = elapsed < 300000 ? 1 : 2;
        const remaining = Math.ceil((side * 300000 - elapsed) / 1000);
        warmupPlayer.textContent = playerName(side);
        warmupTime.textContent = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
        overlay.hidden = false;
        for (const button of document.querySelectorAll('#table-input button')) button.disabled = true;
    }
    const nextButton = document.createElement('button');
    nextButton.id = 'input-next';nextButton.className = 'input-primary';nextButton.textContent = 'Weiter';nextButton.hidden = true;
    el('table-input').appendChild(nextButton);
    nextButton.onclick = () => { endscreen = null;warmup = {};storeWarmup();render(); };
    const rpc = async (name, args) => {
        const { data, error } = await supabaseClient.rpc(name, args);
        if (error) throw error;
        return data;
    };
    function wait(message, title = '') {
        el('waiting').hidden = false;
        text('message', message);text('waiting-title', title);
        el('table-input').hidden = true;
    }
    if (!validTables.includes(table)) { wait('Ungültiger Tisch. Erlaubt: ' + validTables.join(', ')); return; }
    text('table-name', table.toUpperCase());text('gameTime', table.toUpperCase());
    if (!await requireAdmin()) return;
    const playerName = side => device?.event_id ? device.assignment?.snapshot.participants.find(p => Number(p.seed) === Number(device.assignment['seed' + side]))?.name || 'Spieler' : side === 1 ? 'Weiß' : 'Gelb';
    function adopt(next, nextEvent, previousEvent = nextEvent) {
        const previousKey = device?.assignment?.key;
        const completed = previousKey && previousEvent?.results?.[previousKey];
        if (!endscreen && device?.event_id && completed && (next.event_id !== device.event_id || next.assignment?.key !== previousKey)) {
            endscreen = { device: structuredClone(device), event: previousEvent };
        }
        const changed = next.assignment?.key !== device?.assignment?.key || next.event_id !== device?.event_id || next.mode_version !== device?.mode_version;
        if (changed) {
            el('input-winner').value = '0';text('input-error', '');clearTimeout(transitionTimer);
            readyAt = device && (next.assignment || !next.event_id) ? Date.now() + 3000 : 0;
            if (readyAt) transitionTimer = setTimeout(() => { if (connected) render(); }, 3100);
        }
        device = next;event = nextEvent;connected = true;
    }
    function render() {
        if (!endscreen) { nextButton.hidden = true;renderBoard();updateWarmup();return; }
        overlay.hidden = true;
        const currentDevice = device, currentEvent = event;
        try {
            device = endscreen.device;event = endscreen.event;renderBoard();
            text('input-active', 'Partie beendet · Ergebnis gespeichert');
            for (const button of document.querySelectorAll('#table-input button')) button.disabled = true;
            nextButton.hidden = false;nextButton.disabled = false;
        } finally { device = currentDevice;event = currentEvent; }
    }
    function renderBoard() {
        const a = device?.assignment, free = !!device && !device.event_id;
        document.body.classList.toggle('free-play', free);
        el('input-reset').hidden = !free;
        if (!free && !a) {
            if (device?.paused) wait('Turnier pausiert');
            else wait('Wartet auf die nächste spielbereite Partie');
            return;
        }
        const snapshot = free ? {} : a.snapshot, result = free ? null : event.results?.[a.key];
        const s = (free ? device.free_state : result || device.live_state) || {};
        const saved = !free && (!!result || !!s.saved), done = !free && !!s.done, active = Number(s.active || 1);
        const changing = Date.now() < readyAt;
        const disabled = changing || writing || !connected || device.paused || saved || (!free && event.status === 'completed');
        for (const side of [1, 2]) {
            text('player' + side + 'Name', free ? '' : playerName(side));text('player' + side + 'Info', free ? '' : 'Ziel ' + snapshot.playingTargetPoints);
            text('score' + side, s['score' + side] ?? 0);
            el('score' + side).style.setProperty('--score-digits', Math.max(2, String(s['score' + side] ?? 0).length));
            const innings = Number(s['innings' + side] ?? 0), score = Number(s['score' + side] ?? 0);
            text('inn' + side + 'Display', innings);
            text('hs' + side, Math.max(Number(s['high' + side] || 0), Number(s['series' + side] || 0)));
            text('avg' + side, innings ? (score / innings).toFixed(3).replace('.', ',') : '0,000');
            text('discipline' + side + 'Big', snapshot.discipline || '');
            el('p' + side).className = 'player ' + (active === side && !saved ? 'active-' : 'inactive-') + (side === 1 ? 'white' : 'yellow');
        }
        text('totalInnings', saved || done ? Math.max(Number(s.innings1 || 0), Number(s.innings2 || 0)) : Number(s.innings2 || 0) + 1);
        text('currentSeries', !saved && !done && Number(s['series' + active] || 0) ? '+' + s['series' + active] : '');
        text('disciplineInfo', free ? '' : 'Max. ' + snapshot.playingTargetInnings + ' Aufnahmen');
        document.querySelector('.game-label').textContent = free ? 'FREIES SPIEL' : 'TURNIER';
        const reply = !free && !saved && !done && active === 2 && (Number(s.score1 || 0) >= Number(snapshot.playingTargetPoints) || Number(s.innings1 || 0) >= Number(snapshot.playingTargetInnings));
        el('nachstossLabel').style.display = reply ? 'block' : 'none';
        text('input-active', changing ? (free ? 'Freies Spiel · Gleich geht es weiter' : 'Nächste Partie · Gleich geht es weiter') : device.paused ? 'Turnier pausiert' : saved ? 'Ergebnis gespeichert · Korrekturen über die Turnierleitung' : done ? 'Partie beendet' : playerName(active) + ' am Spiel' + (reply ? ' · Nachstoß' : ''));
        const remaining = free ? Infinity : Number(snapshot.playingTargetPoints) - Number(s['score' + active] || 0);
        for (const button of document.querySelectorAll('[data-points]')) {
            const delta = Number(button.dataset.points);
            button.disabled = disabled || done || delta > remaining || (delta < 0 && Number(s['series' + active] || 0) < -delta);
        }
        el('input-turn').disabled = disabled || done;text('input-turn', 'Wechsel');
        el('input-undo').disabled = disabled || !(free ? device.free_can_undo : device.can_undo);
        el('input-reset').disabled = disabled;
        el('input-completion').hidden = saved || !done;
        text('input-completion-message', a?.stage === 'final' && s.score1 === s.score2 ? 'Gleichstand – Sieger nach Entscheid auswählen.' : 'Ergebnis wird automatisch gespeichert.');
        el('input-winner-label').hidden = !(done && a?.stage === 'final' && s.score1 === s.score2);
        el('input-winner').disabled = disabled;
        el('input-finish').disabled = disabled;
        document.title = table.toUpperCase() + ' · ' + (free ? 'Freies Spiel' : a.title);
        el('waiting').hidden = true;el('table-input').hidden = false;
    }
    async function refresh() {
        if (reading || writing) return;
        reading = true;const revision = generation;
        try {
            const next = await rpc('tournament_operation', { p_action: 'heartbeat', p_table: table });
            const nextEvent = next.event_id ? await rpc('get_t15_result_event', { p_id: next.event_id }) : null;
            if (revision !== generation) return;
            const previousEvent = device?.event_id && device.event_id !== next.event_id ? await rpc('get_t15_result_event', { p_id: device.event_id }) : nextEvent;
            adopt(next, nextEvent, previousEvent);render();
        } catch (error) {
            if (revision === generation) { connected = false;wait('Verbindung unterbrochen · erneuter Versuch …', error.message); }
        } finally { reading = false; }
    }
    async function input(action, value = 0) {
        if (endscreen || warmup || writing || Date.now() < readyAt || !connected || !device || (device.event_id && (!device.assignment || device.paused))) return;
        const free = !device.event_id;
        if (action === 'reset' && (!free || !confirm('Neues freies Spiel? Punkte und Aufnahmen dieses Tisches zurücksetzen.'))) return;
        writing = true;generation++;text('input-error', '');render();
        try {
            const next = free ? await rpc('table_free_input', { p_table: table, p_version: device.free_version || 0, p_mode_version: device.mode_version, p_action: action, p_value: value }) : await rpc('tournament_table_input', { p_table: table, p_event: device.event_id, p_key: device.assignment.key, p_version: device.live_version || 0, p_action: action, p_value: value });
            const changed = next.assignment?.key !== device.assignment?.key || next.event_id !== device.event_id;
            const nextEvent = next.event_id ? (changed || action === 'finish' ? await rpc('get_t15_result_event', { p_id: next.event_id }) : event) : null;
            const previousEvent = device.event_id && device.event_id !== next.event_id ? await rpc('get_t15_result_event', { p_id: device.event_id }) : nextEvent;
            adopt(next, nextEvent, previousEvent);
        } catch (error) {
            connected = false;
            text('input-error', error.message + ' · Der aktuelle Stand wird neu geladen.');
        } finally { writing = false;render();if (!connected) await refresh(); }
    }
    for (const button of document.querySelectorAll('[data-points]')) button.onclick = () => input('points', Number(button.dataset.points));
    el('input-turn').onclick = () => input('turn');el('input-undo').onclick = () => input('undo');
    el('input-reset').onclick = () => input('reset');
    el('input-finish').onclick = () => input('finish', Number(el('input-winner').value));
    await refresh();setInterval(refresh, 3000);setInterval(updateWarmup, 250);
})();
