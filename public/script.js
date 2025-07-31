// public/script.js
const socket = io(); // Verbindet sich automatisch mit dem Server, von dem die Seite geladen wurde

// --- DOM-Elemente holen ---
// Startbildschirm
const startScreen = document.getElementById('startScreen');
const playerNameInput = document.getElementById('playerNameInput'); // NEU: Eingabefeld für Spielernamen
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameCodeInput = document.getElementById('gameCodeInput');
const publicGamesList = document.getElementById('publicGamesList'); // NEU: Für öffentliche Spiele

// Spielbereich (Lobby/Spielansicht)
const gameArea = document.getElementById('gameArea');
const gameCodeDisplay = document.getElementById('gameCodeDisplay'); // NEU: Zeigt den aktuellen Spielcode an
const gameStatusDisplay = document.getElementById('gameStatus'); // NEU: Für allgemeine Spielstatus-Nachrichten
const playerListDisplay = document.getElementById('playerList'); // NEU: Zeigt die Spielerliste an
const readyButton = document.getElementById('readyButton'); // NEU: Bereit-Button
const startGameButton = document.getElementById('startGameButton'); // NEU: Start-Game-Button (nur für Host)
const leaveGameButton = document.getElementById('leaveGameButton'); // NEU: Lobby verlassen Button
const chatMessagesDiv = document.getElementById('chatMessages'); // NEU: Chat-Nachrichten
const chatInput = document.getElementById('chatInput'); // NEU: Chat-Eingabe
const sendChatBtn = document.getElementById('sendChatBtn'); // NEU: Chat senden

// Globale Variablen für den Spielzustand im Frontend
let currentGameCode = null;
let myPlayerId = null; // Speichert die eigene Socket-ID
let isHost = false; // Speichert, ob der aktuelle Spieler der Host ist
let myPlayerName = ''; // Speichert den eigenen Spielernamen

// --- Event Listener ---

// Spielername validieren und Spiel erstellen
createGameBtn.addEventListener('click', () => {
    myPlayerName = playerNameInput.value.trim();
    if (myPlayerName) {
        socket.emit('createGame', myPlayerName);
    } else {
        gameStatusDisplay.textContent = 'Bitte gib deinen Spielernamen ein!';
    }
});

// Spielername und Code validieren und Spiel beitreten
joinGameBtn.addEventListener('click', () => {
    myPlayerName = playerNameInput.value.trim();
    currentGameCode = gameCodeInput.value.toUpperCase(); // Code global speichern
    if (myPlayerName && currentGameCode) {
        socket.emit('joinGame', { gameCode: currentGameCode, playerName: myPlayerName });
    } else {
        gameStatusDisplay.textContent = 'Bitte Spielcode und Spielernamen eingeben!';
    }
});

// NEU: Bereit-Button Logik
readyButton.addEventListener('click', () => {
    socket.emit('playerReady');
});

// NEU: Spiel starten Button Logik (nur für Host sichtbar)
startGameButton.addEventListener('click', () => {
    if (isHost) {
        socket.emit('startGame');
    } else {
        console.warn('Nicht der Host. Kann Spiel nicht starten.');
    }
});

// NEU: Lobby verlassen Button Logik
leaveGameButton.addEventListener('click', () => {
    socket.emit('leaveGame'); // Informiere den Server, dass der Spieler die Lobby verlässt
    resetUI(); // Setze das UI zurück auf den Startbildschirm
});

// NEU: Chat-Nachricht senden
sendChatBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
        socket.emit('chatMessage', message);
        chatInput.value = ''; // Eingabefeld leeren
    }
});
chatInput.addEventListener('keypress', (e) => { // Absenden per Enter-Taste
    if (e.key === 'Enter') {
        sendChatBtn.click();
    }
});


// --- Listener für Server-Events ---

// Beim Verbinden mit dem Server (erster Kontakt)
socket.on('connect', () => {
    myPlayerId = socket.id; // Speichert die eigene Socket-ID
    console.log(`Verbunden mit Server. Deine ID: ${myPlayerId}`);
    // Optional: Fordere beim Verbinden öffentliche Lobbys an
    socket.emit('requestPublicGames');
});

// Beim Trennen der Verbindung zum Server (z.B. Serverneustart, Netzwerkprobleme)
socket.on('disconnect', () => {
    console.log('Verbindung zum Server getrennt.');
    gameStatusDisplay.textContent = 'Verbindung zum Server verloren. Bitte Seite neu laden.';
    resetUI(); // UI zurücksetzen
});


socket.on('gameCreated', (data) => {
    currentGameCode = data.gameCode; // Code global speichern
    isHost = true; // Dieser Spieler ist der Host
    gameStatusDisplay.textContent = `Spiel erstellt! Code: ${data.gameCode}`;
    showGameArea(data.gameCode, data.players); // Spielerliste mit übergeben
    startGameButton.style.display = 'block'; // Host kann Spiel starten
});

socket.on('joinedGame', (data) => {
    currentGameCode = data.gameCode; // Code global speichern
    isHost = false; // Als Beigetretener ist man nicht der Host
    gameStatusDisplay.textContent = `Spiel ${data.gameCode} beigetreten!`;
    showGameArea(data.gameCode, data.players); // Spielerliste mit übergeben
    startGameButton.style.display = 'none'; // Nur Host kann starten
});

socket.on('playerJoined', (data) => {
    addSystemMessage(`${data.playerName} (${data.playerId}) ist dem Spiel beigetreten.`);
    updatePlayerList(data.players); // Spielerliste im Frontend aktualisieren
});

socket.on('playerLeft', (data) => {
    addSystemMessage(`${data.playerName} (${data.playerId}) hat das Spiel verlassen.`);
    updatePlayerList(data.players); // Spielerliste im Frontend aktualisieren
});

socket.on('playerStatusUpdate', (data) => {
    updatePlayerList(data.players); // Spielerliste aktualisieren, um Ready-Status zu zeigen
    addSystemMessage(`${data.playerName} ist jetzt ${data.readyStatus ? 'bereit' : 'nicht bereit'}.`);
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

socket.on('gameStarted', (data) => {
    gameStatusDisplay.textContent = `Spiel ${data.gameCode} hat begonnen!`;
    addSystemMessage('Das Spiel beginnt!');
    // Hier können Sie Logik hinzufügen, um zum eigentlichen Spielbildschirm zu wechseln
    // z.B. window.location.href = `/game_board.html?code=${data.gameCode}`;
    // Oder ein Canvas-Spiel im gameArea rendern
});

socket.on('gameStateUpdate', (data) => {
    // Hier den Spielzustand im Frontend aktualisieren (z.B. Spielfeld neu zeichnen)
    console.log('Neuer Spielzustand:', data.newGameState);
    gameStatusDisplay.textContent = `Spielzustand aktualisiert. Nächster Zug von: ${data.newGameState.currentPlayer}`;
    // Beispiel: spielfeldZeichnen(data.newGameState.board);
});

socket.on('newChatMessage', (data) => {
    addChatMessage(data.sender, data.message);
});

socket.on('joinError', (message) => {
    gameStatusDisplay.textContent = `Fehler beim Beitreten: ${message}`;
});

socket.on('gameError', (message) => { // NEU: Für allgemeine Spielfehler
    gameStatusDisplay.textContent = `Fehler im Spiel: ${message}`;
});

socket.on('updatePublicGames', (games) => { // NEU: Aktualisiere öffentliche Lobbys
    publicGamesList.innerHTML = ''; // Liste leeren
    if (games.length === 0) {
        publicGamesList.innerHTML = '<li>Aktuell keine öffentlichen Spiele verfügbar.</li>';
    } else {
        games.forEach(game => {
            const li = document.createElement('li');
            // Zeige Host-Namen und Spieleranzahl an
            li.textContent = `Code: ${game.id} | Host: ${game.hostName} | Spieler: ${Object.keys(game.players).length}`;
            li.style.cursor = 'pointer';
            li.onclick = () => {
                gameCodeInput.value = game.id;
                gameStatusDisplay.textContent = `Code ${game.id} ausgewählt. Bitte Namen eingeben und beitreten.`;
            };
            publicGamesList.appendChild(li);
        });
    }
});


// --- UI-Steuerungsfunktionen ---

// Zeigt den Spielbereich an und initialisiert diesen
function showGameArea(code, players) {
    startScreen.style.display = 'none';
    gameArea.style.display = 'block';
    gameCodeDisplay.textContent = code; // Spielcode anzeigen
    updatePlayerList(players); // Spielerliste initial aktualisieren
    chatMessagesDiv.innerHTML = ''; // Chat leeren
    addSystemMessage(`Willkommen in Spiel ${code}!`); // Willkommensnachricht
    // Hier können weitere Initialisierungen für das Spiel vorgenommen werden
}

// Setzt das UI zurück auf den Startbildschirm
function resetUI() {
    startScreen.style.display = 'block';
    gameArea.style.display = 'none';
    playerNameInput.value = ''; // Namen zurücksetzen
    gameCodeInput.value = ''; // Code zurücksetzen
    gameStatusDisplay.textContent = ''; // Statusmeldungen leeren
    playerListDisplay.innerHTML = ''; // Spielerliste leeren
    chatMessagesDiv.innerHTML = ''; // Chat leeren
    currentGameCode = null;
    myPlayerId = null;
    isHost = false;
    myPlayerName = '';
    startGameButton.style.display = 'none'; // Start-Button ausblenden
    readyButton.style.display = 'block'; // Bereit-Button standardmäßig wieder einblenden
    // Beim Zurücksetzen erneut öffentliche Lobbys anfragen
    socket.emit('requestPublicGames');
}

// Aktualisiert die Anzeige der Spielerliste in der Lobby
function updatePlayerList(players) {
    playerListDisplay.innerHTML = ''; // Liste leeren
    let allPlayersReady = true; // Prüfen, ob alle bereit sind

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
            allPlayersReady = false; // Mindestens ein Spieler ist nicht bereit
        }

        let playerText = player.name + playerStatus;
        if (id === socket.id) { // Eigener Spieler
            playerText = `<strong>${playerText} (Du)</strong>`;
        }
        if (player.isHost) { // Wenn der Server markiert, wer der Host ist
            playerText += ' (Host)';
        }
        li.innerHTML = playerText;
        playerListDisplay.appendChild(li);
    }

    // Wenn ich der Host bin und alle Spieler bereit sind (und mehr als 1 Spieler da ist), zeige den Start-Button
    if (isHost && allPlayersReady && Object.keys(players).length > 1) {
        startGameButton.style.display = 'block';
    } else if (isHost) {
        // Wenn ich der Host bin, aber nicht alle bereit oder nicht genug Spieler, blende Button aus
        startGameButton.style.display = 'none';
    }
}

// Fügt eine Systemnachricht zum Chat/Nachrichtenbereich hinzu
function addSystemMessage(message) {
    const p = document.createElement('p');
    p.textContent = message;
    p.style.fontStyle = 'italic';
    p.style.color = 'gray';
    chatMessagesDiv.appendChild(p);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Zum neuesten Eintrag scrollen
}

// Fügt eine normale Chat-Nachricht hinzu
function addChatMessage(sender, message) {
    const p = document.createElement('p');
    p.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatMessagesDiv.appendChild(p);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Zum neuesten Eintrag scrollen
}

// Initialisiere die UI beim Laden der Seite
resetUI(); // Sorgt dafür, dass beim Laden der Startbildschirm angezeigt wird und öffentliche Lobbys geladen werden.