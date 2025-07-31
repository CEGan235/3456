const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
// Socket.IO Server initialisieren. 'cors' ist wichtig, falls Frontend und Backend von verschiedenen Adressen kommen,
// aber für den Anfang, wenn alles vom selben Server kommt, oft nicht strikt nötig.
const io = socketIo(server, {
    cors: {
        origin: "*", // Erlaube Anfragen von jeder Domain (für Entwicklung, für Produktion einschränken!)
        methods: ["GET", "POST"]
    }
});

// Statische Dateien aus dem 'public'-Ordner servieren
// Das bedeutet, wenn jemand deine Server-Adresse im Browser aufruft, wird die index.html aus 'public' geladen.
app.use(express.static('public'));

// --- Lobby-Verwaltung auf dem Server ---
const games = {}; // Ein Objekt, das alle aktiven Spiele/Lobbys speichert

// Hilfsfunktion zum Generieren eines zufälligen, eindeutigen Spiel-Codes
function generateGameCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (games[code]); // Sicherstellen, dass der Code einzigartig ist
    return code;
}

io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Bei neuer Verbindung: Liste der öffentlichen Spiele an Client senden
    socket.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));

    // --- Events vom Client behandeln ---

    // 1. Spiel erstellen
    socket.on('createGame', (playerName) => {
        const gameCode = generateGameCode();
        games[gameCode] = {
            id: gameCode,
            hostId: socket.id, // Der Ersteller ist der Host
            players: { // Spieler-Objekt, keyed by socket.id
                [socket.id]: { id: socket.id, name: playerName, ready: false, isHost: true }
            },
            status: 'waiting', // waiting, playing, finished
            messages: [] // Für den Chat
        };
        socket.join(gameCode); // Spieler tritt dem Socket.IO Raum (Lobby) bei
        socket.gameCode = gameCode; // Speichere den Code direkt am Socket für einfachen Zugriff

        // Sende Bestätigung und Spielerinfos an den Host
        socket.emit('gameCreated', { gameCode: gameCode, players: games[gameCode].players });
        console.log(`${playerName} (${socket.id}) hat Spiel ${gameCode} erstellt.`);

        // Alle Clients über neue öffentliche Lobbys informieren
        io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    });

    // 2. Spiel beitreten
    socket.on('joinGame', (data) => {
        const { gameCode, playerName } = data;
        const game = games[gameCode];

        if (game && game.status === 'waiting') {
            if (Object.keys(game.players).length >= 4) { // Beispiel: Max. 4 Spieler pro Spiel
                socket.emit('joinError', 'Spiel ist voll.');
                return;
            }
            if (game.players[socket.id]) { // Spieler ist bereits in diesem Spiel
                socket.emit('joinError', 'Du bist diesem Spiel bereits beigetreten.');
                return;
            }

            game.players[socket.id] = { id: socket.id, name: playerName, ready: false, isHost: false };
            socket.join(gameCode);
            socket.gameCode = gameCode;

            // Bestätigung an den beitretenden Spieler
            socket.emit('joinedGame', { gameCode: gameCode, players: game.players });
            console.log(`${playerName} (${socket.id}) ist Spiel ${gameCode} beigetreten.`);

            // Alle Spieler in dieser Lobby informieren, dass ein neuer Spieler beigetreten ist
            io.to(gameCode).emit('playerJoined', {
                playerName: playerName,
                playerId: socket.id,
                players: game.players
            });
            // Alle Clients über aktualisierte öffentliche Lobbys informieren (Spieleranzahl ändert sich)
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));

        } else {
            socket.emit('joinError', 'Spiel nicht gefunden oder nicht verfügbar.');
        }
    });

    // 3. Spieler wechselt Ready-Status
    socket.on('playerReady', () => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const player = games[gameCode].players[socket.id];
            player.ready = !player.ready; // Status umschalten

            // Alle Spieler in der Lobby über den Status-Update informieren
            io.to(gameCode).emit('playerStatusUpdate', {
                playerName: player.name,
                playerId: player.id,
                readyStatus: player.ready,
                players: games[gameCode].players // Komplette aktualisierte Liste senden
            });
            console.log(`${player.name} in Spiel ${gameCode} ist jetzt ${player.ready ? 'bereit' : 'nicht bereit'}.`);
        }
    });

    // 4. Spiel starten (nur für Host)
    socket.on('startGame', () => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.hostId === socket.id) { // Nur der Host kann starten
            const playerCount = Object.keys(game.players).length;
            const allPlayersReady = Object.values(game.players).every(p => p.ready);

            if (playerCount >= 2 && allPlayersReady) { // Mind. 2 Spieler und alle bereit
                game.status = 'playing'; // Spielstatus auf 'playing' setzen
                // Sende 'gameStarted' Event an alle Spieler in dieser Lobby
                io.to(gameCode).emit('gameStarted', { gameCode: gameCode });
                console.log(`Spiel ${gameCode} gestartet.`);
                // Aktualisiere die öffentliche Liste (Spiel ist nicht mehr 'waiting')
                io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));

                // Hier könnte man den Initialzustand des Spiels generieren und senden
                // io.to(gameCode).emit('gameStateUpdate', { newGameState: { /* initialer Zustand */ } });
            } else {
                socket.emit('gameError', 'Nicht genügend Spieler (mind. 2) oder nicht alle bereit, um das Spiel zu starten.');
            }
        } else {
            socket.emit('gameError', 'Du bist nicht der Host oder das Spiel existiert nicht.');
        }
    });

    // 5. Chat-Nachricht senden
    socket.on('chatMessage', (message) => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const chatEntry = { sender: playerName, message: message };
            games[gameCode].messages.push(chatEntry); // Nachricht im Spiel speichern (optional)
            // Sende die Nachricht an alle in dieser Lobby
            io.to(gameCode).emit('newChatMessage', chatEntry);
        }
    });

    // 6. Lobby verlassen (z.B. durch Klick auf Button)
    socket.on('leaveGame', () => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            delete games[gameCode].players[socket.id]; // Spieler aus Lobby entfernen
            socket.leave(gameCode); // Socket aus dem Raum entfernen
            socket.gameCode = undefined; // Zugeordneten Spielcode vom Socket entfernen

            if (Object.keys(games[gameCode].players).length === 0) {
                // Wenn Lobby leer ist, löschen
                delete games[gameCode];
                console.log(`Spiel ${gameCode} ist leer und wurde gelöscht.`);
            } else if (games[gameCode].hostId === socket.id) {
                // Wenn der Host gegangen ist, neuen Host bestimmen (den ersten verbleibenden Spieler)
                const newHostId = Object.keys(games[gameCode].players)[0];
                games[gameCode].hostId = newHostId;
                games[gameCode].players[newHostId].isHost = true; // Markiere neuen Host
                io.to(gameCode).emit('hostChanged', { newHostId: newHostId, newHostName: games[gameCode].players[newHostId].name });
                console.log(`Neuer Host für Spiel ${gameCode}: ${games[gameCode].players[newHostId].name}`);
            }
            // Alle in der Lobby und alle Clients über öffentliche Lobbys informieren
            io.to(gameCode).emit('playerLeft', { playerName: playerName, playerId: socket.id, players: games[gameCode].players });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
            console.log(`${playerName} (${socket.id}) hat Spiel ${gameCode} verlassen.`);
        }
    });

    // 7. Spieler trennt die Verbindung (z.B. Browser geschlossen, Netzwerkproblem)
    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        const gameCode = socket.gameCode; // Hier greifen wir auf den gespeicherten Code zu

        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            delete games[gameCode].players[socket.id];
            console.log(`${playerName} (${socket.id}) hat Spiel ${gameCode} getrennt.`);

            if (Object.keys(games[gameCode].players).length === 0) {
                delete games[gameCode];
                console.log(`Spiel ${gameCode} ist leer und wurde gelöscht.`);
            } else if (games[gameCode].hostId === socket.id) {
                // Wenn der Host die Verbindung trennt, neuen Host bestimmen
                const newHostId = Object.keys(games[gameCode].players)[0];
                games[gameCode].hostId = newHostId;
                games[gameCode].players[newHostId].isHost = true; // Markiere neuen Host
                io.to(gameCode).emit('hostChanged', { newHostId: newHostId, newHostName: games[gameCode].players[newHostId].name });
                console.log(`Neuer Host für Spiel ${gameCode}: ${games[gameCode].players[newHostId].name}`);
            }
            // Informiere die verbleibenden Spieler in der Lobby und alle über öffentliche Lobbys
            io.to(gameCode).emit('playerLeft', { playerName: playerName, playerId: socket.id, players: games[gameCode].players });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
        }
    });
});

// Server starten
const PORT = process.env.PORT || 3000; // Nutzt Port 3000, wenn kein anderer Port in Umgebungsvariablen gesetzt ist
server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});