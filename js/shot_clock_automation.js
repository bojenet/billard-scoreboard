// Runs on the Pi/main scoreboard. The server serializes expiry transitions,
// including when multiple scoreboards observe the same match.
function createShotClockAutomation({ getState, onExtended, playAlarm, client }) {
    let pending = false;
    let retryAt = 0;
    const alarmed = new Set();
    const key = state => `${state.activePlayer}:${state.startedAt}:${state.remaining}`;

    return {
        async check() {
            const state = getState();
            if (!state || state.finished || !state.running || !state.startedAt ||
                String(state.discipline || "").trim().toLowerCase() !== "dreiband") return;
            const started = Date.parse(state.startedAt);
            if (!Number.isFinite(started) || Date.now() < started + state.remaining * 1000 ||
                pending || Date.now() < retryAt || alarmed.has(key(state))) return;
            pending = true;
            retryAt = Date.now() + 1000;
            try {
                const { data, error } = await client.rpc("advance_expired_shot_clock", {
                    p_match_id: state.id,
                    p_started_at: state.startedAt,
                    p_active_player: state.activePlayer
                });
                if (error) throw error;
                const current = getState();
                // A point, pause, or turn change may have arrived during the request.
                if (!current || current.finished || !current.running || key(current) !== key(state)) return;
                if (data?.action === "extended") {
                    onExtended(data.clock);
                } else if (data?.action === "expired") {
                    alarmed.add(key(state));
                    playAlarm();
                }
            } catch (error) {
                console.warn("Automatisches Timeout konnte nicht verarbeitet werden:", error);
            } finally {
                pending = false;
            }
        }
    };
}
