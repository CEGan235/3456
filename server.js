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

// Quiz-Fragen (könnten auch aus einer externen Datei geladen werden)
const quizQuestions = [
    { id: 0, question: "Wer hat die Mona Lisa gemalt?", options: ["Van Gogh", "Leonardo da Vinci", "Pablo Picasso"], correct: 1 },
    { id: 1, question: "Was ist die Hauptstadt Frankreichs?", options: ["Berlin", "Madrid", "Paris"], correct: 2 },
    { id: 2, question: "Wie viele Planeten hat unser Sonnensystem?", options: ["7", "8", "9"], correct: 1 }, // Pluto ist kein Planet mehr
    { id: 3, question: "Welches Tier ist das schnellste Landtier?", options: ["Löwe", "Gepard", "Antilope"], correct: 1 },
    { id: 4, question: "Was ist die chemische Formel für Wasser?", options: ["CO2", "O2", "H2O"], correct: 2 }
];

const QUIZ_QUESTION_TIME_LIMIT = 15; // Sekunden für jede Frage
const QUIZ_RESULT_DISPLAY_TIME = 5000; // Millisekunden für Ergebnis-Anzeige

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

    game.quiz.currentQuestionIndex++;
    if (game.quiz.currentQuestionIndex < game.quiz.questions.length) {
        const questionData = game.quiz.questions[game.quiz.currentQuestionIndex];
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

// Funktion zum Auswerten der Antworten
function evaluateQuizAnswers(gameCode, timeUp = false) {
    const game = games[gameCode];
    if (!game || game.quiz.currentQuestionIndex === -1) return;

    // Timer löschen, falls noch aktiv
    if (game.quiz.questionTimer) {
        clearTimeout(game.quiz.questionTimer);
        game.quiz.questionTimer = null;
    }

    const currentQuestion = game.quiz.currentQuestion;
    const correctOptionIndex = currentQuestion.correct;
    const correctAnswerText = currentQuestion.options[correctOptionIndex];

    const currentScores = {}; // Scores dieser Runde zur Anzeige
    Object.keys(game.players).forEach(pId => {
        const playerAnswer = game.quiz.playerAnswers[pId];
        let pointsEarned = 0;
        if (playerAnswer === correctOptionIndex) {
            game.quiz.scores[pId]++; // Globale Score für Spieler erhöhen
            pointsEarned = 1; // Für lokale Anzeige
        }
        currentScores[pId] = game.quiz.scores[pId]; // Gesamtscore
    });

    // Sende Ergebnisse an alle Spieler
    io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'quizResult' });
    io.to(gameCode).emit('questionResult', {
        questionIndex: currentQuestion.id,
        correctAnswerText: correctAnswerText,
        currentScores: currentScores,
        players: game.players, // Spielerinfos zum Anzeigen der Namen
        isLastQuestion: (game.quiz.currentQuestionIndex === game.quiz.questions.length - 1),
        nextQuestionDelay: QUIZ_RESULT_DISPLAY_TIME
    });

    console.log(`Spiel ${gameCode}: Frage ${currentQuestion.id} ausgewertet.`);

    // Wenn es die letzte Frage war, sofort Ende-Phase einleiten
    if (game.quiz.currentQuestionIndex === game.quiz.questions.length - 1) {
        setTimeout(() => endQuiz(gameCode), QUIZ_RESULT_DISPLAY_TIME);
    } else {
        // Warte und sende die nächste Frage
        setTimeout(() => sendNextQuizQuestion(gameCode), QUIZ_RESULT_DISPLAY_TIME);
    }
}

// Funktion zum Beenden des Quiz und Verteilen der Schlücke
function endQuiz(gameCode) {
    const game = games[gameCode];
    if (!game) return;

    game.currentPhase = 'drinkingPhase';
    io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'drinkingPhase' });

    const finalScores = game.quiz.scores;
    const sipsToDistribute = {};

    // Finde den niedrigsten Score
    const playerScoresArray = Object.values(finalScores);
    if (playerScoresArray.length === 0) { // Kein Spieler, nichts zu tun
        io.to(gameCode).emit('quizFinalResults', { sipsToDistribute: {}, players: game.players });
        return;
    }
    const minScore = Math.min(...playerScoresArray);
    const maxScore = Math.max(...playerScoresArray);

    // Verteilung der Schlücke: Wer am wenigsten weiß, trinkt am meisten.
    // Beispiel-Logik:
    // Der Spieler mit dem geringsten Score bekommt am meisten (z.B. 3 Schlücke)
    // Spieler mit mittlerem Score bekommen weniger (z.B. 2 Schlücke)
    // Spieler mit hohem Score bekommen am wenigsten (z.B. 1 Schluck)
    // Kann auch proportional zum Abstand vom maxScore berechnet werden
    Object.keys(game.players).forEach(pId => {
        const score = finalScores[pId];
        let sips = 0;
        if (playerScoresArray.length > 1) { // Nur verteilen, wenn es mehr als einen Spieler gibt
             if (score === minScore) {
                sips = 3; // Niedrigster Score, am meisten trinken
            } else if (score < maxScore) {
                sips = 2; // Mittlerer Score
            } else {
                sips = 1; // Höchster Score, am wenigsten trinken
            }
            // Wenn alle den gleichen Score haben, bekommt jeder 1 Schluck
            if (minScore === maxScore) {
                sips = 1;
            }
        } else {
            sips = 0; // Einzelner Spieler trinkt nicht alleine
        }
        sipsToDistribute[pId] = sips;
    });

    io.to(gameCode).emit('quizFinalResults', { sipsToDistribute: sipsToDistribute, players: game.players });
    console.log(`Spiel ${gameCode}: Quiz beendet. Schlücke:`, sipsToDistribute);

    // Optional: Setze einen Timer, um nach den Ergebnissen zurück zur Lobby zu gehen
    // oder warte auf Host-Aktion für nächstes Spiel
    // setTimeout(() => {
    //     game.status = 'waiting';
    //     game.currentPhase = 'waitingForStart';
    //     io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'waitingForStart', players: game.players });
    //     io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    // }, 10000); // 10 Sekunden Anzeige der Ergebnisse
}


io.on('connection', (socket) => {
    console.log(`Neuer Spieler verbunden: ${socket.id}`);

    // Bei neuer Verbindung: Liste der öffentlichen Spiele an Client senden
    socket.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    
    // --- Events vom Client behandeln ---

    // 0. Öffentliche Spiele anfragen (wenn der Client neu lädt oder den Startbildschirm anzeigt)
    socket.on('requestPublicGames', () => {
        socket.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    });

    // 1. Spiel erstellen
    socket.on('createGame', (playerName) => {
        const gameCode = generateGameCode();
        games[gameCode] = {
            id: gameCode,
            hostId: socket.id,
            players: {
                [socket.id]: { id: socket.id, name: playerName, ready: false, isHost: true }
            },
            status: 'waiting',
            currentPhase: 'waitingForStart', // Startet in Lobby-Phase
            currentGameModule: null,
            messages: [],
            quiz: { // Quiz-spezifische Daten initialisieren
                currentQuestionIndex: -1,
                questions: [...quizQuestions], // Kopie der Fragen, damit sie nicht global verändert werden
                playerAnswers: {}, // Antworten pro Frage
                answeredPlayers: new Set(), // Welche Spieler haben in der aktuellen Runde geantwortet
                scores: {}, // Globale Scores pro Spieler im Quiz
                currentQuestion: null,
                questionTimer: null
            }
        };
        // Initialisiere Scores für alle Spieler
        Object.keys(games[gameCode].players).forEach(pId => games[gameCode].quiz.scores[pId] = 0);

        socket.join(gameCode);
        socket.gameCode = gameCode;

        socket.emit('gameCreated', { gameCode: gameCode, players: games[gameCode].players });
        console.log(`${playerName} (${socket.id}) hat Spiel ${gameCode} erstellt.`);

        io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
    });

    // 2. Spiel beitreten
    socket.on('joinGame', (data) => {
        const { gameCode, playerName } = data;
        const game = games[gameCode];

        if (game && game.status === 'waiting' && game.currentPhase === 'waitingForStart') { // Nur beitreten, wenn noch in Lobby-Phase
            if (Object.keys(game.players).length >= 4) {
                socket.emit('joinError', 'Spiel ist voll.');
                return;
            }
            if (game.players[socket.id]) {
                socket.emit('joinError', 'Du bist diesem Spiel bereits beigetreten.');
                return;
            }

            game.players[socket.id] = { id: socket.id, name: playerName, ready: false, isHost: false };
            game.quiz.scores[socket.id] = 0; // Score für neuen Spieler initialisieren
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

    // 3. Spieler wechselt Ready-Status
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

    // 4. Spiel starten (nur für Host) - Startet jetzt das Quiz
    socket.on('startGame', () => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.hostId === socket.id) {
            const playerCount = Object.keys(game.players).length;
            const allPlayersReady = Object.values(game.players).every(p => p.ready);

            if (playerCount >= 2 && allPlayersReady) {
                game.status = 'playing';
                game.currentPhase = 'quiz';
                game.currentGameModule = 'quiz';
                io.to(gameCode).emit('gameStarted', { gameCode: gameCode, currentPhase: game.currentPhase });
                io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
                console.log(`Spiel ${gameCode} gestartet. Startet Quiz.`);
                
                // Beginne das Quiz
                game.quiz.currentQuestionIndex = -1; // Index zurücksetzen
                Object.keys(game.players).forEach(pId => game.quiz.scores[pId] = 0); // Scores zurücksetzen
                sendNextQuizQuestion(gameCode);

            } else {
                socket.emit('gameError', 'Nicht genügend Spieler (mind. 2) oder nicht alle bereit, um das Spiel zu starten.');
            }
        } else {
            socket.emit('gameError', 'Du bist nicht der Host oder das Spiel existiert nicht.');
        }
    });

    // NEU: Spieler gibt Quiz-Antwort ab
    socket.on('submitAnswer', (data) => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.currentPhase === 'quiz' && game.quiz.currentQuestion && !game.quiz.answeredPlayers.has(socket.id)) {
            const { questionIndex, answerIndex } = data;
            // Prüfe, ob die Antwort zur aktuellen Frage passt
            if (questionIndex === game.quiz.currentQuestion.id) {
                game.quiz.playerAnswers[socket.id] = answerIndex;
                game.quiz.answeredPlayers.add(socket.id);
                console.log(`${game.players[socket.id].name} hat geantwortet für Frage ${questionIndex}.`);

                // Wenn alle geantwortet haben, Timer sofort löschen und auswerten
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

    // NEU: Host startet das nächste Spiel (nach Quiz)
    socket.on('startNextGame', () => {
        const gameCode = socket.gameCode;
        const game = games[gameCode];

        if (game && game.hostId === socket.id && game.currentPhase === 'drinkingPhase') {
            // Reset Game Status to Lobby
            game.status = 'waiting';
            game.currentPhase = 'waitingForStart';
            game.currentGameModule = null;
            // Spieler sind nicht mehr 'bereit' für die nächste Runde
            Object.keys(game.players).forEach(pId => game.players[pId].ready = false);
            // Quiz-Scores zurücksetzen
            Object.keys(game.players).forEach(pId => game.quiz.scores[pId] = 0);

            io.to(gameCode).emit('gamePhaseChanged', { newPhase: 'waitingForStart', players: game.players }); // Wechselt zur Lobby-Ansicht
            // Sende ein updatePublicGames, da der Status sich geändert hat
            io.emit('updatePublicGames', Object.values(games).filter(g => g.status === 'waiting'));
            console.log(`Spiel ${gameCode}: Zurück zur Lobby, bereit für das nächste Spiel.`);
        }
    });


    // 5. Chat-Nachricht senden
    socket.on('chatMessage', (message) => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const chatEntry = { sender: playerName, message: message };
            games[gameCode].messages.push(chatEntry);
            io.to(gameCode).emit('newChatMessage', chatEntry);
        }
    });

    // 6. Lobby verlassen (z.B. durch Klick auf Button)
    socket.on('leaveGame', () => {
        const gameCode = socket.gameCode;
        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const playerId = socket.id;

            // Beende Timer, falls aktiv und Spieler verlässt
            if (games[gameCode].quiz.questionTimer && games[gameCode].currentPhase === 'quiz') {
                 clearTimeout(games[gameCode].quiz.questionTimer);
                 games[gameCode].quiz.questionTimer = null;
                 console.log(`Timer für ${gameCode} unterbrochen, da Spieler ${playerName} verlassen hat.`);
            }

            delete games[gameCode].players[playerId];
            delete games[gameCode].quiz.scores[playerId]; // Score des Spielers entfernen
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
            
            // Wenn der Spieler während des Quiz verlässt und das der letzte wartende Spieler war, auswerten
            if (games[gameCode] && games[gameCode].currentPhase === 'quiz' && games[gameCode].quiz.answeredPlayers.size === Object.keys(games[gameCode].players).length) {
                evaluateQuizAnswers(gameCode, false);
            }
        }
    });

    // 7. Spieler trennt die Verbindung (z.B. Browser geschlossen, Netzwerkproblem)
    socket.on('disconnect', () => {
        console.log(`Spieler getrennt: ${socket.id}`);
        const gameCode = socket.gameCode;

        if (gameCode && games[gameCode] && games[gameCode].players[socket.id]) {
            const playerName = games[gameCode].players[socket.id].name;
            const playerId = socket.id;

             // Beende Timer, falls aktiv und Spieler die Verbindung trennt
            if (games[gameCode].quiz.questionTimer && games[gameCode].currentPhase === 'quiz') {
                 clearTimeout(games[gameCode].quiz.questionTimer);
                 games[gameCode].quiz.questionTimer = null;
                 console.log(`Timer für ${gameCode} unterbrochen, da Spieler ${playerName} getrennt hat.`);
            }

            delete games[gameCode].players[playerId];
            delete games[gameCode].quiz.scores[playerId]; // Score des Spielers entfernen

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

            // Wenn der Spieler während des Quiz verlässt und das der letzte wartende Spieler war, auswerten
            if (games[gameCode] && games[gameCode].currentPhase === 'quiz' && games[gameCode].quiz.answeredPlayers.size === Object.keys(games[gameCode].players).length) {
                evaluateQuizAnswers(gameCode, false);
            }
        }
    });
});

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf http://localhost:${PORT}`);
});