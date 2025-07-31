const express = require('express');
const http = require('http');
const socketIo = require('socket.io');


const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Erlaube Anfragen von jeder Domain (für Entwicklung). Für Produktion die genaue Frontend-URL angeben!
        methods: ["GET", "POST"]
    }
});

// Statische Dateien aus dem 'public'-Ordner servieren
app.use(express.static('public'));

// --- Lobby- und Spiel-Verwaltung auf dem Server ---
const games = {}; // Speichert alle aktiven Spiele/Lobbys

// NEU: URL zur Quiz-Fragen-JSON-Datei in deinem Git-Repo
// ERSETZE DIES MIT DEINER EIGENEN RAW-CONTENT-URL!
const QUIZ_QUESTIONS_URL = 'https://raw.githubusercontent.com/CEGan235/3456/refs/heads/main/quizQuestions.json';
let quizQuestions = []; // Wird beim Serverstart geladen

const QUIZ_QUESTION_TIME_LIMIT = 15; // Sekunden für jede Frage
const QUIZ_RESULT_DISPLAY_TIME = 5000; // Millisekunden für Ergebnis-Anzeige


// NEU: Funktion zum Laden der Quiz-Fragen von der URL
async function loadQuizQuestions() {
    try {
        console.log(`Lade Quizfragen von: ${QUIZ_QUESTIONS_URL}`);
        const response = await fetch(QUIZ_QUESTIONS_URL);
        if (!response.ok) {
            throw new Error(`HTTP-Fehler! Status: ${response.status}`);
        }
        const data = await response.json();
        // Stelle sicher, dass die geladenen Daten ein Array von Fragen sind
        if (Array.isArray(data) && data.every(q => q.question && Array.isArray(q.options) && typeof q.correct === 'number')) {
            quizQuestions = data;
            console.log(`Erfolgreich ${quizQuestions.length} Quizfragen geladen.`);
        } else {
            console.error("Geladene Quizfragen haben unerwartetes Format:", data);
            // Fallback: Wenn Fragen nicht geladen werden können, leeres Array lassen
            quizQuestions = [];
        }
    } catch (error) {
        console.error("Fehler beim Laden der Quizfragen:", error.message);
        // Fallback: Wenn Laden fehlschlägt, leeres Array lassen oder Standardfragen verwenden
        quizQuestions = [
            { id: 0, question: "Fallback-Frage: Konnte die Fragen nicht laden. Was ist 1+1?", options: ["1", "2", "3"], correct: 1 }
        ];
    }
}


// Hilfsfunktion zum Generieren eines zufälligen, eindeutigen Spiel-Codes
function generateGameCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 7).toUpperCase();
    } while (games[code]);
    return code;
}

// Funktion zum Senden der nächsten Quizfrage
function sendNextQuizQuestion(gameCode) {
    const game = games[gameCode];
    if (!game) return;

    // Stelle sicher, dass Fragen geladen sind
    if (quizQuestions.length === 0) {
        console.error("Keine Quizfragen geladen! Kann Quiz nicht starten.");
        io.to(gameCode).emit('gameError', 'Quizfragen konnten nicht geladen werden.');
        endQuiz(gameCode); // Beende das Quiz, da keine Fragen da sind
        return;
    }

    game.quiz.currentQuestionIndex++;
    if (game.quiz.currentQuestionIndex < quizQuestions.length) { // Nutze jetzt 'quizQuestions' global
        const questionData = quizQuestions[game.quiz.currentQuestionIndex];
        game.quiz.currentQuestion = questionData;
        game.quiz.playerAnswers = {}; // Antworten für neue Frage zurücksetzen
        game.quiz.answeredPlayers = new Set(); // Spieler, die geantwortet haben

        io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'quiz' });
        io.to(gameCode).emit('newQuestion', {
            questionIndex: questionData.id,
            question: questionData.question,
            options: questionData.options,
            timeLimit: QUIZ_QUESTION_TIME_LIMIT
        });

        // Setze einen Timer für die Frage
        game.quiz.questionTimer = setTimeout(() => {
            evaluateQuizAnswers(gameCode, true); // Auswertung nach Zeitablauf
        }, QUIZ_QUESTION_TIME_LIMIT * 1000);

        console.log(`Spiel ${gameCode}: Frage ${questionData.id} gesendet.`);
    } else {
        // Alle Fragen beantwortet, Quiz beenden
        endQuiz(gameCode);
    }
}

// Funktion zum Auswerten der Antworten (bleibt gleich)
function evaluateQuizAnswers(gameCode, timeUp = false) {
    const game = games[gameCode];
    if (!game || game.quiz.currentQuestionIndex === -1) return;

    if (game.quiz.questionTimer) {
        clearTimeout(game.quiz.questionTimer);
        game.quiz.questionTimer = null;
    }

    const currentQuestion = game.quiz.currentQuestion;
    const correctOptionIndex = currentQuestion.correct;
    const correctAnswerText = currentQuestion.options[correctOptionIndex];

    const currentScores = {};
    Object.keys(game.players).forEach(pId => {
        const playerAnswer = game.quiz.playerAnswers[pId];
        if (playerAnswer === correctOptionIndex) {
            game.quiz.scores[pId]++;
        }
        currentScores[pId] = game.quiz.scores[pId];
    });

    io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'quizResult' });
    io.to(gameCode).emit('questionResult', {
        questionIndex: currentQuestion.id,
        correctAnswerText: correctAnswerText,
        currentScores: currentScores,
        players: game.players,
        isLastQuestion: (game.quiz.currentQuestionIndex === quizQuestions.length - 1), // Nutze 'quizQuestions.length'
        nextQuestionDelay: QUIZ_RESULT_DISPLAY_TIME
    });

    console.log(`Spiel ${gameCode}: Frage ${currentQuestion.id} ausgewertet.`);

    if (game.quiz.currentQuestionIndex === quizQuestions.length - 1) { // Nutze 'quizQuestions.length'
        setTimeout(() => endQuiz(gameCode), QUIZ_RESULT_DISPLAY_TIME);
    } else {
        setTimeout(() => sendNextQuizQuestion(gameCode), QUIZ_RESULT_DISPLAY_TIME);
    }
}

// Funktion zum Beenden des Quiz und Verteilen der Schlücke (bleibt gleich, außer questions.length)
function endQuiz(gameCode) {
    const game = games[gameCode];
    if (!game) return;

    game.currentPhase = 'drinkingPhase';
    io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'drinkingPhase' });

    const finalScores = game.quiz.scores;
    const sipsToDistribute = {};

    const playerScoresArray = Object.values(finalScores);
    if (playerScoresArray.length === 0) {
        io.to(gameCode).emit('quizFinalResults', { sipsToDistribute: {}, players: game.players });
        return;
    }
    const minScore = Math.min(...playerScoresArray);
    const maxScore = Math.max(...playerScoresArray);

    Object.keys(game.players).forEach(pId => {
        const score = finalScores[pId];
        let sips = 0;
        if (playerScoresArray.length > 1) {
             if (score === minScore) {
                sips = 3;
            } else if (score < maxScore) {
                sips = 2;
            } else {
                sips = 1;
            }
            if (minScore === maxScore) {
                sips = 1;
            }
        } else {
            sips = 0;
        }
        sipsToDistribute[pId] = sips;
    });

    io.to(gameCode).emit('quizFinalResults', { sipsToDistribute: sipsToDistribute, players: game.players });
    console.log(`Spiel ${gameCode}: Quiz beendet. Schlücke:`, sipsToDistribute);
}


io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    socket.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    
    socket.on('requestPublicGames', () => {
        socket.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    });

    socket.on('createGame', (playerName) => {
        const gameCode = generateGameCode();
        games[gameCode] = {
            id: gameCode,
            hostId: socket.id,
            players: {
                [socket.id]: { id: socket.id, name: playerName, ready: false, isHost: true }
            },
            status: 'waiting',
            currentPhase: 'waitingForStart',
            currentGameModule: null,
            messages: [],
            quiz: {
                currentQuestionIndex: -1,
                questions: [], // Wichtig: Dieses Array wird leer initialisiert und nicht mehr die lokale quizQuestions kopiert
                playerAnswers: {},
                answeredPlayers: new Set(),
                scores: {},
                currentQuestion: null,
                questionTimer: null
            }
        };
        Object.keys(games[gameCode].players).forEach(pId => games[gameCode].quiz.scores[pId] = 0);

        socket.join(gameCode);
        socket.gameCode = gameCode;

        socket.emit('gameCreated', { gameCode: gameCode, players: games[gameCode].players });
        console.log(`${playerName} (${socket.id}) hat Spiel ${gameCode} erstellt.`);

        io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    });

    socket.on('joinGame', (data) => {
        const { gameCode, playerName } = data;
        const game = games[gameCode];

        if (game && game.status === 'waiting' && game.currentPhase === 'waitingForStart') {
            if (Object.keys(game.players).length >= 4) {
                socket.emit('joinError', 'Spiel ist voll.');
                return;
            }
            if (game.players[socket.id]) {
                socket.emit('joinError', 'Du bist diesem Spiel bereits beigetreten.');
                return;
            }

            game.players[socket.id] = { id: socket.id, name: playerName, ready: false, isHost: false };
            game.quiz.scores[socket.id] = 0;
            socket.join(gameCode);
            socket.gameCode = gameCode;

            socket.emit('joinedGame', { gameCode: gameCode, players: game.players });
            console.log(`${playerName} (${socket.id}) ist Spiel ${gameCode} beigetreten.`);

            io.to(gameCode).emit('playerJoined', {
                playerName: playerName,
                playerId: socket.id,
                players: game.players
            });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));

        } else {
            socket.emit('joinError', 'Spiel nicht gefunden oder nicht verfügbar (evtl. schon gestartet).');
        }
    });

    socket.on('playerReady', () => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const player = games[gameCode].players[socket.id];
            player.ready = !player.ready;

            io.to(gameCode).emit('playerStatusUpdate', {
                playerName: player.name,
                playerId: player.id,
                readyStatus: player.ready,
                players: games[gameCode].players
            });
            console.log(`${player.name} in Spiel ${gameCode} ist jetzt ${player.ready ? 'bereit' : 'nicht bereit'}.`);
        }
    });

    socket.on('startGame', () => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.hostId === socket.id) {
            const playerCount = Object.keys(game.players).length;
            const allPlayersReady = Object.values(game.players).every(p => p.ready);

            if (playerCount >= 2 && allPlayersReady) {
                // Wichtig: Die Fragen werden einmalig beim Serverstart geladen.
                // Wenn du möchtest, dass sie bei JEDEM Spielstart neu geladen werden (für aktuelle Änderungen im Repo),
                // müsstest du loadQuizQuestions() hier aufrufen.
                // Aber das wäre weniger effizient. Einmal beim Serverstart ist in der Regel OK.
                if (quizQuestions.length === 0) {
                    socket.emit('gameError', 'Quizfragen konnten nicht geladen werden. Bitte Server neu starten.');
                    return;
                }

                game.status = 'playing';
                game.currentPhase = 'quiz';
                game.currentGameModule = 'quiz';
                io.to(gameCode).emit('gameStarted', { gameCode: gameCode, currentPhase: game.currentPhase });
                io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
                console.log(`Spiel ${gameCode} gestartet. Startet Quiz.`);
                
                game.quiz.currentQuestionIndex = -1;
                Object.keys(game.players).forEach(pId => game.quiz.scores[pId] = 0);
                sendNextQuizQuestion(gameCode);

            } else {
                socket.emit('gameError', 'Nicht genügend Spieler (mind. 2) oder nicht alle bereit, um das Spiel zu starten.');
            }
        } else {
            socket.emit('gameError', 'Du bist nicht der Host oder das Spiel existiert nicht.');
        }
    });

    socket.on('submitAnswer', (data) => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.currentPhase === 'quiz' && game.quiz.currentQuestion && !game.quiz.answeredPlayers.has(socket.id)) {
            const { questionIndex, answerIndex } = data;
            if (questionIndex === game.quiz.currentQuestion.id) {
                game.quiz.playerAnswers[socket.id] = answerIndex;
                game.quiz.answeredPlayers.add(socket.id);
                console.log(`${game.players[socket.id].name} hat geantwortet für Frage ${questionIndex}.`);

                if (game.quiz.answeredPlayers.size === Object.keys(game.players).length) {
                    clearTimeout(game.quiz.questionTimer);
                    evaluateQuizAnswers(gameCode, false);
                }
            } else {
                socket.emit('gameError', 'Antwort passt nicht zur aktuellen Frage.');
            }
        } else {
            socket.emit('gameError', 'Kann keine Antwort entgegennehmen. Nicht im Quiz oder schon geantwortet.');
        }
    });

    socket.on('startNextGame', () => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.hostId === socket.id && game.currentPhase === 'drinkingPhase') {
            game.status = 'waiting';
            game.currentPhase = 'waitingForStart';
            game.currentGameModule = null;
            Object.keys(game.players).forEach(pId => game.players[pId].ready = false);
            Object.keys(game.players).forEach(pId => game.quiz.scores[pId] = 0);

            io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'waitingForStart', players: game.players });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
            console.log(`Spiel ${gameCode}: Zurück zur Lobby, bereit für das nächste Spiel.`);
        }
    });

    socket.on('chatMessage', (message) => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const chatEntry = { sender: playerName, message: message };
            games[gameCode].messages.push(chatEntry);
            io.to(gameCode).emit('newChatMessage', chatEntry);
        }
    });

    socket.on('leaveGame', () => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const playerId = socket.id;

            if (games[gameCode].quiz.questionTimer && games[gameCode].currentPhase === 'quiz') {
                 clearTimeout(games[gameCode].quiz.questionTimer);
                 games[gameCode].quiz.questionTimer = null;
                 console.log(`Timer für ${gameCode} unterbrochen, da Spieler ${playerName} verlassen hat.`);
            }

            delete games[gameCode].players[playerId];
            delete games[gameCode].quiz.scores[playerId];
            socket.leave(gameCode);
            socket.gameCode = undefined;

            if (Object.keys(games[gameCode].players).length === 0) {
                delete games[gameCode];
                console.log(`Spiel ${gameCode} ist leer und wurde gelöscht.`);
            } else if (games[gameCode].hostId === playerId) {
                const newHostId = Object.keys(games[gameCode].players)[0];
                games[gameCode].hostId = newHostId;
                games[gameCode].players[newHostId].isHost = true;
                io.to(gameCode).emit('hostChanged', { newHostId: newHostId, newHostName: games[gameCode].players[newHostId].name });
                console.log(`Neuer Host für Spiel ${gameCode}: ${games[gameCode].players[newHostId].name}`);
            }
            io.to(gameCode).emit('playerLeft', { playerName: playerName, playerId: playerId, players: games[gameCode].players });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
            console.log(`${playerName} (${playerId}) hat Spiel ${gameCode} verlassen.`);
            
            if (games[gameCode] && games[gameCode].currentPhase === 'quiz' && games[gameCode].quiz.answeredPlayers.size === Object.keys(games[gameCode].players).length) {
                evaluateQuizAnswers(gameCode, false);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        const gameCode = socket.gameCode;

        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const playerId = socket.id;

            if (games[gameCode].quiz.questionTimer && games[gameCode].currentPhase === 'quiz') {
                 clearTimeout(games[gameCode].quiz.questionTimer);
                 games[gameCode].quiz.questionTimer = null;
                 console.log(`Timer für ${gameCode} unterbrochen, da Spieler ${playerName} getrennt hat.`);
            }

            delete games[gameCode].players[playerId];
            delete games[gameCode].quiz.scores[playerId];

            if (Object.keys(games[gameCode].players).length === 0) {
                delete games[gameCode];
                console.log(`Spiel ${gameCode} ist leer und wurde gelöscht.`);
            } else if (games[gameCode].hostId === playerId) {
                const newHostId = Object.keys(games[gameCode].players)[0];
                games[gameCode].hostId = newHostId;
                games[gameCode].players[newHostId].isHost = true;
                io.to(gameCode).emit('hostChanged', { newHostId: newHostId, newHostName: games[gameCode].players[newHostId].name });
                console.log(`Neuer Host für Spiel ${gameCode}: ${games[gameCode].players[newHostId].name}`);
            }
            io.to(gameCode).emit('playerLeft', { playerName: playerName, playerId: playerId, players: games[gameCode].players });
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
            console.log(`${playerName} (${playerId}) hat Spiel ${gameCode} getrennt.`);

            if (games[gameCode] && games[gameCode].currentPhase === 'quiz' && games[gameCode].quiz.answeredPlayers.size === Object.keys(games[gameCode].players).length) {
                evaluateQuizAnswers(gameCode, false);
            }
        }
    });
});

// Server starten
const PORT = process.env.PORT || 3000;
server.listen (PORT, async () => { // NEU: async beim listen-Callback
    console.log(`Server läuft auf http://localhost:${PORT}`);
    await loadQuizQuestions(); // NEU: Lade Fragen beim Serverstart
});