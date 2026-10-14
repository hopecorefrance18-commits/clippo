// Clippo : serveur Node.js (Express) + yt-dlp + ffmpeg
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP = process.env.YTDLP_PATH || "yt-dlp";
const TMP = path.join(os.tmpdir(), "clippo");
fs.mkdirSync(TMP, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));

// --- Outils -------------------------------------------------------------
const ALLOWED_HOSTS = [
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtu.be", "tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
];

function validUrl(raw) {
  try {
    const u = new URL(raw);
    return ["http:", "https:"].includes(u.protocol) && ALLOWED_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

const MP4_QUALITIES = ["1080", "720", "480", "360"];
const MP3_QUALITIES = ["320", "192", "128"];

// Limite simple : 3 téléchargements en même temps
let running = 0;
const MAX_RUNNING = 3;

function cleanName(s) {
  return (s || "clippo").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 80) || "clippo";
}

// --- Infos sur la vidéo (titre + miniature) ------------------------------
app.get("/api/info", (req, res) => {
  const url = req.query.url;
  if (!validUrl(url)) return res.status(400).json({ error: "Lien YouTube ou TikTok invalide." });

  execFile(YTDLP, ["-J", "--no-playlist", "--", url], { timeout: 30000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: "Impossible de lire cette vidéo." });
    try {
      const d = JSON.parse(stdout);
      res.json({ title: d.title, thumbnail: d.thumbnail, duration: d.duration, uploader: d.uploader });
    } catch {
      res.status(500).json({ error: "Réponse inattendue de yt-dlp." });
    }
  });
});

// --- Téléchargement ------------------------------------------------------
app.get("/api/download", (req, res) => {
  const { url, type = "mp4", quality } = req.query;
  if (!validUrl(url)) return res.status(400).json({ error: "Lien YouTube ou TikTok invalide." });
  if (!["mp4", "mp3"].includes(type)) return res.status(400).json({ error: "Format inconnu." });

  const allowed = type === "mp4" ? MP4_QUALITIES : MP3_QUALITIES;
  const q = allowed.includes(quality) ? quality : allowed[1];

  if (running >= MAX_RUNNING) return res.status(429).json({ error: "Trop de demandes, réessaie dans un instant." });
  running++;

  const id = crypto.randomBytes(8).toString("hex");
  const outTemplate = path.join(TMP, `${id}.%(ext)s`);

  const args = ["--no-playlist", "--no-warnings", "-o", outTemplate];
  if (type === "mp4") {
    args.push("-f", `bestvideo[height<=${q}]+bestaudio/best[height<=${q}]/best`, "--merge-output-format", "mp4");
  } else {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", `${q}K`);
  }
  args.push("--print", "title", "--no-simulate", "--", url);

   execFile(YTDLP, args, { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
     running--;
        if (err) console.error("ERREUR yt-dlp :", stderr || err.message);
        const file = fs.readdirSync(TMP).find((f) => f.startsWith(id + "."));
    if (err || !file) {
      if (file) fs.unlink(path.join(TMP, file), () => {});
      return res.status(500).json({ error: "Le téléchargement a échoué." });
    }
    const full = path.join(TMP, file);
    const title = cleanName(stdout.split("\n")[0]);
    res.download(full, `${title}.${type}`, () => fs.unlink(full, () => {}));
  });
});

app.listen(PORT, () => console.log(`Clippo tourne sur http://localhost:${PORT}`));
