// Existing setup and remote pages run in isolated windows. No app files are changed.
(() => {
    const tableIds = ["tisch1", "tisch2"];
    const views = new Map();
    const message = document.getElementById("message");
    let user;
    let admin = false;
    let ownedNames = [];
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
                if (match && !admin && !isOwnedMatch(match, user.id, ownedNames)) {
                    status.textContent = "Belegt · Keine Berechtigung für diese Partie";
                    frame.hidden = true;
                    // Discard any previously accessible controller.
                    if (views.get(table) !== "blocked") {
                        views.set(table, "blocked");
                        frame.src = "about:blank";
                    }
                } else if (match) {
                    frame.hidden = false;
                    showFrame(table, `remote.html?match=${encodeURIComponent(match.id)}`, String(match.id));
                } else {
                    frame.hidden = false;
                    showFrame(table, "match_setup.html", "setup");
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
        if (path.endsWith("/remote.html") && !new URL(child.location.href).searchParams.has("match")) {
            views.delete(table);
            refresh();
            return;
        }
        if (!path.endsWith("/match_setup.html") && !path.endsWith("/remote.html")) return;
        const style = child.document.createElement("style");
        style.textContent = ".user-menu-wrap{display:none!important} body{min-width:0} .display-table-wrapper,.control-mode-wrapper{display:none!important}";
        child.document.head.appendChild(style);
        if (path.endsWith("/remote.html")) {
            views.set(table, new URL(child.location.href).searchParams.get("match"));
            refresh();
            return;
        }
        // Lock the assignment in this window, including 'repeat last match'.
        const selectTable = child.selectDisplayTable;
        child.selectDisplayTable = () => selectTable(table);
        child.selectDisplayTable();
        const startMatch = child.startMatch;
        let starting = false;
        child.startMatch = async () => {
            if (starting) return;
            starting = true;
            try {
                // Recheck immediately before creation: a match may have started in the app.
                if ((await runningMatches(table)).length) {
                    child.setFormMessage("Dieser Tisch ist inzwischen belegt. Die laufende Partie wird geladen.", "error");
                    await refresh();
                    return;
                }
                child.selectDisplayTable();
                await startMatch();
            } catch (error) {
                child.setFormMessage("Tischbelegung konnte nicht geprüft werden. Bitte erneut versuchen.", "error");
            } finally {
                starting = false;
            }
        };
        for (const button of child.document.querySelectorAll("button")) {
            if (button.getAttribute("onclick")?.includes("index.html")) {
                button.onclick = () => { window.location.href = "index.html"; };
            }
        }
    }

    async function init() {
        user = await requireAuth();
        if (!user) return;
        const access = await getTournamentAccess(user);
        if (!isTournamentVisible(access)) {
            document.querySelector("main").textContent = "Kein Zugriff auf Turnier.";
            return;
        }
        admin = await hasAdminAccess(user);
        ownedNames = await getOwnedPlayerNames(user.id);
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
