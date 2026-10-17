# Clippo

Des petits outils gratuits qui tournent dans le navigateur : extraire le MP3 d'une vidéo, détourer / convertir une image, texte stylé, pseudos, émojis, QR code, roue de la chance et Pomodoro.

## Structure
```
clippo/
├── server.js            # petit serveur Node qui sert le dossier "public"
├── package.json
├── Dockerfile           # pour l'héberger (Render, etc.)
├── .dockerignore / .gitignore
└── public/
    ├── index.html       # toutes les pages (onglets)
    ├── style.css        # le thème animé
    ├── app.js           # la logique de tous les outils
    ├── qrcode.js        # moteur de QR code (licence MIT, ne pas modifier)
    ├── logo.png / favicon.png
    ├── mentions-legales.html
    └── confidentialite.html
```

## Lancer sur ton PC
Il faut Node.js (https://nodejs.org). Dans le terminal de VS Code, dans le dossier du projet :
```
npm install
npm start
```
Puis ouvre http://localhost:3000. Arrêt avec `Ctrl + C`.

## Mettre en ligne
Envoie tous les fichiers sur GitHub, puis crée un « Web Service » sur Render (langage Docker, offre Free). À chaque modification validée sur GitHub (Commit changes), Render met le site à jour.

## Modifier le contenu
- **Alerte** : dans `public/index.html`, section « Alertes », remplace la ligne `alert calm` par
  `<div class="alert"><span>📢</span><div><strong>Titre</strong> Ton message.</div></div>`
- **Mise à jour** : dans la section « Mises à jour », remplace le bloc `upd-empty` par un `<article class="upd-item">` (date, titre, lignes avec `tag new`, `tag better` ou `tag fix`).
- **Lien Discord** : dans le pied de page de `index.html`.

## Avant d'afficher des publicités
- Remplis tous les passages en jaune `[...]` dans `mentions-legales.html` et `confidentialite.html`.
- Prends un nom de domaine et branche-le à ton site.
- Active le message de consentement aux cookies dans AdSense.

## Remarques
- Les outils « Extraire le MP3 » et « Détourer une image » chargent des bibliothèques depuis internet (jsDelivr, IMG.LY) : ils demandent une connexion.
- Merci de garder la mention de licence en tête de `qrcode.js`.
