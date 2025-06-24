// public/script.js
const socket = io(); // Verbindet sich automatisch mit dem Server, von dem die Seite geladen wurde

// DOM-Elemente holen
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameCodeInput = document.getElementById('gameCodeInput');
const messageDiv = document.getElementById('message');
const gameArea = document.getElementById('gameArea');

createGameBtn.addEventListener('click', () => {
    socket.emit('createGame');
});

joinGameBtn.addEventListener('click', () => {
    const code = gameCodeInput.value.toUpperCase();
    if (code) {
        socket.emit('joinGame', code);
    } else {
        messageDiv.textContent = 'Bitte Spielcode eingeben!';
    }
});

// Listener für Server-Events
socket.on('gameCreated', (data) => {
    messageDiv.textContent = `Spiel erstellt! Code: ${data.gameCode}. Dein Spieler-ID: ${data.playerId}`;
    // Zeige Spielbereich, verstecke Start-Buttons
    showGameArea(data.gameCode);
});

socket.on('joinedGame', (data) => {
    messageDiv.textContent = `Spiel ${data.gameCode} beigetreten! Dein Spieler-ID: ${data.playerId}`;
    showGameArea(data.gameCode);
});

socket.on('playerJoined', (data) => {
    messageDiv.textContent += `\n${data.playerName} (${data.playerId}) ist dem Spiel beigetreten. Aktuelle Spieler: ${data.gamePlayers.length}`;
    // Hier könnten Sie die Spielerliste im Frontend aktualisieren
});

socket.on('gameStateUpdate', (data) => {
    // Hier den Spielzustand im Frontend aktualisieren (z.B. Spielfeld neu zeichnen)
    console.log('Neuer Spielzustand:', data.newGameState);
});

socket.on('joinError', (message) => {
    messageDiv.textContent = `Fehler beim Beitreten: ${message}`;
});

function showGameArea(code) {
    // Logik um Spielbereich anzuzeigen und Spiel-ID/Code zu speichern
    document.getElementById('startScreen').style.display = 'none';
    gameArea.style.display = 'block';
    gameArea.innerHTML = `<h2>Du bist in Spiel ${code}</h2><p id="gameStatus"></p>`;
    // Hier Spiellogik für den Client hinzufügen
}

// Beispiel: Spieler macht einen Zug (dieser Event würde durch eine Benutzeraktion ausgelöst)
// setTimeout(() => {
//     const currentCode = "ABCDE"; // Annahme, dass Sie den aktuellen Spielcode irgendwo speichern
//     socket.emit('makeMove', { gameCode: currentCode, moveData: { row: 0, col: 0, player: 'X' } });
// }, 5000);