// server.js (Beispielhafter Auszug)

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs'); // Benötigt, um die JSON-Datei zu lesen

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Statische Dateien servieren (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// --- Globale Spielzustands-Variablen ---
const games = {}; // Speichert alle aktiven Spiele
let publicGames = []; // Liste der öffentlichen Spiele

// --- Quiz-Konstanten ---
const QUESTION_TIME_LIMIT = 15; // Zeitlimit pro Frage in Sekunden
const NEXT_QUESTION_DELAY = 5000; // Verzögerung zwischen Fragen in ms (5 Sekunden)
const QUIZ_QUESTIONS_COUNT = 5; // <--- HIER AUF 5 GEÄNDERT! Anzahl der Fragen pro Spiel

let allQuizQuestions = []; // Hier werden alle Fragen geladen

// ... (loadQuizQuestions, shuffleArray Funktionen - bleiben wie zuvor) ...

io.on('connection', (socket) => {
    // ... (bestehende Events wie 'connect', 'disconnect', 'createGame', 'joinGame', 'playerReady', 'startGame', 'chatMessage', 'requestPublicGames', 'hostChanged', 'joinError', 'gameError' bleiben wie zuvor) ...

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
        game.resultsRound = {};
        game.playerAnswers = {};
        // Alle Spieler auf "nicht bereit" setzen und Score zurücksetzen
        Object.values(game.players).forEach(p => {
            p.ready = false;
            p.score = 0;
        });

        // Alle Spieler über den Phasenwechsel und den aktualisierten Zustand informieren
        io.to(gameCode).emit('gamePhaseChanged', { newPhase: game.state, players: game.players }); // players hier mitgeben, um UI zu aktualisieren
        // Der Client wird dann auf 'waitingForStart' zur Lobby zurückkehren und die playerList aktualisieren.
        addSystemMessageToChat(gameCode, 'Ein neues Spiel wurde gestartet! Bitte mache dich bereit.');
        console.log(`Neues Spiel in ${gameCode} gestartet. Alle Spieler sind zurück in der Lobby.`);
    });


    // --- Antwort einreichen ---
    socket.on('submitAnswer', (data) => {
        const gameCode = findGameCodeByPlayerId(socket.id);
        if (!gameCode) return;

        const game = games[gameCode];
        if (game.state !== 'quiz' || game.currentQuestionIndex !== data.questionIndex) {
            // Optional: Sende eine Fehlermeldung zurück, wenn die Antwort nicht gültig ist
            return socket.emit('gameError', 'Antwort nicht gültig oder Frage ist nicht aktiv.');
        }

        // Sicherstellen, dass der Spieler nur einmal pro Frage antworten kann
        if (game.playerAnswers[socket.id] === undefined) { // Prüfe auf 'undefined' anstelle von !game.playerAnswers[socket.id]
            game.playerAnswers[socket.id] = data.answerIndex;
            console.log(`Spieler ${game.players[socket.id].name} in ${gameCode} hat Antwort ${data.answerIndex} abgegeben.`);
            // Wenn alle geantwortet haben (optional, Timer ist primär):
            // if (Object.keys(game.playerAnswers).length === Object.keys(game.players).length) {
            //     evaluateAnswers(gameCode);
            // }
        }
    });

    // ... (restlicher Disconnect und Chat-Nachrichten Code - bleibt wie zuvor) ...

    // --- Quiz-Steuerungsfunktionen ---
    function sendNextQuestion(gameCode) {
        const game = games[gameCode];
        if (!game || game.shuffledQuestions.length === 0) {
            console.error(`Keine Fragen für Spiel ${gameCode} oder Spiel existiert nicht.`);
            // Gegebenenfalls hier das Spiel beenden oder Fehler senden
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
        clearTimeout(game.questionTimer); // Sicherstellen, dass kein alter Timer läuft
        game.questionTimer = setTimeout(() => {
            evaluateAnswers(gameCode);
        }, QUESTION_TIME_LIMIT * 1000);
    }

    // --- Korrigierte evaluateAnswers Funktion ---
    function evaluateAnswers(gameCode) {
        const game = games[gameCode];
        if (!game) return;

        clearTimeout(game.questionTimer); // Timer stoppen

        const currentQuestion = game.shuffledQuestions[game.currentQuestionIndex];
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
        if (!game) return;

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