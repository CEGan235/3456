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
// myScore wird jetzt vom Server direkt übermittelt

// --- UI-Helferfunktionen ---
// Blendet alle Spielphasen-Inhalte aus und zeigt den gewünschten an
function showGamePhaseContent(phaseId) {
    const allGamePhaseContents = document.querySelectorAll('.game-phase-content');
    allGamePhaseContents.forEach(el => el.style.display = 'none');
    if (phaseId) {
        document.getElementById(phaseId).style.display = 'flex'; // Use flex for centering content
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

    startGameButton.style.display = 'none';
    readyButton.style.display = 'block'; // Bereit-Button standardmäßig wieder einblenden
    nextGameButton.style.display = 'none'; // Nächstes Spiel Button ausblenden

    if (window.countdownInterval) { // Bestehende Timer bei Startbildschirm-Wechsel löschen
        clearInterval(window.countdownInterval);
    }

    socket.emit('requestPublicGames'); // Neue Liste öffentlicher Spiele anfordern
}

// Zeigt den Spielbereich (Lobby oder aktives Spiel) an
function showGameArea(code, players) {
    startScreen.style.display = 'none';
    gameArea.style.display = 'flex'; // Ensure gameArea is visible
    gameCodeDisplay.textContent = code;
    updatePlayerList(players);
    chatMessagesDiv.innerHTML = '';
    addSystemMessage(`Willkommen in Spiel ${code}!`);
    currentPhase = 'lobby'; // Starte in der Lobby-Phase
    showGamePhaseContent('placeholderGameArea'); // Zeigt den Standard-Platzhalter
}

// Aktualisiert die Anzeige der Spielerliste in der Lobby
function updatePlayerList(players) {
    playerListDisplay.innerHTML = '';
    let allPlayersReady = true;

    // Sortiere Spieler alphabetisch nach Namen für konsistente Anzeige
    const sortedPlayers = Object.values(players).sort((a, b) => a.name.localeCompare(b.name));

    sortedPlayers.forEach(player => {
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
        if (player.id === myPlayerId) { // Eigener Spieler
            playerText = `<strong>${playerText} (Du)</strong>`;
        }
        if (player.isHost) {
            playerText += ' (Host)';
        }
        li.innerHTML = playerText;
        playerListDisplay.appendChild(li);
    });

    // Start-Button Logik: Nur Host, genug Spieler, alle bereit
    const numPlayers = Object.keys(players).length;
    if (isHost && numPlayers >= 2 && allPlayersReady) {
        startGameButton.style.display = 'block';
    } else if (isHost) { // Host ist online, aber Bedingungen nicht erfüllt
        startGameButton.style.display = 'none';
    } else { // Nicht-Host
        startGameButton.style.display = 'none';
    }

    // readyButton nur in der Lobby anzeigen
    if (currentPhase === 'lobby') {
        readyButton.style.display = 'block';
    } else {
        readyButton.style.display = 'none';
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
    // Die Bestätigung kommt vom Server via 'playerStatusUpdate'
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
        nextGameButton.style.display = 'none'; // Button ausblenden, bis Spiel wieder in Lobby ist
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
    gameStatusDisplay.textContent = `Spiel erstellt! Code: ${data.gameCode}.`;
    showGameArea(data.gameCode, data.players);
});

socket.on('joinedGame', (data) => {
    currentGameCode = data.gameCode;
    isHost = false;
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
    // Hier keine explizite Systemnachricht mehr, da updatePlayerList bereits gut funktioniert
    // Die Nachrichten im Chat reichen aus
});

socket.on('hostChanged', (data) => {
    if (myPlayerId === data.newHostId) {
        isHost = true;
        startGameButton.style.display = 'block'; // Host kann Spiel starten
        addSystemMessage('Du bist jetzt der Host des Spiels!');
    } else {
        isHost = false;
        startGameButton.style.display = 'none'; // Nicht-Host kann nicht starten
        addSystemMessage(`${data.newHostName} ist jetzt der Host.`);
    }
    // Nach Host-Wechsel immer die Spielerliste aktualisieren, da Host-Status sich ändert
    // Daten werden normalerweise über 'playerStatusUpdate' oder 'gamePhaseChanged' mitgeliefert
    // Aber für den Fall, dass nur der Host wechselt, ist das gut:
    // Hier fehlt players-data, also auf nachfolgende updates warten oder server anpassen, dies zu senden
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
        case 'lobby': // Wenn der Server explizit auf 'lobby' setzt (z.B. nach 'startNextGame')
        case 'waitingForStart': // Bleibt für Abwärtskompatibilität, wenn der Server dies noch sendet
            showGameArea(currentGameCode, data.players); // Aktualisiert Lobby-Ansicht mit neuen Spielerdaten
            break;
        default:
            showGamePhaseContent('placeholderGameArea'); // Oder eine leere Ansicht
            break;
    }

    // Nach Phasenwechsel sicherstellen, dass Bereit/Start-Buttons korrekt sind
    if (currentPhase === 'lobby') {
        readyButton.style.display = 'block';
        if (isHost && Object.keys(data.players).length >= 2 && Object.values(data.players).every(p => p.ready)) {
            startGameButton.style.display = 'block';
        } else {
            startGameButton.style.display = 'none';
        }
    } else {
        readyButton.style.display = 'none';
        startGameButton.style.display = 'none';
    }
});

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

socket.on('questionResult', (data) => {
    currentPhase = 'quizResult';
    showGamePhaseContent('quizResultArea');
    myQuizStatus.textContent = ''; // Quiz-Status zurücksetzen
    correctAnswerDisplay.textContent = `Die richtige Antwort war: ${data.correctAnswerText}`;
    myCurrentScore.textContent = `Dein aktueller Score: ${data.myScore}`; // Dies ist nun DEIN korrekter Score

    playerScoresThisRound.innerHTML = '';
    // Sortiere Spieler nach Punkten absteigend für die Anzeige
    const sortedPlayersByScore = Object.values(data.players).map(p => ({
        name: p.name,
        score: data.currentScores[p.id] // Verwende den Score aus currentScores, da dieser aktuell ist
    })).sort((a, b) => b.score - a.score);

    sortedPlayersByScore.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name}: ${player.score} Punkte`;
        playerScoresThisRound.appendChild(li);
    });

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

    // Sortiere Spieler nach Schlücken (mehr Schlücke oben)
    const sortedSips = Object.entries(data.sipsToDistribute)
        .sort(([, sipsA], [, sipsB]) => sipsB - sipsA);

    if (sortedSips.length === 0 || sortedSips.every(([,sips]) => sips === 0)) {
        sipsList.innerHTML = '<li>Niemand muss trinken! Alle Quiz-Champions!</li>';
    } else {
        sortedSips.forEach(([playerId, sips]) => {
            const player = data.players[playerId];
            if (sips > 0) { // Zeige nur Spieler, die trinken müssen
                const li = document.createElement('li');
                li.textContent = `${player.name}: ${sips} Schlücke!`;
                if (playerId === myPlayerId) {
                    li.style.fontWeight = 'bold';
                    li.style.color = 'red';
                }
                sipsList.appendChild(li);
            }
        });
        if (sipsList.innerHTML === '') { // Falls alle 0 Schlücke haben, nachdem gefiltert wurde
            sipsList.innerHTML = '<li>Niemand muss trinken! Alle Quiz-Champions!</li>';
        }
    }

    if (isHost) {
        nextGameButton.style.display = 'block'; // Host kann das nächste Spiel starten
    } else {
        nextGameButton.style.display = 'none';
    }
});

// Initialisiere die UI beim Laden der Seite
showStartScreen();