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
    socket.on('chatMessage', (message) => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (gameCode) {
            const player = games[gameCode].players[socket.id];
            // Sende die Nachricht nur, wenn der Spieler existiert
            if (player) {
                io.to(gameCode).emit('newChatMessage', { sender: player.name, message: message });
            }
        }
    });

    // --- Öffentliche Spiele anfragen ---
    socket.on('requestPublicGames', () => {
        socket.emit('updatePublicGames', publicGames);
    });

    // --- Hilfsfunktionen für den Server ---
    function findGameCodeByPlayerId(playerId) {
        for (const code in games) {
            if (games[code].players && games[code].players[playerId]) { // Zusätzliche Prüfung für 'players'
                return code;
            }
        }
        return null;
    }

    function generateGameCode() {
        let code;
        do {
            code = Math.random().toString(36).substring(2, 6).toUpperCase();
        } while (games[code]);
        return code;
    }

    function addSystemMessageToChat(gameCode, message) {
        io.to(gameCode).emit('newChatMessage', { sender: 'System', message: message });
    }

    function updatePublicGamesList() {
        // Filtert Spiele heraus, die nur noch 0 oder 1 Spieler haben und nicht im Lobby-Status sind
        publicGames = Object.values(games)
            .filter(game => game.state === 'lobby' && Object.keys(game.players).length > 0)
            .map(game => ({
                id: game.gameCode,
                hostName: game.players[game.hostId] ? game.players[game.hostId].name : 'Unbekannt',
                players: game.players
            }));
        io.emit('updatePublicGames', publicGames); // Alle Clients über öffentliche Spiele informieren
    }

    // --- Quiz-Steuerungsfunktionen ---
    function sendNextQuestion(gameCode) {
        const game = games[gameCode];
        if (!game) {
            console.error(`Spiel ${gameCode} existiert nicht mehr.`);
            return;
        }
        if (game.shuffledQuestions.length === 0) {
            console.error(`Keine Fragen für Spiel ${gameCode} geladen oder ausgewählt.`);
            endQuiz(gameCode); // Spiel beenden, wenn keine Fragen da sind
            return;
        }

        game.currentQuestionIndex++;
        if (game.currentQuestionIndex >= game.shuffledQuestions.length) {
            // Alle Fragen wurden gestellt, gehe zur Ergebnisphase
            console.log(`Alle Fragen für Spiel ${gameCode} gestellt. Berechne Endresultate.`);
            endQuiz(gameCode);
            return;
        }

        const questionData = game.shuffledQuestions[game.currentQuestionIndex];
        game.playerAnswers = {}; // Antworten für die neue Frage zurücksetzen

        io.to(gameCode).emit('newQuestion', {
            question: questionData.question,
            options: questionData.options,
            questionIndex: game.currentQuestionIndex, // Zur Validierung der Antwort
            timeLimit: QUESTION_TIME_LIMIT
        });
        console.log(`Frage ${game.currentQuestionIndex + 1} von ${QUIZ_QUESTIONS_COUNT} für Spiel ${gameCode} gesendet.`);
        addSystemMessageToChat(gameCode, `Frage ${game.currentQuestionIndex + 1} von ${QUIZ_QUESTIONS_COUNT} wurde gestellt!`);

        // Starte den Timer für die Antwortphase
        if (game.questionTimer) { // Alten Timer löschen, falls vorhanden
            clearTimeout(game.questionTimer);
        }
        game.questionTimer = setTimeout(() => {
            evaluateAnswers(gameCode);
        }, QUESTION_TIME_LIMIT * 1000);
    }

    // --- Korrigierte evaluateAnswers Funktion ---
    function evaluateAnswers(gameCode) {
        const game = games[gameCode];
        if (!game) {
            console.error(`Spiel ${gameCode} existiert nicht mehr bei evaluateAnswers.`);
            return;
        }

        if (game.questionTimer) { // Timer stoppen
            clearTimeout(game.questionTimer);
            game.questionTimer = null;
        }

        const currentQuestion = game.shuffledQuestions[game.currentQuestionIndex];
        // Sicherstellen, dass die Frage existiert und korrekt indiziert ist
        if (!currentQuestion || currentQuestion.correct === undefined) {
             console.error(`Fehler: Aktuelle Frage in Spiel ${gameCode} ist ungültig oder hat keine korrekte Antwort.`);
             // Hier könnte man auch zur nächsten Frage springen oder das Spiel beenden
             sendNextPhase(gameCode); // Versuche, zur nächsten Phase zu springen
             return;
        }

        const correctOptionIndex = currentQuestion.correct;
        const correctAnswerText = currentQuestion.options[correctOptionIndex];

        // Berechne und aktualisiere die Scores für alle Spieler
        Object.values(game.players).forEach(player => {
            const playerAnswer = game.playerAnswers[player.id];
            let pointsThisRound = 0;

            // Überprüfe, ob der Spieler geantwortet hat und ob die Antwort korrekt ist
            if (playerAnswer !== undefined && playerAnswer === correctOptionIndex) {
                pointsThisRound = 1; // 1 Punkt für richtige Antwort
                player.score += pointsThisRound;
                console.log(`${player.name} (ID: ${player.id}) in Spiel ${gameCode} hat richtig geantwortet! Aktueller Score: ${player.score}`);
            } else {
                console.log(`${player.name} (ID: ${player.id}) in Spiel ${gameCode} hat falsch geantwortet oder nicht geantwortet. Score bleibt: ${player.score}`);
            }
        });

        // Sende die Ergebnisse an JEDEN Spieler INDIVIDUELL
        Object.values(game.players).forEach(player => {
            io.to(player.id).emit('questionResult', {
                correctAnswerText: correctAnswerText,
                myScore: player.score, // Dies ist der persönliche Score des empfangenden Spielers
                currentScores: Object.fromEntries(Object.values(game.players).map(p => [p.id, p.score])), // Scores aller Spieler für die Rangliste
                players: Object.fromEntries(Object.values(game.players).map(p => [p.id, { name: p.name }])), // Namen für Anzeige auf Client
                isLastQuestion: (game.currentQuestionIndex + 1) >= game.shuffledQuestions.length,
                nextQuestionDelay: NEXT_QUESTION_DELAY
            });
        });

        console.log(`Ergebnisse für Frage ${game.currentQuestionIndex + 1} in Spiel ${gameCode} gesendet.`);
        addSystemMessageToChat(gameCode, `Die richtige Antwort war: "${correctAnswerText}".`);

        // Verzögerter Übergang zur nächsten Phase
        sendNextPhase(gameCode);
    }

    function sendNextPhase(gameCode) {
        const game = games[gameCode];
        if (!game) return;

        // Wenn es noch Fragen gibt, die nächste Frage nach einer Verzögerung senden
        if (game.currentQuestionIndex + 1 < game.shuffledQuestions.length) {
            game.state = 'quizResult'; // Temporäre Phase für Ergebnisansicht
            io.to(gameCode).emit('gamePhaseChanged', { newPhase: game.state });
            setTimeout(() => sendNextQuestion(gameCode), NEXT_QUESTION_DELAY);
        } else {
            // Letzte Frage war das, gehe zur Endphase über
            setTimeout(() => endQuiz(gameCode), NEXT_QUESTION_DELAY);
        }
    }


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
        io.to(gameCode).emit('quizFinalResults', {
            sipsToDistribute: sipsToDistribute,
            players: Object.fromEntries(Object.values(game.players).map(p => [p.id, { name: p.name }]))
        });
        addSystemMessageToChat(gameCode, 'Das Quiz ist beendet! Zeit für die Schlucke!');
    }
});

server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});