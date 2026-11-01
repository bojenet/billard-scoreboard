const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('scoreboard_app.html', 'utf8');
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, { get value() { return this._value ?? ''; }, set value(value) { this._value = String(value); }, disabled: false, textContent: '', options: [{}, {}], focus() {}, showModal() { this.open = true; }, close() { this.open = false; } });
    return elements.get(id);
};
let stored, fail = false;
const client = { from() {
    let payload, matches = true, returning = false;
    const query = {
        update(value) { payload = value; return query; },
        eq(key, value) { matches &&= stored[key] === value; return query; },
        is(key, value) { matches &&= (stored[key] ?? null) === value; return query; },
        select() { returning = true; return query; },
        then(resolve) {
            if (matches && !fail) stored = { ...stored, ...payload };
            return Promise.resolve({ data: returning && matches && !fail ? [{ id: stored.id }] : [], error: fail ? { message: 'offline' } : null }).then(resolve);
        }
    };
    return query;
} };
const context = { URLSearchParams, console: { error() {} }, window: { location: { search: '' }, addEventListener() {} }, document: { getElementById: element }, supabaseClient: client };
vm.createContext(context);
vm.runInContext(script, context);
vm.runInContext('updateDisplay = () => {}; showEnd = () => {};', context);
const run = code => vm.runInContext(code, context);
const initial = { id: 'test', player1: 'Anna', player2: 'Ben', score1: 12, score2: 9, inn1: 4, inn2: 4, high1: 5, high2: 4, series1: 2, series2: 0, activePlayer: 1, totalInnings: 5, finished: false, status: 1, series_log1: [2, 3, 5, 2], series_log2: [2, 2, 4, 1] };
function reset(extra = {}) {
    stored = { ...initial, ...extra };
    context.initial = structuredClone(stored);
    run('matchId = "test"; matchData = initial; history = []; openScoreEditor();');
}
async function save() { await run('saveScoreCorrection({preventDefault() {}})'); }
(async () => {
    reset();
    element('editscore1').value = '18';
    element('editinn1').value = '6';
    element('edithigh1').value = '7';
    element('editActivePlayer').value = '2';
    await save();
    assert.equal(stored.score1, 18);
    assert.equal(stored.high1, 7);
    assert.equal(stored.inn1, 6);
    assert.equal(stored.totalInnings, 7);
    assert.equal(stored.activePlayer, 2);
    assert.equal(stored.series1, 2);
    assert.deepEqual(stored.series_log1, initial.series_log1);
    assert.equal(element('scoreEditor').open, false);
    await run('undo()');
    assert.equal(stored.score1, 12);
    assert.equal(stored.inn1, 4);
    for (const value of ['', '-1', '1.5', '2147483648']) {
        reset(); element('editscore1').value = value; await save();
        assert.equal(stored.score1, 12);
        assert.equal(element('scoreEditor').open, true);
    }
    reset(); stored.score2 = 10; element('editscore1').value = '20'; await save();
    assert.equal(stored.score1, 12); // Database conflict even before realtime arrives.
    assert.equal(element('scoreEditor').open, true);
    assert.equal(run('history.length'), 0);
    reset(); run('matchData.score2 = 11'); await save();
    assert.match(element('scoreEditorMessage').textContent, /inzwischen/);
    reset(); fail = true; await save(); fail = false;
    assert.equal(element('scoreEditor').open, true);
    assert.equal(element('saveScoreCorrectionBtn').disabled, false);
    reset({ finished: true, series1: 0 });
    element('editscore1').value = '30'; await save();
    assert.equal(stored.finished, true);
    assert.equal(stored.score1, 30);
    assert.equal(stored.series1, 0);
    assert.equal(stored.totalInnings, 4);
    const unplayed = { score1: 0, score2: 0, inn1: 0, inn2: 0, high1: 0, high2: 0, series1: 0, series2: 0, totalInnings: 1, series_log1: [], series_log2: [], discipline1: 'Dreiband', discipline2: 'Einband', target1: 30, target2: 60, player1_id: 'a', player2_id: 'b', player1_country_code: 'DE', player2_country_code: 'NL', player1_club_name: 'A', player2_club_name: 'B' };
    reset(unplayed);
    await run('swapMatchPlayers()');
    assert.equal(stored.player1, 'Ben');
    assert.equal(stored.player2, 'Anna');
    assert.equal(stored.target1, 60);
    assert.equal(stored.discipline1, 'Einband');
    assert.equal(stored.player1_id, 'b');
    assert.equal(stored.player1_country_code, 'NL');
    assert.equal(stored.player1_club_name, 'B');
    assert.equal(stored.activePlayer, 1);
    await run('undo()');
    assert.equal(stored.player1, 'Anna');
    assert.equal(stored.target1, 30);
    await run('swapMatchPlayers()');
    await run('swapMatchPlayers()');
    assert.equal(stored.player1, 'Anna');
    for (const extra of [{ score1: 1 }, { series2: 1 }, { inn1: 1 }, { series_log1: [0] }, { finished: true }]) {
        reset({ ...unplayed, ...extra });
        assert.equal(run('canSwapMatchPlayers()'), false);
        await run('swapMatchPlayers()');
        assert.equal(stored.player1, 'Anna');
    }
    reset(unplayed); stored.series1 = 1;
    await run('swapMatchPlayers()');
    assert.equal(stored.player1, 'Anna');
    assert.equal(run('history.length'), 0);
    console.log('PASS: post-start side swap, metadata/targets, first turn, repeat swap, undo, input guard and concurrent scoring');
    console.log('PASS: score/statistics correction, active player, innings, preserved series, undo, validation, concurrent edits, failed saves, finished matches');
})().catch(error => { console.error(error); process.exitCode = 1; });
