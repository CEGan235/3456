// server.js

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); // <-- NEU: CORS-Modul importieren

const app = express();
const server = http.createServer(app);

// WICHTIG: Socket.IO mit CORS-Optionen initialisieren
// 'origin: "*"' ist gut für die Entwicklung und erste Tests auf Render.
// Für die Produktion solltest du dies auf die genaue URL deiner Render-App ändern,
// z.B. "https://deine-render-app-url.onrender.com"
const io = socketIo(server, {
    cors: {
        origin: "*", // Erlaubt Verbindungen von allen Domains
        methods: ["GET", "POST"] // Erlaubte HTTP-Methoden
    }
});

const PORT = process.env.PORT || 3000; // Dynamischer Port für Render, sonst 3000

// Statische Dateien servieren (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// --- Globale Spielzustands-Variablen ---
const games = {}; // Speichert alle aktiven Spiele
let publicGames = []; // Liste der öffentlichen Spiele

// --- Quiz-Konstanten ---
const QUESTION_TIME_LIMIT = 15; // Zeitlimit pro Frage in Sekunden
const NEXT_QUESTION_DELAY = 5000; // Verzögerung zwischen Fragen in ms (5 Sekunden)
const QUIZ_QUESTIONS_COUNT = 5; // Anzahl der Fragen pro Spiel

let allQuizQuestions = []; // Hier werden alle Fragen geladen


// --- Fragen aus JSON-Datei laden ---
function loadQuizQuestions() {
    try {
        const questionsPath = path.join(__dirname, 'quizQuestions.json');
        const data = fs.readFileSync(questionsPath, 'utf8');
        allQuizQuestions = JSON.parse(data);
        console.log(`✅ ${allQuizQuestions.length} Quizfragen erfolgreich geladen.`);
    } catch (error) {
        console.error('❌ Fehler beim Laden der Quizfragen:', error);
        allQuizQuestions = []; // Sicherstellen, dass die Liste leer ist, falls ein Fehler auftritt
    }
}

// Beim Start des Servers Fragen laden
loadQuizQuestions();

// --- Hilfsfunktion zum Mischen eines Arrays (Fisher-Yates Shuffle) ---
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// --- SPIELLOGIK ---

io.on('connection', (socket) => {
    console.log(`Ein Benutzer verbunden: ${socket.id}`);

    // --- Spiel erstellen ---
    socket.on('createGame', (playerName) => {
        const gameCode = generateGameCode();
        games[gameCode] = {
            gameCode: gameCode,
            hostId: socket.id,
            players: {
                [socket.id]: { id: socket.id, name: playerName, ready: false, isHost: true, score: 0 }
            },
            state: 'lobby', // 'lobby', 'quiz', 'quizResult', 'drinkingPhase'
            currentQuestionIndex: -1,
            shuffledQuestions: [], // Die für dieses Spiel ausgewählten und gemischten Fragen
            questionTimer: null,
            playerAnswers: {} // Speichert Antworten der Spieler für die aktuelle Frage
        };
        socket.join(gameCode);
        socket.emit('gameCreated', { gameCode: gameCode, players: games[gameCode].players });
        updatePublicGamesList();
        console.log(`Spiel ${gameCode} von ${playerName} erstellt.`);
    });

    // --- Spiel beitreten ---
    socket.on('joinGame', ({ gameCode, playerName }) => {
        const game = games[gameCode];
        if (!game) {
            return socket.emit('joinError', 'Spielcode ungültig oder Spiel existiert nicht.');
        }
        if (Object.keys(game.players).length >= 8) { // Beispiel: Max. 8 Spieler
            return socket.emit('joinError', 'Das Spiel ist voll.');
        }
        if (game.state !== 'lobby') { // Man kann nur in der Lobby beitreten
            return socket.emit('joinError', 'Das Spiel hat bereits begonnen.');
        }

        game.players[socket.id] = { id: socket.id, name: playerName, ready: false, isHost: false, score: 0 };
        socket.join(gameCode);
        socket.emit('joinedGame', { gameCode: gameCode, players: game.players });
        io.to(gameCode).emit('playerJoined', { playerName: playerName, players: game.players });
        updatePublicGamesList();
        console.log(`${playerName} ist Spiel ${gameCode} beigetreten.`);
    });

    // --- Spielerstatus 'Bereit' umschalten ---
    socket.on('playerReady', () => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        // Spieler kann nur in der Lobby bereit sein
        if (game.state !== 'lobby') {
            return socket.emit('gameError', 'Du kannst deinen Status nur in der Lobby ändern.');
        }

        const player = game.players[socket.id];
        if (player) {
            player.ready = !player.ready;
            io.to(gameCode).emit('playerStatusUpdate', {
                playerId: socket.id,
                playerName: player.name,
                readyStatus: player.ready,
                players: game.players
            });
            console.log(`${player.name} in Spiel ${gameCode} ist jetzt ${player.ready ? 'bereit' : 'nicht bereit'}.`);
        }
    });

    // --- Spiel starten (nur Host) ---
    socket.on('startGame', () => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        if (game.hostId !== socket.id) {
            return socket.emit('gameError', 'Nur der Host kann das Spiel starten.');
        }

        const numPlayers = Object.keys(game.players).length;
        if (numPlayers < 2) {
            return io.to(gameCode).emit('gameError', 'Mindestens 2 Spieler werden benötigt, um das Spiel zu starten.');
        }

        const allReady = Object.values(game.players).every(p => p.ready);
        if (!allReady) {
            return io.to(gameCode).emit('gameError', 'Alle Spieler müssen bereit sein, um das Spiel zu starten.');
        }

        // Fragen auswählen und mischen
        if (allQuizQuestions.length < QUIZ_QUESTIONS_COUNT) {
             return io.to(gameCode).emit('gameError', `Nicht genug Quizfragen verfügbar. Benötigt: ${QUIZ_QUESTIONS_COUNT}, Verfügbar: ${allQuizQuestions.length}`);
        }
        game.shuffledQuestions = shuffleArray([...allQuizQuestions]).slice(0, QUIZ_QUESTIONS_COUNT);

        Object.values(game.players).forEach(p => p.score = 0); // Scores zurücksetzen
        game.currentQuestionIndex = -1; // Index für die erste Frage vorbereiten
        game.state = 'quiz'; // Spielphase auf Quiz setzen
        io.to(gameCode).emit('gamePhaseChanged', { newPhase: game.state });
        addSystemMessageToChat(gameCode, 'Das Spiel hat begonnen! Erste Frage kommt...');
        console.log(`Spiel ${gameCode} gestartet mit ${game.shuffledQuestions.length} Fragen.`);

        // Kleine Verzögerung, bevor die erste Frage gesendet wird, damit der Client die neue Phase rendern kann
        setTimeout(() => sendNextQuestion(gameCode), NEXT_QUESTION_DELAY);
    });

    // --- Nächstes Spiel starten (nur Host am Ende des Spiels) ---
    socket.on('startNextGame', () => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        if (game.hostId !== socket.id) {
            return socket.emit('gameError', 'Nur der Host kann das nächste Spiel starten.');
        }

        // Spiel auf Lobby-Status zurücksetzen
        game.state = 'lobby';
        game.currentQuestionIndex = -1;
        game.shuffledQuestions = []; // Fragen für das neue Spiel neu mischen
        game.playerAnswers = {};
        if (game.questionTimer) { // Sicherstellen, dass kein Timer mehr läuft
            clearTimeout(game.questionTimer);
            game.questionTimer = null;
        }

        // Alle Spieler auf "nicht bereit" setzen und Score zurücksetzen
        Object.values(game.players).forEach(p => {
            p.ready = false;
            p.score = 0;
        });

        // Alle Spieler über den Phasenwechsel und den aktualisierten Zustand informieren
        io.to(gameCode).emit('gamePhaseChanged', { newPhase: game.state, players: game.players }); // players hier mitgeben
        addSystemMessageToChat(gameCode, 'Ein neues Spiel wurde gestartet! Bitte mache dich bereit.');
        console.log(`Neues Spiel in ${gameCode} gestartet. Alle Spieler sind zurück in der Lobby.`);
        updatePublicGamesList(); // Lobby-Status ändert sich, also öffentliche Liste aktualisieren
    });


    // --- Antwort einreichen ---
    socket.on('submitAnswer', (data) => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        // Prüfe, ob das Spiel im Quiz-Modus ist und die Frage dem aktuellen Index entspricht
        if (game.state !== 'quiz' || game.currentQuestionIndex !== data.questionIndex) {
            console.warn(`Antwort von ${socket.id} in Spiel ${gameCode} ungültig: Falsche Phase oder falscher Index.`);
            return socket.emit('gameError', 'Antwort nicht gültig oder Frage hat sich geändert.');
        }

        // Sicherstellen, dass der Spieler nur einmal pro Frage antworten kann
        if (game.playerAnswers[socket.id] === undefined) {
            game.playerAnswers[socket.id] = data.answerIndex;
            console.log(`Spieler ${game.players[socket.id].name} in ${gameCode} hat Antwort ${data.answerIndex} abgegeben.`);
        }
    });

    // --- Verbindung trennen ---
    socket.on('disconnect', () => {
        console.log(`Ein Benutzer getrennt: ${socket.id}`);
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (gameCode) {
            const game = games[gameCode];
            const playerName = game.players[socket.id] ? game.players[socket.id].name : 'Unbekannter Spieler';
            delete game.players[socket.id];

            if (Object.keys(game.players).length === 0) {
                // Letzter Spieler hat Spiel verlassen, Spiel löschen
                if (game.questionTimer) { // Timer löschen, falls aktiv
                    clearTimeout(game.questionTimer);
                }
                delete games[gameCode];
                console.log(`Spiel ${gameCode} gelöscht, da keine Spieler mehr übrig sind.`);
            } else {
                // Host verlassen? Neuen Host zuweisen
                if (game.hostId === socket.id) {
                    const newHostId = Object.keys(game.players)[0]; // Ersten verbleibenden Spieler zum Host machen
                    game.hostId = newHostId;
                    game.players[newHostId].isHost = true;
                    io.to(gameCode).emit('hostChanged', {
                        newHostId: newHostId,
                        newHostName: game.players[newHostId].name
                    });
                    console.log(`Host in Spiel ${gameCode} gewechselt zu ${game.players[newHostId].name}.`);
                }
                io.to(gameCode).emit('playerLeft', { playerName: playerName, players: game.players });
                addSystemMessageToChat(gameCode, `${playerName} hat das Spiel verlassen.`);
            }
            updatePublicGamesList();
        }
    });

    // --- Chat-Nachricht ---
    socket.on('sendChatMessage', (message) => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        if (!game) return;

        const player = game.players[socket.id];
        if (!player) return;

        const msg = {
            sender: player.name,
            text: message,
            timestamp: new Date().toISOString()
        };

        io.to(gameCode).emit('chatMessage', msg);
    });

    // --- Helferfunktionen ---

    // Spielcode finden anhand Player-ID
    function findGameCodeByPlayerId(playerId) {
        for (const code in games) {
            if (games[code].players[playerId]) {
                return code;
            }
        }
        return null;
    }

    // Zufälligen 6-stelligen Spielcode generieren (nur Zahlen)
    function generateGameCode() {
        let code;
        do {
            code = Math.floor(100000 + Math.random() * 900000).toString();
        } while (games[code]);
        return code;
    }

    // Nächste Frage an Spieler senden
    function sendNextQuestion(gameCode) {
        const game = games[gameCode];
        if (!game) return;

        game.currentQuestionIndex++;
        if (game.currentQuestionIndex >= game.shuffledQuestions.length) {
            // Quiz beendet
            endQuiz(gameCode);
            return;
        }

        // Frage an alle Spieler senden
        const question = game.shuffledQuestions[game.currentQuestionIndex];
        game.playerAnswers = {}; // Antworten für neue Frage zurücksetzen

        io.to(gameCode).emit('newQuestion', {
            questionIndex: game.currentQuestionIndex,
            questionText: question.question,
            options: question.options,
            timeLimit: QUESTION_TIME_LIMIT
        });

        addSystemMessageToChat(gameCode, `Frage ${game.currentQuestionIndex + 1} wird angezeigt.`);

        // Timer setzen, nach Ablauf die Antworten auswerten
        if (game.questionTimer) clearTimeout(game.questionTimer);
        game.questionTimer = setTimeout(() => {
            evaluateAnswers(gameCode);
        }, QUESTION_TIME_LIMIT * 1000);
    }

    // Antworten auswerten
    function evaluateAnswers(gameCode) {
        const game = games[gameCode];
        if (!game) return;

        const currentQuestion = game.shuffledQuestions[game.currentQuestionIndex];
        if (!currentQuestion) return;

        // Bewertung: Punkte für richtige Antworten vergeben
        Object.values(game.players).forEach(player => {
            const answer = game.playerAnswers[player.id];
            if (answer === currentQuestion.correctAnswerIndex) {
                player.score++;
            }
        });

        // Ergebnis an alle Spieler senden
        io.to(gameCode).emit('questionResult', {
            questionIndex: game.currentQuestionIndex,
            correctAnswerIndex: currentQuestion.correctAnswerIndex,
            playerAnswers: game.playerAnswers,
            playersScores: Object.fromEntries(Object.values(game.players).map(p => [p.id, p.score]))
        });

        addSystemMessageToChat(gameCode, `Frage ${game.currentQuestionIndex + 1} ausgewertet.`);

        // Nächste Frage nach Delay
        if (game.questionTimer) clearTimeout(game.questionTimer);
        game.questionTimer = setTimeout(() => sendNextQuestion(gameCode), NEXT_QUESTION_DELAY);
    }

    // Quiz beenden
    function endQuiz(gameCode) {
        const game = games[gameCode];
        if (!game) {
             console.error(`Spiel ${gameCode} existiert nicht mehr bei endQuiz.`);
             return;
        }

        console.log(`Quiz beendet für Spiel ${gameCode}. Berechne Schlücke.`);

        const sipsToDistribute = {};
        Object.values(game.players).forEach(p => {
            // Jeder Spieler trinkt die Anzahl der Fragen, die er falsch beantwortet hat.
            const wrongAnswers = QUIZ_QUESTIONS_COUNT - p.score;
            sipsToDistribute[p.id] = wrongAnswers > 0 ? wrongAnswers : 0; // Mindestens 0 Schlücke
        });

        game.state = 'drinkingPhase';
        io.to(gameCode).emit('gamePhaseChanged', { newPhase: game.state });

        // Sende die Schlucke individuell an jeden Spieler
        Object.values(game.players).forEach(player => {
            const mySips = sipsToDistribute[player.id] || 0;
            io.to(player.id).emit('drinkingInstruction', {
                mySips: mySips,
                finalScores: Object.fromEntries(Object.values(game.players).map(p => [p.id, p.score])),
                players: Object.fromEntries(Object.values(game.players).map(p => [p.id, { name: p.name }]))
            });
        });

        addSystemMessageToChat(gameCode, 'Das Quiz ist beendet! Die Trinkrunde beginnt.');
        console.log(`Trinkphase für Spiel ${gameCode} gestartet.`);
    }

    // Systemnachricht in Chat senden
    function addSystemMessageToChat(gameCode, message) {
        io.to(gameCode).emit('chatMessage', {
            sender: 'System',
            text: message,
            timestamp: new Date().toISOString()
        });
    }

    // Öffentliche Spielerliste aktualisieren
    function updatePublicGamesList() {
        publicGames = Object.values(games)
            .filter(g => g.state === 'lobby')
            .map(g => ({
                gameCode: g.gameCode,
                playerCount: Object.keys(g.players).length,
                hostName: g.players[g.hostId]?.name || "Unbekannt"
            }));
        io.emit('publicGamesUpdate', publicGames);
    }
});


// --- Server starten ---
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
