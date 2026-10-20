// Each table embeds the unchanged app, with its table assignment fixed here.
(() => {
    const tableIds = ["tisch1", "tisch2"];
    const views = new Map();
    const message = document.getElementById("message");
    let user;
    let canUseApp = false;
    let canEdit = false;
    let refreshing = false;

    function showFrame(table, source, key) {
        const frame = document.getElementById(`frame-${table}`);
        if (views.get(table) === key) return;
        views.set(table, key);
        frame.hidden = false;
        frame.src = source;
    }

    async function runningMatches(table) {
        let query = supabaseClient.from("matches").select("*")
            .in("display_table", table ? [table] : tableIds)
            .eq("status", 1).eq("finished", false)
            .order("started_at", { ascending: false });
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    }

    async function refresh() {
        if (refreshing || !user) return;
        refreshing = true;
        try {
            const matches = await runningMatches();
            message.textContent = "";
            for (const table of tableIds) {
                const matchesAtTable = matches.filter(match => match.display_table === table);
                const match = matchesAtTable[0];
                const status = document.getElementById(`status-${table}`);
                const frame = document.getElementById(`frame-${table}`);
                if (matchesAtTable.length > 1) {
                    status.textContent = `${matchesAtTable.length} laufende Partien zugeordnet. Angezeigt wird die zuletzt gestartete Partie.`;
                } else {
                    status.textContent = match ? `${match.player1} · ${match.player2}` : "Frei · Neue Partie anlegen";
                }
                if (!canEdit) {
                    status.textContent = match ? `${match.player1} · ${match.player2} · Nur Lesezugriff` : "Frei · Nur Lesezugriff";
                    frame.hidden = true;
                    continue;
                }
                if (!canUseApp) {
                    status.textContent = "Für die Tischsteuerung wird Zugriff auf die Scoreboard App benötigt.";
                    frame.hidden = true;
                    // Discard any previously accessible controller.
                    if (views.get(table) !== "blocked") {
                        views.set(table, "blocked");
                        frame.src = "about:blank";
                    }
                } else if (match) {
                    frame.hidden = false;
                    showFrame(table, `scoreboard_app.html?match=${encodeURIComponent(match.id)}`, String(match.id));
                } else {
                    frame.hidden = false;
                    if (views.has(table) && views.get(table) !== "setup" && views.get(table) !== "blocked") {
                        // Keep the app's result view and PDF export until 'Neue Partie'.
                        status.textContent = "Partie beendet · Ergebnis oder neue Partie";
                    } else {
                        showFrame(table, "scoreboard_app.html", "setup");
                    }
                }
            }
        } catch (error) {
            console.error("Tischstatus konnte nicht geladen werden:", error);
            message.textContent = "Tischstatus konnte nicht aktualisiert werden. Bitte Verbindung prüfen und erneut aktualisieren.";
        } finally {
            refreshing = false;
        }
    }

    function prepareFrame(table) {
        const frame = document.getElementById(`frame-${table}`);
        const child = frame.contentWindow;
        const path = child.location.pathname;
        if (path.endsWith("/login.html")) {
            window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname)}`;
            return;
        }
        if (!path.endsWith("/scoreboard_app.html")) return;
        const style = child.document.createElement("style");
        style.textContent = "#activeTablesPanel,#displayButtons,.topbar h1,.topbar button[onclick='logoutScoreboardApp()']{display:none!important} body{min-width:0} .two{grid-template-columns:repeat(2,minmax(0,1fr))} .field{min-width:0} select,input{min-width:0}";
        child.document.head.appendChild(style);
        const matchId = new URL(child.location.href).searchParams.get("match");
        views.set(table, matchId || "setup");
        // Lock the assignment in this window, including 'repeat last match'.
        const selectTable = child.selectDisplay;
        child.selectDisplay = () => selectTable(table);
        child.selectDisplay();
        const startMatch = child.startMatch;
        let starting = false;
        child.startMatch = async () => {
            if (starting) return;
            starting = true;
            try {
                // Recheck immediately before creation: a match may have started in the app.
                if ((await runningMatches(table)).length) {
                    child.setMessage("Dieser Tisch ist inzwischen belegt. Die laufende Partie wird geladen.", "error");
                    await refresh();
                    return;
                }
                child.selectDisplay();
                await startMatch();
            } catch (error) {
                child.setMessage("Partie konnte nicht gestartet werden. Bitte Verbindung prüfen und erneut versuchen.", "error");
            } finally {
                starting = false;
                child.document.getElementById("startBtn").disabled = false;
            }
        };
        refresh();
    }

    async function init() {
        user = await requireAuth();
        if (!user) return;
        const access = await getTournamentAccess(user);
        if (!isTournamentVisible(access)) {
            document.querySelector("main").textContent = "Kein Zugriff auf Turnier.";
            return;
        }
        canUseApp = isClubMobileVisible(await getClubMobileAccess(user));
        canEdit = isTournamentEditable(access) && isMatchEditable(await getMatchAccess(user));
        for (const table of tableIds) {
            document.getElementById(`frame-${table}`).addEventListener("load", () => prepareFrame(table));
        }
        document.getElementById("tables").hidden = false;
        document.getElementById("refresh").addEventListener("click", refresh);
        await refresh();
        // Polling also recovers after missed realtime events or reconnects.
        const poll = window.setInterval(refresh, 4000);
        const channel = supabaseClient.channel("tournament-table-control")
            .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refresh)
            .subscribe();
        window.addEventListener("pagehide", () => {
            clearInterval(poll);
            supabaseClient.removeChannel(channel);
        }, { once: true });
    }

    init().catch(error => {
        console.error(error);
        message.textContent = "Tischsteuerung konnte nicht geladen werden. Bitte Seite neu laden.";
    });
})();
