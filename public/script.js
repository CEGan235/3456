// public/script.js
const socket = io();

// --- DOM-Elemente holen ---
// Startbildschirm
const startScreen = document.getElementById('startScreen');
const playerNameInput = document.getElementById('playerNameInput');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameCodeInput = document.getElementById('gameCodeInput');
const publicGamesList = document.getElementById('publicGamesList');
const messageDiv = document.getElementById('message'); // Für temporäre Startbildschirm-Nachrichten

// Spielbereich (Lobby/Spielansicht)
const gameArea = document.getElementById('gameArea');
const gameCodeDisplay = document.getElementById('gameCodeDisplay');
const gameStatusDisplay = document.getElementById('gameStatus'); // Für allgemeine Spielstatus-Nachrichten
const playerListDisplay = document.getElementById('playerList');

const readyButton = document.getElementById('readyButton');
const startGameButton = document.getElementById('startGameButton');
const leaveGameButton = document.getElementById('leaveGameButton');

const chatMessagesDiv = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

// public/script.js

// ... (bestehender Code) ...

// Quiz-spezifische Elemente
const gameContentDiv = document.getElementById('gameContent'); // Container für alle Spielphasen
const quizArea = document.getElementById('quizArea');
const questionText = document.getElementById('questionText');
const quizOptions = document.getElementById('quizOptions');
const timerDisplay = document.getElementById('timerDisplay');
const myQuizStatus = document.getElementById('myQuizStatus'); // z.B. "Deine Antwort wurde empfangen"

// NEU: CSS-Regel für ausgewählte Antwort
// FÜGE DIES ZU DEINER CSS-DATEI HINZU (z.B. public/style.css):
/*
.quiz-option-button.selected {
    background-color: #4CAF50; // Grüne Hervorhebung
    color: white;
    border-color: #388E3C;
}
.quiz-option-button:disabled {
    cursor: not-allowed;
    opacity: 0.7;
}
*/
// ... (bestehender Code) ...

socket.on('newQuestion', (data) => {
    currentPhase = 'quiz';
    showGamePhaseContent('quizArea');
    myQuizStatus.textContent = ''; // Status der eigenen Antwort zurücksetzen
    questionText.textContent = data.question;
    quizOptions.innerHTML = ''; // Vorherige Optionen leeren
    timerDisplay.textContent = `Zeit: ${data.timeLimit}s`; // Timer anzeigen

    // Sicherstellen, dass der Timer jedes Mal neu gesetzt wird
    if (window.countdownInterval) {
        clearInterval(window.countdownInterval);
    }

    data.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.textContent = option;
        button.dataset.index = index; // Index der Option speichern
        button.classList.add('quiz-option-button'); // Füge eine Klasse für Styling hinzu

        button.addEventListener('click', () => {
            // Alle Optionen deaktivieren, sobald eine ausgewählt wurde
            Array.from(quizOptions.children).forEach(btn => btn.disabled = true);
            
            // Markiere die ausgewählte Antwort
            Array.from(quizOptions.children).forEach(btn => btn.classList.remove('selected'));
            button.classList.add('selected');

            socket.emit('submitAnswer', { questionIndex: data.questionIndex, answerIndex: index });
            myQuizStatus.textContent = 'Deine Antwort wurde empfangen.';
        });
        quizOptions.appendChild(button);
    });

    // Timer-Anzeige aktualisieren
    let timeLeft = data.timeLimit;
    timerDisplay.textContent = `Zeit: ${timeLeft}s`;
    window.countdownInterval = setInterval(() => { // Speichere den Interval-ID in window
        timeLeft--;
        timerDisplay.textContent = `Zeit: ${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(window.countdownInterval);
            Array.from(quizOptions.children).forEach(btn => btn.disabled = true); // Optionen deaktivieren
            myQuizStatus.textContent = 'Zeit abgelaufen!';
        }
    }, 1000);
});

// ... (restlicher bestehender Code) ...

socket.on('questionResult', (data) => {
    currentPhase = 'quizResult';
    showGamePhaseContent('quizResultArea');
    myQuizStatus.textContent = ''; // Quiz-Status zurücksetzen
    correctAnswerDisplay.textContent = `Die richtige Antwort war: ${data.correctAnswerText}`;
    myCurrentScore.textContent = `Dein aktueller Score: ${data.myScore}`;

    playerScoresThisRound.innerHTML = '';
    for (const pId in data.currentScores) {
        const player = data.players[pId];
        const li = document.createElement('li');
        li.textContent = `${player.name}: ${data.currentScores[pId]} Punkte`;
        playerScoresThisRound.appendChild(li);
    }

    if (data.isLastQuestion) {
        nextQuestionInfo.textContent = 'Das war die letzte Frage! Ergebnisse werden berechnet...';
    } else {
        nextQuestionInfo.textContent = `Nächste Frage in ${data.nextQuestionDelay / 1000} Sekunden...`;
    }
});

socket.on('quizFinalResults', (data) => {
    currentPhase = 'drinkingPhase';
    showGamePhaseContent('finalSipsArea');
    sipsList.innerHTML = '';

    // Sortiere Spieler nach Schlücken (weniger wissen -> mehr trinken)
    const sortedSips = Object.entries(data.sipsToDistribute).sort(([, sipsA], [, sipsB]) => sipsB - sipsA);

    if (sortedSips.length === 0) {
        sipsList.innerHTML = '<li>Niemand muss trinken!</li>';
    } else {
        sortedSips.forEach(([playerId, sips]) => {
            const player = data.players[playerId];
            const li = document.createElement('li');
            li.textContent = `${player.name}: ${sips} Schlücke!`;
            if (playerId === myPlayerId) {
                li.style.fontWeight = 'bold';
                li.style.color = 'red';
            }
            sipsList.appendChild(li);
        });
    }

    if (isHost) {
        nextGameButton.style.display = 'block'; // Host kann das nächste Spiel starten
    }
});

// Initialisiere die UI beim Laden der Seite
showStartScreen();