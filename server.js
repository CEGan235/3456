// server.js
const express = require('express');
const http = require('http'); // HTTP-Modul für Socket.IO
const { Server } = require('socket.io'); // Socket.IO Server

const app = express();
const server = http.createServer(app); // Erstelle HTTP-Server aus Express-App
const io = new Server(server, {
    cors: {
        origin: "*", // Erlaube Verbindungen von jeder Domain (für Entwicklung, später einschränken!)
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;

// Statische Dateien servieren (Ihr Frontend)
app.use(express.static('public')); // Annahme: Ihre index.html, JS, CSS sind im 'public'-Ordner

// Spiel-Logik (vereinfachtes Beispiel)
const games = {}; // Speichert die aktuellen Spiele {code: {players: [], state: {}}}

io.on('connection', (socket) => {
    console.log('Ein Spieler hat sich verbunden:', socket.id);

    // Event: 'createGame' (Host erstellt ein Spiel)
    socket.on('createGame', () => {
        const gameCode = Math.random().toString(36).substring(2, 7).toUpperCase(); // Einfacher Code
        games[gameCode] = {
            players: [{ id: socket.id, name: 'Host' }],
            state: 'waiting',
            hostId: socket.id
        };
        socket.join(gameCode); // Spieler tritt dem Socket.IO Raum bei
        socket.emit('gameCreated', { gameCode, playerId: socket.id });
        console.log(`Spiel ${gameCode} erstellt von ${socket.id}`);
    });

    // Event: 'joinGame' (Spieler tritt Spiel bei)
    socket.on('joinGame', (code) => {
        const game = games[code];
        if (game && game.players.length < 2) { // Beispiel: Max. 2 Spieler
            socket.join(code);
            game.players.push({ id: socket.id, name: 'Player2' });
            socket.emit('joinedGame', { gameCode: code, playerId: socket.id });
            // Informiere alle im Raum, dass ein Spieler beigetreten ist
            io.to(code).emit('playerJoined', { playerId: socket.id, playerName: 'Player2', gamePlayers: game.players });
            console.log(`Spieler ${socket.id} ist Spiel ${code} beigetreten`);
        } else {
            socket.emit('joinError', 'Spiel nicht gefunden oder voll.');
        }
    });

    // Event: 'makeMove' (Spieler macht einen Zug)
    socket.on('makeMove', ({ gameCode, moveData }) => {
        // Hier die Spiellogik implementieren
        // Zustand aktualisieren und an alle Spieler im Raum senden
        io.to(gameCode).emit('gameStateUpdate', { newGameState: '...' });
        console.log(`Zug in Spiel ${gameCode} von ${socket.id}:`, moveData);
    });

    socket.on('disconnect', () => {
        console.log('Ein Spieler hat sich getrennt:', socket.id);
        // Hier Logik implementieren, um Spiele zu bereinigen, wenn Spieler gehen
    });
});

server.listen(port, () => { // Wichtig: server.listen statt app.listen
  console.log(`Server läuft auf Port ${port}`);
});