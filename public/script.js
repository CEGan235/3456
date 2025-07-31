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

// Quiz-spezifische Elemente
const gameContentDiv = document.getElementById('gameContent'); // Container für alle Spielphasen
const quizArea = document.getElementById('quizArea');
const questionText = document.getElementById('questionText');
const quizOptions = document.getElementById('quizOptions');
const timerDisplay = document.getElementById('timerDisplay');
const myQuizStatus = document.getElementById('myQuizStatus'); // z.B. "Deine Antwort wurde empfangen"

const quizResultArea = document.getElementById('quizResultArea');
const correctAnswerDisplay = document.getElementById('correctAnswerDisplay');
const myCurrentScore = document.getElementById('myCurrentScore');
const playerScoresThisRound = document.getElementById('playerScoresThisRound');
const nextQuestionInfo = document.getElementById('nextQuestionInfo');

const finalSipsArea = document.getElementById('finalSipsArea');
const sipsList = document.getElementById('sipsList');
const nextGameButton = document.getElementById('nextGameButton');


// Globale Variablen für den Spielzustand im Frontend
let currentGameCode = null;
let myPlayerId = null;
let isHost = false;
let myPlayerName = '';
let currentPhase = 'startScreen'; // startScreen, lobby, quiz, quizResult, drinkingPhase
let myScore = 0; // Lokaler Score des Spielers

// --- UI-Helferfunktionen ---
// Blendet alle Spielphasen-Inhalte aus und zeigt den gewünschten an
function showGamePhaseContent(phaseId) {
    const allGamePhaseContents = document.querySelectorAll('.game-phase-content');
    allGamePhaseContents.forEach(el => el.style.display = 'none');
    if (phaseId) {
        document.getElementById(phaseId).style.display = 'block';
    }
}

// Zeigt den Startbildschirm an und setzt UI zurück
function showStartScreen() {
    startScreen.style.display = 'block';
    gameArea.style.display = 'none';
    playerNameInput.value = '';
    gameCodeInput.value = '';
    messageDiv.textContent = '';
    gameCodeDisplay.textContent = '';
    gameStatusDisplay.textContent = '';
    playerListDisplay.innerHTML = '';
    chatMessagesDiv.innerHTML = '';
    chatInput.value = '';
    showGamePhaseContent(null); // Alle Spielphasen-Inhalte ausblenden

    currentGameCode = null;
    myPlayerId = null;
    isHost = false;
    myPlayerName = '';
    currentPhase = 'startScreen';
    myScore = 0; // Score zurücksetzen

    startGameButton.style.display = 'none';
    readyButton.style.display = 'block'; // Bereit-Button standardmäßig wieder einblenden
    nextGameButton.style.display = 'none'; // Nächstes Spiel Button ausblenden

    socket.emit('requestPublicGames'); // Neue Liste öffentlicher Spiele anfordern
}

// Zeigt den Spielbereich (Lobby oder aktives Spiel) an
function showGameArea(code, players) {
    startScreen.style.display = 'none';
    gameArea.style.display = 'block';
    gameCodeDisplay.textContent = code;
    updatePlayerList(players);
    chatMessagesDiv.innerHTML = '';
    addSystemMessage(`Willkommen in Spiel ${code}!`);
    currentPhase = 'lobby'; // Starte in der Lobby-Phase
    showGamePhaseContent(null); // Keine spezifische Spielphase am Anfang anzeigen
}

// Aktualisiert die Anzeige der Spielerliste in der Lobby
function updatePlayerList(players) {
    playerListDisplay.innerHTML = '';
    let allPlayersReady = true;

    for (const id in players) {
        const player = players[id];
        const li = document.createElement('li');
        let playerStatus = '';

        if (player.ready) {
            playerStatus = ' (Bereit)';
            li.style.color = 'green';
        } else {
            playerStatus = ' (Wartet)';
            li.style.color = 'orange';
            allPlayersReady = false;
        }

        let playerText = player.name + playerStatus;
        if (id === socket.id) { // Eigener Spieler
            playerText = `<strong>${playerText} (Du)</strong>`;
        }
        if (player.isHost) {
            playerText += ' (Host)';
        }
        li.innerHTML = playerText;
        playerListDisplay.appendChild(li);
    }

    // Start-Button Logik: Nur Host, genug Spieler, alle bereit
    if (isHost && Object.keys(players).length >= 2 && allPlayersReady) {
        startGameButton.style.display = 'block';
    } else if (isHost) {
        startGameButton.style.display = 'none';
    }
}

// Fügt eine Systemnachricht zum Chat/Nachrichtenbereich hinzu
function addSystemMessage(message) {
    const p = document.createElement('p');
    p.textContent = message;
    p.classList.add('system-message'); // Optional für Styling
    chatMessagesDiv.appendChild(p);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// Fügt eine normale Chat-Nachricht hinzu
function addChatMessage(sender, message) {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatMessagesDiv.appendChild(p);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// --- Event Listener registrieren ---
createGameBtn.addEventListener('click', () => {
    myPlayerName = playerNameInput.value.trim();
    if (myPlayerName) {
        socket.emit('createGame', myPlayerName);
        messageDiv.textContent = 'Erstelle Spiel...';
    } else {
        messageDiv.textContent = 'Bitte gib deinen Spielernamen ein.';
    }
});

joinGameBtn.addEventListener('click', () => {
    myPlayerName = playerNameInput.value.trim();
    currentGameCode = gameCodeInput.value.toUpperCase();
    if (myPlayerName && currentGameCode) {
        socket.emit('joinGame', { gameCode: currentGameCode, playerName: myPlayerName });
        messageDiv.textContent = `Trete Spiel ${currentGameCode} bei...`;
    } else {
        messageDiv.textContent = 'Bitte Spielcode und Spielernamen eingeben.';
    }
});

readyButton.addEventListener('click', () => {
    socket.emit('playerReady');
    myQuizStatus.textContent = ''; // Reset quiz status if player becomes not ready
});

startGameButton.addEventListener('click', () => {
    if (isHost) {
        socket.emit('startGame');
        gameStatusDisplay.textContent = 'Starte Spiel...';
    } else {
        console.warn('Nicht der Host. Kann Spiel nicht starten.');
    }
});

leaveGameButton.addEventListener('click', () => {
    socket.emit('leaveGame');
});

sendChatBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chatMessage', message);
        chatInput.value = '';
    }
});
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatBtn.click();
    }
});

nextGameButton.addEventListener('click', () => {
    if (isHost) {
        socket.emit('startNextGame'); // Neues Event für den Host, um das nächste Spiel zu starten
        nextGameButton.style.display = 'none';
    }
});

// --- Socket.IO Events vom Server ---
socket.on('connect', () => {
    myPlayerId = socket.id;
    console.log(`Verbunden mit Server. Deine ID: ${myPlayerId}`);
    socket.emit('requestPublicGames');
});

socket.on('disconnect', () => {
    console.log('Verbindung zum Server getrennt.');
    gameStatusDisplay.textContent = 'Verbindung zum Server verloren. Bitte Seite neu laden.';
    showStartScreen(); // Zurück zum Startbildschirm
});

socket.on('gameCreated', (data) => {
    currentGameCode = data.gameCode;
    isHost = true;
    myScore = 0; // Score initialisieren
    gameStatusDisplay.textContent = `Spiel erstellt! Code: ${data.gameCode}.`;
    showGameArea(data.gameCode, data.players);
});

socket.on('joinedGame', (data) => {
    currentGameCode = data.gameCode;
    isHost = false;
    myScore = 0; // Score initialisieren
    gameStatusDisplay.textContent = `Spiel ${data.gameCode} beigetreten!`;
    showGameArea(data.gameCode, data.players);
});

socket.on('playerJoined', (data) => {
    addSystemMessage(`${data.playerName} ist dem Spiel beigetreten.`);
    updatePlayerList(data.players);
});

socket.on('playerLeft', (data) => {
    addSystemMessage(`${data.playerName} hat das Spiel verlassen.`);
    updatePlayerList(data.players);
});

socket.on('playerStatusUpdate', (data) => {
    updatePlayerList(data.players);
    if (data.playerId === myPlayerId) {
        addSystemMessage(`Du bist jetzt ${data.readyStatus ? 'bereit' : 'nicht bereit'}.`);
    } else {
        addSystemMessage(`${data.playerName} ist jetzt ${data.readyStatus ? 'bereit' : 'nicht bereit'}.`);
    }
});

socket.on('hostChanged', (data) => {
    if (myPlayerId === data.newHostId) {
        isHost = true;
        startGameButton.style.display = 'block';
        addSystemMessage('Du bist jetzt der Host des Spiels!');
    } else {
        isHost = false;
        startGameButton.style.display = 'none';
        addSystemMessage(`${data.newHostName} ist jetzt der Host.`);
    }
});

socket.on('updatePublicGames', (games) => {
    publicGamesList.innerHTML = '';
    if (games.length === 0) {
        publicGamesList.innerHTML = '<li>Aktuell keine öffentlichen Spiele verfügbar.</li>';
    } else {
        games.forEach(game => {
            const li = document.createElement('li');
            li.textContent = `Code: ${game.id} | Host: ${game.hostName} | Spieler: ${Object.keys(game.players).length}`;
            li.style.cursor = 'pointer';
            li.onclick = () => {
                gameCodeInput.value = game.id;
                messageDiv.textContent = `Code ${game.id} ausgewählt. Bitte Namen eingeben und beitreten.`;
            };
            publicGamesList.appendChild(li);
        });
    }
});

socket.on('joinError', (message) => {
    messageDiv.textContent = `Fehler beim Beitreten: ${message}`;
});

socket.on('gameError', (message) => {
    gameStatusDisplay.textContent = `Fehler im Spiel: ${message}`;
});

socket.on('newChatMessage', (data) => {
    addChatMessage(data.sender, data.message);
});

// --- Quiz Events ---
socket.on('gamePhaseChanged', (data) => {
    currentPhase = data.newPhase;
    gameStatusDisplay.textContent = `Spielphase: ${data.newPhase}`;
    console.log('Neue Spielphase:', data.newPhase);

    showGamePhaseContent(null); // Alle ausblenden

    switch (currentPhase) {
        case 'quiz':
            showGamePhaseContent('quizArea');
            break;
        case 'quizResult':
            showGamePhaseContent('quizResultArea');
            break;
        case 'drinkingPhase':
            showGamePhaseContent('finalSipsArea');
            break;
        case 'waitingForStart': // Zurück zur Lobby-Ansicht (oder Startbildschirm)
            showGameArea(currentGameCode, data.players); // Aktualisiert Lobby-Ansicht
            // Hier sicherstellen, dass readyButton und startGameButton wieder richtig angezeigt werden
            // Der Server sollte playerStatusUpdate und hostChanged senden, um das zu regeln
            break;
        // Füge hier weitere Spielphasen hinzu
        default:
            showGamePhaseContent('placeholderGameArea'); // Oder eine leere Ansicht
            break;
    }
});

socket.on('newQuestion', (data) => {
    currentPhase = 'quiz';
    showGamePhaseContent('quizArea');
    myQuizStatus.textContent = ''; // Status der eigenen Antwort zurücksetzen
    questionText.textContent = data.question;
    quizOptions.innerHTML = ''; // Vorherige Optionen leeren
    timerDisplay.textContent = `Zeit: ${data.timeLimit}s`; // Timer anzeigen

    data.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.textContent = option;
        button.dataset.index = index; // Index der Option speichern
        button.addEventListener('click', () => {
            socket.emit('submitAnswer', { questionIndex: data.questionIndex, answerIndex: index });
            myQuizStatus.textContent = 'Deine Antwort wurde empfangen.';
            // Optionen nach dem Senden der Antwort deaktivieren
            Array.from(quizOptions.children).forEach(btn => btn.disabled = true);
        });
        quizOptions.appendChild(button);
    });

    // Timer-Anzeige aktualisieren
    let timeLeft = data.timeLimit;
    const countdownInterval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = `Zeit: ${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(countdownInterval);
            Array.from(quizOptions.children).forEach(btn => btn.disabled = true); // Optionen deaktivieren
            myQuizStatus.textContent = 'Zeit abgelaufen!';
        }
    }, 1000);
});

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