// Clippo : petit serveur Node.js qui sert les fichiers du dossier "public".
// Tous les outils tournent dans le navigateur, il n'y a plus de téléchargement côté serveur.
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.listen(PORT, () => console.log(`Clippo tourne sur http://localhost:${PORT}`));
