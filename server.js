// server.js (Beispiel für eine sehr einfache Node.js Express-Anwendung)
const express = require('express');
const app = express();
const port = process.env.PORT || 3000; // Render setzt die PORT Umgebungsvariable

app.get('/', (req, res) => {
  res.send('Hallo von meiner dynamischen Render-Anwendung!');
});

app.get('/api/data', (req, res) => {
  res.json({ message: 'Dies sind dynamische Daten!', timestamp: new Date() });
});

app.listen(port, () => {
  console.log(`Server läuft auf Port ${port}`);
});