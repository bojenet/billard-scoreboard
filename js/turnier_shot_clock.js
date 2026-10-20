// Tournament-only clock automation. The standalone app remains unchanged.
let tournamentClockAudio = null;

function prepareTournamentClockAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
        if (!tournamentClockAudio || tournamentClockAudio.state === "closed") {
            tournamentClockAudio = new AudioContextClass();
        }
        if (tournamentClockAudio.state === "suspended") {
            void tournamentClockAudio.resume().catch(() => {});
        }
        return tournamentClockAudio;
    } catch (error) {
        console.warn("Timer-Warnton konnte nicht vorbereitet werden:", error);
        return null;
    }
}

function playTournamentClockAlarm() {
    const context = prepareTournamentClockAudio();
    if (!context || context.state !== "running") return;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
    gain.gain.setValueAtTime(0.3, start + 1.7);
    gain.gain.linearRampToValueAtTime(0, start + 1.8);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + 1.85);
}

function attachTournamentShotClock(child, matchId) {
    // User interaction also unlocks audio when the timer is started in the iframe.
    child.document.addEventListener("pointerdown", prepareTournamentClockAudio);
    child.document.addEventListener("keydown", prepareTournamentClockAudio);
    if (!matchId) return;

    let disposed = false;
    let pending = false;
    let nextAttempt = 0;
    const alarmedClocks = new Set();

    async function checkClock() {
        if (disposed || pending || Date.now() < nextAttempt || child.isFinished() ||
            !child.isDreiband() || child.getShotClockRemaining() > 0) return;
        pending = true;
        nextAttempt = Date.now() + 2000;
        try {
            const { data: match, error } = await supabaseClient.from("matches")
                .select("*").eq("id", matchId).single();
            if (error) throw error;
            if (disposed || !match || match.finished || !match.shot_clock_running ||
                !match.shot_clock_started_at || Number(match.status) !== 1) return;
            const active = Number(match.activePlayer || 1);
            const disciplineKey = active === 1 ? "discipline1" : "discipline2";
            if (String(match[disciplineKey] || "").trim().toLowerCase() !== "dreiband") return;
            const started = Date.parse(match.shot_clock_started_at);
            const duration = Number(match.shot_clock_remaining_seconds ?? 40);
            if (!Number.isFinite(started) || !Number.isFinite(duration) ||
                Date.now() < started + duration * 1000) return;

            const timeoutKey = active === 1 ? "shot_clock_timeouts1" : "shot_clock_timeouts2";
            const used = Number(match[timeoutKey] || 0);
            if (used < 2) {
                // Compare-and-set: another dashboard, the app, a pause, or a player
                // change must not consume a second timeout for this same expiry.
                const { data: updated, error: updateError } = await supabaseClient.from("matches")
                    .update({
                        [timeoutKey]: used + 1,
                        shot_clock_running: true,
                        shot_clock_started_at: new Date().toISOString(),
                        shot_clock_remaining_seconds: 40
                    })
                    .eq("id", matchId).eq("finished", false).eq("status", 1)
                    .eq("activePlayer", match.activePlayer)
                    .eq(disciplineKey, match[disciplineKey])
                    .eq(timeoutKey, match[timeoutKey])
                    .eq("shot_clock_running", true)
                    .eq("shot_clock_started_at", match.shot_clock_started_at)
                    .eq("shot_clock_remaining_seconds", match.shot_clock_remaining_seconds)
                    .select("id");
                if (updateError) throw updateError;
                if (!disposed && updated?.length) await child.pollMatch();
            } else {
                const clockKey = `${active}:${match.shot_clock_started_at}:${duration}`;
                if (!alarmedClocks.has(clockKey)) {
                    alarmedClocks.add(clockKey);
                    playTournamentClockAlarm();
                }
            }
        } catch (error) {
            console.warn("Automatisches Timeout konnte nicht verarbeitet werden:", error);
        } finally {
            pending = false;
        }
    }

    const interval = child.setInterval(checkClock, 250);
    child.addEventListener("pagehide", () => {
        disposed = true;
        child.clearInterval(interval);
    }, { once: true });
    void checkClock();
}
