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
  const maxMo = window.matchMedia("(max-width: 700px)").matches ? 150 : 500;
  if (file.size > maxMo * 1024 * 1024) {
    return setMp3Status(`Fichier trop lourd (${maxMo} Mo maximum sur cet appareil).`, true);
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


// --- MP3 à partir d'un lien (passe par le serveur) ---
const mp3Url = $("mp3Url"), mp3LinkBtn = $("mp3LinkBtn");

async function mp3FromLink() {
  const link = mp3Url.value.trim();
  if (!link) return setMp3Status("Colle d'abord un lien YouTube ou TikTok.", true);
  mp3Result.hidden = true;
  mp3LinkBtn.disabled = true;
  setMp3Status("Récupération du son… ça peut prendre un moment.");
  try {
    const r = await fetch(`/api/download?url=${encodeURIComponent(link)}&type=mp3&quality=${mp3Quality.value}`);
    if (!r.ok) {
      let msg = "Le serveur n'a pas pu récupérer ce lien.";
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg + " YouTube bloque souvent les serveurs en ligne : dépose plutôt le fichier vidéo.");
    }
    const blob = await r.blob();
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "")?.[1];
    const url = URL.createObjectURL(blob);
    mp3Player.src = url;
    mp3Save.href = url;
    mp3Save.download = name ? decodeURIComponent(name) : "clippo.mp3";
    mp3Result.hidden = false;
    setMp3Status("Terminé ! Ton MP3 est prêt.");
  } catch (e) {
    setMp3Status(e.message, true);
  } finally {
    mp3LinkBtn.disabled = false;
  }
}
mp3LinkBtn.addEventListener("click", mp3FromLink);
mp3Url.addEventListener("keydown", (e) => { if (e.key === "Enter") mp3FromLink(); });

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

// ---------- Convertir une image (dans le navigateur) ----------
const cvDrop = $("cvDrop"), cvFile = $("cvFile"), cvFormat = $("cvFormat"), cvQuality = $("cvQuality");
const cvResult = $("cvResult"), cvPreview = $("cvPreview"), cvSave = $("cvSave"), cvStatus = $("cvStatus");
const CV_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
let cvCurrent = null, cvUrl = null;

function cvSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(bytes / 1024)) + " Ko";
}
function cvMessage(msg, isError = false) {
  cvStatus.textContent = msg;
  cvStatus.classList.toggle("error", isError);
}

function convertImage(file) {
  if (!file || !file.type.startsWith("image/")) return cvMessage("Choisis un fichier image.", true);
  cvCurrent = file;
  cvMessage("Conversion…");
  const mime = cvFormat.value;
  const srcUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (mime === "image/jpeg") { // le JPG n'a pas de transparence : fond blanc
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(srcUrl);
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== mime) return cvMessage("Ton navigateur ne sait pas créer ce format.", true);
      if (cvUrl) URL.revokeObjectURL(cvUrl);
      cvUrl = URL.createObjectURL(blob);
      cvPreview.src = cvUrl;
      cvSave.href = cvUrl;
      cvSave.download = file.name.replace(/\.[^.]+$/, "") + "." + CV_EXT[mime];
      cvResult.hidden = false;
      cvMessage(`Terminé ! ${cvSize(file.size)} → ${cvSize(blob.size)}`);
    }, mime, parseFloat(cvQuality.value));
  };
  img.onerror = () => cvMessage("Impossible de lire cette image.", true);
  img.src = srcUrl;
}

function cvUpdateQuality() { cvQuality.disabled = cvFormat.value === "image/png"; }
cvUpdateQuality();
cvFormat.addEventListener("change", () => { cvUpdateQuality(); if (cvCurrent) convertImage(cvCurrent); });
cvQuality.addEventListener("change", () => { if (cvCurrent) convertImage(cvCurrent); });
cvFile.addEventListener("change", () => convertImage(cvFile.files[0]));
["dragenter", "dragover"].forEach((ev) => cvDrop.addEventListener(ev, (e) => { e.preventDefault(); cvDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => cvDrop.addEventListener(ev, (e) => { e.preventDefault(); cvDrop.classList.remove("over"); }));
cvDrop.addEventListener("drop", (e) => convertImage(e.dataTransfer.files[0]));

// ---------- Texte stylé (Discord, TikTok…) ----------
const FANCY_MAPS = [{"n": "Gras", "u": ["𝐀", "𝐁", "𝐂", "𝐃", "𝐄", "𝐅", "𝐆", "𝐇", "𝐈", "𝐉", "𝐊", "𝐋", "𝐌", "𝐍", "𝐎", "𝐏", "𝐐", "𝐑", "𝐒", "𝐓", "𝐔", "𝐕", "𝐖", "𝐗", "𝐘", "𝐙"], "l": ["𝐚", "𝐛", "𝐜", "𝐝", "𝐞", "𝐟", "𝐠", "𝐡", "𝐢", "𝐣", "𝐤", "𝐥", "𝐦", "𝐧", "𝐨", "𝐩", "𝐪", "𝐫", "𝐬", "𝐭", "𝐮", "𝐯", "𝐰", "𝐱", "𝐲", "𝐳"], "d": ["𝟎", "𝟏", "𝟐", "𝟑", "𝟒", "𝟓", "𝟔", "𝟕", "𝟖", "𝟗"]}, {"n": "Italique", "u": ["𝐴", "𝐵", "𝐶", "𝐷", "𝐸", "𝐹", "𝐺", "𝐻", "𝐼", "𝐽", "𝐾", "𝐿", "𝑀", "𝑁", "𝑂", "𝑃", "𝑄", "𝑅", "𝑆", "𝑇", "𝑈", "𝑉", "𝑊", "𝑋", "𝑌", "𝑍"], "l": ["𝑎", "𝑏", "𝑐", "𝑑", "𝑒", "𝑓", "𝑔", "ℎ", "𝑖", "𝑗", "𝑘", "𝑙", "𝑚", "𝑛", "𝑜", "𝑝", "𝑞", "𝑟", "𝑠", "𝑡", "𝑢", "𝑣", "𝑤", "𝑥", "𝑦", "𝑧"], "d": null}, {"n": "Gras italique", "u": ["𝑨", "𝑩", "𝑪", "𝑫", "𝑬", "𝑭", "𝑮", "𝑯", "𝑰", "𝑱", "𝑲", "𝑳", "𝑴", "𝑵", "𝑶", "𝑷", "𝑸", "𝑹", "𝑺", "𝑻", "𝑼", "𝑽", "𝑾", "𝑿", "𝒀", "𝒁"], "l": ["𝒂", "𝒃", "𝒄", "𝒅", "𝒆", "𝒇", "𝒈", "𝒉", "𝒊", "𝒋", "𝒌", "𝒍", "𝒎", "𝒏", "𝒐", "𝒑", "𝒒", "𝒓", "𝒔", "𝒕", "𝒖", "𝒗", "𝒘", "𝒙", "𝒚", "𝒛"], "d": null}, {"n": "Gras sans empattement", "u": ["𝗔", "𝗕", "𝗖", "𝗗", "𝗘", "𝗙", "𝗚", "𝗛", "𝗜", "𝗝", "𝗞", "𝗟", "𝗠", "𝗡", "𝗢", "𝗣", "𝗤", "𝗥", "𝗦", "𝗧", "𝗨", "𝗩", "𝗪", "𝗫", "𝗬", "𝗭"], "l": ["𝗮", "𝗯", "𝗰", "𝗱", "𝗲", "𝗳", "𝗴", "𝗵", "𝗶", "𝗷", "𝗸", "𝗹", "𝗺", "𝗻", "𝗼", "𝗽", "𝗾", "𝗿", "𝘀", "𝘁", "𝘂", "𝘃", "𝘄", "𝘅", "𝘆", "𝘇"], "d": ["𝟬", "𝟭", "𝟮", "𝟯", "𝟰", "𝟱", "𝟲", "𝟳", "𝟴", "𝟵"]}, {"n": "Cercles", "u": ["Ⓐ", "Ⓑ", "Ⓒ", "Ⓓ", "Ⓔ", "Ⓕ", "Ⓖ", "Ⓗ", "Ⓘ", "Ⓙ", "Ⓚ", "Ⓛ", "Ⓜ", "Ⓝ", "Ⓞ", "Ⓟ", "Ⓠ", "Ⓡ", "Ⓢ", "Ⓣ", "Ⓤ", "Ⓥ", "Ⓦ", "Ⓧ", "Ⓨ", "Ⓩ"], "l": ["ⓐ", "ⓑ", "ⓒ", "ⓓ", "ⓔ", "ⓕ", "ⓖ", "ⓗ", "ⓘ", "ⓙ", "ⓚ", "ⓛ", "ⓜ", "ⓝ", "ⓞ", "ⓟ", "ⓠ", "ⓡ", "ⓢ", "ⓣ", "ⓤ", "ⓥ", "ⓦ", "ⓧ", "ⓨ", "ⓩ"], "d": ["⓪", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"]}, {"n": "Script", "u": ["𝒜", "ℬ", "𝒞", "𝒟", "ℰ", "ℱ", "𝒢", "ℋ", "ℐ", "𝒥", "𝒦", "ℒ", "ℳ", "𝒩", "𝒪", "𝒫", "𝒬", "ℛ", "𝒮", "𝒯", "𝒰", "𝒱", "𝒲", "𝒳", "𝒴", "𝒵"], "l": ["𝒶", "𝒷", "𝒸", "𝒹", "ℯ", "𝒻", "ℊ", "𝒽", "𝒾", "𝒿", "𝓀", "𝓁", "𝓂", "𝓃", "ℴ", "𝓅", "𝓆", "𝓇", "𝓈", "𝓉", "𝓊", "𝓋", "𝓌", "𝓍", "𝓎", "𝓏"], "d": null}, {"n": "Script gras", "u": ["𝓐", "𝓑", "𝓒", "𝓓", "𝓔", "𝓕", "𝓖", "𝓗", "𝓘", "𝓙", "𝓚", "𝓛", "𝓜", "𝓝", "𝓞", "𝓟", "𝓠", "𝓡", "𝓢", "𝓣", "𝓤", "𝓥", "𝓦", "𝓧", "𝓨", "𝓩"], "l": ["𝓪", "𝓫", "𝓬", "𝓭", "𝓮", "𝓯", "𝓰", "𝓱", "𝓲", "𝓳", "𝓴", "𝓵", "𝓶", "𝓷", "𝓸", "𝓹", "𝓺", "𝓻", "𝓼", "𝓽", "𝓾", "𝓿", "𝔀", "𝔁", "𝔂", "𝔃"], "d": null}, {"n": "Gothique", "u": ["𝔄", "𝔅", "ℭ", "𝔇", "𝔈", "𝔉", "𝔊", "ℌ", "ℑ", "𝔍", "𝔎", "𝔏", "𝔐", "𝔑", "𝔒", "𝔓", "𝔔", "ℜ", "𝔖", "𝔗", "𝔘", "𝔙", "𝔚", "𝔛", "𝔜", "ℨ"], "l": ["𝔞", "𝔟", "𝔠", "𝔡", "𝔢", "𝔣", "𝔤", "𝔥", "𝔦", "𝔧", "𝔨", "𝔩", "𝔪", "𝔫", "𝔬", "𝔭", "𝔮", "𝔯", "𝔰", "𝔱", "𝔲", "𝔳", "𝔴", "𝔵", "𝔶", "𝔷"], "d": null}, {"n": "Gothique gras", "u": ["𝕬", "𝕭", "𝕮", "𝕯", "𝕰", "𝕱", "𝕲", "𝕳", "𝕴", "𝕵", "𝕶", "𝕷", "𝕸", "𝕹", "𝕺", "𝕻", "𝕼", "𝕽", "𝕾", "𝕿", "𝖀", "𝖁", "𝖂", "𝖃", "𝖄", "𝖅"], "l": ["𝖆", "𝖇", "𝖈", "𝖉", "𝖊", "𝖋", "𝖌", "𝖍", "𝖎", "𝖏", "𝖐", "𝖑", "𝖒", "𝖓", "𝖔", "𝖕", "𝖖", "𝖗", "𝖘", "𝖙", "𝖚", "𝖛", "𝖜", "𝖝", "𝖞", "𝖟"], "d": null}, {"n": "Double barre", "u": ["𝔸", "𝔹", "ℂ", "𝔻", "𝔼", "𝔽", "𝔾", "ℍ", "𝕀", "𝕁", "𝕂", "𝕃", "𝕄", "ℕ", "𝕆", "ℙ", "ℚ", "ℝ", "𝕊", "𝕋", "𝕌", "𝕍", "𝕎", "𝕏", "𝕐", "ℤ"], "l": ["𝕒", "𝕓", "𝕔", "𝕕", "𝕖", "𝕗", "𝕘", "𝕙", "𝕚", "𝕛", "𝕜", "𝕝", "𝕞", "𝕟", "𝕠", "𝕡", "𝕢", "𝕣", "𝕤", "𝕥", "𝕦", "𝕧", "𝕨", "𝕩", "𝕪", "𝕫"], "d": ["𝟘", "𝟙", "𝟚", "𝟛", "𝟜", "𝟝", "𝟞", "𝟟", "𝟠", "𝟡"]}, {"n": "Machine à écrire", "u": ["𝙰", "𝙱", "𝙲", "𝙳", "𝙴", "𝙵", "𝙶", "𝙷", "𝙸", "𝙹", "𝙺", "𝙻", "𝙼", "𝙽", "𝙾", "𝙿", "𝚀", "𝚁", "𝚂", "𝚃", "𝚄", "𝚅", "𝚆", "𝚇", "𝚈", "𝚉"], "l": ["𝚊", "𝚋", "𝚌", "𝚍", "𝚎", "𝚏", "𝚐", "𝚑", "𝚒", "𝚓", "𝚔", "𝚕", "𝚖", "𝚗", "𝚘", "𝚙", "𝚚", "𝚛", "𝚜", "𝚝", "𝚞", "𝚟", "𝚠", "𝚡", "𝚢", "𝚣"], "d": ["𝟶", "𝟷", "𝟸", "𝟹", "𝟺", "𝟻", "𝟼", "𝟽", "𝟾", "𝟿"]}, {"n": "Carrés noirs", "u": ["🅰", "🅱", "🅲", "🅳", "🅴", "🅵", "🅶", "🅷", "🅸", "🅹", "🅺", "🅻", "🅼", "🅽", "🅾", "🅿", "🆀", "🆁", "🆂", "🆃", "🆄", "🆅", "🆆", "🆇", "🆈", "🆉"], "l": ["🅰", "🅱", "🅲", "🅳", "🅴", "🅵", "🅶", "🅷", "🅸", "🅹", "🅺", "🅻", "🅼", "🅽", "🅾", "🅿", "🆀", "🆁", "🆂", "🆃", "🆄", "🆅", "🆆", "🆇", "🆈", "🆉"], "d": null}, {"n": "Petites majuscules", "u": ["ᴀ", "ʙ", "ᴄ", "ᴅ", "ᴇ", "ꜰ", "ɢ", "ʜ", "ɪ", "ᴊ", "ᴋ", "ʟ", "ᴍ", "ɴ", "ᴏ", "ᴘ", "ǫ", "ʀ", "ꜱ", "ᴛ", "ᴜ", "ᴠ", "ᴡ", "x", "ʏ", "ᴢ"], "l": ["ᴀ", "ʙ", "ᴄ", "ᴅ", "ᴇ", "ꜰ", "ɢ", "ʜ", "ɪ", "ᴊ", "ᴋ", "ʟ", "ᴍ", "ɴ", "ᴏ", "ᴘ", "ǫ", "ʀ", "ꜱ", "ᴛ", "ᴜ", "ᴠ", "ᴡ", "x", "ʏ", "ᴢ"], "d": null}];
function fancyMap(text, st) {
  return Array.from(text).map((ch) => {
    const c = ch.charCodeAt(0);
    if (c >= 65 && c <= 90) return st.u[c - 65];
    if (c >= 97 && c <= 122) return st.l[c - 97];
    if (c >= 48 && c <= 57 && st.d) return st.d[c - 48];
    return ch;
  }).join("");
}

const FLIP = { a:"ɐ", b:"q", c:"ɔ", d:"p", e:"ǝ", f:"ɟ", g:"ƃ", h:"ɥ", i:"ᴉ", j:"ɾ", k:"ʞ", l:"l", m:"ɯ", n:"u", o:"o", p:"d", q:"b", r:"ɹ", s:"s", t:"ʇ", u:"n", v:"ʌ", w:"ʍ", x:"x", y:"ʎ", z:"z", "?":"¿", "!":"¡", ".":"˙", ",":"'" };

function fancyOutputs(text) {
  const list = FANCY_MAPS.map((st) => ({ name: st.n, text: fancyMap(text, st) }));
  list.push({
    name: "Pleine largeur",
    text: Array.from(text).map((ch) => {
      const c = ch.charCodeAt(0);
      if (c === 32) return "\u3000";
      return c >= 33 && c <= 126 ? String.fromCharCode(c + 0xFEE0) : ch;
    }).join(""),
  });
  list.push({ name: "À l'envers", text: Array.from(text.toLowerCase()).map((ch) => FLIP[ch] || ch).reverse().join("") });
  list.push({ name: "Barré", text: Array.from(text).map((ch) => ch + "\u0336").join("") });
  list.push({ name: "Souligné", text: Array.from(text).map((ch) => ch + "\u0332").join("") });
  list.push({ name: "Décoré ✦", text: `✦ ${text} ✦` });
  list.push({ name: "Décoré ꧁꧂", text: `꧁ ${text} ꧂` });
  list.push({ name: "Décoré ⋆｡˚", text: `⋆｡˚ ${text} ˚｡⋆` });
  return list;
}

const fancyInput = $("fancyInput"), fancyList = $("fancyList");

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => { // plan B pour les anciens navigateurs
    const t = document.createElement("textarea");
    t.value = text;
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    try { document.execCommand("copy") ? resolve() : reject(); } catch (e) { reject(e); }
    t.remove();
  });
}

function renderFancy() {
  const text = fancyInput.value.trim() || "Clippo";
  fancyList.innerHTML = "";
  fancyOutputs(text).forEach((o) => {
    const row = document.createElement("div");
    row.className = "fancy-row";
    const box = document.createElement("div");
    const label = document.createElement("small");
    label.textContent = o.name;
    const out = document.createElement("span");
    out.textContent = o.text;
    box.append(label, out);
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copier";
    btn.addEventListener("click", async () => {
      try {
        await copyText(o.text);
        btn.textContent = "Copié !";
        btn.classList.add("done");
      } catch {
        btn.textContent = "Erreur";
      }
      setTimeout(() => { btn.textContent = "Copier"; btn.classList.remove("done"); }, 1500);
    });
    row.append(box, btn);
    fancyList.appendChild(row);
  });
}
fancyInput.addEventListener("input", renderFancy);
renderFancy();

// ---------- Générateur de pseudos ----------
const NAME_WORDS = {
  gaming: {
    pre: ["Shadow", "Dark", "Toxic", "Turbo", "Ultra", "Neo", "Ghost", "Savage", "Hyper", "Silent", "Rapid", "Iron", "Frost", "Cyber"],
    noun: ["Wolf", "Sniper", "Ninja", "Viper", "Reaper", "Falcon", "Titan", "Phantom", "Dragon", "Hunter", "Blade", "Storm", "Rider", "Striker"],
  },
  mignon: {
    pre: ["Petit", "Mini", "Choco", "Mochi", "Kawaii", "Doudou", "Sucre", "Bebe", "Miel", "Nuage", "Pop", "Happy"],
    noun: ["Panda", "Chaton", "Lapin", "Biscuit", "Cookie", "Nounours", "Cerise", "Bonbon", "Mimi", "Poussin", "Chouchou", "Pepite"],
  },
  mystere: {
    pre: ["Ombre", "Nuit", "Lune", "Brume", "Silence", "Eclipse", "Minuit", "Etoile", "Fantome", "Reve", "Nova", "Void"],
    noun: ["Corbeau", "Loup", "Mirage", "Voyageur", "Secret", "Echo", "Spectre", "Oracle", "Nomade", "Enigme", "Rodeur", "Zenith"],
  },
  drole: {
    pre: ["Super", "Captain", "Sir", "Monsieur", "Professeur", "Mega", "Gros", "Tonton", "Docteur", "Maitre"],
    noun: ["Baguette", "Patate", "Croissant", "Fromage", "Nouille", "Raclette", "Pantoufle", "Moustache", "Tacos", "Frite", "Burger", "Pizza"],
  },
};

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function cleanWord(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "");
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function makeName(style, base, withNum) {
  const w = NAME_WORDS[style];
  const pre = cleanWord(pick(w.pre)), noun = cleanWord(pick(w.noun));
  const b = cleanWord(base);
  const options = b
    ? [
        () => cap(b) + noun,
        () => pre + cap(b),
        () => b.toLowerCase() + "_" + noun.toLowerCase(),
        () => pre.toLowerCase() + "." + b.toLowerCase(),
        () => cap(b) + "_" + pre,
      ]
    : [
        () => pre + noun,
        () => noun + "_" + pre,
        () => (pre + "." + noun).toLowerCase(),
        () => noun.toLowerCase() + "_" + pre.toLowerCase(),
        () => pre.toLowerCase() + noun,
      ];
  if (style === "gaming") options.push(() => "xX" + (b ? cap(b) : noun) + "Xx");
  let name = pick(options)();
  if (withNum) name += String(Math.floor(Math.random() * 90) + 10);
  return name.slice(0, 24);
}

function makeNames(style, base, withNum, count = 10) {
  const seen = new Set();
  for (let tries = 0; seen.size < count && tries < 200; tries++) seen.add(makeName(style, base, withNum));
  return [...seen];
}

const pStyle = $("pStyle"), pBase = $("pBase"), pNum = $("pNum"), pGo = $("pGo"), pList = $("pList");

function renderPseudos() {
  pList.innerHTML = "";
  makeNames(pStyle.value, pBase.value.trim(), pNum.checked).forEach((name) => {
    const row = document.createElement("div");
    row.className = "fancy-row";
    const box = document.createElement("div");
    const out = document.createElement("span");
    out.textContent = name;
    box.appendChild(out);
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copier";
    btn.addEventListener("click", async () => {
      try {
        await copyText(name);
        btn.textContent = "Copié !";
        btn.classList.add("done");
      } catch {
        btn.textContent = "Erreur";
      }
      setTimeout(() => { btn.textContent = "Copier"; btn.classList.remove("done"); }, 1500);
    });
    row.append(box, btn);
    pList.appendChild(row);
  });
}
pGo.addEventListener("click", renderPseudos);
pStyle.addEventListener("change", renderPseudos);
pNum.addEventListener("change", renderPseudos);
pBase.addEventListener("input", renderPseudos);
renderPseudos();

// ---------- Émojis et symboles ----------
const EM_DATA = [
  { n: "Visages", s: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😍 🥰 😘 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😔 😢 😭 😤 😠 😡 🤬 🤯 😱 😨 🥶 🥵 🤔 🤫 🤭 😴 🤤 😈 👿 💀 ☠️ 👻 👽 🤖 💩 🙄 😬 🫠 🥹" },
  { n: "Cœurs", s: "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💖 💗 💓 💞 💕 💘 💝 💔 ❣️ 💌 💋 🫶 ♡ ♥ ❥ ❦ ❧ ☙" },
  { n: "Mains", s: "👍 👎 👏 🙌 🫶 🤝 🙏 ✌️ 🤞 🤟 🤘 👌 🤌 👈 👉 👆 👇 ☝️ ✋ 🖐️ 👋 💪 🫡 🤙 ✍️" },
  { n: "Animaux", s: "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦄 🐺 🦇 🐲 🐍 🐢 🐙 🦋 🐝 🐞 🦈 🐬 🐳" },
  { n: "Nourriture", s: "🍕 🍔 🍟 🌭 🌮 🌯 🍣 🍜 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍿 🥐 🥖 🧀 🍓 🍒 🍑 🍉 🍌 🍎 🍋 🥑 ☕ 🧋 🍺" },
  { n: "Gaming et fun", s: "🎮 🕹️ 👾 🎧 🎵 🎶 🎤 🎬 📸 🎯 🎲 🏆 🥇 🔥 ⚡ 💥 ✨ 🌟 💫 🚀 💎 👑 🎁 🎉 🎊 🪩" },
  { n: "Nature et ciel", s: "🌙 ☀️ ⭐ 🌈 ☁️ ❄️ 🌊 🌸 🌺 🌹 🌻 🍀 🌿 🍂 🔮 🌌 ☄️" },
  { n: "Étoiles et fleurs", s: "★ ☆ ✦ ✧ ✩ ✪ ✫ ✬ ✭ ✮ ✯ ✰ ⋆ ✶ ✷ ✸ ✹ ❂ ✺ ❋ ✿ ❀ ❁ ✾ ❃ ꕤ ･ﾟ ｡ ˚ ° ·" },
  { n: "Flèches", s: "→ ← ↑ ↓ ↗ ↘ ↙ ↖ ↔ ↕ ⇒ ⇐ ⇑ ⇓ ➜ ➤ ➔ ➡ ⬅ ⬆ ⬇ ↩ ↪ ⟲ ⟳ ❯ ❮ » «" },
  { n: "Cadres et formes", s: "꧁ ꧂ ༺ ༻ ☾ ☽ 〔 〕 【 】 『 』 「 」 ❝ ❞ ❛ ❜ ═ ─ ━ ┈ ┄ ╌ ┅ ⋯ ░ ▒ ▓ ● ○ ◆ ◇ ■ □ ▲ △ ▼ ▽ ◉ ◈" },
  { n: "Divers", s: "♪ ♫ ♬ ☮ ☯ ☢ ☣ ☠ ⚔ ⚜ ☂ ☃ ✈ ☎ ✉ ✂ ✔ ✘ ✖ ™ © ® ∞ ≈ ≠ ± × ÷ † ‡ № ℓ ❖ ☑ ☒ ⚠ ♻ ♨ ♠ ♣ ♦" },
];

const emBox = $("emBox"), emGrid = $("emGrid"), emTabs = $("emTabs"), emStatus = $("emStatus");

function emMessage(msg, isError = false) {
  emStatus.textContent = msg;
  emStatus.classList.toggle("error", isError);
}

function emInsert(ch) {
  const start = emBox.selectionStart ?? emBox.value.length;
  const end = emBox.selectionEnd ?? start;
  emBox.value = emBox.value.slice(0, start) + ch + emBox.value.slice(end);
  const pos = start + ch.length;
  emBox.setSelectionRange(pos, pos);
}

function showEmCategory(i) {
  emTabs.querySelectorAll(".chip").forEach((c, k) => c.classList.toggle("active", k === i));
  emGrid.innerHTML = "";
  EM_DATA[i].s.split(" ").filter(Boolean).forEach((ch) => {
    const b = document.createElement("button");
    b.className = "em-cell";
    b.textContent = ch;
    b.setAttribute("aria-label", "Ajouter " + ch);
    b.addEventListener("click", () => emInsert(ch));
    emGrid.appendChild(b);
  });
}

EM_DATA.forEach((cat, i) => {
  const c = document.createElement("button");
  c.className = "chip";
  c.textContent = cat.n;
  c.addEventListener("click", () => showEmCategory(i));
  emTabs.appendChild(c);
});
showEmCategory(0);

$("emCopy").addEventListener("click", async () => {
  if (!emBox.value) return emMessage("Ta sélection est vide.", true);
  try {
    await copyText(emBox.value);
    emMessage("Copié !");
  } catch {
    emMessage("Impossible de copier automatiquement : sélectionne le texte et fais Ctrl + C.", true);
  }
});
$("emClear").addEventListener("click", () => { emBox.value = ""; emMessage(""); });

// ---------- Accueil : les cartes ouvrent l'onglet correspondant ----------
document.querySelectorAll("[data-go]").forEach((card) => {
  card.addEventListener("click", () => {
    document.querySelector(`.tab[data-tab="${card.dataset.go}"]`)?.click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
});

// ---------- QR code ----------
const qrText = $("qrText"), qrLevel = $("qrLevel"), qrSize = $("qrSize"), qrFg = $("qrFg"), qrBg = $("qrBg");
const qrBox = $("qrBox"), qrCanvas = $("qrCanvas"), qrSave = $("qrSave"), qrStatus = $("qrStatus");
let qrLibReady;

function qrMessage(msg, isError = false) {
  qrStatus.textContent = msg;
  qrStatus.classList.toggle("error", isError);
}

function loadQrLib() {
  if (window.QRCodeLib) return Promise.resolve();
  if (!qrLibReady) {
    qrLibReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "qrcode.js";
      s.onload = resolve;
      s.onerror = () => { qrLibReady = null; reject(new Error("Le fichier qrcode.js est introuvable sur le site.")); };
      document.head.appendChild(s);
    });
  }
  return qrLibReady;
}

function makeQr(text, level) {
  const { QRCode, QRErrorCorrectLevel } = window.QRCodeLib;
  const bytes = unescape(encodeURIComponent(text)); // accents et émojis en UTF-8
  for (let version = 1; version <= 40; version++) {
    try {
      const qr = new QRCode(version, QRErrorCorrectLevel[level]);
      qr.addData(bytes);
      qr.make();
      return qr;
    } catch (e) { /* trop petit : on essaie la version suivante */ }
  }
  throw new Error("Texte trop long");
}

function luminance(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

async function renderQr() {
  const text = qrText.value.trim();
  if (!text) {
    qrBox.hidden = true;
    return qrMessage("");
  }
  try {
    await loadQrLib();
  } catch (e) {
    return qrMessage(e.message, true);
  }
  let qr;
  try {
    qr = makeQr(text, qrLevel.value);
  } catch {
    qrBox.hidden = true;
    return qrMessage("Texte trop long pour un QR code. Raccourcis-le.", true);
  }

  const n = qr.getModuleCount(), margin = 4;
  const cell = Math.max(2, Math.floor(parseInt(qrSize.value, 10) / (n + margin * 2)));
  const size = cell * (n + margin * 2);
  qrCanvas.width = size;
  qrCanvas.height = size;
  const ctx = qrCanvas.getContext("2d");
  ctx.fillStyle = qrBg.value;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = qrFg.value;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
    }
  }
  qrSave.href = qrCanvas.toDataURL("image/png");
  qrBox.hidden = false;

  const l1 = luminance(qrFg.value), l2 = luminance(qrBg.value);
  const contrast = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  if (contrast < 3) {
    qrMessage("Contraste trop faible : ce QR code risque de ne pas se scanner.", true);
  } else if (l1 > l2) {
    qrMessage("Garde le code plus foncé que le fond, sinon certains téléphones ne le lisent pas.", true);
  } else {
    qrMessage(`QR code prêt (${size} × ${size} px).`);
  }
}

[qrText, qrLevel, qrSize, qrFg, qrBg].forEach((el) => el.addEventListener("input", renderQr));

// ---------- Roue de la chance ----------
const wheelInput = $("wheelInput"), wheelCanvas = $("wheelCanvas"), wheelSpin = $("wheelSpin");
const wheelResult = $("wheelResult"), wheelWinner = $("wheelWinner"), wheelRemove = $("wheelRemove"), wheelStatus = $("wheelStatus");
const WHEEL_COLORS = [
  ["#ff3d81", "#15112e"], ["#2ee6d6", "#15112e"], ["#ffd84d", "#15112e"],
  ["#8b5cf6", "#ffffff"], ["#ff8a4c", "#15112e"], ["#4da3ff", "#15112e"],
];
const TWO_PI = Math.PI * 2;
let wheelRot = 0, wheelSpinning = false, wheelLast = "";

function wheelMessage(msg, isError = false) {
  wheelStatus.textContent = msg;
  wheelStatus.classList.toggle("error", isError);
}

function wheelOptions() {
  return wheelInput.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 40);
}

function wheelColor(i, n) {
  let k = i % WHEEL_COLORS.length;
  if (i === n - 1 && k === 0 && n > 1) k = 2; // évite deux couleurs identiques côte à côte
  return WHEEL_COLORS[k];
}

function drawWheel() {
  const ctx = wheelCanvas.getContext("2d");
  const size = wheelCanvas.width, c = size / 2, r = c - 8;
  ctx.clearRect(0, 0, size, size);
  const opts = wheelOptions();

  if (opts.length < 2) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, TWO_PI);
    ctx.fillStyle = "#211b45";
    ctx.fill();
    ctx.fillStyle = "#b9b2de";
    ctx.font = '700 26px "DM Sans", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("Ajoute au moins 2 options", c, c);
    return;
  }

  const seg = TWO_PI / opts.length;
  opts.forEach((label, i) => {
    const [bg, fg] = wheelColor(i, opts.length);
    const a0 = wheelRot + i * seg;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, r, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = "rgba(21,17,46,.6)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(a0 + seg / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fg;
    const fontSize = Math.max(12, Math.min(28, Math.floor(r * seg * 0.45)));
    ctx.font = `700 ${fontSize}px "DM Sans", sans-serif`;
    const maxW = r - 70;
    let chars = Array.from(label);
    if (ctx.measureText(label).width > maxW) {
      while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > maxW) chars.pop();
      chars = Array.from(chars.join("").trimEnd() + "…");
    }
    ctx.fillText(chars.join(""), r - 18, 0);
    ctx.restore();
  });

  ctx.beginPath();
  ctx.arc(c, c, 26, 0, TWO_PI);
  ctx.fillStyle = "#15112e";
  ctx.fill();
  ctx.strokeStyle = "#f6f3ff";
  ctx.lineWidth = 4;
  ctx.stroke();
}

function spinWheel() {
  if (wheelSpinning) return;
  const opts = wheelOptions();
  if (opts.length < 2) return wheelMessage("Ajoute au moins 2 options (une par ligne).", true);

  wheelSpinning = true;
  wheelSpin.disabled = true;
  wheelInput.disabled = true;
  wheelResult.hidden = true;
  wheelMessage("");

  const n = opts.length, seg = TWO_PI / n;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const winner = buf[0] % n; // tirage au sort, décidé avant l'animation
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const target = -Math.PI / 2 - (winner + 0.5) * seg + jitter; // le gagnant finit sous la flèche (en haut)
  const delta = (((target - wheelRot) % TWO_PI) + TWO_PI) % TWO_PI;
  const start = wheelRot;
  const end = start + TWO_PI * (5 + Math.floor(Math.random() * 3)) + delta;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduce ? 1200 : 5000 + Math.random() * 1500;
  const t0 = performance.now();

  function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    wheelRot = start + (end - start) * (1 - Math.pow(1 - p, 4));
    drawWheel();
    if (p < 1) return requestAnimationFrame(frame);
    wheelRot = end % TWO_PI;
    drawWheel();
    wheelLast = opts[winner];
    wheelWinner.textContent = "🎉 " + wheelLast;
    wheelResult.hidden = false;
    wheelSpinning = false;
    wheelSpin.disabled = false;
    wheelInput.disabled = false;
  }
  requestAnimationFrame(frame);
}

wheelSpin.addEventListener("click", spinWheel);
wheelInput.addEventListener("input", () => { if (!wheelSpinning) { wheelResult.hidden = true; drawWheel(); } });
wheelRemove.addEventListener("click", () => {
  const lines = wheelInput.value.split("\n");
  const idx = lines.findIndex((l) => l.trim() === wheelLast);
  if (idx >= 0) lines.splice(idx, 1);
  wheelInput.value = lines.join("\n");
  wheelResult.hidden = true;
  drawWheel();
});
drawWheel();
