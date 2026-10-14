const $ = (id) => document.getElementById(id);

// ---------- Onglets ----------
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b === btn);
      b.setAttribute("aria-selected", b === btn);
    });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
  });
});

// ---------- Extraire le MP3 (dans le navigateur) ----------
const mp3Drop = $("mp3Drop"), mp3File = $("mp3File"), mp3Status = $("mp3Status");
const mp3Quality = $("mp3Quality"), mp3Result = $("mp3Result"), mp3Player = $("mp3Player"), mp3Save = $("mp3Save");
let lameReady;

function setMp3Status(msg, isError = false) {
  mp3Status.textContent = msg;
  mp3Status.classList.toggle("error", isError);
}

function loadLame() {
  if (window.lamejs) return Promise.resolve();
  if (!lameReady) {
    lameReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
      s.onload = resolve;
      s.onerror = () => { lameReady = null; reject(new Error("Impossible de charger l'encodeur MP3. Vérifie ta connexion.")); };
      document.head.appendChild(s);
    });
  }
  return lameReady;
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

async function extractMp3(file) {
  if (file.size > 500 * 1024 * 1024) {
    return setMp3Status("Fichier trop lourd (500 Mo maximum).", true);
  }
  mp3Result.hidden = true;
  setMp3Status("Lecture du fichier…");
  try {
    await loadLame();
    const data = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let audio;
    try {
      audio = await ctx.decodeAudioData(data);
    } catch {
      throw new Error("Impossible de lire le son de ce fichier. Essaie un MP4, WEBM ou MP3.");
    } finally {
      ctx.close();
    }

    const kbps = parseInt(mp3Quality.value, 10);
    const channels = Math.min(audio.numberOfChannels, 2);
    const encoder = new lamejs.Mp3Encoder(channels, audio.sampleRate, kbps);
    const left = toInt16(audio.getChannelData(0));
    const right = channels === 2 ? toInt16(audio.getChannelData(1)) : null;

    const block = 1152 * 20;
    const parts = [];
    for (let i = 0, n = 0; i < left.length; i += block, n++) {
      const l = left.subarray(i, i + block);
      const buf = right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
      if (buf.length) parts.push(buf);
      if (n % 25 === 0) {
        setMp3Status(`Conversion en cours… ${Math.round((i / left.length) * 100)}%`);
        await new Promise((r) => setTimeout(r)); // laisse la page respirer
      }
    }
    const end = encoder.flush();
    if (end.length) parts.push(end);

    const blob = new Blob(parts, { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    mp3Player.src = url;
    mp3Save.href = url;
    mp3Save.download = file.name.replace(/\.[^.]+$/, "") + ".mp3";
    mp3Result.hidden = false;
    setMp3Status("Terminé ! Ton MP3 est prêt.");
  } catch (e) {
    console.error(e);
    setMp3Status(e.message || "La conversion a échoué.", true);
  }
}

mp3File.addEventListener("change", () => mp3File.files[0] && extractMp3(mp3File.files[0]));
["dragenter", "dragover"].forEach((ev) => mp3Drop.addEventListener(ev, (e) => { e.preventDefault(); mp3Drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => mp3Drop.addEventListener(ev, (e) => { e.preventDefault(); mp3Drop.classList.remove("over"); }));
mp3Drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && extractMp3(e.dataTransfer.files[0]));
// ---------- Détourage d'image (dans le navigateur) ----------
const drop = $("drop"), fileInput = $("file"), cutStatus = $("cutStatus");
let removeBackground;

async function handleFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  $("results").hidden = true; $("saveRow").hidden = true;
  $("before").src = URL.createObjectURL(file);
  cutStatus.classList.remove("error");
  cutStatus.textContent = "Retrait du fond en cours… (le premier lancement télécharge le modèle, ~1 min)";
  try {
    if (!removeBackground) {
      ({ removeBackground } = await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm"));
    }
    const out = await removeBackground(file);
    const url = URL.createObjectURL(out);
    $("after").src = url;
    $("saveCut").href = url;
    $("results").hidden = false; $("saveRow").hidden = false;
    cutStatus.textContent = "Terminé !";
  } catch (e) {
    console.error(e);
    cutStatus.classList.add("error");
    cutStatus.textContent = "Le retrait du fond a échoué. Essaie une autre image.";
  }
}

fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
