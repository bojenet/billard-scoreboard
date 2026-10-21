/* T15 result export: UTF-8 without BOM, semicolon separated, CRLF records. */
(function (root) {
    'use strict';
    const cell = value => {
        const text = String(value ?? '');
        return /[;"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    function date(value) {
        const text = String(value || '').trim();
        if (!text) return '';
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
        const parts = iso ? [Number(iso[1]),Number(iso[2]),Number(iso[3])] : de ? [Number(de[3]),Number(de[2]),Number(de[1])] : null;
        if (!parts) throw new Error('Das Turnierdatum ist ungültig.');
        const check = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
        if (check.getUTCFullYear() !== parts[0] || check.getUTCMonth()+1 !== parts[1] || check.getUTCDate() !== parts[2]) throw new Error('Das Turnierdatum ist ungültig.');
        return `${String(parts[2]).padStart(2,'0')}.${String(parts[1]).padStart(2,'0')}.${parts[0]}`;
    }
    function build(event) {
        const snapshot = event.snapshot;
        const participants = new Map(snapshot.participants.map(p => [Number(p.seed),p]));
        const exportDate = date(event.event_date || snapshot.date || snapshot.eventDate);
        const time = String(snapshot.startTime || '').trim();
        if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Die Uhrzeit in der Einladung ist ungültig.');
        const lines = [];
        const rounds = {HF1:'Halbfinale',HF2:'Halbfinale',P7:'Spiel um Platz 7',P5:'Spiel um Platz 5',P3:'Spiel um Platz 3',F:'Finale'};
        event.schedule.forEach((match, index) => {
            const result = event.results[match.key];
            if (!result) return;
            if (!match.ready) throw new Error(`${match.label}: Die gespeicherte Partie hat keine eindeutige Paarung.`);
            const players = [participants.get(Number(match.seed1)),participants.get(Number(match.seed2))];
            for (const p of players) {
                if (!p || !String(p.passNo ?? '').trim()) throw new Error(`${match.label}: Passnummer für ${p?.name || 'einen Spieler'} fehlt.`);
            }
            const values = ['score1','score2','innings1','innings2','high1','high2'].map(field => result[field]);
            if (values.some(v => !Number.isInteger(v) || v < 0)) throw new Error(`${match.label}: Die Ergebnisdaten sind unvollständig oder ungültig.`);
            lines.push([match.stage === 'A' || match.stage === 'B' ? `Gruppe ${match.stage}` : rounds[match.key],index+1,1,String(players[0].passNo).trim(),String(players[1].passNo).trim(),...values,exportDate,time]);
        });
        if (lines.length === 0) throw new Error('Es sind noch keine gespeicherten Partien zum Exportieren vorhanden.');
        return lines.map(row => row.map(cell).join(';')).join('\r\n') + '\r\n';
    }
    const api = {build};
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.T15CsvExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
