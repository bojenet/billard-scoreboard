const express = require('express');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use(express.static(__dirname));

const db = new sqlite3.Database('./scoreboard.db');

db.serialize(() => {

    db.run(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        )
    `);

   db.run(`
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player1 TEXT,
        player2 TEXT,
        discipline1 TEXT,
        discipline2 TEXT,
        target1 INTEGER,
        target2 INTEGER,
        maxInnings INTEGER,
        score1 INTEGER DEFAULT 0,
        score2 INTEGER DEFAULT 0,
        inn1 INTEGER DEFAULT 0,
        inn2 INTEGER DEFAULT 0,
        totalInnings INTEGER DEFAULT 1,
        activePlayer INTEGER DEFAULT 1,
        finished INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS archive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId INTEGER,
        player1 TEXT,
        player2 TEXT,
        score1 INTEGER,
        score2 INTEGER,
        avg1 TEXT,
        avg2 TEXT,
        hs1 INTEGER,
        hs2 INTEGER,
        innings INTEGER,
        series1 TEXT,
        series2 TEXT,
        duration INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);


});

// Spieler laden
app.get('/api/players', (req, res) => {
    db.all("SELECT * FROM players ORDER BY name ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Spieler anlegen
app.post('/api/players', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name fehlt" });

    db.run(
        "INSERT INTO players (name) VALUES (?)",
        [name],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name });
        }
    );
});

// Match erstellen
app.post('/api/match', (req, res) => {

    const { player1, player2, discipline1, discipline2, target1, target2, maxInnings } = req.body;

    db.run(
        `INSERT INTO matches 
        (player1, player2, discipline1, discipline2, target1, target2, maxInnings) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [player1, player2, discipline1, discipline2, target1, target2, maxInnings],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ matchId: this.lastID });
        }
    );
});

// Match laden
app.get('/api/match/:id', (req, res) => {

    db.get(
        "SELECT * FROM matches WHERE id = ?",
        [req.params.id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(row);
        }
    );
});

// Match aktualisieren
app.post('/api/updateMatch', (req, res) => {

    const {
        matchId,
        score1,
        score2,
        inn1,
        inn2,
        totalInnings,
        activePlayer,
        finished
    } = req.body;

    db.run(
        `UPDATE matches SET
         score1=?, score2=?, inn1=?, inn2=?, totalInnings=?, activePlayer=?, finished=?
         WHERE id=?`,
        [score1, score2, inn1, inn2, totalInnings, activePlayer, finished, matchId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success:true });
        }
    );
});

// Partie speichern
app.post('/api/archive', (req, res) => {

    const {
        matchId,
        player1,
        player2,
        score1,
        score2,
        avg1,
        avg2,
        hs1,
        hs2,
        innings,
        series1,
        series2,
        duration
    } = req.body;

    db.run(
        `INSERT INTO archive
        (matchId, player1, player2, score1, score2,
         avg1, avg2, hs1, hs2, innings,
         series1, series2, duration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            matchId,
            player1,
            player2,
            score1,
            score2,
            avg1,
            avg2,
            hs1,
            hs2,
            innings,
            JSON.stringify(series1),
            JSON.stringify(series2),
            duration
        ],
        function(err){
            if (err) return res.status(500).json({error:err.message});
            res.json({success:true});
        }
    );
});

// Archiv Liste laden
app.get('/api/archive', (req, res) => {
    db.all(
        "SELECT * FROM archive ORDER BY created_at DESC",
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.delete('/api/players/:id', (req, res) => {

    db.run(
        "DELETE FROM players WHERE id = ?",
        [req.params.id],
        function(err){
            if(err) return res.status(500).json({error:err.message});
            res.json({success:true});
        }
    );
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server läuft auf http://localhost:${port}`);
});