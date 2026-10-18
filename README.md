# Clippo

Des petits outils gratuits qui tournent dans le navigateur, rangés par catégories :

- **Éducatif** : calculateur de moyenne, Pomodoro
- **Médias** : extraire le MP3 d'une vidéo, détourer une image, convertir une image
- **Créateurs** : texte stylé, pseudos, émojis et symboles
- **Pratique** : QR code, roue de la chance, liste de tâches

## Structure
```
clippo/
├── server.js            # petit serveur Node qui sert le dossier "public"
├── package.json
├── Dockerfile           # pour l'héberger (Render, etc.)
├── .dockerignore / .gitignore
└── public/
    ├── index.html       # toutes les pages (menu, accueil, outils)
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
Envoie les fichiers à la **racine** du dépôt GitHub (le dossier `public` doit être visible dès la racine, sans dossier `clippo` autour). Sur Render : « Web Service », langage Docker, offre Free. À chaque modification validée sur GitHub (Commit changes), Render met le site à jour.

## Modifier le contenu (dans public/index.html)
- **Alerte** : section « Alertes » de l'Accueil, remplace la ligne `alert calm` par
  `<div class="alert"><span>📢</span><div><strong>Titre</strong> Ton message.</div></div>`
- **Mise à jour** : section « Mises à jour », remplace le bloc `upd-empty` par un `<article class="upd-item">` (date, titre, lignes avec `tag new`, `tag better` ou `tag fix`).
- **Lien Discord** : dans le pied de page.
- **Bouton de don** : cherche « BOUTON DE DON » dans le pied de page, remplace `TON_PSEUDO` par ton lien, puis supprime la ligne `<!--` et la ligne `-->` qui entourent le bouton (pas celles de la phrase d'explication).

## Ajouter un outil
1. Dans le menu (`<nav class="subs">`), ajoute un bouton `<button class="tab" data-tab="monoutil">` dans la bonne catégorie.
2. Sur l'Accueil, ajoute une carte `<button class="tool-card" data-go="monoutil">` dans la même catégorie.
3. Ajoute la page `<section id="monoutil" class="panel">…</section>` avant `</main>`.
4. Ajoute le code de l'outil à la fin de `app.js`.
Chaque outil a un lien direct : `ton-site/#monoutil`.

## Avant d'afficher des publicités
- Remplis tous les passages en jaune `[...]` dans `mentions-legales.html` et `confidentialite.html`.
- Prends un nom de domaine et branche-le à ton site.
- Active le message de consentement aux cookies dans AdSense.

## Remarques
- « Extraire le MP3 » et « Détourer une image » chargent des bibliothèques depuis internet (jsDelivr, IMG.LY) : ils demandent une connexion.
- Garde la mention de licence en tête de `qrcode.js`.
