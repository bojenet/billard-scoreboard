// Installed only by the tournament dashboard into its embedded app windows.
// The standalone app and its source remain unchanged.
function attachTournamentResultSheet(child) {
    const doc = child.document;
    const endView = doc.getElementById("endView");
    if (!endView || typeof child.showEnd !== "function") return;

    const style = doc.createElement("style");
    style.textContent = `
        .tournament-sheet { background: #fff; color: #172033; border-radius: 10px; padding: 16px; overflow-x: auto; }
        .tournament-sheet h2 { margin: 0 0 12px; font-size: 23px; }
        .tournament-sheet p { margin: 6px 0; font-size: 14px; }
        .tournament-sheet table { width: 100%; border-collapse: collapse; margin-top: 16px; table-layout: fixed; }
        .tournament-sheet th, .tournament-sheet td { border: 1px solid #bdc5d1; padding: 7px 3px; text-align: center; overflow-wrap: anywhere; font-size: 13px; }
        .tournament-sheet th { background: #e9edf3; }
        .tournament-sheet .sheet-players { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .tournament-sheet .sheet-players > div { min-width: 0; overflow-wrap: anywhere; }
        .tournament-sheet .sheet-summary { font-weight: bold; }
    `;
    doc.head.appendChild(style);

    const sheet = doc.createElement("section");
    sheet.className = "tournament-sheet";
    sheet.setAttribute("aria-label", "Partiezettel");
    endView.insertBefore(sheet, endView.querySelector(".email-panel"));

    function element(tag, text, parent) {
        const node = doc.createElement(tag);
        if (text !== undefined) node.textContent = String(text);
        if (parent) parent.appendChild(node);
        return node;
    }

    function render() {
        const result = child.buildResultMailPayload();
        sheet.replaceChildren();
        element("h2", "Partiezettel", sheet);
        const date = new Date(result.startedAt);
        if (!Number.isNaN(date.getTime())) {
            element("p", date.toLocaleString("de-DE"), sheet);
        }
        const players = element("div", undefined, sheet);
        players.className = "sheet-players";
        for (const number of [1, 2]) {
            const player = element("div", undefined, players);
            element("strong", result[`player${number}`], player);
            element("p", `${result[`discipline${number}`]} · Ziel: ${result[`target${number}`]}`, player);
        }
        const summary = element("p", `Ergebnis: ${result.score1} : ${result.score2} · Aufnahmen: ${result.innings}`, sheet);
        summary.className = "sheet-summary";

        const table = element("table", undefined, sheet);
        const header = element("tr", undefined, element("thead", undefined, table));
        for (const title of ["Serie", "Gesamt", "Aufn.", "Serie", "Gesamt"]) {
            const th = element("th", title, header);
            th.setAttribute("scope", "col");
        }
        const body = element("tbody", undefined, table);
        const series1 = result.series1 || [];
        const series2 = result.series2 || [];
        const rows = Math.max(series1.length, series2.length, Number(result.innings) || 0);
        let total1 = 0;
        let total2 = 0;
        for (let index = 0; index < rows; index++) {
            const has1 = index < series1.length;
            const has2 = index < series2.length;
            total1 += has1 ? Number(series1[index]) || 0 : 0;
            total2 += has2 ? Number(series2[index]) || 0 : 0;
            const row = element("tr", undefined, body);
            for (const value of [has1 ? series1[index] : "", has1 ? total1 : "", index + 1, has2 ? series2[index] : "", has2 ? total2 : ""]) {
                element("td", value, row);
            }
        }
        const footer = element("tfoot", undefined, table);
        for (const [label, left, right] of [
            ["Bälle", result.score1, result.score2],
            ["GD", result.avg1, result.avg2],
            ["HS", result.hs1, result.hs2]
        ]) {
            const row = element("tr", undefined, footer);
            const leftCell = element("td", left, row);
            leftCell.colSpan = 2;
            const labelCell = element("th", label, row);
            labelCell.setAttribute("scope", "row");
            const rightCell = element("td", right, row);
            rightCell.colSpan = 2;
        }
        if (rows && !series1.length && !series2.length) {
            element("p", "Für diese Partie sind keine einzelnen Serien gespeichert.", sheet);
        }
        element("p", `Maximale Aufnahmen: ${result.maxInnings}`, sheet);
    }

    const showEnd = child.showEnd;
    child.showEnd = function (...args) {
        const result = showEnd.apply(this, args);
        render();
        return result;
    };
    // A loaded, already finished match may have rendered before the iframe load event.
    if (!endView.classList.contains("hidden")) render();
}
