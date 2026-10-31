const $ = (id) => document.getElementById(id);

// ---------- Navigation : catégories et outils ----------
const lastTool = {}; // dernier outil ouvert dans chaque catégorie

function openTab(id) {
  const panel = document.getElementById(id);
  if (!panel || !panel.classList.contains("panel")) return;
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p === panel));

  const tool = document.querySelector(`.tab[data-tab="${id}"]`);
  const group = tool ? tool.closest(".subgroup") : null;
  if (group) lastTool[group.dataset.cat] = id;

  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === id;
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  document.querySelectorAll(".subgroup").forEach((s) => { s.hidden = s !== group; });
  document.querySelectorAll(".cat").forEach((c) => {
    const on = group ? c.dataset.cat === group.dataset.cat : c.dataset.tab === id;
    c.classList.toggle("active", on);
    if (on) c.setAttribute("aria-current", "page"); else c.removeAttribute("aria-current");
  });

  // garde l'élément actif visible dans les menus qui défilent (téléphone)
  document.querySelectorAll(".cat.active, .tab.active").forEach((el) => {
    if (el.offsetParent) el.scrollIntoView({ inline: "center", block: "nearest" });
  });
  history.replaceState(null, "", id === "home" ? location.pathname + location.search : "#" + id);
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => openTab(t.dataset.tab)));
document.querySelectorAll(".cat").forEach((c) => c.addEventListener("click", () => {
  if (c.dataset.tab) return openTab(c.dataset.tab); // Accueil
  const group = document.querySelector(`.subgroup[data-cat="${c.dataset.cat}"]`);
  openTab(lastTool[c.dataset.cat] || group.querySelector(".tab").dataset.tab);
}));

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
const cvMax = $("cvMax");

function cvSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(bytes / 1024)) + " Ko";
}
function cvMessage(msg, isError = false) {
  cvStatus.textContent = msg;
  cvStatus.classList.toggle("error", isError);
}

// ---------- Convertir : lecture, recadrage, pivotement, export ----------
const CV_MAX_SIDE = 6000;
const cvPanel = $("cvPanel"), cvStage = $("cvStage"), cvStageWrap = $("cvStageWrap"), cvBox = $("cvBox");
const cvCropOn = $("cvCropOn"), cvAspect = $("cvAspect"), cvCropInfo = $("cvCropInfo");
let cvOrig = null, cvBase = null, cvRot = 0, cvFlip = false, cvJob = 0, cvDrag = null;
let cvCrop = { x: 0, y: 0, w: 1, h: 1 }; // fractions de l'image (0 à 1)
const cvClamp = (v, a, b) => Math.max(a, Math.min(b, v));

function cvRatio() {
  if (cvAspect.value === "free") return 0;
  const [a, b] = cvAspect.value.split(":").map(Number);
  return a / b;
}

function cvResetCrop() { // grand cadre centré, légèrement plus petit que l'image
  const W = cvBase.width, H = cvBase.height, r = cvRatio();
  let w = 1, h = 1;
  if (r) {
    if (W / H > r) w = (H * r) / W;
    else h = W / r / H;
  }
  w *= 0.8; h *= 0.8;
  cvCrop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  cvBoxDraw();
}

function cvBoxDraw() {
  const on = cvCropOn.checked && !!cvBase;
  cvBox.hidden = !on;
  if (!on) { cvCropInfo.textContent = ""; return; }
  cvBox.style.left = cvCrop.x * 100 + "%";
  cvBox.style.top = cvCrop.y * 100 + "%";
  cvBox.style.width = cvCrop.w * 100 + "%";
  cvBox.style.height = cvCrop.h * 100 + "%";
  cvCropInfo.textContent = `Zone recadrée : ${Math.round(cvCrop.w * cvBase.width)} × ${Math.round(cvCrop.h * cvBase.height)} px`;
}

function cvRefreshBase() { // applique pivotement et miroir, puis dessine l'aperçu
  const sw = cvOrig.width, sh = cvOrig.height, swap = cvRot % 2 === 1;
  const c = document.createElement("canvas");
  c.width = swap ? sh : sw;
  c.height = swap ? sw : sh;
  const x = c.getContext("2d");
  x.translate(c.width / 2, c.height / 2);
  x.scale(cvFlip ? -1 : 1, 1);
  x.rotate((cvRot * Math.PI) / 2);
  x.drawImage(cvOrig, -sw / 2, -sh / 2);
  cvBase = c;
  const k = Math.min(1, 900 / Math.max(c.width, c.height));
  cvStage.width = Math.max(1, Math.round(c.width * k));
  cvStage.height = Math.max(1, Math.round(c.height * k));
  cvStage.getContext("2d").drawImage(c, 0, 0, cvStage.width, cvStage.height);
  cvResetCrop();
}

function cvRender() { // recadre, réduit, convertit, puis affiche le résultat
  if (!cvBase || !cvCurrent) return;
  const file = cvCurrent, mime = cvFormat.value, job = ++cvJob;
  const bw = cvBase.width, bh = cvBase.height;
  let sx = 0, sy = 0, sw = bw, sh = bh;
  if (cvCropOn.checked) {
    sx = Math.round(cvCrop.x * bw);
    sy = Math.round(cvCrop.y * bh);
    sw = Math.max(1, Math.min(bw - sx, Math.round(cvCrop.w * bw)));
    sh = Math.max(1, Math.min(bh - sy, Math.round(cvCrop.h * bh)));
  }
  const maxPx = parseInt(cvMax.value, 10) || 0;
  const k = maxPx ? Math.min(1, maxPx / Math.max(sw, sh)) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * k));
  canvas.height = Math.max(1, Math.round(sh * k));
  const ctx = canvas.getContext("2d");
  if (mime === "image/jpeg") { // le JPG n'a pas de transparence : fond blanc
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cvBase, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  cvMessage("Conversion…");
  canvas.toBlob((blob) => {
    if (job !== cvJob) return; // une réponse plus récente est en cours
    if (!blob || blob.type !== mime) return cvMessage("Ton navigateur ne sait pas créer ce format.", true);
    if (cvUrl) URL.revokeObjectURL(cvUrl);
    cvUrl = URL.createObjectURL(blob);
    cvPreview.src = cvUrl;
    cvSave.href = cvUrl;
    cvSave.download = file.name.replace(/\.[^.]+$/, "") + (cvCropOn.checked ? "-recadre" : "") + "." + CV_EXT[mime];
    cvResult.hidden = false;
    cvMessage(`Terminé ! ${cvSize(file.size)} → ${cvSize(blob.size)} · ${canvas.width} × ${canvas.height} px · infos cachées supprimées`);
  }, mime, parseFloat(cvQuality.value));
}

function convertImage(file) {
  if (!file || !file.type.startsWith("image/")) return cvMessage("Choisis un fichier image.", true);
  if (file === cvCurrent && cvBase) return cvRender(); // même photo : on recalcule seulement
  cvMessage("Lecture de l'image…");
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, CV_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    cvOrig = c;
    cvCurrent = file;
    cvRot = 0; cvFlip = false;
    cvCropOn.checked = false;
    cvAspect.value = "free";
    cvPanel.hidden = false;
    cvRefreshBase();
    cvRender();
  };
  img.onerror = () => { URL.revokeObjectURL(url); cvMessage("Impossible de lire cette image.", true); };
  img.src = url;
}

// --- Réglages du panneau ---
cvCropOn.addEventListener("change", () => { if (!cvBase) return; if (cvCropOn.checked) cvResetCrop(); cvBoxDraw(); cvRender(); });
cvAspect.addEventListener("change", () => { if (!cvBase) return; cvCropOn.checked = true; cvResetCrop(); cvRender(); });
$("cvTurnL").addEventListener("click", () => { if (!cvOrig) return; cvRot = (cvRot + 3) % 4; cvRefreshBase(); cvRender(); });
$("cvTurnR").addEventListener("click", () => { if (!cvOrig) return; cvRot = (cvRot + 1) % 4; cvRefreshBase(); cvRender(); });
$("cvMirror").addEventListener("click", () => { if (!cvOrig) return; cvFlip = !cvFlip; cvRefreshBase(); cvRender(); });
$("cvUndo").addEventListener("click", () => {
  if (!cvOrig) return;
  cvRot = 0; cvFlip = false;
  cvCropOn.checked = false;
  cvAspect.value = "free";
  cvRefreshBase();
  cvRender();
});

// --- Déplacer et redimensionner le cadre ---
function cvPoint(e) {
  const r = cvStageWrap.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
}

cvBox.addEventListener("pointerdown", (e) => {
  if (!cvBase) return;
  e.preventDefault();
  cvBox.setPointerCapture(e.pointerId);
  cvDrag = { mode: (e.target.dataset && e.target.dataset.h) || "move", start: cvPoint(e), rect: { ...cvCrop } };
});

cvBox.addEventListener("pointermove", (e) => {
  if (!cvDrag) return;
  const d = cvDrag, p = cvPoint(e), W = cvBase.width, H = cvBase.height;
  if (d.mode === "move") {
    cvCrop.x = cvClamp(d.rect.x + p.x - d.start.x, 0, 1 - d.rect.w);
    cvCrop.y = cvClamp(d.rect.y + p.y - d.start.y, 0, 1 - d.rect.h);
  } else {
    const m = d.mode; // nw, ne, sw ou se : le coin opposé reste fixe
    const ax = m.includes("w") ? d.rect.x + d.rect.w : d.rect.x;
    const ay = m.includes("n") ? d.rect.y + d.rect.h : d.rect.y;
    const px = cvClamp(p.x, 0, 1), py = cvClamp(p.y, 0, 1);
    const sx = px >= ax ? 1 : -1, sy = py >= ay ? 1 : -1;
    let wpx = Math.abs(px - ax) * W, hpx = Math.abs(py - ay) * H;
    const r = cvRatio();
    if (r) {
      wpx = Math.max(wpx, hpx * r);
      wpx = Math.min(wpx, (sx > 0 ? 1 - ax : ax) * W, (sy > 0 ? 1 - ay : ay) * H * r);
      wpx = Math.max(wpx, 20);
      hpx = wpx / r;
    } else {
      wpx = Math.max(wpx, 20);
      hpx = Math.max(hpx, 20);
    }
    const w = Math.min(1, wpx / W), h = Math.min(1, hpx / H);
    cvCrop = {
      x: cvClamp(sx > 0 ? ax : ax - w, 0, 1 - w),
      y: cvClamp(sy > 0 ? ay : ay - h, 0, 1 - h),
      w, h,
    };
  }
  cvBoxDraw();
});

function cvDragEnd() {
  if (!cvDrag) return;
  cvDrag = null;
  cvRender();
}
cvBox.addEventListener("pointerup", cvDragEnd);
cvBox.addEventListener("pointercancel", cvDragEnd);

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

// ---------- Pomodoro ----------
const pdTime = $("pdTime"), pdPhase = $("pdPhase"), pdRing = $("pdRing"), pdStart = $("pdStart");
const pdReset = $("pdReset"), pdSkip = $("pdSkip"), pdTask = $("pdTask"), pdToday = $("pdToday"), pdMsg = $("pdMsg");
const pdFocus = $("pdFocus"), pdShort = $("pdShort"), pdLong = $("pdLong"), pdSound = $("pdSound");
const pdDots = $("pdDots"), pdClock = document.querySelector(".pd-clock");
const PD_CIRC = 2 * Math.PI * 90;
const PD_NAMES = { focus: "Concentration", short: "Pause courte", long: "Pause longue" };
const PD_DEFAULTS = { focus: 25, short: 5, long: 15 };
const pd = { mode: "focus", total: 1, left: 1, running: false, endAt: 0, done: 0, today: 0, timer: null };
let pdWorker = null;

function pdMinutes(mode) {
  const input = { focus: pdFocus, short: pdShort, long: pdLong }[mode];
  const v = parseInt(input.value, 10);
  return Math.min(180, v >= 1 ? v : PD_DEFAULTS[mode]);
}
function pdFmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}
function pdLoadToday() {
  try {
    const d = JSON.parse(localStorage.getItem("clippo_pomodoro") || "{}");
    return d.day === new Date().toDateString() ? d.count || 0 : 0;
  } catch { return 0; }
}
function pdSaveToday() {
  try { localStorage.setItem("clippo_pomodoro", JSON.stringify({ day: new Date().toDateString(), count: pd.today })); } catch { /* stockage indisponible */ }
}

function pdRender() {
  pdTime.textContent = pdFmt(pd.left);
  pdRing.style.strokeDashoffset = String(PD_CIRC * (1 - pd.left / pd.total));
  pdClock.classList.remove("short", "long");
  if (pd.mode !== "focus") pdClock.classList.add(pd.mode);
  document.querySelectorAll("#pdModes .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === pd.mode));

  const task = pdTask.value.trim();
  pdPhase.textContent = pd.mode === "focus"
    ? `Session ${(pd.done % 4) + 1} sur 4` + (task ? " · " + task : "")
    : PD_NAMES[pd.mode];
  const filled = pd.mode === "long" ? 4 : pd.done % 4;
  Array.from(pdDots.children).forEach((d, i) => d.classList.toggle("on", i < filled));

  pdStart.textContent = pd.running ? "Pause" : pd.left < pd.total ? "Reprendre" : "Démarrer";
  pdToday.textContent = `Sessions terminées aujourd'hui : ${pd.today}`;
  document.title = pd.running ? `${pdFmt(pd.left)} · ${PD_NAMES[pd.mode]}` : "Clippo";
}

function pdStartTicker() {
  try {
    if (!pdWorker) { // un worker n'est pas ralenti quand l'onglet est en arrière-plan
      const src = "let t=null;onmessage=function(e){clearInterval(t);if(e.data==='start')t=setInterval(function(){postMessage(1)},250);};";
      pdWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      pdWorker.onmessage = pdTick;
    }
    pdWorker.postMessage("start");
  } catch {
    pd.timer = setInterval(pdTick, 250);
  }
}
function pdStopTicker() {
  if (pdWorker) pdWorker.postMessage("stop");
  clearInterval(pd.timer);
}

function pdSetMode(mode) {
  pdStopTicker();
  pd.running = false;
  pd.mode = mode;
  pd.total = pd.left = pdMinutes(mode) * 60000;
  pdRender();
}

function pdBeep() {
  if (!pdSound.checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((delay) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* pas de son possible */ }
}

function pdNextMode(finishedFocus) {
  if (!finishedFocus) return "focus";
  return pd.done % 4 === 0 ? "long" : "short";
}

function pdFinish() {
  const wasFocus = pd.mode === "focus";
  if (wasFocus) { pd.done++; pd.today++; pdSaveToday(); }
  pdBeep();
  const next = pdNextMode(wasFocus);
  pdSetMode(next);
 
  pdMsg.textContent = wasFocus
    ? `Bravo, session terminée ! ${PD_NAMES[next]} : ${pdMinutes(next)} min.`
    : "Pause terminée, on reprend !";
}

function pdTick() {
  if (!pd.running) return;
  pd.left = pd.endAt - Date.now();
  if (pd.left <= 0) return pdFinish();
  pdRender();
}

function pdToggle() {
  if (pd.running) {
    pd.left = Math.max(0, pd.endAt - Date.now());
    pd.running = false;
    pdStopTicker();
  } else {
    pdMsg.textContent = "";
    pd.endAt = Date.now() + pd.left;
    pd.running = true;
    pdStartTicker();
  }
  pdRender();
}

pdStart.addEventListener("click", pdToggle);
pdReset.addEventListener("click", () => { pdMsg.textContent = ""; pdSetMode(pd.mode); });
pdSkip.addEventListener("click", () => {
  pdMsg.textContent = "";
  pdSetMode(pd.mode === "focus" ? "short" : "focus"); // passer ne compte pas comme une session
});
document.querySelectorAll("#pdModes .chip").forEach((c) => c.addEventListener("click", () => { pdMsg.textContent = ""; pdSetMode(c.dataset.mode); }));
[pdFocus, pdShort, pdLong].forEach((el) => el.addEventListener("change", () => { if (!pd.running) pdSetMode(pd.mode); }));
pdTask.addEventListener("input", pdRender);

pdRing.style.strokeDasharray = String(PD_CIRC);
pd.today = pdLoadToday();
pdSetMode("focus");

// ---------- Calculateur de moyenne ----------
const grRows = $("grRows"), grAvg = $("grAvg"), grInfo = $("grInfo"), grNeed = $("grNeed");
const grTarget = $("grTarget"), grNextCoef = $("grNextCoef"), grNextOn = $("grNextOn");

function grNum(v) {
  const n = parseFloat(String(v).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}
function grFmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}
function grMention(avg) {
  if (avg >= 16) return "Très bien";
  if (avg >= 14) return "Bien";
  if (avg >= 12) return "Assez bien";
  if (avg >= 10) return "Passable";
  return "Sous la moyenne";
}

function grCompute() {
  let sum = 0, coefs = 0, used = 0, problems = 0;
  grRows.querySelectorAll(".gr-row").forEach((row) => {
    const inputs = row.querySelectorAll("input");
    const filled = inputs[1].value.trim() !== "";
    const note = grNum(inputs[1].value), on = grNum(inputs[2].value), coef = grNum(inputs[3].value);
    const bad = filled && !(note >= 0 && on > 0 && coef > 0 && note <= on);
    row.classList.toggle("bad", bad);
    if (!filled) return;
    if (bad) { problems++; return; }
    sum += (note / on) * 20 * coef; // chaque note est ramenée sur 20
    coefs += coef;
    used++;
  });
  return { sum, coefs, used, problems };
}

function grRender() {
  const { sum, coefs, used, problems } = grCompute();
  if (!used) {
    grAvg.textContent = "–";
    grInfo.textContent = problems ? "Vérifie les lignes en rouge." : "Entre au moins une note.";
  } else {
    const avg = sum / coefs;
    grAvg.textContent = grFmt(avg) + " / 20";
    grInfo.textContent = `Repère (mentions du bac) : ${grMention(avg)}` + (problems ? ` · ${problems} ligne(s) ignorée(s)` : "");
  }

  const target = grNum(grTarget.value), c = grNum(grNextCoef.value), on = grNum(grNextOn.value);
  if (!used) { grNeed.textContent = "Entre d'abord tes notes."; grNeed.classList.remove("error"); return; }
  if (!(target >= 0 && target <= 20 && c > 0 && on > 0)) {
    grNeed.textContent = "Vérifie la moyenne visée (entre 0 et 20), le coefficient et le barème.";
    grNeed.classList.add("error");
    return;
  }
  grNeed.classList.remove("error");
  const need20 = (target * (coefs + c) - sum) / c; // note /20 nécessaire au prochain contrôle
  if (need20 > 20) {
    grNeed.textContent = `Impossible : il faudrait ${grFmt(need20)} / 20. Avec 20 / 20, ta moyenne maximale serait ${grFmt((sum + 20 * c) / (coefs + c))} / 20.`;
  } else if (need20 <= 0) {
    grNeed.textContent = `Objectif déjà atteint : même avec 0, ta moyenne resterait à ${grFmt(sum / (coefs + c))} / 20.`;
  } else {
    const soit = on === 20 ? "" : ` (soit ${grFmt(need20)} / 20)`;
    grNeed.textContent = `Il te faut au moins ${grFmt((need20 * on) / 20)} / ${grFmt(on)}${soit} pour atteindre ${grFmt(target)}.`;
  }
}

function grAddRow(focus) {
  const row = document.createElement("div");
  row.className = "gr-row";
  row.innerHTML =
    '<input class="text-in gr-name" type="text" maxlength="30" placeholder="Matière (facultatif)" aria-label="Matière">' +
    '<input class="text-in" type="text" inputmode="decimal" placeholder="Note" aria-label="Note">' +
    '<input class="text-in" type="text" inputmode="decimal" value="20" aria-label="Barème (sur)">' +
    '<input class="text-in" type="text" inputmode="decimal" value="1" aria-label="Coefficient">' +
    '<button class="gr-del" type="button" aria-label="Supprimer cette ligne">×</button>';
  grRows.appendChild(row);
  if (focus) row.querySelectorAll("input")[1].focus();
}

function grReset() {
  grRows.innerHTML = "";
  for (let i = 0; i < 4; i++) grAddRow(false);
  grRender();
}

grRows.addEventListener("input", grRender);
grRows.addEventListener("click", (e) => {
  const del = e.target.closest(".gr-del");
  if (!del) return;
  del.parentElement.remove();
  if (!grRows.children.length) grAddRow(false);
  grRender();
});
[grTarget, grNextCoef, grNextOn].forEach((el) => el.addEventListener("input", grRender));
$("grAdd").addEventListener("click", () => { grAddRow(true); grRender(); });
$("grClear").addEventListener("click", grReset);
grReset();

// ---------- Ouverture directe d'un outil avec le lien (ex. /#qr) ----------
function openFromHash() {
  const wanted = location.hash.slice(1);
  const el = wanted && document.getElementById(wanted);
  openTab(el && el.classList.contains("panel") ? wanted : "home");
}
window.addEventListener("hashchange", openFromHash);
openFromHash();

// ---------- Liste de tâches ----------
const todoInput = $("todoInput"), todoAdd = $("todoAdd"), todoList = $("todoList"), todoCount = $("todoCount");
const todoBar = $("todoBar"), todoClear = $("todoClear"), todoStatus = $("todoStatus");
const todoDate = $("todoDate"), todoTime = $("todoTime"), todoPrio = $("todoPrio"), todoNote = $("todoNote"), todoSort = $("todoSort");
const TODO_KEY = "clippo_todos", TODO_MAX = 200, TODO_BIG = Number.MAX_SAFE_INTEGER;
const TODO_PRIO = { 1: "Basse", 2: "Normale", 3: "Haute" };
let todoFilter = "all";
let todos = [];

function todoMessage(msg, isError = false) {
  todoStatus.textContent = msg;
  todoStatus.classList.toggle("error", isError);
}
function todoMk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function todoParseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
function todoValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || "")); }

function todoLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(TODO_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((t) => t && typeof t.text === "string").slice(0, TODO_MAX).map((t) => {
          const date = todoParseDate(t.date) ? String(t.date) : "";
          return {
            id: String(t.id), text: t.text.slice(0, 120), done: !!t.done,
            date, time: date && todoValidTime(t.time) ? String(t.time) : "",
            prio: [1, 2, 3].includes(Number(t.prio)) ? Number(t.prio) : 2,
            note: String(t.note || "").slice(0, 200),
          };
        })
      : [];
  } catch { return []; }
}
function todoSave() {
  try { localStorage.setItem(TODO_KEY, JSON.stringify(todos)); }
  catch { todoMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

// Échéance en millisecondes (sans heure : fin de la journée), ou null
function todoDueAt(t) {
  const d = todoParseDate(t.date);
  if (!d) return null;
  if (todoValidTime(t.time)) { const [h, m] = t.time.split(":").map(Number); d.setHours(h, m, 0, 0); }
  else d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function todoOverdue(t) {
  if (t.done) return false;
  const at = todoDueAt(t);
  return at !== null && at < Date.now();
}
function todoDays(dateStr) {
  const n = new Date();
  const t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  return Math.round((todoParseDate(dateStr) - t0) / 86400000);
}
function todoWhen(t) {
  const diff = todoDays(t.date);
  let label;
  if (diff === 0) label = "Aujourd'hui";
  else if (diff === 1) label = "Demain";
  else if (diff === -1) label = "Hier";
  else label = todoParseDate(t.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  if (todoValidTime(t.time)) label += " à " + t.time.replace(":", " h ");
  return label;
}

function todoSorted(list) {
  const arr = list.slice();
  const due = (t) => { const x = todoDueAt(t); return x === null ? TODO_BIG : x; };
  if (todoSort.value === "date") arr.sort((a, b) => (a.done - b.done) || (due(a) - due(b)));
  else if (todoSort.value === "prio") arr.sort((a, b) => (a.done - b.done) || (b.prio - a.prio) || (due(a) - due(b)));
  return arr;
}

function todoStartEdit(li, t) {
  li.innerHTML = "";
  li.classList.add("editing");
  const form = todoMk("div", "todo-editform");

  const tx = todoMk("input", "text-in");
  tx.type = "text"; tx.maxLength = 120; tx.value = t.text; tx.setAttribute("aria-label", "Texte de la tâche");
  const dt = todoMk("input", "text-in");
  dt.type = "date"; dt.value = t.date;
  const tm = todoMk("input", "text-in");
  tm.type = "time"; tm.value = t.time;
  const pr = document.createElement("select");
  [1, 2, 3].forEach((v) => { const o = todoMk("option", "", TODO_PRIO[v]); o.value = String(v); pr.appendChild(o); });
  pr.value = String(t.prio);
  const nt = todoMk("input", "text-in");
  nt.type = "text"; nt.maxLength = 200; nt.value = t.note; nt.placeholder = "Détails (facultatif)"; nt.setAttribute("aria-label", "Détails de la tâche");

  const field = (label, el) => { const l = todoMk("label", "select"); l.append(todoMk("span", "", label), el); return l; };
  const opts = todoMk("div", "todo-opts");
  opts.append(field("Date", dt), field("Heure", tm), field("Priorité", pr));

  const save = todoMk("button", "primary", "Enregistrer");
  save.type = "button";
  const cancel = todoMk("button", "ghost-btn", "Annuler");
  cancel.type = "button";
  const row = todoMk("div", "row todo-editbtns");
  row.append(save, cancel);

  const doSave = () => {
    const v = tx.value.trim();
    if (!v) return todoMessage("Le texte de la tâche ne peut pas être vide.", true);
    if (tm.value && !dt.value) return todoMessage("Choisis une date pour ajouter une heure.", true);
    t.text = v.slice(0, 120);
    t.date = todoParseDate(dt.value) ? dt.value : "";
    t.time = t.date && todoValidTime(tm.value) ? tm.value : "";
    t.prio = parseInt(pr.value, 10);
    t.note = nt.value.trim().slice(0, 200);
    todoMessage("");
    todoSave();
    todoRender();
  };
  save.addEventListener("click", doSave);
  cancel.addEventListener("click", () => { todoMessage(""); todoRender(); });
  [tx, nt].forEach((el) => el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSave();
    if (e.key === "Escape") todoRender();
  }));

  form.append(tx, opts, nt, row);
  li.appendChild(form);
  tx.focus();
}

function todoRender() {
  let shown = todos.filter((t) => todoFilter === "all" || (todoFilter === "open" ? !t.done : todoFilter === "done" ? t.done : todoOverdue(t)));
  shown = todoSorted(shown);
  todoList.innerHTML = "";
  if (!shown.length) {
    const li = todoMk("li", "todo-empty",
      todoFilter === "late" ? "Aucune tâche en retard. Bravo !"
        : todos.length ? "Rien à afficher dans cette liste." : "Aucune tâche pour l'instant. Ajoute-en une !");
    todoList.appendChild(li);
  }
  shown.forEach((t) => {
    const late = todoOverdue(t);
    const li = todoMk("li", "todo-item" + (t.done ? " done" : "") + (late ? " late" : "") + " prio" + t.prio);

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.setAttribute("aria-label", "Terminée : " + t.text);
    cb.addEventListener("change", () => { t.done = cb.checked; todoSave(); todoRender(); });

    const main = todoMk("div", "todo-main");
    main.appendChild(todoMk("span", "todo-text", t.text)); // texte brut : rien n'est interprété comme du code
    const meta = todoMk("div", "todo-meta");
    if (t.date) {
      const soon = !t.done && !late && todoDays(t.date) === 0;
      meta.appendChild(todoMk("span", "todo-chip" + (late ? " late" : soon ? " soon" : ""), (late ? "⚠️ En retard · " : "📅 ") + todoWhen(t)));
    }
    if (t.prio === 3) meta.appendChild(todoMk("span", "todo-chip p3", "🔥 Haute"));
    if (t.prio === 1) meta.appendChild(todoMk("span", "todo-chip p1", "Basse"));
    if (t.note) meta.appendChild(todoMk("span", "todo-note", t.note));
    if (meta.children.length) main.appendChild(meta);

    const edit = todoMk("button", "todo-btn", "✎");
    edit.type = "button";
    edit.setAttribute("aria-label", "Modifier : " + t.text);
    edit.addEventListener("click", () => todoStartEdit(li, t));

    const del = todoMk("button", "todo-btn", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Supprimer : " + t.text);
    del.addEventListener("click", () => { todos = todos.filter((x) => x.id !== t.id); todoSave(); todoRender(); });

    li.append(cb, main, edit, del);
    todoList.appendChild(li);
  });

  const done = todos.filter((t) => t.done).length, open = todos.length - done;
  const lateCount = todos.filter(todoOverdue).length;
  todoCount.textContent = todos.length
    ? `${open} à faire · ${done} terminée${done > 1 ? "s" : ""}` + (lateCount ? ` · ${lateCount} en retard` : "")
    : "";
  todoBar.style.width = todos.length ? Math.round((done / todos.length) * 100) + "%" : "0%";
  todoClear.hidden = done === 0;
}

function todoAddTask() {
  const text = todoInput.value.trim();
  if (!text) return;
  if (todoTime.value && !todoDate.value) return todoMessage("Choisis une date pour ajouter une heure.", true);
  if (todos.length >= TODO_MAX) return todoMessage(`Tu as atteint la limite de ${TODO_MAX} tâches. Supprime-en une.`, true);
  const date = todoParseDate(todoDate.value) ? todoDate.value : "";
  todos.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text.slice(0, 120), done: false, date,
    time: date && todoValidTime(todoTime.value) ? todoTime.value : "",
    prio: parseInt(todoPrio.value, 10),
    note: todoNote.value.trim().slice(0, 200),
  });
  todoInput.value = ""; todoDate.value = ""; todoTime.value = ""; todoPrio.value = "2"; todoNote.value = "";
  todoMessage("");
  todoSave();
  todoRender();
  todoInput.focus();
}

todoAdd.addEventListener("click", todoAddTask);
[todoInput, todoNote].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") todoAddTask(); }));
todoSort.addEventListener("change", todoRender);
$("todoFilters").querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
  todoFilter = chip.dataset.filter;
  $("todoFilters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  todoRender();
}));
todoClear.addEventListener("click", () => { todos = todos.filter((t) => !t.done); todoSave(); todoRender(); });

todos = todoLoad();
todoRender();
// les retards se mettent à jour tout seuls (sans fermer une modification en cours)
setInterval(() => { if (!todoList.querySelector(".editing")) todoRender(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && !todoList.querySelector(".editing")) todoRender(); });
// ---------- Flashcards ----------
const fcCard = $("fcCard"), fcSide = $("fcSide"), fcText = $("fcText"), fcCount = $("fcCount");
const fcQ = $("fcQ"), fcA = $("fcA"), fcList = $("fcList");
const FC_KEY = "clippo_flashcards", FC_MAX = 300;
let fcCards = [], fcIndex = 0, fcShowAnswer = false, fcFilter = "all";

function fcLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(FC_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((c) => c && typeof c.q === "string" && typeof c.a === "string").slice(0, FC_MAX)
          .map((c) => ({ id: String(c.id), q: c.q.slice(0, 200), a: c.a.slice(0, 300), known: !!c.known }))
      : [];
  } catch { return []; }
}
function fcSave() {
  try { localStorage.setItem(FC_KEY, JSON.stringify(fcCards)); } catch { /* stockage indisponible */ }
}
function fcDeck() {
  return fcFilter === "review" ? fcCards.filter((c) => !c.known) : fcCards;
}

function fcRender() {
  const deck = fcDeck();
  if (fcIndex >= deck.length) fcIndex = 0;
  const empty = !deck.length;
  ["fcPrev", "fcFlip", "fcNext", "fcKnow", "fcAgain", "fcShuffle"].forEach((id) => { $(id).disabled = empty; });
  fcCard.disabled = empty;

  if (empty) {
    fcCard.classList.remove("back");
    fcSide.textContent = "";
    fcText.textContent = fcCards.length ? "Bravo, tu connais toutes les cartes !" : "Ajoute ta première carte ci-dessous.";
    fcCount.textContent = "";
  } else {
    const c = deck[fcIndex];
    fcCard.classList.toggle("back", fcShowAnswer);
    fcSide.textContent = fcShowAnswer ? "Réponse" : "Question";
    fcText.textContent = fcShowAnswer ? c.a : c.q;
    const known = fcCards.filter((x) => x.known).length;
    fcCount.textContent = `Carte ${fcIndex + 1} sur ${deck.length} · ${known} sue${known > 1 ? "s" : ""} sur ${fcCards.length}`;
  }

  fcList.innerHTML = "";
  fcCards.forEach((c) => {
    const li = document.createElement("li");
    li.className = "todo-item" + (c.known ? " known" : "");
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = c.q;
    const ans = document.createElement("span");
    ans.className = "fc-ans";
    ans.textContent = c.a;
    text.appendChild(ans);
    const del = document.createElement("button");
    del.className = "todo-btn";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", "Supprimer : " + c.q);
    del.addEventListener("click", () => { fcCards = fcCards.filter((x) => x.id !== c.id); fcSave(); fcRender(); });
    li.append(text, del);
    fcList.appendChild(li);
  });
}

function fcMove(step) {
  const deck = fcDeck();
  if (!deck.length) return;
  fcIndex = (fcIndex + step + deck.length) % deck.length;
  fcShowAnswer = false;
  fcRender();
}
function fcMark(known) {
  const deck = fcDeck();
  if (!deck.length) return;
  deck[fcIndex].known = known;
  fcSave();
  fcShowAnswer = false;
  if (fcFilter === "all") fcIndex = (fcIndex + 1) % deck.length; // en mode « À revoir », la carte sue disparaît du paquet
  fcRender();
}
function fcFlip() { fcShowAnswer = !fcShowAnswer; fcRender(); }

$("fcAdd").addEventListener("click", () => {
  const q = fcQ.value.trim(), a = fcA.value.trim();
  if (!q || !a) return;
  if (fcCards.length >= FC_MAX) return;
  fcCards.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), q, a, known: false });
  fcQ.value = ""; fcA.value = "";
  fcSave();
  fcRender();
  fcQ.focus();
});
[fcQ, fcA].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") $("fcAdd").click(); }));
fcCard.addEventListener("click", fcFlip);
$("fcFlip").addEventListener("click", fcFlip);
$("fcNext").addEventListener("click", () => fcMove(1));
$("fcPrev").addEventListener("click", () => fcMove(-1));
$("fcKnow").addEventListener("click", () => fcMark(true));
$("fcAgain").addEventListener("click", () => fcMark(false));
$("fcShuffle").addEventListener("click", () => {
  for (let i = fcCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fcCards[i], fcCards[j]] = [fcCards[j], fcCards[i]];
  }
  fcIndex = 0; fcShowAnswer = false;
  fcSave();
  fcRender();
});
$("fcClearAll").addEventListener("click", () => {
  if (fcCards.length && confirm("Supprimer toutes tes cartes ?")) {
    fcCards = []; fcIndex = 0; fcShowAnswer = false;
    fcSave();
    fcRender();
  }
});
$("fcFilters").querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
  fcFilter = chip.dataset.filter;
  fcIndex = 0; fcShowAnswer = false;
  $("fcFilters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  fcRender();
}));

fcCards = fcLoad();
fcRender();

todos = todoLoad();
todoRender();

// ---------- Détection des mises à jour ----------
const VERSION_KEY = "clippo_version";
let updating = false;

function showUpdateOverlay() {
  const box = document.createElement("div");
  box.className = "upd-overlay";
  box.setAttribute("role", "alert");
  box.innerHTML = '<div class="upd-box"><span class="upd-spin" aria-hidden="true"></span><strong>Chargement de la mise à jour…</strong><small>Veuillez patienter.</small></div>';
  document.body.appendChild(box);
}

async function checkVersion() {
  if (updating) return;
  try {
    const res = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const latest = String((await res.json()).version);
    let seen = null;
    try { seen = localStorage.getItem(VERSION_KEY); } catch { /* stockage indisponible */ }
    if (seen === null) { // première visite : on note simplement la version
      try { localStorage.setItem(VERSION_KEY, latest); } catch { /* ignoré */ }
      return;
    }
    if (seen !== latest) {
      updating = true;
      try { localStorage.setItem(VERSION_KEY, latest); } catch { /* ignoré */ }
      showUpdateOverlay();
      setTimeout(() => location.reload(), 800);
    }
  } catch { /* hors ligne : on réessaiera plus tard */ }
}

checkVersion();
setInterval(checkVersion, 15000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });

// ---------- Clic sur le logo : rechargement complet ----------
document.querySelectorAll(".logo").forEach((logo) => {
  logo.addEventListener("click", (e) => {
    e.preventDefault();
    location.href = location.pathname + "?r=" + Date.now();
  });
});



// ---------- Flouter une image (dans le navigateur) ----------
const blDrop = $("blDrop"), blFile = $("blFile"), blWork = $("blWork"), blCanvas = $("blCanvas"), blStatus = $("blStatus");
const blTool = $("blTool"), blEffect = $("blEffect"), blShape = $("blShape"), blSize = $("blSize"), blPower = $("blPower");
const blUndo = $("blUndo"), blApplyAll = $("blApplyAll");
const blCtx = blCanvas.getContext("2d");
const BL_MAX = 1600, BL_UNDO = 6;
let blHistory = [], blOriginal = null, blName = "image", blDrag = null;

function blMessage(msg, isError = false) {
  blStatus.textContent = msg;
  blStatus.classList.toggle("error", isError);
}

function blUi() {
  const t = blTool.value;
  $("blShapeBox").hidden = t !== "brush";
  $("blSizeBox").hidden = t !== "brush";
  $("blPowerBox").hidden = blEffect.value === "black";
  blApplyAll.hidden = t !== "all";
  blUndo.disabled = !blHistory.length;
  blCanvas.style.cursor = t === "all" ? "default" : "crosshair";
  blCanvas.style.touchAction = t === "all" ? "auto" : "none";
}

function blPush(snap) {
  blHistory.push(snap || blCtx.getImageData(0, 0, blCanvas.width, blCanvas.height));
  if (blHistory.length > BL_UNDO) blHistory.shift();
}

function blLoad(file) {
  if (!file || !file.type.startsWith("image/")) return blMessage("Choisis un fichier image.", true);
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, BL_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    blCanvas.width = Math.max(1, Math.round(img.naturalWidth * s));
    blCanvas.height = Math.max(1, Math.round(img.naturalHeight * s));
    blCtx.drawImage(img, 0, 0, blCanvas.width, blCanvas.height);
    URL.revokeObjectURL(url);
    blOriginal = blCtx.getImageData(0, 0, blCanvas.width, blCanvas.height);
    blHistory = [];
    blName = file.name.replace(/\.[^.]+$/, "") || "image";
    blWork.hidden = false;
    blUi();
    blMessage("Choisis un outil, puis dessine sur l'image pour la flouter.");
  };
  img.onerror = () => { URL.revokeObjectURL(url); blMessage("Impossible de lire cette image.", true); };
  img.src = url;
}

// Crée une copie de l'image avec l'effet choisi (flou, pixelisé ou noir)
function blMakeEffect() {
  const w = blCanvas.width, h = blCanvas.height;
  const unit = Math.max(w, h) / 1000;
  const p = parseInt(blPower.value, 10);
  const fx = document.createElement("canvas");
  fx.width = w; fx.height = h;
  const c = fx.getContext("2d");
  const kind = blEffect.value;

  if (kind === "black") {
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    return fx;
  }
  if (kind === "pixel") {
    const size = Math.max(3, Math.round(p * unit * 1.2));
    const sw = Math.max(1, Math.ceil(w / size)), sh = Math.max(1, Math.ceil(h / size));
    const t = document.createElement("canvas");
    t.width = sw; t.height = sh;
    const tc = t.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.drawImage(blCanvas, 0, 0, sw, sh);
    c.imageSmoothingEnabled = false;
    c.drawImage(t, 0, 0, sw, sh, 0, 0, sw * size, sh * size);
    return fx;
  }
  const blur = Math.max(1, p * unit);
  if (typeof c.filter === "string") {
    const pad = Math.ceil(blur * 2); // évite les bords transparents
    c.filter = `blur(${blur}px)`;
    c.drawImage(blCanvas, -pad, -pad, w + pad * 2, h + pad * 2);
    c.filter = "none";
  } else { // navigateurs sans filtre canvas : flou par réduction
    const f = Math.max(2, blur);
    const sw = Math.max(1, Math.round(w / f)), sh = Math.max(1, Math.round(h / f));
    const t = document.createElement("canvas");
    t.width = sw; t.height = sh;
    const tc = t.getContext("2d");
    tc.imageSmoothingQuality = "high";
    tc.drawImage(blCanvas, 0, 0, sw, sh);
    c.imageSmoothingQuality = "high";
    c.drawImage(t, 0, 0, sw, sh, 0, 0, w, h);
  }
  return fx;
}

function blPos(e) {
  const r = blCanvas.getBoundingClientRect();
  const k = blCanvas.width / r.width;
  return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
}

function blStamp(fx, x, y, r, shape) {
  blCtx.save();
  blCtx.beginPath();
  if (shape === "square") blCtx.rect(x - r, y - r, r * 2, r * 2);
  else blCtx.arc(x, y, r, 0, Math.PI * 2);
  blCtx.clip();
  blCtx.drawImage(fx, 0, 0);
  blCtx.restore();
}

function blShapePath(tool, a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  blCtx.beginPath();
  if (tool === "ellipse") blCtx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else blCtx.rect(x, y, w, h);
}

blCanvas.addEventListener("pointerdown", (e) => {
  if (!blOriginal || blTool.value === "all") return;
  e.preventDefault();
  blCanvas.setPointerCapture(e.pointerId);
  const p = blPos(e);
  const snap = blCtx.getImageData(0, 0, blCanvas.width, blCanvas.height);
  blPush(snap);
  blDrag = { tool: blTool.value, snap, start: p, last: p, fx: blMakeEffect(), r: (parseInt(blSize.value, 10) * p.k) / 2, shape: blShape.value };
  if (blDrag.tool === "brush") blStamp(blDrag.fx, p.x, p.y, blDrag.r, blDrag.shape);
  blUi();
});

blCanvas.addEventListener("pointermove", (e) => {
  if (!blDrag) return;
  const p = blPos(e), d = blDrag;
  if (d.tool === "brush") {
    const dx = p.x - d.last.x, dy = p.y - d.last.y;
    const n = Math.ceil(Math.hypot(dx, dy) / Math.max(1, d.r / 3));
    for (let i = 1; i <= n; i++) blStamp(d.fx, d.last.x + (dx * i) / n, d.last.y + (dy * i) / n, d.r, d.shape);
  } else {
    blCtx.putImageData(d.snap, 0, 0);
    blCtx.save();
    blShapePath(d.tool, d.start, p);
    blCtx.lineWidth = 3 * p.k;
    blCtx.strokeStyle = "#000";
    blCtx.setLineDash([8 * p.k, 6 * p.k]);
    blCtx.stroke();
    blCtx.lineWidth = 1.5 * p.k;
    blCtx.strokeStyle = "#fff";
    blCtx.stroke();
    blCtx.restore();
  }
  d.last = p;
});

function blEnd(e, cancel) {
  if (!blDrag) return;
  const d = blDrag;
  blDrag = null;
  if (d.tool !== "brush") {
    blCtx.putImageData(d.snap, 0, 0);
    const p = blPos(e);
    if (cancel || Math.abs(p.x - d.start.x) < 3 || Math.abs(p.y - d.start.y) < 3) {
      blHistory.pop();
    } else {
      blCtx.save();
      blShapePath(d.tool, d.start, p);
      blCtx.clip();
      blCtx.drawImage(d.fx, 0, 0);
      blCtx.restore();
    }
  }
  blUi();
}
blCanvas.addEventListener("pointerup", (e) => blEnd(e, false));
blCanvas.addEventListener("pointercancel", (e) => blEnd(e, true));

blApplyAll.addEventListener("click", () => {
  if (!blOriginal) return;
  blPush();
  blCtx.drawImage(blMakeEffect(), 0, 0);
  blUi();
  blMessage("Effet appliqué à toute l'image.");
});
blUndo.addEventListener("click", () => {
  const snap = blHistory.pop();
  if (snap) blCtx.putImageData(snap, 0, 0);
  blUi();
});
$("blReset").addEventListener("click", () => {
  if (!blOriginal) return;
  blCtx.putImageData(blOriginal, 0, 0);
  blHistory = [];
  blUi();
  blMessage("Image réinitialisée.");
});
$("blSave").addEventListener("click", () => {
  if (!blOriginal) return;
  blCanvas.toBlob((b) => {
    if (!b) return blMessage("Impossible de créer l'image.", true);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = blName + "-flou.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
});

[blTool, blEffect].forEach((el) => el.addEventListener("change", blUi));
blFile.addEventListener("change", () => blLoad(blFile.files[0]));
["dragenter", "dragover"].forEach((ev) => blDrop.addEventListener(ev, (e) => { e.preventDefault(); blDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => blDrop.addEventListener(ev, (e) => { e.preventDefault(); blDrop.classList.remove("over"); }));
blDrop.addEventListener("drop", (e) => blLoad(e.dataTransfer.files[0]));

// ---------- Améliorer une image (dans le navigateur) ----------
const upDrop = $("upDrop"), upFile = $("upFile"), upStatus = $("upStatus"), upResult = $("upResult");
const upScale = $("upScale"), upSharp = $("upSharp"), upDenoise = $("upDenoise"), upBoost = $("upBoost");
const upSave = $("upSave"), upSaveRow = $("upSaveRow");
let upCurrent = null, upBusy = false, upBeforeUrl = null, upAfterUrl = null;

function upMessage(msg, isError = false) {
  upStatus.textContent = msg;
  upStatus.classList.toggle("error", isError);
}
const upPause = () => new Promise((r) => setTimeout(r, 20));

function upSharpen(canvas, a) {
  const w = canvas.width, h = canvas.height;
  if (a <= 0 || w < 3 || h < 3) return;
  const ctx = canvas.getContext("2d");
  const src = ctx.getImageData(0, 0, w, h);
  const out = ctx.createImageData(w, h);
  const s = src.data, d = out.data;
  d.set(s);
  const k = 1 + 4 * a, row = w * 4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const j = i + c;
        const v = s[j] * k - a * (s[j - 4] + s[j + 4] + s[j - row] + s[j + row]);
        d[j] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  ctx.putImageData(out, 0, 0);
}

async function upEnhance(file) {
  if (!file || !file.type.startsWith("image/")) return upMessage("Choisis un fichier image.", true);
  if (upBusy) return;
  upBusy = true;
  upCurrent = file;
  upMessage("Lecture de l'image…");
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Impossible de lire cette image."));
      im.src = srcUrl;
    });
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const maxSide = window.matchMedia("(max-width: 700px)").matches ? 2560 : 4096;
    let factor = parseInt(upScale.value, 10);
    factor = Math.min(factor, maxSide / Math.max(w0, h0));
    if (factor < 1) factor = 1; // image déjà très grande : netteté seulement
    const finalW = Math.round(w0 * factor), finalH = Math.round(h0 * factor);

    // 1. image de départ (réduction légère des défauts de compression)
    let cur = document.createElement("canvas");
    cur.width = w0; cur.height = h0;
    let c = cur.getContext("2d");
    if (upDenoise.checked && typeof c.filter === "string") c.filter = "blur(0.6px)";
    c.drawImage(img, 0, 0);
    c.filter = "none";

    // 2. agrandissement par étapes de ×2 maximum (rendu plus doux qu'un seul grand saut)
    while (cur.width < finalW || cur.height < finalH) {
      upMessage(`Agrandissement… ${cur.width} × ${cur.height}`);
      await upPause();
      const nw = Math.min(finalW, Math.round(cur.width * 2));
      const nh = Math.min(finalH, Math.round(cur.height * 2));
      const next = document.createElement("canvas");
      next.width = nw; next.height = nh;
      const nc = next.getContext("2d");
      nc.imageSmoothingEnabled = true;
      nc.imageSmoothingQuality = "high";
      nc.drawImage(cur, 0, 0, nw, nh);
      cur = next;
    }

    // 3. netteté
    upMessage("Accentuation des détails…");
    await upPause();
    upSharpen(cur, parseFloat(upSharp.value));

    // 4. couleurs
    if (upBoost.checked && typeof c.filter === "string") {
      const col = document.createElement("canvas");
      col.width = cur.width; col.height = cur.height;
      const cc = col.getContext("2d");
      cc.filter = "contrast(1.08) saturate(1.15) brightness(1.02)";
      cc.drawImage(cur, 0, 0);
      cur = col;
    }

    const blob = await new Promise((resolve) => cur.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Ton navigateur n'a pas pu créer l'image. Essaie un agrandissement plus petit.");
    if (upBeforeUrl) URL.revokeObjectURL(upBeforeUrl);
    if (upAfterUrl) URL.revokeObjectURL(upAfterUrl);
    upBeforeUrl = srcUrl;
    upAfterUrl = URL.createObjectURL(blob);
    $("upBefore").src = upBeforeUrl;
    $("upAfter").src = upAfterUrl;
    $("upBeforeCap").textContent = `Avant (${w0} × ${h0})`;
    $("upAfterCap").textContent = `Après (${cur.width} × ${cur.height})`;
    upSave.href = upAfterUrl;
    upSave.download = file.name.replace(/\.[^.]+$/, "") + "-ameliore.png";
    upResult.hidden = false;
    upSaveRow.hidden = false;
    upMessage(factor === 1 ? "Terminé ! L'image était déjà très grande : seule la netteté a été améliorée." : "Terminé ! Ton image est prête.");
  } catch (e) {
    console.error(e);
    URL.revokeObjectURL(srcUrl);
    upMessage(e.message || "L'amélioration a échoué. Essaie une image plus petite.", true);
  } finally {
    upBusy = false;
  }
}

upFile.addEventListener("change", () => upEnhance(upFile.files[0]));
[upScale, upSharp, upDenoise, upBoost].forEach((el) => el.addEventListener("change", () => { if (upCurrent) upEnhance(upCurrent); }));
["dragenter", "dragover"].forEach((ev) => upDrop.addEventListener(ev, (e) => { e.preventDefault(); upDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => upDrop.addEventListener(ev, (e) => { e.preventDefault(); upDrop.classList.remove("over"); }));
upDrop.addEventListener("drop", (e) => upEnhance(e.dataTransfer.files[0]));

// ---------- Générateur de bio ----------
const BIO_LIMITS = { tiktok: 80, instagram: 150, discord: 190, x: 160 };
const BIO_DATA = {
  mignon: {
    emo: ["🌸", "🍓", "✨", "🧸", "🐰", "☁️", "💖"],
    t: [
      "{n} · petit nuage {e}", "{n} | {i} | bisous {e}", "juste {n}, fan de {i} {e}",
      "{e} amoureux de {i} {e}", "{i} et câlins {e}", "douce vie, doux sourires {e}",
      "mode doudou activé {e}", "ici pour sourire et partager {e}", "{e} petite bulle de bonne humeur {e}",
      "{n} {e} {i} & chocolat chaud", "un peu de douceur chaque jour {e}", "{e} rêveur(se) de {i}",
    ],
  },
  gaming: {
    emo: ["🎮", "🔥", "⚡", "👾", "🏆", "🎧", "💥"],
    t: [
      "{n} | {i} | GG {e}", "{e} joueur(se) de {i} {e}", "{n} · toujours en partie {e}",
      "{i} le jour, {i} la nuit {e}", "niveau max en {i} {e}", "{e} pas de pause, que du jeu {e}",
      "AFK = jamais {e}", "{n} {e} ranked & chill", "{e} le skill, pas la chance {e}",
      "{n} · prêt pour la prochaine game {e}", "{i} addict {e}", "on se retrouve en lobby {e}",
    ],
  },
  mystere: {
    emo: ["🌙", "🖤", "🔮", "🌌", "🕯️", "🦇", "✦"],
    t: [
      "{n} · ombre de la nuit {e}", "{e} on ne sait jamais qui je suis {e}", "silence, {i} et mystère {e}",
      "{n} | {i} {e}", "né(e) sous la lune {e}", "{e} ne cherche pas, tu trouveras {e}",
      "entre ombre et lumière {e}", "{i}, secrets et minuit {e}", "{n} {e} énigme ambulante",
      "{e} certains mystères restent entiers {e}", "je parle peu, je pense beaucoup {e}", "{n} · caché(e) dans la brume {e}",
    ],
  },
  drole: {
    emo: ["😂", "🤪", "🥐", "🍕", "😎", "🤡", "🔥"],
    t: [
      "{n} · 100% bon sens, 0% sérieux {e}", "{i}, pizza et mauvaises blagues {e}", "{e} ma bio est en pause café {e}",
      "{n} | {i} | sieste {e}", "pro de {i}, amateur du reste {e}", "{e} rire d'abord, réfléchir ensuite {e}",
      "{n} : mode humour activé {e}", "je ne suis pas en retard, j'arrive en style {e}", "{e} vie de {i} et de gaffes {e}",
      "{n} {e} spécialiste de la sieste", "drôle de bio, drôle de vie {e}", "{i} ou rien, mais avec des chips {e}",
    ],
  },
  motive: {
    emo: ["💪", "🚀", "🎯", "⭐", "🔥", "📈", "✨"],
    t: [
      "{n} · un pas de plus chaque jour {e}", "{e} {i}, objectif : progresser {e}", "rêve grand, travaille dur {e}",
      "{n} | {i} | en route {e}", "{e} la discipline avant la motivation {e}", "{i} chaque jour, mieux chaque jour {e}",
      "{n} {e} jamais sans mon objectif", "{e} petit à petit, on y arrive {e}", "{i} & persévérance {e}",
      "{n} · on lâche rien {e}", "{e} aujourd'hui meilleur(e) qu'hier {e}", "{n} : cap sur {i} {e}",
    ],
  },
  chill: {
    emo: ["🌴", "☀️", "🎶", "☕", "🌊", "🍃", "😌"],
    t: [
      "{n} · tranquille, tout va bien {e}", "{e} {i}, musique et bonne humeur {e}", "vivre doucement {e}",
      "{n} | {i} | café {e}", "{e} la vie sans stress {e}", "{i} dans le calme {e}",
      "{n} {e} good vibes only", "{e} un jour à la fois {e}", "{i} et petits bonheurs {e}",
      "{n} · cool, simplement {e}", "{e} détendu(e) mais présent(e) {e}", "{n} : plage, {i}, repos {e}",
    ],
  },
};

const biStyle = $("biStyle"), biPlat = $("biPlat"), biName = $("biName"), biInt = $("biInt");
const biEmoji = $("biEmoji"), biList = $("biList");
const biLen = (s) => Array.from(s).length;

function biMake(tpl, name, interest, emojis, useEmoji) {
  let s = tpl
    .split("{n}").join(name)
    .split("{i}").join(interest)
    .split("{e}").join(useEmoji ? pick(emojis) : "");
  return s.replace(/\s+/g, " ").replace(/\s+([|·:,])/g, " $1").replace(/^[\s|·:,]+|[\s|·:,]+$/g, "").trim();
}

function biGenerate() {
  const data = BIO_DATA[biStyle.value];
  const limit = BIO_LIMITS[biPlat.value];
  const name = biName.value.trim();
  const interests = biInt.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const pool = data.t.filter((t) => (name || !t.includes("{n}")) && (interests.length || !t.includes("{i}")));
  const useEmoji = biEmoji.checked;
  const seen = new Set();
  for (let tries = 0; seen.size < 8 && tries < 150; tries++) {
    const tpl = pick(pool.length ? pool : data.t);
    const bio = biMake(tpl, name, interests.length ? pick(interests) : "", data.emo, useEmoji);
    if (bio && biLen(bio) <= limit) seen.add(bio);
  }
  return [...seen];
}

function biRender() {
  biList.innerHTML = "";
  const limit = BIO_LIMITS[biPlat.value];
  biGenerate().forEach((bio) => {
    const row = document.createElement("div");
    row.className = "fancy-row";
    const box = document.createElement("div");
    const label = document.createElement("small");
    label.textContent = `${biLen(bio)} / ${limit} caractères`;
    const out = document.createElement("span");
    out.textContent = bio;
    box.append(label, out);
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copier";
    btn.addEventListener("click", async () => {
      try {
        await copyText(bio);
        btn.textContent = "Copié !";
        btn.classList.add("done");
      } catch {
        btn.textContent = "Erreur";
      }
      setTimeout(() => { btn.textContent = "Copier"; btn.classList.remove("done"); }, 1500);
    });
    row.append(box, btn);
    biList.appendChild(row);
  });
  if (!biList.children.length) {
    const p = document.createElement("p");
    p.className = "status error";
    p.textContent = "Aucune bio assez courte pour ce réseau. Raccourcis ton prénom ou tes passions.";
    biList.appendChild(p);
  }
}

$("biGo").addEventListener("click", biRender);
[biStyle, biPlat, biEmoji].forEach((el) => el.addEventListener("change", biRender));
[biName, biInt].forEach((el) => el.addEventListener("input", biRender));
biRender();

// ---------- Générateur de mot de passe ----------
const pwLen = $("pwLen"), pwLenVal = $("pwLenVal"), pwOut = $("pwOut");
const pwBar = $("pwBar"), pwInfo = $("pwInfo"), pwStatus = $("pwStatus");
const PW_SETS = {
  pwUp: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  pwLow: "abcdefghijklmnopqrstuvwxyz",
  pwNum: "0123456789",
  pwSym: "!@#$%^&*()-_=+[]{};:,.?",
};
const PW_AMBIG = /[Il1O0o]/g;

function pwRand(n) { // entier uniforme dans [0, n), sans biais
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}

function pwMessage(msg, isError = false) {
  pwStatus.textContent = msg;
  pwStatus.classList.toggle("error", isError);
}

function pwGenerate() {
  pwLenVal.textContent = pwLen.value;
  const len = parseInt(pwLen.value, 10);
  const sets = Object.keys(PW_SETS)
    .filter((id) => $(id).checked)
    .map((id) => ($("pwAmb").checked ? PW_SETS[id].replace(PW_AMBIG, "") : PW_SETS[id]));

  if (!sets.length) {
    pwOut.value = "";
    pwBar.style.width = "0%";
    pwInfo.textContent = "";
    return pwMessage("Coche au moins un type de caractères.", true);
  }
  pwMessage("");

  const all = sets.join("");
  const chars = sets.map((s) => s[pwRand(s.length)]); // au moins un de chaque type
  while (chars.length < len) chars.push(all[pwRand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { // mélange
    const j = pwRand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  pwOut.value = chars.join("");

  const bits = len * Math.log2(all.length);
  const level = bits < 45 ? "Faible" : bits < 65 ? "Moyen" : bits < 90 ? "Bon" : "Excellent";
  pwBar.style.width = Math.min(100, Math.round((bits / 110) * 100)) + "%";
  pwInfo.textContent = `Solidité : ${level}`;
}

$("pwCopy").addEventListener("click", async () => {
  if (!pwOut.value) return pwMessage("Rien à copier.", true);
  try {
    await copyText(pwOut.value);
    pwMessage("Copié !");
  } catch {
    pwOut.select();
    pwMessage("Copie automatique impossible : le mot de passe est sélectionné, fais Ctrl + C.", true);
  }
});
$("pwGo").addEventListener("click", pwGenerate);
pwLen.addEventListener("input", pwGenerate);
["pwUp", "pwLow", "pwNum", "pwSym", "pwAmb"].forEach((id) => $(id).addEventListener("change", pwGenerate));
pwOut.addEventListener("focus", () => pwOut.select());
pwGenerate();



// ---------- Bloc-notes ----------
const ntList = $("ntList"), ntSearch = $("ntSearch"), ntEditor = $("ntEditor");
const ntTitle = $("ntTitle"), ntBody = $("ntBody"), ntInfo = $("ntInfo"), ntStatus = $("ntStatus");
const NT_KEY = "clippo_notes", NT_MAX = 100;
let notes = [], ntCur = null, ntTimer = null;

function ntMessage(msg, isError = false) {
  ntStatus.textContent = msg;
  ntStatus.classList.toggle("error", isError);
}

function ntLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(NT_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((n) => n && typeof n.body === "string").slice(0, NT_MAX)
          .map((n) => ({ id: String(n.id), title: String(n.title || "").slice(0, 80), body: n.body.slice(0, 20000), t: Number(n.t) || Date.now() }))
      : [];
  } catch { return []; }
}
function ntSave() {
  try { localStorage.setItem(NT_KEY, JSON.stringify(notes)); }
  catch { ntMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

function ntFind(id) { return notes.find((n) => n.id === id); }

function ntInfoUpdate() {
  const n = ntFind(ntCur);
  if (!n) { ntInfo.textContent = ""; return; }
  const words = n.body.trim() ? n.body.trim().split(/\s+/).length : 0;
  ntInfo.textContent = `${words} mot${words > 1 ? "s" : ""} · ${n.body.length} caractère${n.body.length > 1 ? "s" : ""}`;
}

function ntRenderList() {
  const q = ntSearch.value.trim().toLowerCase();
  const shown = notes
    .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    .sort((a, b) => b.t - a.t);
  ntList.innerHTML = "";
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = notes.length ? "Aucune note trouvée." : "Aucune note pour l'instant.";
    ntList.appendChild(li);
    return;
  }
  shown.forEach((n) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nt-item" + (n.id === ntCur ? " active" : "");
    const t = document.createElement("strong");
    t.textContent = n.title || "Sans titre";
    const p = document.createElement("span");
    p.textContent = n.body.replace(/\s+/g, " ").slice(0, 60) || "(vide)";
    const d = document.createElement("small");
    d.textContent = new Date(n.t).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    b.append(t, p, d);
    b.addEventListener("click", () => ntOpen(n.id));
    li.appendChild(b);
    ntList.appendChild(li);
  });
}

function ntOpen(id) {
  const n = ntFind(id);
  if (!n) { ntCur = null; ntEditor.hidden = true; ntRenderList(); return; }
  ntCur = id;
  ntTitle.value = n.title;
  ntBody.value = n.body;
  ntEditor.hidden = false;
  ntInfoUpdate();
  ntRenderList();
}

$("ntNew").addEventListener("click", () => {
  if (notes.length >= NT_MAX) return ntMessage(`Tu as atteint la limite de ${NT_MAX} notes. Supprime-en une.`, true);
  ntMessage("");
  ntSearch.value = "";
  const n = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: "", body: "", t: Date.now() };
  notes.unshift(n);
  ntSave();
  ntOpen(n.id);
  ntBody.focus();
});

function ntEdited() {
  const n = ntFind(ntCur);
  if (!n) return;
  n.title = ntTitle.value.slice(0, 80);
  n.body = ntBody.value;
  n.t = Date.now();
  ntInfoUpdate();
  ntRenderList();
  clearTimeout(ntTimer);
  ntTimer = setTimeout(ntSave, 300);
}
ntTitle.addEventListener("input", ntEdited);
ntBody.addEventListener("input", ntEdited);
ntSearch.addEventListener("input", ntRenderList);
window.addEventListener("pagehide", () => { clearTimeout(ntTimer); if (notes.length) ntSave(); });

$("ntCopy").addEventListener("click", async () => {
  const n = ntFind(ntCur);
  if (!n) return;
  try { await copyText((n.title ? n.title + "\n\n" : "") + n.body); ntMessage("Note copiée !"); }
  catch { ntMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
});

$("ntDownload").addEventListener("click", () => {
  const n = ntFind(ntCur);
  if (!n) return;
  const name = (n.title || "note").replace(/[^\w\u00C0-\u017F -]+/g, "").trim().slice(0, 40) || "note";
  const url = URL.createObjectURL(new Blob([(n.title ? n.title + "\n\n" : "") + n.body], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

$("ntDelete").addEventListener("click", () => {
  const n = ntFind(ntCur);
  if (!n || !confirm("Supprimer cette note ?")) return;
  notes = notes.filter((x) => x.id !== n.id);
  ntSave();
  ntMessage("");
  const next = notes.slice().sort((a, b) => b.t - a.t)[0];
  if (next) ntOpen(next.id);
  else { ntCur = null; ntEditor.hidden = true; ntRenderList(); }
});

notes = ntLoad();
if (notes.length) ntOpen(notes.slice().sort((a, b) => b.t - a.t)[0].id);
else ntRenderList();

// ---------- Compte à rebours ----------
const cdName = $("cdName"), cdDate = $("cdDate"), cdTime = $("cdTime"), cdList = $("cdList");
const cdHero = $("cdHero"), cdStatus = $("cdStatus"), cdClearPast = $("cdClearPast");
const CD_KEY = "clippo_countdowns", CD_MAX = 30;
let cdItems = [];

function cdMessage(msg, isError = false) {
  cdStatus.textContent = msg;
  cdStatus.classList.toggle("error", isError);
}

function cdLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(CD_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((x) => x && typeof x.name === "string" && Number.isFinite(Number(x.at))).slice(0, CD_MAX)
          .map((x) => ({ id: String(x.id), name: x.name.slice(0, 60), at: Number(x.at), created: Number(x.created) || Date.now() }))
      : [];
  } catch { return []; }
}
function cdSave() {
  try { localStorage.setItem(CD_KEY, JSON.stringify(cdItems)); } catch { /* stockage indisponible */ }
}

function cdParse(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  const t = /^(\d{2}):(\d{2})$/.exec(time || "") || [null, "08", "00"];
  return new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]).getTime();
}

function cdDays(at) { // jours calendaires entre aujourd'hui et la date (insensible à l'heure d'été)
  const now = new Date(), a = new Date(at);
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round((d1 - d0) / 86400000);
}

function cdFormatDate(at) {
  return new Date(at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function cdFormatTime(at) {
  return new Date(at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }).replace(":", " h ");
}

function cdRemaining(at) { // texte court pour une échéance
  const now = Date.now();
  if (at <= now) return { done: true, big: "Terminé", unit: "" };
  const days = cdDays(at);
  if (days === 0) {
    const mins = Math.max(1, Math.ceil((at - now) / 60000));
    return { done: false, big: "Aujourd'hui", unit: `encore ${Math.floor(mins / 60)} h ${mins % 60} min` };
  }
  return { done: false, big: String(days), unit: days > 1 ? "jours" : "jour" };
}

function cdEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function cdRender() {
  const now = Date.now();
  const sorted = cdItems.slice().sort((a, b) => {
    const ad = a.at <= now, bd = b.at <= now;
    return ad !== bd ? (ad ? 1 : -1) : ad ? b.at - a.at : a.at - b.at;
  });
  const next = sorted.find((x) => x.at > now);

  cdHero.innerHTML = "";
  if (next) {
    const r = cdRemaining(next.at);
    cdHero.appendChild(cdEl("small", "", "Prochaine échéance"));
    cdHero.appendChild(cdEl("strong", "cd-name", next.name));
    cdHero.appendChild(cdEl("div", "cd-big", r.big));
    if (r.unit) cdHero.appendChild(cdEl("div", "cd-unit", r.unit));
    const days = cdDays(next.at);
    const weeks = days >= 14 ? ` · soit ${Math.floor(days / 7)} semaines` : "";
    cdHero.appendChild(cdEl("p", "gr-info", `${cdFormatDate(next.at)} à ${cdFormatTime(next.at)}${weeks}`));
    const span = next.at - next.created;
    const pct = span > 0 ? Math.max(0, Math.min(100, ((now - next.created) / span) * 100)) : 0;
    const meter = cdEl("div", "todo-meter");
    const bar = cdEl("div", "todo-bar");
    bar.style.width = Math.round(pct) + "%";
    meter.appendChild(bar);
    cdHero.appendChild(meter);
    cdHero.appendChild(cdEl("small", "", `${Math.round(pct)} % du temps écoulé depuis l'ajout`));
  } else {
    cdHero.appendChild(cdEl("p", "", cdItems.length ? "Toutes tes échéances sont terminées. Ajoutes-en une nouvelle ci-dessous." : "Aucune échéance pour l'instant. Ajoute ton prochain examen ci-dessous."));
  }

  cdList.innerHTML = "";
  sorted.forEach((x) => {
    const r = cdRemaining(x.at);
    const li = cdEl("li", "cd-item" + (r.done ? " done" : ""));
    const left = cdEl("div", "cd-info");
    left.appendChild(cdEl("strong", "", x.name));
    left.appendChild(cdEl("span", "", `${cdFormatDate(x.at)} · ${cdFormatTime(x.at)}`));
    const chip = cdEl("span", "cd-chip", r.done ? "Terminé" : r.unit && r.big === "Aujourd'hui" ? "Aujourd'hui" : `${r.big} ${r.unit}`);
    const del = cdEl("button", "todo-btn", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Supprimer : " + x.name);
    del.addEventListener("click", () => { cdItems = cdItems.filter((y) => y.id !== x.id); cdSave(); cdRender(); });
    li.append(left, chip, del);
    cdList.appendChild(li);
  });
  cdClearPast.hidden = !cdItems.some((x) => x.at <= now);
}

$("cdAdd").addEventListener("click", () => {
  const name = cdName.value.trim() || "Examen";
  const at = cdParse(cdDate.value, cdTime.value);
  if (!Number.isFinite(at)) return cdMessage("Choisis une date.", true);
  if (at <= Date.now()) return cdMessage("Cette date est déjà passée. Choisis une date à venir.", true);
  if (cdItems.length >= CD_MAX) return cdMessage(`Tu as atteint la limite de ${CD_MAX} échéances. Supprime-en une.`, true);
  cdItems.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name.slice(0, 60), at, created: Date.now() });
  cdName.value = "";
  cdSave();
  cdMessage("Échéance ajoutée !");
  cdRender();
});
cdName.addEventListener("keydown", (e) => { if (e.key === "Enter") $("cdAdd").click(); });
cdClearPast.addEventListener("click", () => {
  const now = Date.now();
  cdItems = cdItems.filter((x) => x.at > now);
  cdSave();
  cdRender();
});

cdItems = cdLoad();
cdDate.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
cdRender();
setInterval(cdRender, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cdRender(); });

// ---------- Budget mensuel ----------
const BU_KEY = "clippo_budget", BU_MAX = 300;
const BU_CATS = ["Logement", "Courses", "Transport", "Abonnements", "Loisirs", "Santé", "Autres"];
const buType = $("buType"), buLabel = $("buLabel"), buAmount = $("buAmount"), buCat = $("buCat"), buCatBox = $("buCatBox");
const buList = $("buList"), buBreak = $("buBreak"), buStatus = $("buStatus"), buInfo = $("buInfo"), buBar = $("buBar");
let buData = {}, buMonth = "";

function buThisMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function buShift(key, delta) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function buMonthName(key) {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function buEur(n) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function buNum(v) {
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function buMessage(msg, isError = false) {
  buStatus.textContent = msg;
  buStatus.classList.toggle("error", isError);
}
function buEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function buId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function buLoad() {
  try {
    const raw = JSON.parse(localStorage.getItem(BU_KEY) || "{}");
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((k) => {
      if (!/^\d{4}-\d{2}$/.test(k) || !Array.isArray(raw[k])) return;
      out[k] = raw[k]
        .filter((e) => e && (e.type === "in" || e.type === "out") && Number.isFinite(Number(e.amount)) && Number(e.amount) > 0)
        .slice(0, BU_MAX)
        .map((e) => ({ id: String(e.id), type: e.type, label: String(e.label || "").slice(0, 40), cat: BU_CATS.includes(e.cat) ? e.cat : "Autres", amount: Number(e.amount) }));
    });
    return out;
  } catch { return {}; }
}
function buSave() {
  try { localStorage.setItem(BU_KEY, JSON.stringify(buData)); }
  catch { buMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

function buRender() {
  $("buMonth").textContent = buMonthName(buMonth);
  const entries = buData[buMonth] || [];
  const inc = entries.filter((e) => e.type === "in").reduce((a, e) => a + e.amount, 0);
  const out = entries.filter((e) => e.type === "out").reduce((a, e) => a + e.amount, 0);
  const left = Math.round((inc - out) * 100) / 100;

  $("buIn").textContent = buEur(inc);
  $("buOut").textContent = buEur(out);
  const leftEl = $("buLeft");
  leftEl.textContent = buEur(left);
  leftEl.className = left < 0 ? "bu-out" : "bu-in";

  const pct = inc > 0 ? Math.min(100, (out / inc) * 100) : out > 0 ? 100 : 0;
  buBar.style.width = Math.round(pct) + "%";
  if (!entries.length) buInfo.textContent = "Ajoute tes revenus et tes dépenses pour commencer.";
  else if (inc === 0) buInfo.textContent = "Ajoute tes revenus pour voir ce qu'il te reste.";
  else if (left < 0) buInfo.textContent = `Tu dépenses ${buEur(-left)} de plus que tes revenus ce mois-ci.`;
  else buInfo.textContent = `Tu as dépensé ${Math.round(pct)} % de tes revenus.`;

  // Répartition par catégorie
  buBreak.innerHTML = "";
  const byCat = {};
  entries.filter((e) => e.type === "out").forEach((e) => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  if (cats.length) {
    buBreak.appendChild(buEl("h2", "fc-title", "Où part ton argent"));
    cats.forEach(([cat, sum]) => {
      const share = out ? (sum / out) * 100 : 0;
      const row = buEl("div", "bu-cat");
      const head = buEl("div", "bu-cat-head");
      head.append(buEl("span", "", cat), buEl("span", "", `${buEur(sum)} · ${Math.round(share)} %`));
      const meter = buEl("div", "todo-meter");
      const bar = buEl("div", "todo-bar");
      bar.style.width = Math.round(share) + "%";
      meter.appendChild(bar);
      row.append(head, meter);
      buBreak.appendChild(row);
    });
  }

  // Liste des lignes
  buList.innerHTML = "";
  entries.slice().reverse().forEach((e) => {
    const li = buEl("li", "bu-item");
    const info = buEl("div", "bu-info");
    info.appendChild(buEl("strong", "", e.label || (e.type === "in" ? "Revenu" : e.cat)));
    info.appendChild(buEl("span", "", e.type === "in" ? "Revenu" : e.cat));
    const amt = buEl("span", "bu-amt " + (e.type === "in" ? "bu-in" : "bu-out"), (e.type === "in" ? "+" : "−") + buEur(e.amount));
    const del = buEl("button", "todo-btn", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Supprimer : " + (e.label || e.cat));
    del.addEventListener("click", () => {
      buData[buMonth] = (buData[buMonth] || []).filter((x) => x.id !== e.id);
      buSave();
      buRender();
    });
    li.append(info, amt, del);
    buList.appendChild(li);
  });
  $("buClear").hidden = !entries.length;
  $("buCopy").hidden = !(buData[buShift(buMonth, -1)] || []).length;
}

$("buAdd").addEventListener("click", () => {
  const amount = buNum(buAmount.value);
  if (!(amount > 0)) return buMessage("Entre un montant supérieur à 0 (ex : 45,90).", true);
  if (amount > 1e9) return buMessage("Ce montant est trop grand.", true);
  const list = buData[buMonth] || (buData[buMonth] = []);
  if (list.length >= BU_MAX) return buMessage(`Tu as atteint la limite de ${BU_MAX} lignes pour ce mois.`, true);
  const type = buType.value;
  list.push({ id: buId(), type, label: buLabel.value.trim().slice(0, 40), cat: type === "out" ? buCat.value : "Autres", amount });
  buLabel.value = ""; buAmount.value = "";
  buSave();
  buMessage("");
  buRender();
  buLabel.focus();
});
[buLabel, buAmount].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") $("buAdd").click(); }));
buType.addEventListener("change", () => { buCatBox.hidden = buType.value === "in"; });

$("buPrev").addEventListener("click", () => { buMonth = buShift(buMonth, -1); buMessage(""); buRender(); });
$("buNext").addEventListener("click", () => { buMonth = buShift(buMonth, 1); buMessage(""); buRender(); });

$("buCopy").addEventListener("click", () => {
  const prev = buData[buShift(buMonth, -1)] || [];
  if (!prev.length) return;
  const cur = buData[buMonth] || [];
  if (cur.length && !confirm("Ce mois contient déjà des lignes. Ajouter aussi celles du mois précédent ?")) return;
  const copy = prev.map((e) => ({ ...e, id: buId() }));
  buData[buMonth] = cur.concat(copy).slice(0, BU_MAX);
  buSave();
  buMessage(`${copy.length} ligne${copy.length > 1 ? "s" : ""} copiée${copy.length > 1 ? "s" : ""} depuis ${buMonthName(buShift(buMonth, -1))}.`);
  buRender();
});
$("buClear").addEventListener("click", () => {
  if (!(buData[buMonth] || []).length || !confirm("Effacer toutes les lignes de ce mois ?")) return;
  buData[buMonth] = [];
  buSave();
  buMessage("");
  buRender();
});

buData = buLoad();
buMonth = buThisMonth();
buRender();

// ---------- Accueil : recherche intelligente, défilement, compteur ----------
const homeSearch = $("homeSearch"), homeEmpty = $("homeEmpty");
const HS_STOP = new Set("le la les un une des du de au aux en et ou a pour sur mon ma mes ton ta tes comment faire fait je veux voudrais besoin outil outils avec sans cherche trouver".split(" "));
const HS_KW = {
  grades: "moyenne note notes calcul coefficient bulletin controle ecole college lycee bac scolaire",
  pomodoro: "minuteur timer chrono concentration travail travailler focus pause revision productivite temps",
  flashcards: "cartes carte fiches memoriser memoire reviser revision apprendre lecon quiz",
  countdown: "compte rebours examen date jours echeance evenement attente",
  studyplan: "planning revisions revision organiser calendrier examen emploi du temps programme",
  gradeconv: "convertir note bareme pourcentage sur 20 sur 10 mention",
  mp3: "audio son musique video extraire convertir telecharger piste",
  cutout: "detourer fond arriere plan image photo supprimer transparent png gomme",
  convert: "image photo compresser compression reduire poids taille format png jpg webp recadrer pivoter convertir alleger",
  blur: "flou flouter pixeliser cacher masquer visage plaque texte photo image confidentialite",
  enhance: "ameliorer agrandir nettete qualite hd upscale image photo floue resolution",
  photopdf: "pdf photo image document scanner fusionner dossier demarches",
  watermark: "filigrane signature signer logo copyright protection photo image marque",
  fancy: "texte style police fonts discord tiktok instagram pseudo gras cursif lettres",
  pseudo: "pseudo nom utilisateur gaming jeu username generateur",
  emoji: "emoji emojis symboles smiley copier coller caracteres",
  bio: "bio description profil instagram tiktok discord presentation",
  hashtags: "hashtag hashtags reseaux sociaux tiktok instagram tags diese",
  brandname: "nom chaine marque boutique idee youtube entreprise",
  descgen: "description legende video youtube titre texte reseaux",
  palette: "couleur couleurs palette hex rgb design css photo harmonie",
  qr: "qr code lien url scanner flashcode",
  wheel: "roue hasard tirage sort aleatoire jeu choisir",
  todo: "taches liste todo faire rappel organisation agenda",
  password: "mot de passe mdp securite generateur securise compte",
  notes: "bloc notes note memo texte ecrire carnet",
  worldclock: "horloge heure fuseau monde ville pays decalage voyage",
  trip: "voyage valise checklist liste affaires vacances bagage",
  budget: "budget argent depenses revenus finance mois economies",
  savings: "epargne economiser objectif argent mettre de cote projet",
  currency: "devise devises change euro euros dollar monnaie voyage taux conversion",
  discount: "reduction soldes promo remise pourcentage prix code promo",
  tictactoe: "morpion jeu jouer ordinateur deux joueurs",
  memory: "memoire paires cartes jeu",
  mental: "calcul mental maths jeu chrono",
  dice: "des de pile ou face hasard jeu nombre aleatoire",
  recorder: "enregistreur ecran video capture filmer",
    mindmap: "carte mentale schema idees brainstorming reviser plan mind map organiser cours",
  calendar: "calendrier planning mois annee imprimer agenda jours feries dates evenements",
};
const hsNorm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/œ/g, "oe").replace(/[^a-z0-9]+/g, " ").trim();
const hsTools = [];
(() => { // lit les cartes de « Tous les outils »
  const seen = new Set();
  document.querySelectorAll("#home .home-cat").forEach((cat) => {
    const head = cat.querySelector(".tool-cat");
    const catLabel = head ? head.textContent.replace(/^[^\p{L}\p{N}]+/u, "").trim() : "";
    cat.querySelectorAll(".tool-card[data-go]").forEach((card) => {
      const id = card.dataset.go;
      if (seen.has(id)) return;
      seen.add(id);
      const name = ((card.querySelector("strong") || {}).textContent || id).trim();
      const desc = ((card.querySelector("span") || {}).textContent || "").trim();
      const icon = ((card.querySelector(".tc-ico") || {}).textContent || "🧰").trim();
      hsTools.push({
        id, name, desc, icon, catLabel, cat: hsNorm(catLabel), nameN: hsNorm(name),
        nameW: hsNorm(name).split(" ").filter(Boolean),
        kw: hsNorm(HS_KW[id] || "").split(" ").filter(Boolean),
        descW: hsNorm(desc).split(" ").filter(Boolean),
      });
    });
  });
})();

function hsLev(a, b) { // distance entre deux mots (fautes de frappe)
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function hsWordScore(t, w) {
  let best = 0;
  const test = (list, exact, prefix, sub) => {
    for (const x of list) {
      if (x === w) best = Math.max(best, exact);
      else if (x.startsWith(w)) best = Math.max(best, prefix);
      else if (w.length >= 3 && x.includes(w)) best = Math.max(best, sub);
    }
  };
  test(t.nameW, 100, 80, 55);
  test(t.kw, 70, 55, 35);
  test(t.descW, 30, 22, 12);
  if (t.cat === w || t.cat.startsWith(w)) best = Math.max(best, 20);
  if (!best && w.length >= 4) {
    const tol = w.length >= 7 ? 2 : 1;
    for (const x of [...t.nameW, ...t.kw]) if (x.length >= 3 && hsLev(w, x) <= tol) { best = 28; break; }
  }
  return best;
}
function hsSearch(raw) {
  let words = hsNorm(raw).split(" ").filter(Boolean);
  const kept = words.filter((w) => !HS_STOP.has(w));
  if (kept.length) words = kept;
  if (!words.length) return [];
  const full = words.join(" ");
  const res = [];
  let top = 0;
  hsTools.forEach((t) => {
    let score = 0, matched = 0;
    words.forEach((w) => { const s = hsWordScore(t, w); if (s) { score += s; matched++; } });
    if (!matched) return;
    if (t.nameN.includes(full)) score += 40;
    if (matched > top) top = matched;
    res.push({ t, score, matched });
  });
  return res.filter((r) => r.matched === top).sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name, "fr"));
}

if (homeSearch) {
  const hsHost = homeSearch.closest(".hm-card, .hero-card") || homeSearch.parentElement;
  const hsLabel = homeSearch.closest("label") || homeSearch;
  const hsBox = document.createElement("div");
  hsBox.id = "homeSuggest";
  hsBox.className = "hs-box";
  hsBox.setAttribute("role", "listbox");
  hsBox.setAttribute("aria-label", "Résultats de la recherche");
  hsBox.hidden = true;
  hsHost.appendChild(hsBox);
  homeSearch.setAttribute("role", "combobox");
  homeSearch.setAttribute("aria-autocomplete", "list");
  homeSearch.setAttribute("aria-controls", "homeSuggest");
  homeSearch.setAttribute("aria-expanded", "false");
  homeSearch.setAttribute("autocomplete", "off");
  let hsShown = [], hsActive = -1;

  const hsClose = () => {
    hsBox.hidden = true;
    hsActive = -1;
    homeSearch.setAttribute("aria-expanded", "false");
    homeSearch.removeAttribute("aria-activedescendant");
  };
  function hsMark() {
    hsBox.querySelectorAll(".hs-item").forEach((b, i) => {
      const on = i === hsActive;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      if (on) { homeSearch.setAttribute("aria-activedescendant", b.id); b.scrollIntoView({ block: "nearest" }); }
    });
    if (hsActive < 0) homeSearch.removeAttribute("aria-activedescendant");
  }
  function hsMove(d) {
    const n = hsShown.length;
    hsActive = hsActive < 0 ? (d > 0 ? 0 : n - 1) : (hsActive + d + n) % n;
    hsMark();
  }
  function hsGo(id) { // ouvre l'outil et remet la recherche à zéro
    homeSearch.value = "";
    homeSearch.dispatchEvent(new Event("input"));
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) tab.click(); else openTab(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function hsRenderBox(results, searching) {
    hsBox.innerHTML = "";
    hsActive = -1;
    hsShown = results.slice(0, 6);
    homeSearch.removeAttribute("aria-activedescendant");
    if (!searching) return hsClose();
    hsBox.style.top = hsLabel.offsetTop + hsLabel.offsetHeight + 6 + "px";
    if (!hsShown.length) {
      const p = document.createElement("p");
      p.className = "hs-empty";
      p.textContent = "Aucun outil trouvé. Essaie un mot plus simple : photo, argent, pdf, qr code…";
      hsBox.appendChild(p);
    } else {
      hsShown.forEach((r, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hs-item";
        b.id = "hs-opt-" + i;
        b.setAttribute("role", "option");
        const ic = document.createElement("span");
        ic.className = "hs-ico";
        ic.textContent = r.t.icon;
        ic.setAttribute("aria-hidden", "true");
        const tx = document.createElement("span");
        tx.className = "hs-txt";
        const nm = document.createElement("strong");
        nm.textContent = r.t.name;
        const sm = document.createElement("small");
        sm.textContent = r.t.catLabel + " · " + r.t.desc;
        tx.append(nm, sm);
        b.append(ic, tx);
        b.addEventListener("mousedown", (e) => e.preventDefault()); // garde le curseur dans la barre
        b.addEventListener("click", () => hsGo(r.t.id));
        hsBox.appendChild(b);
      });
      if (results.length > hsShown.length) {
        const more = document.createElement("p");
        more.className = "hs-more";
        const n = results.length - hsShown.length;
        more.textContent = `… et ${n} autre${n > 1 ? "s" : ""} outil${n > 1 ? "s" : ""} plus bas dans la page.`;
        hsBox.appendChild(more);
      }
    }
    hsBox.hidden = false;
    homeSearch.setAttribute("aria-expanded", "true");
  }

  function homeFilter() {
    const raw = homeSearch.value;
    const searching = hsNorm(raw).length >= 2;
    const results = searching ? hsSearch(raw) : [];
    const ok = new Set(results.map((r) => r.t.id));
    let total = 0;
    document.querySelectorAll("#home .home-cat").forEach((cat) => {
      let shown = 0;
      cat.querySelectorAll(".tool-card[data-go]").forEach((card) => {
        const visible = !searching || ok.has(card.dataset.go);
        card.hidden = !visible;
        if (visible) shown++;
      });
      cat.hidden = !shown;
      total += shown;
    });
    if (homeEmpty) homeEmpty.hidden = total > 0;
    const feat = $("tools");
    if (feat) feat.hidden = searching;
    hsRenderBox(results, searching);
  }

  homeSearch.addEventListener("input", homeFilter);
  homeSearch.addEventListener("focus", () => { if (hsNorm(homeSearch.value).length >= 2) homeFilter(); });
  homeSearch.addEventListener("keydown", (e) => {
    const open = !hsBox.hidden && hsShown.length > 0;
    if (e.key === "ArrowDown" && open) { e.preventDefault(); hsMove(1); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); hsMove(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (open) hsGo(hsShown[hsActive >= 0 ? hsActive : 0].t.id);
      else { const all = $("alltools"); if (all) all.scrollIntoView({ behavior: "smooth" }); }
    } else if (e.key === "Escape") {
      if (!hsBox.hidden) hsClose();
      else if (homeSearch.value) { homeSearch.value = ""; homeSearch.dispatchEvent(new Event("input")); }
    }
  });
  document.addEventListener("click", (e) => { if (!hsBox.hidden && e.target !== homeSearch && !hsBox.contains(e.target)) hsClose(); });
  document.addEventListener("keydown", (e) => { // « / » ou Ctrl + K : aller dans la barre
    const home = $("home");
    if (!home || !home.classList.contains("active")) return;
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    const slash = e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    if (!slash && !ctrlK) return;
    e.preventDefault();
    homeSearch.focus();
    homeSearch.select();
    homeSearch.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const hc = $("homeCount");
  if (hc) hc.textContent = document.querySelectorAll("#home .tool-card").length;
  homeFilter();
}
document.querySelectorAll("[data-scroll]").forEach((b) => b.addEventListener("click", () => {
  const t = document.getElementById(b.dataset.scroll);
  if (t) t.scrollIntoView({ behavior: "smooth" });
}));

// ---------- Générateur de hashtags ----------
const HT_THEMES = [
  { k: ["gaming", "jeu", "jeux", "gamer", "jeuxvideo", "fortnite", "minecraft", "valorant", "roblox", "fifa"],
    t: ["gamer", "gaming", "jeuxvideo", "gamingcommunity", "gamerfrance", "gameplay", "streamer", "twitch", "console", "pcgaming", "playstation", "xbox"] },
  { k: ["cuisine", "recette", "recettes", "cuisiner", "patisserie", "gateau", "food", "repas"],
    t: ["cuisine", "recette", "recettefacile", "foodie", "faitmaison", "cuisinemaison", "gourmand", "patisserie", "foodlover", "ideerepas", "recettesimple"] },
  { k: ["sport", "fitness", "musculation", "running", "gym", "entrainement", "workout", "foot", "football"],
    t: ["sport", "fitness", "musculation", "entrainement", "motivation", "running", "gym", "workout", "coachsportif", "santeetsport"] },
  { k: ["mode", "fashion", "style", "outfit", "tenue", "vetement", "streetwear"],
    t: ["mode", "fashion", "ootd", "style", "outfit", "tendance", "look", "streetwear", "shopping", "modefemme", "modehomme"] },
  { k: ["voyage", "voyages", "travel", "vacances", "tourisme", "roadtrip"],
    t: ["voyage", "travel", "vacances", "aventure", "explorer", "tourisme", "roadtrip", "bonsplans", "decouverte", "paysage"] },
  { k: ["musique", "music", "chanson", "rap", "concert", "playlist", "chanteur"],
    t: ["musique", "music", "chanson", "rapfr", "concert", "playlist", "newmusic", "artiste", "chanteur", "musicien"] },
  { k: ["etudes", "etude", "etudiant", "revisions", "revision", "bac", "examen", "cours", "lycee", "fac", "ecole", "apprendre"],
    t: ["etudes", "etudiant", "revisions", "bac", "examen", "apprendre", "studygram", "studywithme", "lycee", "fac", "organisation", "motivationetudes"] },
  { k: ["beaute", "makeup", "maquillage", "skincare", "cheveux", "soin", "coiffure"],
    t: ["beaute", "makeup", "maquillage", "skincare", "soinsdupeau", "cheveux", "routinebeaute", "beauty", "tutomaquillage", "coiffure"] },
  { k: ["humour", "drole", "meme", "blague", "rire", "comedie", "sketch"],
    t: ["humour", "drole", "meme", "blague", "rire", "funny", "comedie", "sketch", "lol", "humourfrancais"] },
  { k: ["animaux", "animal", "chien", "chat", "chiot", "chaton"],
    t: ["animaux", "chien", "chat", "chiot", "chaton", "petlovers", "animauxmignons", "dog", "cat", "amoureuxdesanimaux"] },
  { k: ["photo", "photos", "photographie", "retouche", "portrait", "lightroom"],
    t: ["photo", "photographie", "photooftheday", "retouche", "lightroom", "portrait", "paysage", "photographe", "astucephoto", "photomobile"] },
  { k: ["tech", "technologie", "informatique", "smartphone", "iphone", "android", "ordinateur", "ia"],
    t: ["tech", "technologie", "informatique", "astuce", "smartphone", "iphone", "android", "gadget", "high tech".replace(" ", ""), "applications"] },
  { k: ["business", "entrepreneur", "argent", "marketing", "investissement", "budget", "freelance"],
    t: ["business", "entrepreneur", "argent", "marketing", "reussite", "budget", "freelance", "autoentrepreneur", "indépendant".normalize("NFD").replace(/[\u0300-\u036f]/g, ""), "astucesargent"] },
  { k: ["auto", "voiture", "moto", "mecanique", "tuning"],
    t: ["auto", "voiture", "moto", "mecanique", "tuning", "passionauto", "carlovers", "automobile", "garage", "conduite"] },
];
const HT_GENERIC = {
  tiktok: ["fyp", "pourtoi", "foryou", "foryoupage", "viral", "tiktokfrance", "trending", "pourtoipage"],
  instagram: ["instagood", "reels", "instadaily", "explorepage", "instagramfrance", "photooftheday", "reelsinstagram", "love"],
  x: ["tendance", "actu", "thread", "france", "astuce"],
  youtube: ["shorts", "youtubeshorts", "youtubefrance", "tuto", "astuces", "video"],
};
const HT_NET = {
  tiktok: { rec: 5, max: 10, note: "Conseil TikTok : 3 à 5 hashtags bien choisis suffisent, plus devient vite du spam." },
  instagram: { rec: 15, max: 30, note: "Instagram accepte 30 hashtags au maximum. Entre 5 et 15, bien ciblés, c'est un bon réglage." },
  x: { rec: 2, max: 3, note: "Sur X, 1 à 2 hashtags suffisent : au-delà, le post paraît surchargé." },
  youtube: { rec: 5, max: 15, note: "YouTube ignore tous les hashtags d'une vidéo si elle en contient plus de 15." },
};
const HT_SUFFIX = ["france", "fr", "astuces", "idees", "tips", "debutant", "tuto", "addict", "lovers", "communaute", "life", "daily"];
const HT_LABELS = [
  ["large", "Très larges", "Beaucoup de monde les utilise : bonne portée, mais beaucoup de concurrence."],
  ["mid", "Moyens", "Liés à ton thème : un bon équilibre entre portée et précision."],
  ["niche", "De niche", "Précis et plus rares : moins de concurrence, public plus ciblé."],
];

const htTopic = $("htTopic"), htNet = $("htNet"), htResult = $("htResult"), htGroups = $("htGroups");
const htOut = $("htOut"), htCount = $("htCount"), htStatus = $("htStatus"), htNote = $("htNote");
let htData = { large: [], mid: [], niche: [] }, htSel = new Set();

function htMessage(msg, isError = false) {
  htStatus.textContent = msg;
  htStatus.classList.toggle("error", isError);
}
function htClean(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function htShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function htBuild(topic, net) {
  const words = topic.split(/[\s,;/+]+/).map(htClean).filter((w) => w.length >= 2).slice(0, 4);
  if (!words.length) return null;
  const joined = words.join("");
  const bases = [...new Set([...(words.length > 1 && joined.length <= 24 ? [joined] : []), ...words])];
  const seen = new Set();
  const take = (list, max) => {
    const out = [];
    list.forEach((t) => {
      if (out.length >= max || t.length < 3 || t.length > 30 || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return out;
  };

  const theme = [];
  HT_THEMES.forEach((th) => {
    const hit = words.some((w) => th.k.some((k) => k === w || (w.length >= 4 && k.length >= 4 && (k.includes(w) || w.includes(k)))));
    if (hit) theme.push(...th.t.map(htClean));
  });

  const niche = [];
  bases.slice(0, 3).forEach((b) => HT_SUFFIX.forEach((s) => niche.push(b + s)));

  const mid = take([...bases, ...htShuffle(theme)], 12);
  const nicheTags = take(htShuffle(niche), 14);
  const large = take(htShuffle(HT_GENERIC[net]), 6);
  return { large, mid, niche: nicheTags, themed: theme.length > 0 };
}

function htPreselect(net) {
  const rec = HT_NET[net].rec;
  const nL = Math.round(rec * 0.25), nM = Math.round(rec * 0.4), nN = Math.max(0, rec - nL - nM);
  htSel = new Set([...htData.large.slice(0, nL), ...htData.mid.slice(0, nM), ...htData.niche.slice(0, nN)]);
}

function htOrdered() {
  return [...htData.large, ...htData.mid, ...htData.niche].filter((t) => htSel.has(t));
}

function htUpdateOut() {
  const tags = htOrdered().map((t) => "#" + t);
  const text = tags.join(" ");
  const net = HT_NET[htNet.value];
  htOut.value = text;
  htCount.textContent = `${tags.length} hashtag${tags.length > 1 ? "s" : ""} sélectionné${tags.length > 1 ? "s" : ""} · ${text.length} caractères`;
  if (tags.length > net.max) htMessage(`Tu as sélectionné ${tags.length} hashtags : au-delà de ${net.max}, c'est trop pour ce réseau.`, true);
  else htMessage("");
  htGroups.querySelectorAll(".ht-chip").forEach((b) => {
    const on = htSel.has(b.dataset.tag);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function htRender() {
  htGroups.innerHTML = "";
  HT_LABELS.forEach(([key, title, desc]) => {
    const list = htData[key];
    if (!list.length) return;
    const box = document.createElement("div");
    box.className = "ht-group";
    const h = document.createElement("h3");
    h.className = "tool-cat";
    h.textContent = title;
    const p = document.createElement("p");
    p.className = "gr-note";
    p.textContent = desc;
    const chips = document.createElement("div");
    chips.className = "ht-chips";
    list.forEach((tag) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ht-chip";
      b.dataset.tag = tag;
      b.textContent = "#" + tag;
      b.addEventListener("click", () => {
        if (htSel.has(tag)) htSel.delete(tag); else htSel.add(tag);
        htUpdateOut();
      });
      chips.appendChild(b);
    });
    box.append(h, p, chips);
    htGroups.appendChild(box);
  });
  htNote.textContent = HT_NET[htNet.value].note;
  htUpdateOut();
}

function htGenerate() {
  const topic = htTopic.value.trim();
  if (!topic) { htResult.hidden = true; return htMessage("Écris un sujet (ex : cuisine, gaming, révisions bac).", true); }
  const data = htBuild(topic, htNet.value);
  if (!data) { htResult.hidden = true; return htMessage("Utilise des lettres ou des chiffres pour ton sujet.", true); }
  htData = data;
  htPreselect(htNet.value);
  htResult.hidden = false;
  htRender();
  if (!data.themed) htMessage("Je ne connais pas de liste pour ce thème : les hashtags viennent surtout de tes mots. Essaie un sujet plus courant pour plus d'idées.");
}

async function htCopy(tags, okMsg) {
  if (!tags.length) return htMessage("Sélectionne au moins un hashtag.", true);
  try { await copyText(tags.map((t) => "#" + t).join(" ")); htMessage(okMsg); }
  catch { htMessage("Copie automatique impossible : sélectionne le texte dans la case et fais Ctrl + C.", true); }
}

$("htGo").addEventListener("click", htGenerate);
htTopic.addEventListener("keydown", (e) => { if (e.key === "Enter") htGenerate(); });
htNet.addEventListener("change", () => { if (htTopic.value.trim()) htGenerate(); });
$("htShuffle").addEventListener("click", htGenerate);
$("htCopySel").addEventListener("click", () => htCopy(htOrdered(), "Hashtags copiés !"));
$("htCopyAll").addEventListener("click", () => htCopy([...htData.large, ...htData.mid, ...htData.niche], "Tous les hashtags copiés !"));
$("htClear").addEventListener("click", () => { htSel.clear(); htUpdateOut(); });

// ---------- Jeux : outils communs ----------
function gmRand(n) { // entier uniforme dans [0, n), sans biais
  const max = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= max);
  return buf[0] % n;
}
function gmShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = gmRand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Jeu : Morpion ----------
const ttBoard = $("ttBoard"), ttInfo = $("ttInfo"), ttMode = $("ttMode"), ttSide = $("ttSide");
const TT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const ttScore = { X: 0, O: 0, D: 0 };
const ttBtns = [];
let ttCells = Array(9).fill(""), ttTurn = "X", ttOver = false, ttTimer = null;

function ttCpuTurn() { return ttMode.value !== "two" && ttTurn !== ttSide.value; }

function ttResult(c) {
  for (const l of TT_LINES) {
    if (c[l[0]] && c[l[0]] === c[l[1]] && c[l[0]] === c[l[2]]) return { w: c[l[0]], line: l };
  }
  return c.every(Boolean) ? { w: "draw" } : null;
}

function ttMinimax(c, turn, cpu) {
  const r = ttResult(c);
  if (r) return r.w === "draw" ? 0 : r.w === cpu ? 1 : -1;
  let best = turn === cpu ? -2 : 2;
  for (let i = 0; i < 9; i++) {
    if (c[i]) continue;
    c[i] = turn;
    const s = ttMinimax(c, turn === "X" ? "O" : "X", cpu);
    c[i] = "";
    best = turn === cpu ? Math.max(best, s) : Math.min(best, s);
  }
  return best;
}

function ttPick() {
  const me = ttSide.value, cpu = me === "X" ? "O" : "X";
  const free = ttCells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (ttMode.value === "cpu-easy") {
    const win = free.find((i) => { ttCells[i] = cpu; const r = ttResult(ttCells); ttCells[i] = ""; return r && r.w === cpu; });
    return win !== undefined ? win : free[gmRand(free.length)];
  }
  let best = -2, picks = [];
  free.forEach((i) => {
    ttCells[i] = cpu;
    const s = ttMinimax(ttCells, me, cpu);
    ttCells[i] = "";
    if (s > best) { best = s; picks = [i]; } else if (s === best) picks.push(i);
  });
  return picks[gmRand(picks.length)];
}

function ttRender(line) {
  ttCells.forEach((v, i) => {
    const b = ttBtns[i];
    b.textContent = v;
    b.className = "tt-cell" + (v ? " " + v.toLowerCase() : "") + (line && line.includes(i) ? " win" : "");
    b.disabled = ttOver || !!v || ttCpuTurn();
    b.setAttribute("aria-label", "Case " + (i + 1) + (v ? " : " + v : ""));
  });
  $("ttSX").textContent = ttScore.X;
  $("ttSO").textContent = ttScore.O;
  $("ttSD").textContent = ttScore.D;
  if (!ttOver) ttInfo.textContent = ttMode.value === "two" ? `Au tour de ${ttTurn}` : ttCpuTurn() ? "L'ordinateur réfléchit…" : "À toi de jouer !";
}

function ttMove(i) {
  ttCells[i] = ttTurn;
  const r = ttResult(ttCells);
  if (r) {
    ttOver = true;
    if (r.w === "draw") { ttScore.D++; ttInfo.textContent = "Match nul !"; }
    else {
      ttScore[r.w]++;
      ttInfo.textContent = ttMode.value === "two" ? `${r.w} a gagné ! 🎉` : r.w === ttSide.value ? "Tu as gagné ! 🎉" : "L'ordinateur a gagné.";
    }
    return ttRender(r.line);
  }
  ttTurn = ttTurn === "X" ? "O" : "X";
  ttRender();
  if (ttCpuTurn()) ttTimer = setTimeout(() => { if (!ttOver) ttMove(ttPick()); }, 450);
}

function ttNew() {
  clearTimeout(ttTimer);
  ttCells = Array(9).fill("");
  ttTurn = "X";
  ttOver = false;
  $("ttSideBox").hidden = ttMode.value === "two";
  ttRender();
  if (ttCpuTurn()) ttTimer = setTimeout(() => { if (!ttOver) ttMove(ttPick()); }, 450);
}

for (let i = 0; i < 9; i++) {
  const b = document.createElement("button");
  b.type = "button";
  b.addEventListener("click", () => { if (!ttOver && !ttCells[i] && !ttCpuTurn()) ttMove(i); });
  ttBoard.appendChild(b);
  ttBtns.push(b);
}
$("ttNew").addEventListener("click", ttNew);
$("ttReset").addEventListener("click", () => { ttScore.X = ttScore.O = ttScore.D = 0; ttNew(); });
[ttMode, ttSide].forEach((el) => el.addEventListener("change", ttNew));
ttNew();

// ---------- Jeu : Mémoire ----------
const MM_EMO = ["🍎", "🐶", "🚀", "🎸", "🌈", "⚽", "🍕", "🐱", "🌻", "🎲", "🍩", "🦊", "🎧", "🌙", "🍒", "🐼", "⭐", "🏀"];
const mmGrid = $("mmGrid"), mmLevel = $("mmLevel"), mmMoves = $("mmMoves"), mmTime = $("mmTime"), mmMsg = $("mmMsg");
let mmFirst = null, mmLock = false, mmCount = 0, mmFound = 0, mmPairs = 0, mmStart = 0, mmTick = null;

function mmClock() {
  const s = mmStart ? Math.floor((Date.now() - mmStart) / 1000) : 0;
  const t = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  mmTime.textContent = t;
  return t;
}

function mmNew() {
  clearInterval(mmTick);
  mmTick = null; mmStart = 0; mmFirst = null; mmLock = false; mmCount = 0; mmFound = 0;
  mmMoves.textContent = "0";
  mmMsg.textContent = "";
  mmClock();
  const [cols, pairs] = mmLevel.value.split("-").map(Number);
  mmPairs = pairs;
  const deck = gmShuffle([...gmShuffle(MM_EMO).slice(0, pairs), ...gmShuffle(MM_EMO).slice(0, 0)].flatMap((e) => [e, e]));
  mmGrid.style.setProperty("--cols", cols);
  mmGrid.innerHTML = "";
  deck.forEach((e) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mm-card";
    b.dataset.e = e;
    b.setAttribute("aria-label", "Carte cachée");
    const front = document.createElement("span");
    front.className = "mm-front";
    front.textContent = "?";
    const back = document.createElement("span");
    back.className = "mm-back";
    back.textContent = e;
    b.append(front, back);
    b.addEventListener("click", () => mmFlip(b));
    mmGrid.appendChild(b);
  });
}

function mmFlip(b) {
  if (mmLock || b.classList.contains("open") || b.classList.contains("done")) return;
  if (!mmStart) { mmStart = Date.now(); mmTick = setInterval(mmClock, 500); }
  b.classList.add("open");
  b.setAttribute("aria-label", "Carte " + b.dataset.e);
  if (!mmFirst) { mmFirst = b; return; }
  mmCount++;
  mmMoves.textContent = String(mmCount);
  const a = mmFirst;
  mmFirst = null;
  if (a.dataset.e === b.dataset.e) {
    a.classList.add("done");
    b.classList.add("done");
    mmFound++;
    if (mmFound === mmPairs) {
      clearInterval(mmTick);
      mmMsg.textContent = `Bravo ! Tu as trouvé toutes les paires en ${mmCount} coups et ${mmClock()}. 🎉`;
    }
  } else {
    mmLock = true;
    setTimeout(() => {
      a.classList.remove("open");
      b.classList.remove("open");
      a.setAttribute("aria-label", "Carte cachée");
      b.setAttribute("aria-label", "Carte cachée");
      mmLock = false;
    }, 800);
  }
}
$("mmNew").addEventListener("click", mmNew);
mmLevel.addEventListener("change", mmNew);
mmNew();

// ---------- Jeu : Calcul mental ----------
const cmLevel = $("cmLevel"), cmQ = $("cmQ"), cmAns = $("cmAns"), cmFb = $("cmFb"), cmEnd = $("cmEnd"), cmGo = $("cmGo"), cmOk = $("cmOk");
let cmTimer = null, cmLeft = 60, cmGood = 0, cmDone = 0, cmCur = null;

function cmMake(level) {
  const r = (a, b) => a + gmRand(b - a + 1);
  if (level === "easy") {
    if (gmRand(2)) { const a = r(2, 20), b = r(2, 20); return { q: `${a} + ${b}`, a: a + b }; }
    const a = r(5, 25), b = r(1, a);
    return { q: `${a} − ${b}`, a: a - b };
  }
  if (level === "mid") {
    const t = gmRand(3);
    if (t === 0) { const a = r(2, 9), b = r(2, 9); return { q: `${a} × ${b}`, a: a * b }; }
    if (t === 1) { const a = r(20, 99), b = r(11, 99); return { q: `${a} + ${b}`, a: a + b }; }
    const a = r(40, 150), b = r(11, 39);
    return { q: `${a} − ${b}`, a: a - b };
  }
  const t = gmRand(4);
  if (t === 0) { const a = r(11, 19), b = r(6, 19); return { q: `${a} × ${b}`, a: a * b }; }
  if (t === 1) { const a = r(100, 999), b = r(100, 999); return { q: `${a} + ${b}`, a: a + b }; }
  if (t === 2) { const a = r(200, 999), b = r(100, 199); return { q: `${a} − ${b}`, a: a - b }; }
  const b = r(2, 12), res = r(2, 12);
  return { q: `${b * res} ÷ ${b}`, a: res };
}

function cmNext() {
  cmCur = cmMake(cmLevel.value);
  cmQ.textContent = cmCur.q + " = ?";
  cmAns.value = "";
  cmAns.focus();
}

function cmStop() {
  clearInterval(cmTimer);
  cmTimer = null;
  cmAns.disabled = true;
  cmOk.disabled = true;
  cmGo.disabled = false;
  cmGo.textContent = "Rejouer";
  cmLevel.disabled = false;
  cmQ.textContent = "Terminé !";
  const mention = cmGood >= 15 ? "Excellent !" : cmGood >= 10 ? "Très bien !" : cmGood >= 5 ? "Pas mal !" : "Continue à t'entraîner !";
  cmEnd.textContent = `${mention} Tu as trouvé ${cmGood} bonne${cmGood > 1 ? "s" : ""} réponse${cmGood > 1 ? "s" : ""} sur ${cmDone} calcul${cmDone > 1 ? "s" : ""}.`;
}

function cmStart() {
  cmGood = 0; cmDone = 0; cmLeft = 60;
  $("cmScore").textContent = "0";
  $("cmTime").textContent = "60";
  cmFb.textContent = "";
  cmEnd.textContent = "";
  cmAns.disabled = false;
  cmOk.disabled = false;
  cmGo.disabled = true;
  cmLevel.disabled = true;
  cmNext();
  cmTimer = setInterval(() => {
    cmLeft--;
    $("cmTime").textContent = String(Math.max(0, cmLeft));
    if (cmLeft <= 0) cmStop();
  }, 1000);
}

function cmSubmit() {
  if (!cmTimer) return;
  const v = parseInt(cmAns.value.trim(), 10);
  if (!Number.isFinite(v)) return;
  cmDone++;
  if (v === cmCur.a) {
    cmGood++;
    $("cmScore").textContent = String(cmGood);
    cmFb.textContent = "✅ Bravo !";
  } else {
    cmFb.textContent = `❌ C'était ${cmCur.a}`;
  }
  cmNext();
}
cmGo.addEventListener("click", cmStart);
cmOk.addEventListener("click", cmSubmit);
cmAns.addEventListener("keydown", (e) => { if (e.key === "Enter") cmSubmit(); });

// ---------- Jeu : Dés et pile ou face ----------
const dcStage = $("dcStage"), dcSum = $("dcSum"), dcMsg = $("dcMsg");
let dcMode = "dice";

function dcSet(mode) {
  dcMode = mode;
  document.querySelectorAll("#dcModes .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === mode));
  $("dcDice").hidden = mode !== "dice";
  $("dcNum").hidden = mode !== "num";
  dcStage.innerHTML = "";
  dcSum.textContent = "";
  dcMsg.textContent = "";
  dcMsg.classList.remove("error");
}

function dcRoll() {
  dcStage.innerHTML = "";
  dcSum.textContent = "";
  dcMsg.textContent = "";
  dcMsg.classList.remove("error");
  if (dcMode === "dice") {
    const count = parseInt($("dcCount").value, 10), faces = parseInt($("dcFaces").value, 10);
    const vals = Array.from({ length: count }, () => gmRand(faces) + 1);
    vals.forEach((v) => {
      const d = document.createElement("div");
      d.className = "dc-die";
      d.textContent = v;
      dcStage.appendChild(d);
    });
    if (count > 1) dcSum.textContent = `Total : ${vals.reduce((a, b) => a + b, 0)}`;
  } else if (dcMode === "coin") {
    const d = document.createElement("div");
    d.className = "dc-big";
    d.textContent = "🪙 " + (gmRand(2) ? "Pile" : "Face");
    dcStage.appendChild(d);
  } else {
    const min = parseInt($("dcMin").value, 10), max = parseInt($("dcMax").value, 10);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min || max - min > 1e9 || Math.abs(min) > 1e9 || Math.abs(max) > 1e9) {
      dcMsg.textContent = "Choisis deux nombres entiers, le deuxième plus grand que le premier (écart de 1 milliard maximum).";
      dcMsg.classList.add("error");
      return;
    }
    const d = document.createElement("div");
    d.className = "dc-big";
    d.textContent = min + gmRand(max - min + 1);
    dcStage.appendChild(d);
  }
}
document.querySelectorAll("#dcModes .chip").forEach((c) => c.addEventListener("click", () => dcSet(c.dataset.mode)));
$("dcGo").addEventListener("click", dcRoll);

// ---------- Objectif d'épargne ----------
const SV_KEY = "clippo_savings", SV_MAX = 20;
const svName = $("svName"), svTarget = $("svTarget"), svSaved = $("svSaved"), svDate = $("svDate"), svRate = $("svRate");
const svList = $("svList"), svStatus = $("svStatus");
let svGoals = [];

function svMessage(msg, isError = false) {
  svStatus.textContent = msg;
  svStatus.classList.toggle("error", isError);
}
function svEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function svNum(v) {
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function svEur(n) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
function svId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function svToday() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function svFmtDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function svLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(SV_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((g) => g && typeof g.name === "string" && Number(g.target) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(g.date)))
          .slice(0, SV_MAX)
          .map((g) => ({
            id: String(g.id), name: g.name.slice(0, 60), target: Number(g.target),
            saved: Math.max(0, Number(g.saved) || 0), date: String(g.date),
            rate: Math.min(20, Math.max(0, Number(g.rate) || 0)),
          }))
      : [];
  } catch { return []; }
}
function svSave() {
  try { localStorage.setItem(SV_KEY, JSON.stringify(svGoals)); }
  catch { svMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

function svPlan(g) {
  const remaining = Math.max(0, Math.round((g.target - g.saved) * 100) / 100);
  const pct = Math.min(100, (g.saved / g.target) * 100);
  const now = new Date();
  const d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, d] = g.date.split("-").map(Number);
  const days = Math.round((new Date(y, m - 1, d) - d0) / 86400000);
  const plan = { remaining, pct, days, done: g.saved >= g.target, passed: days < 0, byInterest: false, n: 0, perMonth: 0, perWeek: 0 };
  if (plan.done || days <= 0) return plan;

  plan.n = Math.max(1, Math.ceil(days / 30.4375));
  const mr = g.rate > 0 ? Math.pow(1 + g.rate / 100, 1 / 12) - 1 : 0;
  let need;
  if (mr > 0) {
    const grow = Math.pow(1 + mr, plan.n);
    need = ((g.target - g.saved * grow) * mr) / (grow - 1);
  } else {
    need = remaining / plan.n;
  }
  if (need <= 0) { plan.byInterest = true; return plan; }
  plan.perMonth = Math.ceil(need * 100) / 100;
  plan.perWeek = Math.ceil(((plan.perMonth * 12) / 52) * 100) / 100;
  return plan;
}

function svRender() {
  svList.innerHTML = "";
  if (!svGoals.length) {
    svList.appendChild(svEl("li", "todo-empty", "Aucun objectif pour l'instant. Ajoute le premier ci-dessus."));
    return;
  }
  svGoals.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((g) => {
    const p = svPlan(g);
    const li = svEl("li", "sv-item" + (p.done ? " reached" : ""));

    const head = svEl("div", "sv-head");
    head.appendChild(svEl("strong", "", g.name));
    const del = svEl("button", "todo-btn", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Supprimer : " + g.name);
    del.addEventListener("click", () => {
      if (!confirm(`Supprimer l'objectif « ${g.name} » ?`)) return;
      svGoals = svGoals.filter((x) => x.id !== g.id);
      svSave();
      svRender();
    });
    head.appendChild(del);
    li.appendChild(head);

    li.appendChild(svEl("p", "sv-amounts", `${svEur(g.saved)} sur ${svEur(g.target)} · ${Math.round(p.pct)} %`));
    const meter = svEl("div", "todo-meter");
    const bar = svEl("div", "todo-bar");
    bar.style.width = Math.round(p.pct) + "%";
    meter.appendChild(bar);
    li.appendChild(meter);

    let when = svFmtDate(g.date);
    if (!p.done) when += p.passed ? " · date passée" : p.days === 0 ? " · aujourd'hui" : ` · ${p.days} jour${p.days > 1 ? "s" : ""} restant${p.days > 1 ? "s" : ""}`;
    li.appendChild(svEl("p", "sv-when", when));

    let text;
    if (p.done) text = "🎉 Objectif atteint ! Bravo.";
    else if (p.passed) text = `La date limite est passée : il reste ${svEur(p.remaining)}. Choisis une nouvelle date ci-dessous.`;
    else if (p.days === 0) text = `C'est aujourd'hui : il reste ${svEur(p.remaining)} à mettre de côté.`;
    else if (p.byInterest) text = "Avec les intérêts, ton épargne actuelle suffit pour atteindre l'objectif à la date prévue.";
    else text = `Mets de côté environ ${svEur(p.perMonth)} par mois (≈ ${svEur(p.perWeek)} par semaine) pendant ${p.n} mois. Il reste ${svEur(p.remaining)}.`;
    li.appendChild(svEl("p", "sv-plan", text));

    const row = svEl("div", "sv-actions");
    const amt = document.createElement("input");
    amt.type = "text"; amt.inputMode = "decimal"; amt.className = "text-in"; amt.placeholder = "Montant (€)"; amt.autocomplete = "off";
    amt.setAttribute("aria-label", "Montant du versement pour " + g.name);
    const change = (sign) => {
      const v = svNum(amt.value);
      if (!(v > 0)) return svMessage("Entre un montant supérieur à 0 (ex : 50).", true);
      g.saved = Math.min(1e9, Math.max(0, Math.round((g.saved + sign * v) * 100) / 100));
      svSave();
      svMessage("");
      svRender();
    };
    const plus = svEl("button", "ghost-btn", "+ Ajouter");
    plus.type = "button";
    plus.addEventListener("click", () => change(1));
    const minus = svEl("button", "ghost-btn", "− Retirer");
    minus.type = "button";
    minus.addEventListener("click", () => change(-1));
    amt.addEventListener("keydown", (e) => { if (e.key === "Enter") change(1); });
    row.append(amt, plus, minus);
    li.appendChild(row);

    const dateRow = svEl("label", "select sv-date");
    dateRow.appendChild(svEl("span", "", "Date limite"));
    const di = document.createElement("input");
    di.type = "date"; di.className = "text-in"; di.value = g.date; di.min = svToday();
    di.addEventListener("change", () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(di.value) || di.value <= svToday()) return svMessage("Choisis une date à venir.", true);
      g.date = di.value;
      svSave();
      svMessage("");
      svRender();
    });
    dateRow.appendChild(di);
    li.appendChild(dateRow);

    svList.appendChild(li);
  });
}

$("svAdd").addEventListener("click", () => {
  const target = svNum(svTarget.value);
  if (!(target > 0)) return svMessage("Entre la somme à atteindre (ex : 1500).", true);
  if (target > 1e9) return svMessage("Cette somme est trop grande.", true);
  const saved = svSaved.value.trim() === "" ? 0 : svNum(svSaved.value);
  if (!Number.isFinite(saved) || saved < 0) return svMessage("La somme déjà épargnée doit être un nombre positif (ou vide).", true);
  const rate = svRate.value.trim() === "" ? 0 : svNum(svRate.value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 20) return svMessage("Le taux annuel doit être compris entre 0 et 20 %.", true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(svDate.value) || svDate.value <= svToday()) return svMessage("Choisis une date limite à venir.", true);
  if (svGoals.length >= SV_MAX) return svMessage(`Tu as atteint la limite de ${SV_MAX} objectifs. Supprime-en un.`, true);
  svGoals.push({ id: svId(), name: svName.value.trim().slice(0, 60) || "Mon objectif", target, saved: Math.min(saved, 1e9), date: svDate.value, rate });
  svName.value = ""; svTarget.value = ""; svSaved.value = ""; svRate.value = "";
  svSave();
  svMessage("Objectif ajouté !");
  svRender();
});
[svName, svTarget, svSaved, svRate].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") $("svAdd").click(); }));

svGoals = svLoad();
svDate.min = svToday();
svRender();
document.addEventListener("visibilitychange", () => { if (!document.hidden) svRender(); });

// ---------- Bouton « remonter en haut » ----------
const toTopBtn = $("toTop");
if (toTopBtn) {
  const toTopCheck = () => { toTopBtn.hidden = window.scrollY < 400; };
  window.addEventListener("scroll", toTopCheck, { passive: true });
  toTopBtn.addEventListener("click", () => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  });
  toTopCheck();
}

// ---------- Journal des mises à jour (pastille rouge) ----------
const jrBtn = $("jrBtn"), jrBadge = $("jrBadge"), jrPanel = $("jrPanel"), jrOverlay = $("jrOverlay"), jrBody = $("jrBody");
const JR_KEY = "clippo_updates_seen";

function jrKeys() { // une clé par entrée : date + titre, de la plus récente à la plus ancienne
  return [...document.querySelectorAll("#updates .upd-item")].map((a) => {
    const t = a.querySelector("time"), h = a.querySelector("h3");
    return (t ? t.getAttribute("datetime") : "") + "|" + (h ? h.textContent.trim() : "");
  });
}
function jrUnread() {
  const keys = jrKeys();
  if (!keys.length) return 0;
  let seen = null;
  try { seen = localStorage.getItem(JR_KEY); } catch { /* stockage indisponible */ }
  if (seen === null) return 1; // première visite
  const i = keys.indexOf(seen);
  return i < 0 ? 1 : i;
}
function jrRefresh() {
  const n = jrUnread();
  jrBadge.hidden = n === 0;
  jrBadge.textContent = n > 9 ? "9+" : String(n);
}
function jrMarkSeen() {
  const keys = jrKeys();
  if (keys.length) { try { localStorage.setItem(JR_KEY, keys[0]); } catch { /* ignoré */ } }
  jrRefresh();
}

function jrOpen() {
  jrBody.innerHTML = "";
  const tl = document.querySelector("#updates .timeline");
  if (tl) jrBody.appendChild(tl.cloneNode(true));
  jrPanel.classList.add("open");
  jrOverlay.classList.add("open");
  jrPanel.setAttribute("aria-hidden", "false");
  jrBtn.setAttribute("aria-expanded", "true");
  jrMarkSeen();
  $("jrClose").focus();
}
function jrClose() {
  jrPanel.classList.remove("open");
  jrOverlay.classList.remove("open");
  jrPanel.setAttribute("aria-hidden", "true");
  jrBtn.setAttribute("aria-expanded", "false");
  jrBtn.focus();
}

if (jrBtn) {
  jrBtn.addEventListener("click", jrOpen);
  $("jrClose").addEventListener("click", jrClose);
  jrOverlay.addEventListener("click", jrClose);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && jrPanel.classList.contains("open")) jrClose(); });
  document.querySelectorAll("[data-journal]").forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); jrOpen(); }));
  jrRefresh();
}

// ---------- Générateur de noms de chaîne ----------
const BN_PRE = {
  moderne: ["Neo", "Next", "Pixel", "Flow", "Zen", "Nova", "Ultra", "Hyper", "Meta", "Alpha"],
  mignon: ["Petit", "Mini", "Doux", "Joli", "Happy", "Cosy", "Mochi", "Pop", "Sweet"],
  serieux: ["Pro", "Expert", "Maitre", "Prime", "Elite", "Smart", "Atelier", "Studio"],
  fun: ["Super", "Mega", "Crazy", "Turbo", "Gros", "Capitaine", "Docteur", "Fun"],
};
const BN_SUF = {
  channel: ["TV", "Studio", "Lab", "Club", "Zone", "Univers", "Media", "Show", "Vlog", "Game"],
  shop: ["Shop", "Store", "Boutique", "Market", "Atelier", "Corner", "Factory", "House", "Co"],
  blog: ["Blog", "Mag", "Notes", "Journal", "Hub", "Lab", "Guide", "Facts"],
  team: ["Esport", "Squad", "Team", "Gaming", "Clan", "Crew", "Legends", "Army"],
};
const BN_END = {
  moderne: ["ly", "io", "ify", "hub", "go"],
  mignon: ["land", "club", "time", "party", "friends"],
  serieux: ["pro", "expert", "academy", "works"],
  fun: ["mania", "party", "land", "delire", "zone"],
};

const bnKw = $("bnKw"), bnType = $("bnType"), bnStyle = $("bnStyle"), bnMax = $("bnMax");
const bnNum = $("bnNum"), bnList = $("bnList"), bnStatus = $("bnStatus");

function bnMessage(msg, isError = false) {
  bnStatus.textContent = msg;
  bnStatus.classList.toggle("error", isError);
}
function bnClean(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function bnCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function bnBlend(a, b) {
  return a.slice(0, Math.max(3, Math.ceil(a.length * 0.6))) + b.slice(Math.floor(b.length * 0.4));
}

function bnGenerate() {
  const words = bnKw.value.split(/[\s,;/+]+/).map(bnClean).filter((w) => w.length >= 2).slice(0, 3);
  if (!words.length) return null;
  const pre = BN_PRE[bnStyle.value], suf = BN_SUF[bnType.value], end = BN_END[bnStyle.value];
  const max = parseInt(bnMax.value, 10);
  const patterns = [
    () => bnCap(pick(words)) + pick(suf),
    () => bnCap(pick(words)) + pick(suf),
    () => pick(pre) + bnCap(pick(words)),
    () => pick(pre) + bnCap(pick(words)),
    () => bnCap(pick(words)) + pick(end),
  ];
  if (words.length > 1) {
    patterns.push(
      () => { const a = pick(words); let b = pick(words); if (b === a) b = words.find((w) => w !== a); return bnCap(a) + bnCap(b); },
      () => { const a = pick(words); let b = pick(words); if (b === a) b = words.find((w) => w !== a); return bnCap(bnBlend(a, b)); },
      () => bnCap(words[0]) + bnCap(words[1]) + pick(suf)
    );
  }
  const seen = new Set();
  for (let tries = 0; seen.size < 12 && tries < 300; tries++) {
    let name = pick(patterns)();
    if (bnNum.checked) name += String(10 + Math.floor(Math.random() * 90));
    if (name.length >= 3 && name.length <= max) seen.add(name);
  }
  return [...seen];
}

function bnRender() {
  bnList.innerHTML = "";
  if (!bnKw.value.trim()) return bnMessage("Écris au moins un mot-clé (ex : cuisine).", true);
  const names = bnGenerate();
  if (!names) return bnMessage("Utilise des lettres ou des chiffres pour tes mots-clés.", true);
  if (!names.length) return bnMessage("Aucun nom assez court. Choisis une longueur plus grande ou des mots plus courts.", true);
  bnMessage("");
  names.forEach((name) => {
    const row = document.createElement("div");
    row.className = "fancy-row";
    const box = document.createElement("div");
    const label = document.createElement("small");
    const tag = name.length <= 12 ? "très court" : name.length <= 16 ? "court" : "long";
    label.textContent = `@${name.toLowerCase()} · ${name.length} caractères · ${tag}`;
    const out = document.createElement("span");
    out.textContent = name;
    box.append(label, out);
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
    bnList.appendChild(row);
  });
}

$("bnGo").addEventListener("click", bnRender);
[bnType, bnStyle, bnMax, bnNum].forEach((el) => el.addEventListener("change", () => { if (bnKw.value.trim()) bnRender(); }));
bnKw.addEventListener("input", () => { if (bnKw.value.trim()) bnRender(); else { bnList.innerHTML = ""; bnMessage(""); } });

// ---------- Générateur de description ----------
const DS_LIMITS = { youtube: 5000, tiktok: 4000, instagram: 2200, x: 280 };
const DS_TAGN = { youtube: 3, tiktok: 5, instagram: 8, x: 2 };
const DS_NOTES = {
  youtube: "Sur YouTube, seules les premières lignes (environ 100 à 150 caractères) se voient avant « Afficher plus » : l'accroche compte.",
  tiktok: "Sur TikTok, une légende courte avec 3 à 5 hashtags fonctionne le mieux.",
  instagram: "Sur Instagram, seul le début (environ 125 caractères) se voit avant « plus » : mets l'accroche en premier.",
  x: "Sur X, la limite est de 280 caractères.",
};
const DS_TONES = {
  info: {
    hook: ["Dans cette vidéo, on parle de {t}.", "Tout ce qu'il faut savoir sur {t}.", "{t} : on fait le point.", "Tu veux comprendre {t} ? Voici l'essentiel."],
    body: ["On passe en revue {k} pour que tu repartes avec des idées claires et faciles à appliquer.", "Au programme : {k}, expliqués simplement, étape par étape.", "Je te montre {k} avec des exemples concrets."],
    gen: ["Tout est expliqué simplement, étape par étape.", "Je te montre l'essentiel avec des exemples concrets."],
    cta: ["Si la vidéo t'a aidé, laisse un like et abonne-toi pour ne rien rater.", "Dis-moi en commentaire ce que tu aimerais voir ensuite."],
  },
  fun: {
    hook: ["Tu n'es pas prêt pour {t} 🔥", "{t} : prépare-toi, ça va être drôle ! 😂", "On a testé {t}, et c'était n'importe quoi 🤪", "{t}, mais en mode chaos ! 😎"],
    body: ["Au programme : {k}, avec beaucoup de bonne humeur.", "On parle de {k} et on se marre en route.", "{k} : on y va sans prise de tête !"],
    gen: ["On y va sans prise de tête, avec beaucoup de bonne humeur.", "Prépare-toi à rigoler, ça vaut le détour !"],
    cta: ["Un like si tu as rigolé, et abonne-toi pour la suite ! 👇", "Dis-moi en commentaire ton moment préféré 😎"],
  },
  motive: {
    hook: ["{t} : c'est le moment de passer à l'action 💪", "Si tu veux progresser, regarde ça : {t}.", "{t} : un pas de plus vers tes objectifs 🚀"],
    body: ["On voit {k} ensemble, avec des conseils simples à appliquer dès aujourd'hui.", "{k} : tout ce qu'il faut pour avancer, étape par étape.", "Je partage {k} pour t'aider à te lancer sans attendre."],
    gen: ["Des conseils simples à appliquer dès aujourd'hui pour avancer.", "Lance-toi sans attendre, un pas après l'autre."],
    cta: ["Abonne-toi pour ne pas lâcher et progresser avec moi 🔥", "Commente « Go » si tu es motivé(e) !"],
  },
  pro: {
    hook: ["{t} : notre guide complet.", "Découvrez {t} en détail.", "{t} : ce qu'il faut retenir."],
    body: ["Nous abordons {k} avec une approche claire et professionnelle.", "Vous trouverez ici une analyse de {k}, avec des conseils pratiques.", "Un tour d'horizon de {k} pour vous aider à avancer."],
    gen: ["Une approche claire et des conseils pratiques pour avancer.", "Un tour d'horizon complet, accessible à tous."],
    cta: ["Abonnez-vous pour suivre nos prochains contenus.", "N'hésitez pas à partager votre avis en commentaire."],
  },
};

const dsTitle = $("dsTitle"), dsKw = $("dsKw"), dsPlat = $("dsPlat"), dsTone = $("dsTone");
const dsCta = $("dsCta"), dsTags = $("dsTags"), dsChap = $("dsChap"), dsChapBox = $("dsChapBox");
const dsLinks = $("dsLinks"), dsList = $("dsList"), dsNote = $("dsNote"), dsStatus = $("dsStatus");

function dsMessage(msg, isError = false) {
  dsStatus.textContent = msg;
  dsStatus.classList.toggle("error", isError);
}
function dsClean(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function dsJoin(list) {
  if (list.length === 1) return list[0];
  return list.slice(0, -1).join(", ") + " et " + list[list.length - 1];
}

function dsBuild() {
  const title = dsTitle.value.trim().replace(/[.!?…\s]+$/, "");
  if (!title) return null;
  const kws = dsKw.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const plat = dsPlat.value, tone = DS_TONES[dsTone.value], limit = DS_LIMITS[plat];
  const short = plat === "tiktok" || plat === "x";
  const kText = kws.length ? dsJoin(kws) : "";
  const links = dsLinks.value.trim();

  const tagSet = [];
  const addTag = (t) => { if (t.length >= 3 && t.length <= 30 && !tagSet.includes(t)) tagSet.push(t); };
  kws.forEach((k) => addTag(dsClean(k)));
  title.split(/\s+/).forEach((w) => { const c = dsClean(w); if (c.length >= 5) addTag(c); });
  const tagLine = dsTags.checked && tagSet.length ? tagSet.slice(0, DS_TAGN[plat]).map((t) => "#" + t).join(" ") : "";
  const chap = plat === "youtube" && dsChap.checked ? "Chapitres :\n00:00 Introduction\n01:00 Première partie\n02:00 Deuxième partie\n03:00 Conclusion" : "";

  const out = new Set();
  for (let tries = 0; out.size < 4 && tries < 80; tries++) {
    const hook = pick(tone.hook).split("{t}").join(title);
    const body = kText ? pick(tone.body).split("{k}").join(kText) : pick(tone.gen);
    const cta = dsCta.checked ? pick(tone.cta) : "";
    const variants = [
      short ? [hook, cta, tagLine] : [hook, body, chap, cta, links, tagLine],
      [hook, cta, tagLine],
      [hook, tagLine],
      [hook],
    ].map((v) => v.filter(Boolean).join("\n\n"));
    let text = variants.find((v) => v.length <= limit);
    if (!text) text = variants[3].slice(0, limit - 1) + "…";
    out.add(text);
  }
  return [...out];
}

function dsRender() {
  dsList.innerHTML = "";
  dsChapBox.hidden = dsPlat.value !== "youtube";
  dsNote.textContent = DS_NOTES[dsPlat.value];
  if (!dsTitle.value.trim()) return dsMessage("Écris le titre ou le sujet de ta vidéo.", true);
  const list = dsBuild();
  dsMessage("");
  list.forEach((text) => {
    const row = document.createElement("div");
    row.className = "fancy-row";
    const box = document.createElement("div");
    const label = document.createElement("small");
    label.textContent = `${text.length} / ${DS_LIMITS[dsPlat.value]} caractères`;
    const out = document.createElement("span");
    out.textContent = text;
    box.append(label, out);
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copier";
    btn.addEventListener("click", async () => {
      try {
        await copyText(text);
        btn.textContent = "Copié !";
        btn.classList.add("done");
      } catch {
        btn.textContent = "Erreur";
      }
      setTimeout(() => { btn.textContent = "Copier"; btn.classList.remove("done"); }, 1500);
    });
    row.append(box, btn);
    dsList.appendChild(row);
  });
}

$("dsGo").addEventListener("click", dsRender);
[dsPlat, dsTone, dsCta, dsTags, dsChap].forEach((el) => el.addEventListener("change", dsRender));
[dsTitle, dsKw, dsLinks].forEach((el) => el.addEventListener("input", () => { if (dsTitle.value.trim()) dsRender(); else { dsList.innerHTML = ""; dsMessage(""); } }));
dsChapBox.hidden = dsPlat.value !== "youtube";
dsNote.textContent = DS_NOTES[dsPlat.value];

// ---------- Planning de révisions ----------
const SP_KEY = "clippo_revplan", SP_MAX = 12, SP_HORIZON = 180;
const SP_LEVELS = { 1: "Facile", 2: "Moyenne", 3: "Difficile" };
const spName = $("spName"), spDate = $("spDate"), spLevel = $("spLevel");
const spSubjectsEl = $("spSubjects"), spPlanEl = $("spPlan"), spStatus = $("spStatus");
const spMinEl = $("spMin"), spLenEl = $("spLen"), spWeekendEl = $("spWeekend");
const spSummary = $("spSummary"), spBar = $("spBar"), spMore = $("spMore"), spPlanBox = $("spPlanBox");
let spSubjects = [], spDone = new Set(), spStart = "", spShowAll = false;

function spMessage(msg, isError = false) {
  spStatus.textContent = msg;
  spStatus.classList.toggle("error", isError);
}
function spEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function spPad(n) { return String(n).padStart(2, "0"); }
function spIso(d) { return d.getFullYear() + "-" + spPad(d.getMonth() + 1) + "-" + spPad(d.getDate()); }
function spParse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function spAddDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function spToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function spDiff(a, b) { return Math.round((a - b) / 86400000); }
function spFmtDate(d) {
  const s = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function spId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function spLoad() {
  const empty = { subjects: [], min: 60, len: 30, weekend: true, start: "", done: [] };
  try {
    const d = JSON.parse(localStorage.getItem(SP_KEY) || "{}");
    if (!d || typeof d !== "object") return empty;
    const subs = Array.isArray(d.subjects)
      ? d.subjects.filter((s) => s && typeof s.name === "string" && spParse(s.date)).slice(0, SP_MAX)
          .map((s) => ({ id: String(s.id), name: s.name.slice(0, 40), date: String(s.date), level: [1, 2, 3].includes(Number(s.level)) ? Number(s.level) : 2 }))
      : [];
    const set = d.settings || {};
    return {
      subjects: subs,
      min: [30, 60, 90, 120, 180].includes(Number(set.min)) ? Number(set.min) : 60,
      len: [25, 30, 45, 60].includes(Number(set.len)) ? Number(set.len) : 30,
      weekend: set.weekend !== false,
      start: spParse(d.start) ? String(d.start) : "",
      done: Array.isArray(d.done) ? d.done.map(String).slice(0, 5000) : [],
    };
  } catch { return empty; }
}
function spSave() {
  try {
    localStorage.setItem(SP_KEY, JSON.stringify({
      subjects: spSubjects,
      settings: { min: parseInt(spMinEl.value, 10), len: parseInt(spLenEl.value, 10), weekend: spWeekendEl.checked },
      start: spStart,
      done: [...spDone],
    }));
  } catch { spMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

// Répartit les séances, jour par jour, depuis la date de départ jusqu'à la veille du dernier examen
function spBuild() {
  const start = spParse(spStart) || spToday();
  const subs = spSubjects.map((s) => ({ s, at: spParse(s.date) })).filter((x) => x.at > start);
  if (!subs.length) return { days: [], total: 0 };
  const last = new Date(Math.max(...subs.map((x) => x.at.getTime())));
  const min = parseInt(spMinEl.value, 10), len = parseInt(spLenEl.value, 10);
  const perDay = Math.max(1, Math.floor(min / len));
  const count = {};
  subs.forEach((x) => { count[x.s.id] = 0; });
  const days = [];
  let total = 0;
  for (let d = start, n = 0; d <= last && n < 400; d = spAddDays(d, 1), n++) {
    const iso = spIso(d), dow = d.getDay();
    const active = subs.filter((x) => x.at > d);
    const exams = subs.filter((x) => spDiff(x.at, d) === 0).map((x) => x.s);
    const sessions = [];
    if (active.length && (spWeekendEl.checked || (dow !== 0 && dow !== 6))) {
      const picked = {};
      for (let slot = 0; slot < perDay; slot++) {
        let best = null, bestP = -1;
        active.forEach((x) => {
          const left = spDiff(x.at, d);
          let p = (x.s.level * (1 + 2 / left)) / (count[x.s.id] + 1);
          if (picked[x.s.id]) p *= 0.5;   // on varie les matières dans la journée
          if (left === 1) p *= 1.5;       // la veille : révision finale
          if (p > bestP) { bestP = p; best = x; }
        });
        picked[best.s.id] = true;
        count[best.s.id]++;
        sessions.push({ id: iso + "|" + best.s.id + "|" + slot, subject: best.s, final: spDiff(best.at, d) === 1 });
        total++;
      }
    }
    if (sessions.length || exams.length) days.push({ iso, date: d, exams, sessions });
  }
  return { days, total };
}

function spRender() {
  const today = spToday();
  const len = parseInt(spLenEl.value, 10);

  // Liste des examens
  spSubjectsEl.innerHTML = "";
  spSubjects.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((s) => {
    const dd = spDiff(spParse(s.date), today);
    const li = spEl("li", "sp-sub" + (dd < 0 ? " past" : ""));
    const info = spEl("div", "sp-info");
    info.appendChild(spEl("strong", "", s.name));
    info.appendChild(spEl("span", "", spFmtDate(spParse(s.date)) + " · " + (dd > 0 ? `dans ${dd} jour${dd > 1 ? "s" : ""}` : dd === 0 ? "aujourd'hui" : "terminé")));
    const chip = spEl("span", "sp-chip", SP_LEVELS[s.level]);
    const del = spEl("button", "todo-btn", "×");
    del.type = "button";
    del.setAttribute("aria-label", "Supprimer : " + s.name);
    del.addEventListener("click", () => {
      spSubjects = spSubjects.filter((x) => x.id !== s.id);
      spStart = spIso(today);
      spSave();
      spRender();
    });
    li.append(info, chip, del);
    spSubjectsEl.appendChild(li);
  });

  // Planning
  spPlanBox.hidden = !spSubjects.length;
  spPlanEl.innerHTML = "";
  if (!spSubjects.length) return;

  const plan = spBuild();
  const valid = new Set(plan.days.flatMap((d) => d.sessions.map((x) => x.id)));
  [...spDone].forEach((id) => { if (!valid.has(id)) spDone.delete(id); });
  const done = spDone.size;
  const hours = Math.round(((plan.total * len) / 60) * 10) / 10;
  spSummary.textContent = plan.total
    ? `${plan.total} séance${plan.total > 1 ? "s" : ""} de ${len} min (environ ${hours} h) · ${done} faite${done > 1 ? "s" : ""}`
    : "Aucune séance à planifier : vérifie les dates de tes examens, ou coche « Réviser le week-end ».";
  spBar.style.width = plan.total ? Math.round((done / plan.total) * 100) + "%" : "0%";

  const upcoming = plan.days.filter((d) => d.date >= today);
  const shown = spShowAll ? upcoming : upcoming.slice(0, 14);
  shown.forEach((day) => {
    const diff = spDiff(day.date, today);
    const box = spEl("div", "sp-day" + (diff === 0 ? " today" : ""));
    const head = spEl("div", "sp-dayhead");
    head.appendChild(spEl("strong", "", spFmtDate(day.date)));
    if (diff === 0) head.appendChild(spEl("em", "sp-tag", "Aujourd'hui"));
    else if (diff === 1) head.appendChild(spEl("em", "sp-tag", "Demain"));
    box.appendChild(head);

    day.sessions.forEach((s) => {
      const lab = spEl("label", "sp-sess" + (spDone.has(s.id) ? " done" : ""));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = spDone.has(s.id);
      cb.addEventListener("change", () => {
        if (cb.checked) spDone.add(s.id); else spDone.delete(s.id);
        spSave();
        spRender();
      });
      lab.append(cb, spEl("span", "", `${s.subject.name} · ${len} min`));
      if (s.final) lab.appendChild(spEl("em", "sp-tag final", "Révision finale"));
      box.appendChild(lab);
    });
    day.exams.forEach((s) => box.appendChild(spEl("div", "sp-exam", "📝 Examen : " + s.name)));
    spPlanEl.appendChild(box);
  });
  if (!shown.length && plan.total) spPlanEl.appendChild(spEl("p", "todo-empty", "Toutes tes séances sont passées. Ajoute un nouvel examen."));
  spMore.hidden = spShowAll || upcoming.length <= 14;
}

$("spAdd").addEventListener("click", () => {
  const today = spToday();
  const d = spParse(spDate.value);
  if (!d) return spMessage("Choisis la date de l'examen.", true);
  if (d <= today) return spMessage("Choisis une date à venir (au moins demain).", true);
  if (spDiff(d, today) > SP_HORIZON) return spMessage(`Choisis une date dans les ${SP_HORIZON} prochains jours.`, true);
  if (spSubjects.length >= SP_MAX) return spMessage(`Tu as atteint la limite de ${SP_MAX} examens. Supprime-en un.`, true);
  spSubjects.push({ id: spId(), name: spName.value.trim().slice(0, 40) || "Matière", date: spDate.value, level: parseInt(spLevel.value, 10) });
  spName.value = ""; spDate.value = "";
  spStart = spIso(today);
  spSave();
  spMessage("Examen ajouté !");
  spRender();
});
spName.addEventListener("keydown", (e) => { if (e.key === "Enter") $("spAdd").click(); });
[spMinEl, spLenEl, spWeekendEl].forEach((el) => el.addEventListener("change", () => {
  spStart = spIso(spToday());
  spSave();
  spRender();
}));
spMore.addEventListener("click", () => { spShowAll = true; spRender(); });

const spInit = spLoad();
spSubjects = spInit.subjects;
spDone = new Set(spInit.done);
spStart = spInit.start || spIso(spToday());
spMinEl.value = String(spInit.min);
spLenEl.value = String(spInit.len);
spWeekendEl.checked = spInit.weekend;
spDate.min = spIso(spAddDays(spToday(), 1));
spRender();
document.addEventListener("visibilitychange", () => { if (!document.hidden) spRender(); });

// ---------- Favoris et derniers outils utilisés ----------
const fvBox = $("fvBox");
if (fvBox) {
  const FV_FAV_KEY = "clippo_favs", FV_REC_KEY = "clippo_recent", FV_FAV_MAX = 12, FV_REC_MAX = 8, FV_REC_SHOW = 5;
  const fvSearch = document.getElementById("homeSearch");
  const fvTools = {};

  // Noms et icônes : lus dans les cartes de l'accueil
  document.querySelectorAll("#home .tool-card[data-go]").forEach((c) => {
    const id = c.dataset.go;
    if (fvTools[id]) return;
    const ico = c.querySelector(".tc-ico"), name = c.querySelector("strong");
    fvTools[id] = { name: name ? name.textContent.trim() : id, icon: ico ? ico.textContent.trim() : "🧰" };
  });

  function fvRead(key, max) {
    try {
      const d = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(d) ? [...new Set(d.map(String))].filter((id) => fvTools[id]).slice(0, max) : [];
    } catch { return []; }
  }
  function fvWrite(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* stockage indisponible */ }
  }
  let fvFavs = fvRead(FV_FAV_KEY, FV_FAV_MAX), fvRecent = fvRead(FV_REC_KEY, FV_REC_MAX);

  function fvOpen(id) {
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) tab.click(); else openTab(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function fvItem(id) {
    const t = fvTools[id];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fv-item";
    const i = document.createElement("span");
    i.textContent = t.icon;
    i.setAttribute("aria-hidden", "true");
    const n = document.createElement("span");
    n.textContent = t.name;
    b.append(i, n);
    b.addEventListener("click", () => fvOpen(id));
    return b;
  }

  function fvMark() { // met à jour toutes les étoiles
    document.querySelectorAll(".fv-star, .fv-pbtn").forEach((b) => {
      const on = fvFavs.includes(b.dataset.id), name = fvTools[b.dataset.id].name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
      if (b.classList.contains("fv-star")) {
        b.textContent = on ? "★" : "☆";
        b.setAttribute("aria-label", (on ? "Retirer des favoris : " : "Ajouter aux favoris : ") + name);
      } else {
        b.textContent = on ? "★ Dans mes favoris" : "☆ Ajouter aux favoris";
      }
    });
  }

  function fvRender() {
    const searching = !!(fvSearch && fvSearch.value.trim());
    const favEl = $("fvFavs"), recEl = $("fvRec");
    favEl.innerHTML = "";
    recEl.innerHTML = "";
    fvFavs.forEach((id) => favEl.appendChild(fvItem(id)));
    const rec = fvRecent.filter((id) => !fvFavs.includes(id)).slice(0, FV_REC_SHOW);
    rec.forEach((id) => recEl.appendChild(fvItem(id)));
    $("fvFavsBox").hidden = !fvFavs.length;
    $("fvRecBox").hidden = !rec.length;
    fvBox.hidden = searching || (!fvFavs.length && !rec.length);
    fvMark();
  }

  function fvToggle(id) {
    if (fvFavs.includes(id)) fvFavs = fvFavs.filter((x) => x !== id);
    else if (fvFavs.length >= FV_FAV_MAX) return alert(`Tu as déjà ${FV_FAV_MAX} favoris. Retire-en un pour en ajouter un autre.`);
    else fvFavs.push(id);
    fvWrite(FV_FAV_KEY, fvFavs);
    fvRender();
  }

  function fvTrack(id) {
    if (!fvTools[id]) return;
    fvRecent = [id, ...fvRecent.filter((x) => x !== id)].slice(0, FV_REC_MAX);
    fvWrite(FV_REC_KEY, fvRecent);
    fvRender();
  }

  // Étoile dans le coin de chaque carte de « Tous les outils »
  document.querySelectorAll("#home .tool-card[data-go]").forEach((card) => {
    const id = card.dataset.go;
    const wrap = document.createElement("div");
    wrap.className = "fv-wrap";
    card.parentNode.insertBefore(wrap, card);
    wrap.appendChild(card);
    const star = document.createElement("button");
    star.type = "button";
    star.className = "fv-star";
    star.dataset.id = id;
    star.addEventListener("click", () => fvToggle(id));
    wrap.appendChild(star);
  });

  // Bouton « Ajouter aux favoris » dans chaque outil
  Object.keys(fvTools).forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel || !panel.classList.contains("panel")) return;
    const anchor = panel.querySelector(".sub") || panel.querySelector("h1");
    if (!anchor) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fv-pbtn";
    b.dataset.id = id;
    b.addEventListener("click", () => fvToggle(id));
    anchor.insertAdjacentElement("afterend", b);
  });

  $("fvClear").addEventListener("click", () => {
    fvRecent = [];
    fvWrite(FV_REC_KEY, fvRecent);
    fvRender();
  });
  if (fvSearch) fvSearch.addEventListener("input", fvRender);

  // Chaque ouverture d'outil est notée (menu, cartes, raccourcis, liens directs)
  const fvOriginalOpen = openTab;
  openTab = (id) => { fvOriginalOpen(id); fvTrack(id); };
  const fvStart = location.hash.slice(1);
  if (fvTools[fvStart]) fvTrack(fvStart);

  fvRender();
}

// ---------- Palette de couleurs ----------
const plSwatches = $("plSwatches"), plStatus = $("plStatus"), plCount = $("plCount"), plHarmony = $("plHarmony"), plFmt = $("plFmt");
const plGo = $("plGo"), plPhotoBox = $("plPhotoBox"), plHarmonyBox = $("plHarmonyBox"), plPreview = $("plPreview");
const plDrop = $("plDrop"), plFile = $("plFile");
let plColors = [], plMode = "gen", plPhotoUrl = null, plPhotoFile = null;

function plMessage(msg, isError = false) {
  plStatus.textContent = msg;
  plStatus.classList.toggle("error", isError);
}
function plRnd(a, b) { return a + Math.random() * (b - a); }

// --- Conversions de couleurs ---
function plHslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return "#" + to(f(0)) + to(f(8)) + to(f(4));
}
function plHexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function plRgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
}
function plRgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function plLum(hex) {
  const [r, g, b] = plHexToRgb(hex).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function plInk(hex) { return plLum(hex) > 0.45 ? "#15112e" : "#ffffff"; } // texte lisible sur la couleur
function plFormat(hex, fmt) {
  if (fmt === "rgb") { const [r, g, b] = plHexToRgb(hex); return `rgb(${r}, ${g}, ${b})`; }
  if (fmt === "hsl") { const [h, s, l] = plRgbToHsl(...plHexToRgb(hex)); return `hsl(${h}, ${s}%, ${l}%)`; }
  return hex.toUpperCase();
}

// --- Génération ---
function plGenerate(mode, n, baseHue) {
  const h0 = baseHue === undefined ? plRnd(0, 360) : baseHue;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    let h, s, l;
    if (mode === "analog") { h = h0 + (i - (n - 1) / 2) * 28; s = plRnd(50, 80); l = plRnd(35, 70); }
    else if (mode === "comp") { h = h0 + (i % 2 ? 180 : 0) + plRnd(-10, 10); s = plRnd(50, 85); l = plRnd(30, 75); }
    else if (mode === "triad") { h = h0 + (i % 3) * 120 + plRnd(-8, 8); s = plRnd(50, 80); l = plRnd(35, 72); }
    else if (mode === "mono") { h = h0 + plRnd(-4, 4); s = plRnd(40, 75); l = 18 + t * 68; }
    else if (mode === "pastel") { h = plRnd(0, 360); s = plRnd(60, 85); l = plRnd(78, 90); }
    else { h = plRnd(0, 360); s = plRnd(45, 85); l = plRnd(30, 78); }
    out.push(plHslToHex(h, s, l));
  }
  return out;
}

function plRegenerate() {
  const n = plColors.length;
  const locked = plColors.find((c) => c.locked);
  const base = locked ? plRgbToHsl(...plHexToRgb(locked.hex))[0] : undefined; // l'harmonie se construit autour du verrou
  const fresh = plGenerate(plHarmony.value, n, base);
  plColors = plColors.map((c, i) => (c.locked ? c : { hex: fresh[i], locked: false }));
}

function plResize(n) {
  const fresh = plGenerate(plHarmony.value, n);
  plColors = Array.from({ length: n }, (_, i) => plColors[i] || { hex: fresh[i], locked: false });
}

// --- Couleurs dominantes d'une photo (median cut) ---
function plMedianCut(px, n) {
  const boxes = [px];
  while (boxes.length < n) {
    let bi = -1, bs = 0, bch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      const rng = [0, 1, 2].map((c) => {
        let mn = 255, mx = 0;
        for (const p of b) { if (p[c] < mn) mn = p[c]; if (p[c] > mx) mx = p[c]; }
        return mx - mn;
      });
      const ch = rng.indexOf(Math.max(...rng));
      const score = rng[ch] * Math.sqrt(b.length);
      if (score > bs) { bs = score; bi = i; bch = ch; }
    });
    if (bi < 0) break;
    const sorted = boxes[bi].slice().sort((a, c) => a[bch] - c[bch]);
    const mid = sorted.length >> 1;
    boxes.splice(bi, 1, sorted.slice(0, mid), sorted.slice(mid));
  }
  return boxes.filter((b) => b.length).map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return { rgb: s.map((v) => v / b.length), size: b.length };
  }).sort((a, b) => b.size - a.size).map((x) => plRgbToHex(...x.rgb));
}

function plExtract(file) {
  if (!file || !file.type.startsWith("image/")) return plMessage("Choisis un fichier image.", true);
  if (file.size > 30 * 1048576) return plMessage("Cette image est trop lourde (30 Mo maximum).", true);
  plMessage("Lecture de la photo…");
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 120 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    const px = [];
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) px.push([data[i], data[i + 1], data[i + 2]]);
    if (px.length < 10) { URL.revokeObjectURL(url); return plMessage("Cette image est presque transparente : essaie une autre photo.", true); }
    const hexes = plMedianCut(px, parseInt(plCount.value, 10));
    plColors = hexes.map((hex) => ({ hex, locked: false }));
    if (plPhotoUrl) URL.revokeObjectURL(plPhotoUrl);
    plPhotoUrl = url;
    plPhotoFile = file;
    plPreview.src = url;
    plPreview.hidden = false;
    plRender();
    plMessage(hexes.length < parseInt(plCount.value, 10) ? "Cette image contient peu de couleurs différentes : la palette est plus courte." : "Palette tirée de ta photo !");
  };
  img.onerror = () => { URL.revokeObjectURL(url); plMessage("Impossible de lire cette image.", true); };
  img.src = url;
}

// --- Affichage ---
async function plCopy(text, okMsg) {
  try { await copyText(text); plMessage(okMsg || `${text} copié !`); }
  catch { plMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
}

function plRender() {
  plSwatches.innerHTML = "";
  const fmt = plFmt.value;
  plColors.forEach((c, i) => {
    const sw = document.createElement("div");
    sw.className = "pl-sw";
    sw.style.background = c.hex;
    sw.style.color = plInk(c.hex);
    const code = document.createElement("button");
    code.type = "button";
    code.className = "pl-code";
    code.textContent = plFormat(c.hex, fmt);
    code.setAttribute("aria-label", "Copier " + plFormat(c.hex, fmt));
    code.addEventListener("click", () => plCopy(plFormat(c.hex, fmt)));
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "pl-lock" + (c.locked ? " on" : "");
    lock.textContent = c.locked ? "🔒" : "🔓";
    lock.setAttribute("aria-pressed", String(c.locked));
    lock.setAttribute("aria-label", (c.locked ? "Déverrouiller" : "Verrouiller") + " la couleur " + (i + 1));
    lock.addEventListener("click", () => { c.locked = !c.locked; plRender(); });
    sw.append(code, lock);
    plSwatches.appendChild(sw);
  });
}

function plSetMode(mode) {
  plMode = mode;
  document.querySelectorAll("#plModes .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === mode));
  plHarmonyBox.hidden = mode !== "gen";
  plGo.hidden = mode !== "gen";
  plPhotoBox.hidden = mode !== "photo";
  plMessage("");
}

// --- Boutons ---
$("plModes").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => plSetMode(c.dataset.mode)));
plGo.addEventListener("click", () => { plRegenerate(); plRender(); plMessage(""); });
plHarmony.addEventListener("change", () => { plRegenerate(); plRender(); });
plCount.addEventListener("change", () => {
  const n = parseInt(plCount.value, 10);
  if (plMode === "photo" && plPhotoFile) return plExtract(plPhotoFile);
  plResize(n);
  plRender();
});
plFmt.addEventListener("change", plRender);

plFile.addEventListener("change", () => plExtract(plFile.files[0]));
["dragenter", "dragover"].forEach((ev) => plDrop.addEventListener(ev, (e) => { e.preventDefault(); plDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => plDrop.addEventListener(ev, (e) => { e.preventDefault(); plDrop.classList.remove("over"); }));
plDrop.addEventListener("drop", (e) => plExtract(e.dataTransfer.files[0]));

$("plCopyAll").addEventListener("click", () => {
  if (!plColors.length) return;
  plCopy(plColors.map((c) => plFormat(c.hex, plFmt.value)).join("\n"), "Les codes sont copiés !");
});
$("plCopyCss").addEventListener("click", () => {
  if (!plColors.length) return;
  plCopy(":root {\n" + plColors.map((c, i) => `  --couleur-${i + 1}: ${c.hex};`).join("\n") + "\n}", "Les variables CSS sont copiées !");
});
$("plSave").addEventListener("click", () => {
  if (!plColors.length) return;
  const w = 1200, h = 400, n = plColors.length;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  plColors.forEach((col, i) => {
    const x0 = Math.round((w / n) * i), x1 = Math.round((w / n) * (i + 1));
    x.fillStyle = col.hex;
    x.fillRect(x0, 0, x1 - x0, h);
    x.fillStyle = plInk(col.hex);
    x.font = `700 ${n > 6 ? 22 : 28}px "DM Sans", sans-serif`;
    x.textAlign = "center";
    x.fillText(col.hex.toUpperCase(), (x0 + x1) / 2, h - 36);
  });
  c.toBlob((b) => {
    if (!b) return plMessage("Impossible de créer l'image.", true);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clippo-palette.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
});

// Barre d'espace : nouvelle palette (ordinateur, hors champs de saisie)
document.addEventListener("keydown", (e) => {
  const panel = document.getElementById("palette");
  if (e.code !== "Space" || !panel || !panel.classList.contains("active") || plMode !== "gen") return;
  if (e.target.closest("input, textarea, select, button, a")) return;
  e.preventDefault();
  plRegenerate();
  plRender();
});

plResize(parseInt(plCount.value, 10));
plSetMode("gen");
plRegenerate();
plRender();

// ---------- Convertisseur de notes ----------
const gcNote = $("gcNote"), gcFrom = $("gcFrom"), gcOther = $("gcOther"), gcOtherBox = $("gcOtherBox");
const gcResults = $("gcResults"), gcInfo = $("gcInfo"), gcStatus = $("gcStatus"), gcTo = $("gcTo"), gcToOut = $("gcToOut");

function gcMessage(msg, isError = false) {
  gcStatus.textContent = msg;
  gcStatus.classList.toggle("error", isError);
}
function gcNum(v) {
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
function gcFmt(n) {
  return (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}
function gcMention(p) {
  if (p >= 80) return "Très bien";
  if (p >= 70) return "Bien";
  if (p >= 60) return "Assez bien";
  if (p >= 50) return "Passable";
  return "Sous la moyenne";
}
function gcLetter(p) {
  if (p >= 90) return "A";
  if (p >= 80) return "B";
  if (p >= 70) return "C";
  if (p >= 60) return "D";
  return "F";
}

function gcRender() {
  gcOtherBox.hidden = gcFrom.value !== "other";
  gcResults.innerHTML = "";
  gcInfo.textContent = "";
  gcToOut.textContent = "";
  const raw = gcNote.value.trim();
  if (!raw) return gcMessage("");

  const note = gcNum(raw);
  const scale = gcFrom.value === "other" ? gcNum(gcOther.value) : parseFloat(gcFrom.value);
  if (!(note >= 0)) return gcMessage("Entre une note positive (ex : 14,5).", true);
  if (!(scale > 0)) return gcMessage("Entre un barème supérieur à 0 (ex : 30).", true);
  if (scale > 1000) return gcMessage("Ce barème est trop grand (1000 maximum).", true);
  if (note > scale) return gcMessage("La note ne peut pas dépasser le barème.", true);
  gcMessage("");

  const p = (note / scale) * 100;
  const items = [
    ["Sur 20", gcFmt(p / 5) + " / 20"],
    ["Sur 10", gcFmt(p / 10) + " / 10"],
    ["Sur 100", gcFmt(p) + " / 100"],
    ["Sur 5", gcFmt(p / 20) + " / 5"],
    ["Pourcentage", gcFmt(p) + " %"],
  ];
  items.forEach(([label, value]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gc-box";
    b.setAttribute("aria-label", "Copier : " + label + " " + value);
    const s = document.createElement("small");
    s.textContent = label;
    const v = document.createElement("strong");
    v.textContent = value;
    b.append(s, v);
    b.addEventListener("click", async () => {
      try { await copyText(value); gcMessage(value + " copié !"); }
      catch { gcMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
    });
    gcResults.appendChild(b);
  });
  gcInfo.textContent = `Mention (repère du bac) : ${gcMention(p)} · Équivalent américain (indicatif) : ${gcLetter(p)}`;

  const to = gcNum(gcTo.value);
  if (gcTo.value.trim() && to > 0 && to <= 1000) {
    gcToOut.textContent = `${gcFmt(note)} / ${gcFmt(scale)} = ${gcFmt((p / 100) * to)} / ${gcFmt(to)}`;
  } else if (gcTo.value.trim()) {
    gcMessage("Entre un barème d'arrivée entre 1 et 1000.", true);
  }
}

// Tableau d'équivalences de 20 à 0
(() => {
  const body = $("gcTable");
  for (let n = 20; n >= 0; n--) {
    const tr = document.createElement("tr");
    [n, gcFmt(n / 2), gcFmt(n * 5), gcMention(n * 5)].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
})();

[gcNote, gcOther, gcTo].forEach((el) => el.addEventListener("input", gcRender));
gcFrom.addEventListener("change", gcRender);
gcRender();

// ---------- Photo en PDF (sans bibliothèque, sur l'appareil) ----------
const PP_MAX = 30;
const PP_QUALITY = { high: { side: 2400, q: 0.92 }, mid: { side: 1800, q: 0.8 }, low: { side: 1200, q: 0.6 } };
const PP_PAGES = { a4: [595.28, 841.89], letter: [612, 792] };
const ppDrop = $("ppDrop"), ppFile = $("ppFile"), ppList = $("ppList"), ppStatus = $("ppStatus"), ppCount = $("ppCount");
const ppSize = $("ppSize"), ppOrient = $("ppOrient"), ppOrientBox = $("ppOrientBox"), ppMargin = $("ppMargin"), ppQuality = $("ppQuality");
const ppName = $("ppName"), ppMake = $("ppMake"), ppSet = $("ppSet"), ppResult = $("ppResult"), ppSave = $("ppSave"), ppInfo = $("ppInfo");
let ppItems = [], ppUrl = null, ppBusy = false;

function ppMessage(msg, isError = false) {
  ppStatus.textContent = msg;
  ppStatus.classList.toggle("error", isError);
}
const ppPause = () => new Promise((r) => setTimeout(r, 20));
function ppId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function ppFmtSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " Mo" : Math.max(1, Math.round(bytes / 1024)) + " Ko";
}

// Dessine une photo (réduite et pivotée) sur un canevas à fond blanc
async function ppRender(file, rot, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Image illisible"));
      im.src = url;
    });
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error("Image vide");
    const k = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const swap = rot % 2 === 1;
    const c = document.createElement("canvas");
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    const x = c.getContext("2d");
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2);
    x.rotate((rot * Math.PI) / 2);
    x.imageSmoothingQuality = "high";
    x.drawImage(img, -w / 2, -h / 2, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ppInvalidate() { // le résultat n'est plus à jour
  ppResult.hidden = true;
  if (ppUrl) { URL.revokeObjectURL(ppUrl); ppUrl = null; }
}

function ppBtn(label, aria, fn, disabled) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.setAttribute("aria-label", aria);
  b.disabled = !!disabled;
  b.addEventListener("click", fn);
  return b;
}

function ppRenderList() {
  ppList.innerHTML = "";
  ppItems.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "pp-item";
    const frame = document.createElement("div");
    frame.className = "pp-frame";
    const img = document.createElement("img");
    img.src = it.thumb;
    img.alt = "Photo " + (i + 1);
    img.style.transform = `rotate(${it.rot * 90}deg)`;
    frame.appendChild(img);
    const num = document.createElement("span");
    num.className = "pp-num";
    num.textContent = String(i + 1);
    frame.appendChild(num);
    const name = document.createElement("span");
    name.className = "pp-name";
    name.textContent = it.name;
    const bar = document.createElement("div");
    bar.className = "pp-btns";
    bar.append(
      ppBtn("←", "Déplacer la photo " + (i + 1) + " vers le début", () => ppMove(i, -1), i === 0),
      ppBtn("→", "Déplacer la photo " + (i + 1) + " vers la fin", () => ppMove(i, 1), i === ppItems.length - 1),
      ppBtn("↻", "Pivoter la photo " + (i + 1), () => { it.rot = (it.rot + 1) % 4; ppInvalidate(); ppRenderList(); }),
      ppBtn("×", "Retirer la photo " + (i + 1), () => { ppItems.splice(i, 1); ppInvalidate(); ppRenderList(); })
    );
    li.append(frame, name, bar);
    ppList.appendChild(li);
  });
  ppSet.hidden = !ppItems.length;
  ppCount.textContent = ppItems.length ? `${ppItems.length} photo${ppItems.length > 1 ? "s" : ""} · ${ppItems.length} page${ppItems.length > 1 ? "s" : ""}` : "";
  ppOrientBox.hidden = ppSize.value === "image";
}

function ppMove(i, d) {
  const j = i + d;
  if (j < 0 || j >= ppItems.length) return;
  [ppItems[i], ppItems[j]] = [ppItems[j], ppItems[i]];
  ppInvalidate();
  ppRenderList();
}

async function ppAdd(list) {
  const files = Array.from(list).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return ppMessage("Choisis des fichiers image (PNG, JPG, WEBP…).", true);
  ppMessage("Lecture des photos…");
  let unreadable = 0, tooBig = 0, full = false;
  for (const f of files) {
    if (ppItems.length >= PP_MAX) { full = true; break; }
    if (f.size > 30 * 1048576) { tooBig++; continue; }
    try {
      const c = await ppRender(f, 0, 220);
      ppItems.push({ id: ppId(), file: f, rot: 0, thumb: c.toDataURL("image/jpeg", 0.7), name: f.name || "photo" });
    } catch { unreadable++; }
  }
  ppInvalidate();
  ppRenderList();
  const notes = [];
  if (full) notes.push(`limite de ${PP_MAX} photos atteinte`);
  if (tooBig) notes.push(`${tooBig} photo${tooBig > 1 ? "s" : ""} trop lourde${tooBig > 1 ? "s" : ""} (30 Mo maximum)`);
  if (unreadable) notes.push(`${unreadable} fichier${unreadable > 1 ? "s" : ""} illisible${unreadable > 1 ? "s" : ""} (les photos HEIC ne sont pas lues par tous les navigateurs)`);
  if (notes.length) ppMessage("Ajouté, mais : " + notes.join(" ; ") + ".", true);
  else ppMessage("");
}

// Écrit le PDF à la main : une image JPEG par page
async function ppBuild() {
  if (ppBusy || !ppItems.length) return;
  ppBusy = true;
  ppMake.disabled = true;
  ppInvalidate();
  try {
    const qset = PP_QUALITY[ppQuality.value];
    const margin = parseFloat(ppMargin.value) || 0;
    const enc = new TextEncoder();
    const chunks = [], offsets = [];
    let pos = 0;
    const push = (d) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); pos += b.length; };
    const n = ppItems.length, total = 2 + n * 3;

    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    offsets[1] = pos;
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offsets[2] = pos;
    push(`2 0 obj\n<< /Type /Pages /Count ${n} /Kids [${ppItems.map((_, i) => `${3 + i * 3} 0 R`).join(" ")}] >>\nendobj\n`);

    for (let i = 0; i < n; i++) {
      ppMessage(`Création du PDF… page ${i + 1} sur ${n}`);
      await ppPause();
      const it = ppItems[i];
      const canvas = await ppRender(it.file, it.rot, qset.side);
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", qset.q));
      if (!blob) throw new Error("Ton navigateur n'a pas pu préparer la photo " + (i + 1) + ".");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const iw = canvas.width, ih = canvas.height;

      let pw, ph;
      if (ppSize.value === "image") {
        const k = 842 / Math.max(iw, ih);
        pw = iw * k + margin * 2;
        ph = ih * k + margin * 2;
      } else {
        const base = PP_PAGES[ppSize.value];
        const land = ppOrient.value === "land" || (ppOrient.value === "auto" && iw > ih);
        pw = land ? base[1] : base[0];
        ph = land ? base[0] : base[1];
      }
      const s = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih);
      const dw = iw * s, dh = ih * s, x = (pw - dw) / 2, y = (ph - dh) / 2;
      const f = (v) => v.toFixed(2);

      const base = 3 + i * 3;
      const content = `q ${f(dw)} 0 0 ${f(dh)} ${f(x)} ${f(y)} cm /Im0 Do Q`;
      offsets[base] = pos;
      push(`${base} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /XObject << /Im0 ${base + 2} 0 R >> >> /Contents ${base + 1} 0 R >>\nendobj\n`);
      offsets[base + 1] = pos;
      push(`${base + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      offsets[base + 2] = pos;
      push(`${base + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
      push(bytes);
      push("\nendstream\nendobj\n");
    }

    const xref = pos;
    let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let k = 1; k <= total; k++) table += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
    push(table + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const pdf = new Blob(chunks, { type: "application/pdf" });
    ppUrl = URL.createObjectURL(pdf);
    const base = (ppName.value.trim().replace(/[^\w\u00C0-\u017F -]+/g, "").trim().slice(0, 40)) || "clippo-photos";
    ppSave.href = ppUrl;
    ppSave.download = base + ".pdf";
    ppInfo.textContent = `Ton PDF est prêt : ${n} page${n > 1 ? "s" : ""}, ${ppFmtSize(pdf.size)}.` + (pdf.size > 20 * 1048576 ? " Il est lourd : choisis la qualité « Légère » pour l'envoyer par e-mail." : "");
    ppResult.hidden = false;
    ppMessage("");
  } catch (e) {
    console.error(e);
    ppMessage(e.message || "La création du PDF a échoué. Essaie avec moins de photos ou une qualité plus légère.", true);
  } finally {
    ppBusy = false;
    ppMake.disabled = false;
  }
}

ppFile.addEventListener("change", () => { ppAdd(ppFile.files).then(() => { ppFile.value = ""; }); });
["dragenter", "dragover"].forEach((ev) => ppDrop.addEventListener(ev, (e) => { e.preventDefault(); ppDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => ppDrop.addEventListener(ev, (e) => { e.preventDefault(); ppDrop.classList.remove("over"); }));
ppDrop.addEventListener("drop", (e) => ppAdd(e.dataTransfer.files));
ppMake.addEventListener("click", ppBuild);
$("ppClear").addEventListener("click", () => {
  if (ppItems.length > 1 && !confirm("Retirer toutes les photos ?")) return;
  ppItems = [];
  ppInvalidate();
  ppRenderList();
  ppMessage("");
});
[ppSize, ppOrient, ppMargin, ppQuality].forEach((el) => el.addEventListener("change", () => { ppInvalidate(); ppOrientBox.hidden = ppSize.value === "image"; }));
ppName.addEventListener("input", () => { if (ppUrl) ppSave.download = (ppName.value.trim().replace(/[^\w\u00C0-\u017F -]+/g, "").trim().slice(0, 40) || "clippo-photos") + ".pdf"; });
ppRenderList();

// ---------- Convertisseur de devises ----------
const FX_URL = "https://api.frankfurter.dev/v1/latest?base=EUR";
const FX_KEY = "clippo_fx", FX_PREF_KEY = "clippo_fx_pref", FX_TTL = 6 * 3600 * 1000;
const FX_POPULAR = ["EUR", "USD", "GBP", "CHF", "CAD", "JPY", "AUD", "CNY", "TRY", "MXN", "BRL", "INR", "THB"];
const fxAmount = $("fxAmount"), fxFrom = $("fxFrom"), fxTo = $("fxTo"), fxOut = $("fxOut"), fxIn = $("fxIn");
const fxRateLine = $("fxRateLine"), fxMeta = $("fxMeta"), fxTable = $("fxTable"), fxStatus = $("fxStatus"), fxRefresh = $("fxRefresh");
let fxRates = null, fxDate = "", fxAt = 0, fxLoading = false;
let fxNames = null;
try { fxNames = new Intl.DisplayNames(["fr"], { type: "currency" }); } catch { /* navigateur sans noms de devises */ }

function fxMessage(msg, isError = false) {
  fxStatus.textContent = msg;
  fxStatus.classList.toggle("error", isError);
}
function fxName(code) {
  try {
    const n = fxNames ? fxNames.of(code) : "";
    return n && n !== code ? n.charAt(0).toUpperCase() + n.slice(1) : code;
  } catch { return code; }
}
function fxNum(v) {
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
function fxMoney(n, code) {
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: code, maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);
  } catch { return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " " + code; }
}
function fxRate(n) { return n.toLocaleString("fr-FR", { maximumSignificantDigits: 5 }); }
function fxFmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
}

function fxReadCache() {
  try {
    const o = JSON.parse(localStorage.getItem(FX_KEY) || "null");
    if (!o || typeof o.rates !== "object" || !Number.isFinite(Number(o.at))) return null;
    const rates = {};
    Object.keys(o.rates).forEach((k) => { const v = Number(o.rates[k]); if (/^[A-Z]{3}$/.test(k) && v > 0 && Number.isFinite(v)) rates[k] = v; });
    return rates.EUR ? { rates, date: String(o.date || ""), at: Number(o.at) } : null;
  } catch { return null; }
}
function fxReadPref() {
  try {
    const o = JSON.parse(localStorage.getItem(FX_PREF_KEY) || "{}");
    return { from: /^[A-Z]{3}$/.test(o.from) ? o.from : "", to: /^[A-Z]{3}$/.test(o.to) ? o.to : "" };
  } catch { return { from: "", to: "" }; }
}
function fxSavePref() {
  try { localStorage.setItem(FX_PREF_KEY, JSON.stringify({ from: fxFrom.value, to: fxTo.value })); } catch { /* ignoré */ }
}

function fxCodes() {
  const all = Object.keys(fxRates);
  return [...FX_POPULAR.filter((c) => all.includes(c)), ...all.filter((c) => !FX_POPULAR.includes(c)).sort()];
}
function fxFill() {
  const codes = fxCodes(), pref = fxReadPref();
  [[fxFrom, pref.from || "USD"], [fxTo, pref.to || "EUR"]].forEach(([sel, def]) => {
    const keep = sel.value && fxRates[sel.value] ? sel.value : fxRates[def] ? def : "EUR";
    sel.innerHTML = "";
    codes.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = `${c} · ${fxName(c)}`;
      sel.appendChild(o);
    });
    sel.value = keep;
    sel.disabled = false;
  });
}

function fxConvert(n, from, to) { return (n / fxRates[from]) * fxRates[to]; }

function fxRender() {
  fxTable.innerHTML = "";
  if (!fxRates) return;
  const from = fxFrom.value, to = fxTo.value;
  if (!fxRates[from] || !fxRates[to]) return;
  fxMeta.textContent = fxDate ? `Taux de la Banque centrale européenne du ${fxFmtDate(fxDate)}.` : "";
  $("fxHeadFrom").textContent = from;
  $("fxHeadTo").textContent = to;

  const amount = fxNum(fxAmount.value);
  if (!(amount >= 0) || amount > 1e12) {
    fxIn.textContent = "";
    fxOut.textContent = "";
    fxRateLine.textContent = "";
    return fxMessage(fxAmount.value.trim() ? "Entre un montant positif (ex : 49,90)." : "", !!fxAmount.value.trim());
  }
  if (fxStatus.classList.contains("error") && /montant/i.test(fxStatus.textContent)) fxMessage("");

  fxIn.textContent = fxMoney(amount, from) + " =";
  fxOut.textContent = fxMoney(fxConvert(amount, from, to), to);
  const r = fxConvert(1, from, to);
  fxRateLine.textContent = `1 ${from} = ${fxRate(r)} ${to} · 1 ${to} = ${fxRate(1 / r)} ${from}`;

  [1, 5, 10, 20, 50, 100, 500, 1000].forEach((v) => {
    const tr = document.createElement("tr");
    [fxMoney(v, from), fxMoney(fxConvert(v, from, to), to)].forEach((t) => {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    fxTable.appendChild(tr);
  });
}

function fxApply(o) {
  fxRates = o.rates; fxDate = o.date; fxAt = o.at;
  fxFill();
  fxRender();
}

async function fxLoad(force = false) {
  if (fxLoading) return;
  const cached = fxReadCache();
  if (cached && !force && Date.now() - cached.at < FX_TTL) { fxApply(cached); fxMessage(""); return; }
  fxLoading = true;
  fxRefresh.disabled = true;
  fxMessage("Chargement des taux…");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(FX_URL, { signal: ctrl.signal });
    if (!res.ok) throw new Error("http");
    const data = await res.json();
    if (!data || typeof data.rates !== "object") throw new Error("format");
    const rates = { EUR: 1 };
    Object.keys(data.rates).forEach((k) => { const v = Number(data.rates[k]); if (/^[A-Z]{3}$/.test(k) && v > 0 && Number.isFinite(v)) rates[k] = v; });
    const obj = { rates, date: String(data.date || ""), at: Date.now() };
    try { localStorage.setItem(FX_KEY, JSON.stringify(obj)); } catch { /* ignoré */ }
    fxApply(obj);
    fxMessage(force ? "Taux actualisés !" : "");
  } catch {
    if (cached) {
      fxApply(cached);
      fxMessage("Impossible d'actualiser les taux : les derniers taux enregistrés sont affichés.", true);
    } else {
      fxMessage("Impossible de charger les taux. Vérifie ta connexion et réessaie.", true);
    }
  } finally {
    clearTimeout(timer);
    fxLoading = false;
    fxRefresh.disabled = false;
  }
}

fxAmount.addEventListener("input", fxRender);
[fxFrom, fxTo].forEach((el) => el.addEventListener("change", () => { fxSavePref(); fxRender(); }));
$("fxSwap").addEventListener("click", () => {
  if (!fxRates) return;
  const a = fxFrom.value;
  fxFrom.value = fxTo.value;
  fxTo.value = a;
  fxSavePref();
  fxRender();
});
fxRefresh.addEventListener("click", () => fxLoad(true));

// Les taux ne sont demandés que lorsque l'onglet est ouvert
(() => {
  const panel = document.getElementById("currency");
  if (!panel) return;
  const check = () => { if (panel.classList.contains("active") && !fxRates) fxLoad(); };
  new MutationObserver(check).observe(panel, { attributes: true, attributeFilter: ["class"] });
  check();
})();

// ---------- Calculateur de réductions ----------
const rdPrice = $("rdPrice"), rdDisc = $("rdDisc"), rdDisc2 = $("rdDisc2"), rdOff = $("rdOff");
const rdOrig = $("rdOrig"), rdSold = $("rdSold"), rdSold2 = $("rdSold2"), rdDisc3 = $("rdDisc3");
const rdBig = $("rdBig"), rdLine = $("rdLine"), rdSteps = $("rdSteps"), rdStatus = $("rdStatus"), rdCopy = $("rdCopy");
const RD_HINTS = {
  final: "Entre un prix et une réduction pour voir le résultat.",
  percent: "Entre le prix d'origine et le prix soldé pour voir le pourcentage.",
  original: "Entre le prix soldé et la réduction pour retrouver le prix d'origine.",
};
let rdMode = "final", rdText = "";

function rdMessage(msg, isError = false) {
  rdStatus.textContent = msg;
  rdStatus.classList.toggle("error", isError);
}
function rdParse(v) { // null = vide, NaN = invalide
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(s) ? parseFloat(s) : NaN;
}
function rdEur(n) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Math.round(n * 100) / 100);
}
function rdPct(n) {
  return (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";
}
function rdShow(big, line, steps) {
  rdBig.textContent = big;
  rdLine.textContent = line;
  steps.forEach(([a, b]) => {
    const li = document.createElement("li");
    const l = document.createElement("span");
    l.textContent = a;
    const r = document.createElement("strong");
    r.textContent = b;
    li.append(l, r);
    rdSteps.appendChild(li);
  });
  rdText = ["Résultat : " + big, ...steps.map(([a, b]) => `${a} : ${b}`), line].join("\n");
  rdCopy.disabled = false;
}

function rdCalc() {
  rdSteps.innerHTML = "";
  rdBig.textContent = "";
  rdLine.textContent = "";
  rdText = "";
  rdCopy.disabled = true;
  document.querySelectorAll("#rdQuick .chip").forEach((c) => c.classList.toggle("active", c.dataset.pct === rdDisc.value.trim()));

  let vals;
  if (rdMode === "final") vals = [rdParse(rdPrice.value), rdParse(rdDisc.value), rdParse(rdDisc2.value), rdParse(rdOff.value)];
  else if (rdMode === "percent") vals = [rdParse(rdOrig.value), rdParse(rdSold.value)];
  else vals = [rdParse(rdSold2.value), rdParse(rdDisc3.value)];

  if (vals.some((v) => Number.isNaN(v))) return rdMessage("Entre des nombres positifs, avec une virgule ou un point (ex : 49,90).", true);
  if (vals.some((v) => v !== null && v > 1e9)) return rdMessage("Ce nombre est trop grand.", true);
  rdMessage("");
  if (vals[0] === null || vals[1] === null) { rdLine.textContent = RD_HINTS[rdMode]; return; }

  if (rdMode === "final") {
    const P = vals[0], d1 = vals[1], d2 = vals[2] || 0, e = vals[3] || 0;
    if (d1 > 100 || d2 > 100) return rdMessage("Une réduction ne peut pas dépasser 100 %.", true);
    const p1 = P * (1 - d1 / 100);
    const p2 = p1 * (1 - d2 / 100);
    const p3 = Math.max(0, p2 - e);
    const save = P - p3;
    const total = P > 0 ? (save / P) * 100 : 0;
    const steps = [["Prix d'origine", rdEur(P)], [`Après −${rdPct(d1)}`, rdEur(p1)]];
    if (d2) steps.push([`Après −${rdPct(d2)} en plus`, rdEur(p2)]);
    if (e) steps.push([`Après −${rdEur(e)}`, rdEur(p3)]);
    let line = `Tu économises ${rdEur(save)}, soit ${rdPct(total)} du prix d'origine.`;
    if (d1 && d2) line += ` Les réductions se calculent l'une après l'autre : ${rdPct(d1)} puis ${rdPct(d2)} ne font pas ${rdPct(d1 + d2)}.`;
    rdShow(rdEur(p3), line, steps);
    if (e > p2) rdMessage("Le code promo dépasse le prix restant : le résultat est limité à 0 €.");
  } else if (rdMode === "percent") {
    const P = vals[0], S = vals[1];
    if (!(P > 0)) return rdMessage("Le prix d'origine doit être supérieur à 0.", true);
    const diff = P - S, pct = (diff / P) * 100;
    const steps = [["Prix d'origine", rdEur(P)], ["Prix soldé", rdEur(S)]];
    if (diff > 0) rdShow("−" + rdPct(pct), `Le prix baisse de ${rdEur(diff)} : tu économises ${rdPct(pct)} du prix d'origine.`, steps);
    else if (diff === 0) rdShow("0 %", "Le prix soldé est le même que le prix d'origine : il n'y a pas de réduction.", steps);
    else rdShow("+" + rdPct(-pct), `Le prix soldé est plus élevé de ${rdEur(-diff)} que le prix d'origine : c'est une hausse, pas une réduction.`, steps);
  } else {
    const S = vals[0], d = vals[1];
    if (d >= 100) return rdMessage("La réduction doit être inférieure à 100 %.", true);
    const P = S / (1 - d / 100);
    rdShow(rdEur(P), `Avant une réduction de ${rdPct(d)}, ce produit coûtait ${rdEur(P)} : tu économises ${rdEur(P - S)}.`,
      [["Prix payé", rdEur(S)], [`Réduction de ${rdPct(d)}`, "−" + rdEur(P - S)]]);
  }
}

function rdSetMode(m) {
  rdMode = m;
  document.querySelectorAll("#rdModes .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === m));
  $("rdFinal").hidden = m !== "final";
  $("rdPercent").hidden = m !== "percent";
  $("rdOriginal").hidden = m !== "original";
  rdCalc();
}

document.querySelectorAll("#rdModes .chip").forEach((c) => c.addEventListener("click", () => rdSetMode(c.dataset.mode)));
document.querySelectorAll("#rdQuick .chip").forEach((c) => c.addEventListener("click", () => { rdDisc.value = c.dataset.pct; rdCalc(); }));
[rdPrice, rdDisc, rdDisc2, rdOff, rdOrig, rdSold, rdSold2, rdDisc3].forEach((el) => el.addEventListener("input", rdCalc));
rdCopy.addEventListener("click", async () => {
  if (!rdText) return;
  try { await copyText(rdText); rdMessage("Résultat copié !"); }
  catch { rdMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
});
rdSetMode("final");

// ---------- Horloge mondiale ----------
const WC_KEY = "clippo_clocks", WC_MAX = 12, WC_DEFAULT = ["londres", "new-york", "tokyo"];
const WC_CITIES = [
  { id: "paris", n: "Paris", c: "France", z: "Europe/Paris" },
  { id: "londres", n: "Londres", c: "Royaume-Uni", z: "Europe/London" },
  { id: "madrid", n: "Madrid", c: "Espagne", z: "Europe/Madrid" },
  { id: "berlin", n: "Berlin", c: "Allemagne", z: "Europe/Berlin" },
  { id: "rome", n: "Rome", c: "Italie", z: "Europe/Rome" },
  { id: "lisbonne", n: "Lisbonne", c: "Portugal", z: "Europe/Lisbon" },
  { id: "bruxelles", n: "Bruxelles", c: "Belgique", z: "Europe/Brussels" },
  { id: "zurich", n: "Zurich", c: "Suisse", z: "Europe/Zurich" },
  { id: "athenes", n: "Athènes", c: "Grèce", z: "Europe/Athens" },
  { id: "istanbul", n: "Istanbul", c: "Turquie", z: "Europe/Istanbul" },
  { id: "moscou", n: "Moscou", c: "Russie", z: "Europe/Moscow" },
  { id: "reykjavik", n: "Reykjavik", c: "Islande", z: "Atlantic/Reykjavik" },
  { id: "casablanca", n: "Casablanca", c: "Maroc", z: "Africa/Casablanca" },
  { id: "alger", n: "Alger", c: "Algérie", z: "Africa/Algiers" },
  { id: "tunis", n: "Tunis", c: "Tunisie", z: "Africa/Tunis" },
  { id: "dakar", n: "Dakar", c: "Sénégal", z: "Africa/Dakar" },
  { id: "abidjan", n: "Abidjan", c: "Côte d'Ivoire", z: "Africa/Abidjan" },
  { id: "lagos", n: "Lagos", c: "Nigeria", z: "Africa/Lagos" },
  { id: "le-caire", n: "Le Caire", c: "Égypte", z: "Africa/Cairo" },
  { id: "nairobi", n: "Nairobi", c: "Kenya", z: "Africa/Nairobi" },
  { id: "johannesburg", n: "Johannesburg", c: "Afrique du Sud", z: "Africa/Johannesburg" },
  { id: "dubai", n: "Dubaï", c: "Émirats arabes unis", z: "Asia/Dubai" },
  { id: "delhi", n: "New Delhi", c: "Inde", z: "Asia/Kolkata" },
  { id: "bangkok", n: "Bangkok", c: "Thaïlande", z: "Asia/Bangkok" },
  { id: "singapour", n: "Singapour", c: "Singapour", z: "Asia/Singapore" },
  { id: "hong-kong", n: "Hong Kong", c: "Chine", z: "Asia/Hong_Kong" },
  { id: "shanghai", n: "Shanghai", c: "Chine", z: "Asia/Shanghai" },
  { id: "tokyo", n: "Tokyo", c: "Japon", z: "Asia/Tokyo" },
  { id: "seoul", n: "Séoul", c: "Corée du Sud", z: "Asia/Seoul" },
  { id: "sydney", n: "Sydney", c: "Australie", z: "Australia/Sydney" },
  { id: "perth", n: "Perth", c: "Australie", z: "Australia/Perth" },
  { id: "auckland", n: "Auckland", c: "Nouvelle-Zélande", z: "Pacific/Auckland" },
  { id: "honolulu", n: "Honolulu", c: "États-Unis (Hawaï)", z: "Pacific/Honolulu" },
  { id: "los-angeles", n: "Los Angeles", c: "États-Unis", z: "America/Los_Angeles" },
  { id: "denver", n: "Denver", c: "États-Unis", z: "America/Denver" },
  { id: "chicago", n: "Chicago", c: "États-Unis", z: "America/Chicago" },
  { id: "new-york", n: "New York", c: "États-Unis", z: "America/New_York" },
  { id: "vancouver", n: "Vancouver", c: "Canada", z: "America/Vancouver" },
  { id: "toronto", n: "Toronto", c: "Canada", z: "America/Toronto" },
  { id: "montreal", n: "Montréal", c: "Canada", z: "America/Toronto" },
  { id: "mexico", n: "Mexico", c: "Mexique", z: "America/Mexico_City" },
  { id: "bogota", n: "Bogota", c: "Colombie", z: "America/Bogota" },
  { id: "lima", n: "Lima", c: "Pérou", z: "America/Lima" },
  { id: "sao-paulo", n: "São Paulo", c: "Brésil", z: "America/Sao_Paulo" },
  { id: "buenos-aires", n: "Buenos Aires", c: "Argentine", z: "America/Argentina/Buenos_Aires" },
  { id: "fort-de-france", n: "Fort-de-France", c: "Martinique", z: "America/Martinique" },
  { id: "pointe-a-pitre", n: "Pointe-à-Pitre", c: "Guadeloupe", z: "America/Guadeloupe" },
  { id: "cayenne", n: "Cayenne", c: "Guyane", z: "America/Cayenne" },
  { id: "saint-denis", n: "Saint-Denis", c: "La Réunion", z: "Indian/Reunion" },
  { id: "noumea", n: "Nouméa", c: "Nouvelle-Calédonie", z: "Pacific/Noumea" },
  { id: "papeete", n: "Papeete", c: "Polynésie française", z: "Pacific/Tahiti" },
];
const wcGrid = $("wcGrid"), wcCity = $("wcCity"), wcRef = $("wcRef"), wcRefDate = $("wcRefDate"), wcRefTime = $("wcRefTime");
const wcConv = $("wcConv"), wcStatus = $("wcStatus"), wcPanel = $("worldclock");
const wcOk = (z) => { try { new Intl.DateTimeFormat("fr-FR", { timeZone: z }); return true; } catch { return false; } };
const wcCities = WC_CITIES.filter((c) => wcOk(c.z));
let wcLocalZone = "Europe/Paris";
try { wcLocalZone = Intl.DateTimeFormat().resolvedOptions().timeZone || wcLocalZone; } catch { /* fuseau par défaut */ }
if (!wcOk(wcLocalZone)) wcLocalZone = "Europe/Paris";
const wcLocal = { id: "local", n: "Chez moi", c: wcLocalZone.replace(/_/g, " ").replace("/", " · "), z: wcLocalZone };
let wcIds = [], wcRefs = [];

function wcMessage(msg, isError = false) {
  wcStatus.textContent = msg;
  wcStatus.classList.toggle("error", isError);
}
const wcFmtCache = {};
function wcFmt(key, tz, opts) {
  const k = key + "|" + tz;
  return wcFmtCache[k] || (wcFmtCache[k] = new Intl.DateTimeFormat("fr-FR", { timeZone: tz, ...opts }));
}
function wcParts(ts, tz) {
  const o = {};
  wcFmt("p", tz, { hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(ts).forEach((p) => { if (p.type !== "literal") o[p.type] = parseInt(p.value, 10); });
  o.hour = o.hour % 24;
  return o;
}
function wcOffset(ts, tz) { // décalage en minutes par rapport à UTC
  const p = wcParts(ts, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000) / 60000);
}
function wcZonedToUtc(y, mo, d, h, mi, tz) { // heure affichée dans un fuseau -> instant réel
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const o1 = wcOffset(guess, tz);
  let t = guess - o1 * 60000;
  const o2 = wcOffset(t, tz);
  if (o2 !== o1) t = guess - o2 * 60000;
  return t;
}
function wcTime(ts, tz, sec) {
  return wcFmt(sec ? "ts" : "t", tz, sec ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ts);
}
function wcDate(ts, tz) { return wcFmt("d", tz, { weekday: "short", day: "numeric", month: "short" }).format(ts); }
function wcDiff(ts, tz) {
  const d = wcOffset(ts, tz) - wcOffset(ts, wcLocalZone);
  if (d === 0) return "Même heure que chez toi";
  const a = Math.abs(d), h = Math.floor(a / 60), m = a % 60;
  return (d > 0 ? "+" : "−") + h + " h" + (m ? " " + String(m).padStart(2, "0") : "") + " par rapport à chez toi";
}
function wcMk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function wcEntries() { return [wcLocal, ...wcIds.map((id) => wcCities.find((c) => c.id === id)).filter(Boolean)]; }
function wcEntry(id) { return wcEntries().find((e) => e.id === id); }

function wcLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(WC_KEY) || "null");
    if (Array.isArray(d)) return [...new Set(d.map(String))].filter((id) => wcCities.some((c) => c.id === id)).slice(0, WC_MAX);
  } catch { /* données illisibles */ }
  return WC_DEFAULT.filter((id) => wcCities.some((c) => c.id === id));
}
function wcSave() { try { localStorage.setItem(WC_KEY, JSON.stringify(wcIds)); } catch { /* stockage indisponible */ } }

function wcTick() {
  if (!wcPanel.classList.contains("active") || document.hidden) return;
  const now = Date.now();
  wcRefs.forEach((r) => {
    r.time.textContent = wcTime(now, r.tz, true);
    r.date.textContent = wcDate(now, r.tz);
    r.diff.textContent = wcDiff(now, r.tz);
    const h = wcParts(now, r.tz).hour;
    r.icon.textContent = h >= 7 && h < 20 ? "☀️" : "🌙";
  });
}

function wcFillCities() {
  const free = wcCities.filter((c) => !wcIds.includes(c.id)).sort((a, b) => a.n.localeCompare(b.n, "fr"));
  wcCity.innerHTML = "";
  free.forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.n} (${c.c})`; wcCity.appendChild(o); });
  wcCity.disabled = !free.length || wcIds.length >= WC_MAX;
  $("wcAddBtn").disabled = wcCity.disabled;
}
function wcFillRef() {
  const keep = wcRef.value || "local";
  wcRef.innerHTML = "";
  wcEntries().forEach((e) => { const o = document.createElement("option"); o.value = e.id; o.textContent = e.n; wcRef.appendChild(o); });
  wcRef.value = wcEntry(keep) ? keep : "local";
}

function wcBuild() {
  wcGrid.innerHTML = "";
  wcRefs = [];
  wcEntries().forEach((e) => {
    const card = wcMk("div", "wc-card" + (e.id === "local" ? " local" : ""));
    const top = wcMk("div", "wc-top");
    const name = wcMk("div", "wc-name");
    name.append(wcMk("strong", "", e.n), wcMk("span", "", e.c));
    top.appendChild(name);
    if (e.id !== "local") {
      const del = wcMk("button", "todo-btn", "×");
      del.type = "button";
      del.setAttribute("aria-label", "Retirer " + e.n);
      del.addEventListener("click", () => { wcIds = wcIds.filter((id) => id !== e.id); wcSave(); wcRefresh(); });
      top.appendChild(del);
    }
    const icon = wcMk("span", "wc-icon");
    icon.setAttribute("aria-hidden", "true");
    const time = wcMk("div", "wc-time");
    const date = wcMk("div", "wc-date");
    const diff = wcMk("div", "wc-diff");
    card.append(top, time, date, diff, icon);
    wcGrid.appendChild(card);
    wcRefs.push({ tz: e.z, time, date, diff, icon });
  });
  wcTick();
}

function wcConvert() {
  wcConv.innerHTML = "";
  const ent = wcEntry(wcRef.value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wcRefDate.value), t = /^(\d{2}):(\d{2})$/.exec(wcRefTime.value);
  if (!ent || !m || !t) return wcMessage("Choisis une date et une heure pour convertir.");
  wcMessage("");
  const ts = wcZonedToUtc(+m[1], +m[2], +m[3], +t[1], +t[2], ent.z);
  const pr = wcParts(ts, ent.z);
  wcEntries().forEach((e) => {
    const pe = wcParts(ts, e.z);
    const dd = Math.round((Date.UTC(pe.year, pe.month - 1, pe.day) - Date.UTC(pr.year, pr.month - 1, pr.day)) / 86400000);
    const li = wcMk("li", "wc-row" + (e.id === ent.id ? " ref" : ""));
    const left = wcMk("div", "wc-rowname");
    left.append(wcMk("strong", "", e.n), wcMk("span", "", e.c));
    const right = wcMk("div", "wc-rowtime");
    right.append(wcMk("strong", "", wcTime(ts, e.z, false)), wcMk("span", "", wcDate(ts, e.z) + (dd === 1 ? " · jour suivant" : dd === -1 ? " · veille" : dd ? ` · ${dd > 0 ? "+" : "−"}${Math.abs(dd)} jours` : "")));
    li.append(left, right);
    wcConv.appendChild(li);
  });
}
function wcSetNow() {
  const ent = wcEntry(wcRef.value) || wcLocal;
  const p = wcParts(Date.now(), ent.z), pad = (n) => String(n).padStart(2, "0");
  wcRefDate.value = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  wcRefTime.value = `${pad(p.hour)}:${pad(p.minute)}`;
  wcConvert();
}
function wcRefresh() { wcFillCities(); wcFillRef(); wcBuild(); wcConvert(); }

$("wcAddBtn").addEventListener("click", () => {
  if (!wcCity.value) return;
  if (wcIds.length >= WC_MAX) return wcMessage(`Tu as atteint la limite de ${WC_MAX} villes. Retire-en une.`, true);
  wcIds.push(wcCity.value);
  wcSave();
  wcMessage("");
  wcRefresh();
});
wcRef.addEventListener("change", () => { wcSetNow(); });
[wcRefDate, wcRefTime].forEach((el) => el.addEventListener("input", wcConvert));
$("wcNow").addEventListener("click", wcSetNow);

wcIds = wcLoad();
wcFillCities();
wcFillRef();
wcBuild();
wcSetNow();
setInterval(wcTick, 1000);
document.addEventListener("visibilitychange", wcTick);

// ---------- Checklist de voyage ----------
const TP_KEY = "clippo_trips", TP_MAX = 10, TP_ITEMS = 150;
const TP_CATS = ["Papiers", "Vêtements", "Hygiène", "Santé", "Électronique", "Divers"];
const TP_TPL = {
  essentiel: { label: "L'essentiel", items: [
    ["Papiers", "Carte d'identité ou passeport"], ["Papiers", "Billets et réservations"], ["Papiers", "Carte bancaire et un peu d'espèces"],
    ["Vêtements", "Sous-vêtements"], ["Vêtements", "Chaussettes"], ["Vêtements", "Pyjama"], ["Vêtements", "Une tenue par jour"],
    ["Hygiène", "Brosse à dents et dentifrice"], ["Hygiène", "Déodorant"], ["Hygiène", "Shampooing et gel douche"],
    ["Santé", "Médicaments personnels"], ["Santé", "Trousse de premiers secours"],
    ["Électronique", "Téléphone et chargeur"], ["Électronique", "Batterie externe"], ["Électronique", "Écouteurs"],
    ["Divers", "Clés de la maison"], ["Divers", "Gourde"]] },
  weekend: { label: "Week-end", items: [
    ["Vêtements", "Une tenue de rechange"], ["Vêtements", "Une veste ou un pull"], ["Vêtements", "Chaussures confortables"],
    ["Divers", "Petit sac à dos"], ["Divers", "Livre ou jeu pour le trajet"], ["Hygiène", "Trousse de toilette réduite"]] },
  plage: { label: "Plage et soleil", items: [
    ["Vêtements", "Maillot de bain"], ["Vêtements", "Chapeau ou casquette"], ["Vêtements", "Tongs"],
    ["Hygiène", "Crème solaire"], ["Hygiène", "Après-soleil"], ["Divers", "Lunettes de soleil"],
    ["Divers", "Serviette de plage"], ["Divers", "Sac de plage"]] },
  montagne: { label: "Montagne et randonnée", items: [
    ["Vêtements", "Vêtements chauds et coupe-vent"], ["Vêtements", "Bonnet et gants"], ["Vêtements", "Chaussures de randonnée"],
    ["Santé", "Pansements et crème pour les ampoules"], ["Divers", "Sac à dos"], ["Divers", "Gourde ou poche à eau"],
    ["Électronique", "Lampe frontale"], ["Divers", "Carte ou itinéraire hors connexion"]] },
  etranger: { label: "À l'étranger", items: [
    ["Papiers", "Passeport en cours de validité"], ["Papiers", "Visa ou autorisation d'entrée (si nécessaire)"], ["Papiers", "Assurance voyage et contacts d'urgence"],
    ["Papiers", "Copies des documents importants"], ["Papiers", "Carte européenne d'assurance maladie (en Europe)"],
    ["Électronique", "Adaptateur de prise"], ["Divers", "Monnaie locale"], ["Santé", "Ordonnances des médicaments à emporter"]] },
};
const tpSel = $("tpSel"), tpBox = $("tpBox"), tpList = $("tpList"), tpStatus = $("tpStatus"), tpInfo = $("tpInfo");
const tpBar = $("tpBar"), tpCount = $("tpCount"), tpDate = $("tpDate"), tpItem = $("tpItem"), tpCat = $("tpCat"), tpTpl = $("tpTpl");
let tpTrips = [], tpCur = "";

function tpMessage(msg, isError = false) {
  tpStatus.textContent = msg;
  tpStatus.classList.toggle("error", isError);
}
function tpMk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function tpId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function tpParse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
function tpToday() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function tpIso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function tpDays(s) { return Math.round((tpParse(s) - tpToday()) / 86400000); }
function tpFmtDate(s) {
  const t = tpParse(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function tpCurTrip() { return tpTrips.find((t) => t.id === tpCur); }

function tpLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(TP_KEY) || "[]");
    return Array.isArray(d)
      ? d.filter((t) => t && typeof t.name === "string").slice(0, TP_MAX).map((t) => ({
          id: String(t.id), name: t.name.slice(0, 40), date: tpParse(t.date) ? String(t.date) : "",
          items: (Array.isArray(t.items) ? t.items : []).filter((i) => i && typeof i.text === "string").slice(0, TP_ITEMS)
            .map((i) => ({ id: String(i.id), text: i.text.slice(0, 60), cat: TP_CATS.includes(i.cat) ? i.cat : "Divers", done: !!i.done })),
        }))
      : [];
  } catch { return []; }
}
function tpSave() {
  try { localStorage.setItem(TP_KEY, JSON.stringify(tpTrips)); }
  catch { tpMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

function tpRender() {
  tpBox.hidden = !tpTrips.length;
  if (!tpTrips.length) return;
  if (!tpCurTrip()) tpCur = tpTrips[0].id;
  const t = tpCurTrip();

  tpSel.innerHTML = "";
  tpTrips.forEach((x) => { const o = document.createElement("option"); o.value = x.id; o.textContent = x.name; tpSel.appendChild(o); });
  tpSel.value = t.id;
  tpDate.value = t.date;
  tpDate.min = tpIso(tpToday());

  if (!t.date) tpInfo.textContent = "Aucune date de départ choisie.";
  else {
    const d = tpDays(t.date);
    tpInfo.textContent = "Départ : " + tpFmtDate(t.date) + " · " + (d > 1 ? `dans ${d} jours` : d === 1 ? "demain" : d === 0 ? "aujourd'hui" : "déjà passé");
  }

  const done = t.items.filter((i) => i.done).length, total = t.items.length;
  tpBar.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
  tpCount.textContent = total ? `${done} élément${done > 1 ? "s" : ""} prêt${done > 1 ? "s" : ""} sur ${total}` + (done === total ? " · Tout est prêt, bon voyage ! 🎉" : "") : "La liste est vide : ajoute un élément ou des suggestions.";

  tpList.innerHTML = "";
  TP_CATS.forEach((cat) => {
    const items = t.items.filter((i) => i.cat === cat);
    if (!items.length) return;
    const grp = tpMk("div", "tp-group");
    const d = items.filter((i) => i.done).length;
    grp.appendChild(tpMk("h3", "tool-cat", `${cat} · ${d}/${items.length}`));
    items.forEach((i) => {
      const row = tpMk("div", "tp-item" + (i.done ? " done" : ""));
      const lab = tpMk("label", "tp-lab");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = i.done;
      cb.addEventListener("change", () => { i.done = cb.checked; tpSave(); tpRender(); });
      lab.append(cb, tpMk("span", "", i.text));
      const del = tpMk("button", "todo-btn", "×");
      del.type = "button";
      del.setAttribute("aria-label", "Supprimer : " + i.text);
      del.addEventListener("click", () => { t.items = t.items.filter((x) => x.id !== i.id); tpSave(); tpRender(); });
      row.append(lab, del);
      grp.appendChild(row);
    });
    tpList.appendChild(grp);
  });
}

function tpAddItems(list) { // renvoie le nombre d'éléments réellement ajoutés
  const t = tpCurTrip();
  let n = 0;
  list.forEach(([cat, text]) => {
    if (t.items.length >= TP_ITEMS) return;
    if (t.items.some((i) => i.text.toLowerCase() === text.toLowerCase())) return;
    t.items.push({ id: tpId(), text, cat, done: false });
    n++;
  });
  tpSave();
  tpRender();
  return n;
}

$("tpCreate").addEventListener("click", () => {
  const name = $("tpName").value.trim().slice(0, 40) || "Mon voyage";
  const date = $("tpDateNew").value;
  if (date && !tpParse(date)) return tpMessage("Cette date n'est pas valide.", true);
  if (date && tpDays(date) < 0) return tpMessage("Choisis une date de départ à venir (ou laisse la case vide).", true);
  if (tpTrips.length >= TP_MAX) return tpMessage(`Tu as atteint la limite de ${TP_MAX} voyages. Supprime-en un.`, true);
  const t = { id: tpId(), name, date: date || "", items: [] };
  tpTrips.push(t);
  tpCur = t.id;
  $("tpName").value = ""; $("tpDateNew").value = "";
  tpSave();
  tpRender();
  tpMessage("Voyage créé ! Ajoute des éléments ou des suggestions.");
});
$("tpName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("tpCreate").click(); });
tpSel.addEventListener("change", () => { tpCur = tpSel.value; tpMessage(""); tpRender(); });
tpDate.addEventListener("change", () => {
  const t = tpCurTrip();
  if (!t) return;
  if (tpDate.value && (!tpParse(tpDate.value) || tpDays(tpDate.value) < 0)) { tpMessage("Choisis une date de départ à venir.", true); return tpRender(); }
  t.date = tpDate.value;
  tpMessage("");
  tpSave();
  tpRender();
});
$("tpAdd").addEventListener("click", () => {
  const t = tpCurTrip(), text = tpItem.value.trim().slice(0, 60);
  if (!t || !text) return;
  if (t.items.length >= TP_ITEMS) return tpMessage(`Cette liste est pleine (${TP_ITEMS} éléments).`, true);
  if (!tpAddItems([[tpCat.value, text]])) return tpMessage("Cet élément est déjà dans la liste.", true);
  tpItem.value = "";
  tpMessage("");
  tpItem.focus();
});
tpItem.addEventListener("keydown", (e) => { if (e.key === "Enter") $("tpAdd").click(); });
$("tpSug").addEventListener("click", () => {
  if (!tpCurTrip()) return;
  const n = tpAddItems(TP_TPL[tpTpl.value].items);
  tpMessage(n ? `${n} élément${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""}.` : "Ces suggestions sont déjà dans ta liste.");
});
$("tpUncheck").addEventListener("click", () => {
  const t = tpCurTrip();
  if (!t) return;
  t.items.forEach((i) => { i.done = false; });
  tpSave();
  tpRender();
});
$("tpCopy").addEventListener("click", async () => {
  const t = tpCurTrip();
  if (!t || !t.items.length) return tpMessage("La liste est vide.", true);
  const lines = [t.name + (t.date ? " · départ le " + tpFmtDate(t.date) : "")];
  TP_CATS.forEach((cat) => {
    const items = t.items.filter((i) => i.cat === cat);
    if (!items.length) return;
    lines.push("", cat.toUpperCase());
    items.forEach((i) => lines.push((i.done ? "☑ " : "☐ ") + i.text));
  });
  try { await copyText(lines.join("\n")); tpMessage("Liste copiée !"); }
  catch { tpMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
});
$("tpDelete").addEventListener("click", () => {
  const t = tpCurTrip();
  if (!t || !confirm(`Supprimer le voyage « ${t.name} » et sa liste ?`)) return;
  tpTrips = tpTrips.filter((x) => x.id !== t.id);
  tpCur = tpTrips[0] ? tpTrips[0].id : "";
  tpSave();
  tpMessage("");
  tpRender();
});

TP_CATS.forEach((c) => { const o = document.createElement("option"); o.textContent = c; tpCat.appendChild(o); });
Object.keys(TP_TPL).forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = TP_TPL[k].label; tpTpl.appendChild(o); });
$("tpDateNew").min = tpIso(tpToday());
tpTrips = tpLoad();
tpCur = tpTrips[0] ? tpTrips[0].id : "";
tpRender();

// ---------- Ajout de filigrane (sur l'appareil) ----------
const WM_MAX_SIDE = 3000;
const WM_FONTS = {
  sans: '"DM Sans", system-ui, sans-serif',
  titre: '"Bricolage Grotesque", "DM Sans", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, Consolas, "Courier New", monospace',
};
const wmDrop = $("wmDrop"), wmFile = $("wmFile"), wmWork = $("wmWork"), wmCanvas = $("wmCanvas"), wmStatus = $("wmStatus");
const wmText = $("wmText"), wmFont = $("wmFont"), wmColor = $("wmColor"), wmBold = $("wmBold"), wmOutline = $("wmOutline");
const wmSize = $("wmSize"), wmOpacity = $("wmOpacity"), wmAngle = $("wmAngle"), wmGap = $("wmGap"), wmGapBox = $("wmGapBox");
const wmFmt = $("wmFmt"), wmQual = $("wmQual"), wmQualBox = $("wmQualBox");
const wmCtx = wmCanvas.getContext("2d");
let wmBase = null, wmName = "photo", wmType = "text", wmPosVal = "br", wmLogo = null, wmLogoUrl = null, wmRaf = 0;

function wmMessage(msg, isError = false) {
  wmStatus.textContent = msg;
  wmStatus.classList.toggle("error", isError);
}
function wmLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function wmLabels() {
  $("wmSizeVal").textContent = wmSize.value;
  $("wmOpVal").textContent = wmOpacity.value;
  $("wmAngleVal").textContent = wmAngle.value;
  $("wmGapVal").textContent = wmGap.value;
}

// Fabrique le filigrane (texte ou logo) sur un petit canevas à part
function wmMakeMark(w, h) {
  const tw = Math.max(8, Math.round(w * (parseInt(wmSize.value, 10) / 100)));
  if (wmType === "logo") {
    if (!wmLogo || !wmLogo.naturalWidth) return null;
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = Math.max(1, Math.round(wmLogo.naturalHeight * (tw / wmLogo.naturalWidth)));
    c.getContext("2d").drawImage(wmLogo, 0, 0, c.width, c.height);
    return c;
  }
  const text = wmText.value.trim();
  if (!text) return null;
  const weight = wmBold.checked ? "800" : "500";
  const fam = WM_FONTS[wmFont.value] || WM_FONTS.sans;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = `${weight} 100px ${fam}`;
  const w100 = Math.max(1, probe.measureText(text).width);
  const px = Math.max(8, Math.min((100 * tw) / w100, Math.min(w, h) * 0.5));
  const pad = Math.ceil(px * 0.2);
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  x.font = `${weight} ${px}px ${fam}`;
  c.width = Math.ceil(x.measureText(text).width) + pad * 2;
  c.height = Math.ceil(px * 1.3) + pad * 2;
  x.font = `${weight} ${px}px ${fam}`; // le redimensionnement réinitialise le contexte
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.lineJoin = "round";
  if (wmOutline.checked) {
    x.lineWidth = Math.max(2, px * 0.14);
    x.strokeStyle = wmLum(wmColor.value) > 0.5 ? "rgba(0,0,0,.75)" : "rgba(255,255,255,.8)";
    x.strokeText(text, c.width / 2, c.height / 2);
  }
  x.fillStyle = wmColor.value;
  x.fillText(text, c.width / 2, c.height / 2);
  return c;
}

function wmDraw() {
  if (!wmBase) return;
  const w = wmCanvas.width, h = wmCanvas.height, ctx = wmCtx;
  ctx.clearRect(0, 0, w, h);
  if (wmFmt.value === "jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h); } // le JPG n'a pas de transparence
  ctx.drawImage(wmBase, 0, 0);
  const mark = wmMakeMark(w, h);
  if (!mark) return;
  const mw = mark.width, mh = mark.height;
  const angle = (parseInt(wmAngle.value, 10) * Math.PI) / 180;
  ctx.save();
  ctx.globalAlpha = parseInt(wmOpacity.value, 10) / 100;
  if (wmPosVal === "tile") {
    const gap = parseInt(wmGap.value, 10) / 100;
    const stepX = Math.max(12, mw * (1 + gap)), stepY = Math.max(12, mh * (1 + gap));
    const diag = Math.hypot(w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    let n = 0, row = 0;
    for (let y = -diag / 2; y < diag / 2 && n < 4000; y += stepY, row++) {
      for (let x = -diag / 2 - (row % 2 ? stepX / 2 : 0); x < diag / 2 && n < 4000; x += stepX) {
        ctx.drawImage(mark, x, y);
        n++;
      }
    }
  } else {
    const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
    const bw = mw * cos + mh * sin, bh = mw * sin + mh * cos;
    const m = Math.round(Math.min(w, h) * 0.03);
    const r = wmPosVal[0], c = wmPosVal[1];
    const cx = c === "l" ? m + bw / 2 : c === "r" ? w - m - bw / 2 : w / 2;
    const cy = r === "t" ? m + bh / 2 : r === "b" ? h - m - bh / 2 : h / 2;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(mark, -mw / 2, -mh / 2);
  }
  ctx.restore();
}
function wmSchedule() {
  if (wmRaf) return;
  wmRaf = requestAnimationFrame(() => { wmRaf = 0; wmDraw(); });
}

function wmLoad(file) {
  if (!file || !file.type.startsWith("image/")) return wmMessage("Choisis un fichier image.", true);
  if (file.size > 30 * 1048576) return wmMessage("Cette image est trop lourde (30 Mo maximum).", true);
  wmMessage("Lecture de la photo…");
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) { URL.revokeObjectURL(url); return wmMessage("Impossible de lire cette image.", true); }
    const k = Math.min(1, WM_MAX_SIDE / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    wmBase = c;
    wmCanvas.width = w;
    wmCanvas.height = h;
    wmName = file.name.replace(/\.[^.]+$/, "") || "photo";
    wmWork.hidden = false;
    wmMessage(k < 1 ? `Ta photo est réduite à ${w} × ${h} px pour rester fluide.` : "");
    wmDraw();
  };
  img.onerror = () => { URL.revokeObjectURL(url); wmMessage("Impossible de lire cette image. Les photos HEIC ne sont pas lues par tous les navigateurs.", true); };
  img.src = url;
}

function wmSetType(t) {
  wmType = t;
  document.querySelectorAll("#wmTypes .chip").forEach((c) => c.classList.toggle("active", c.dataset.type === t));
  $("wmTextBox").hidden = t !== "text";
  $("wmLogoBox").hidden = t !== "logo";
  wmSize.value = t === "logo" ? "20" : "30";
  wmLabels();
  wmMessage(t === "logo" && !wmLogo ? "Choisis ton logo pour l'ajouter sur la photo." : "");
  wmSchedule();
}
function wmSetPos(p) {
  wmPosVal = p;
  document.querySelectorAll("#wmPos button").forEach((b) => {
    const on = b.dataset.pos === p;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  wmGapBox.hidden = p !== "tile";
  if (p === "tile" && wmAngle.value === "0") { wmAngle.value = "-30"; wmLabels(); } // une mosaïque penchée est plus difficile à effacer
  wmSchedule();
}

// Les polices du site doivent être chargées avant de dessiner du texte
(function wmFonts() {
  if (!document.fonts || !document.fonts.load) return;
  Promise.all(['500 40px "DM Sans"', '800 40px "DM Sans"', '500 40px "Bricolage Grotesque"', '800 40px "Bricolage Grotesque"']
    .map((f) => document.fonts.load(f))).then(() => { if (wmBase) wmSchedule(); }).catch(() => {});
})();

wmFile.addEventListener("change", () => { wmLoad(wmFile.files[0]); wmFile.value = ""; });
["dragenter", "dragover"].forEach((ev) => wmDrop.addEventListener(ev, (e) => { e.preventDefault(); wmDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => wmDrop.addEventListener(ev, (e) => { e.preventDefault(); wmDrop.classList.remove("over"); }));
wmDrop.addEventListener("drop", (e) => wmLoad(e.dataTransfer.files[0]));

$("wmLogoFile").addEventListener("change", () => {
  const input = $("wmLogoFile"), f = input.files[0];
  input.value = "";
  if (!f) return;
  if (!f.type.startsWith("image/")) return wmMessage("Choisis un fichier image pour le logo.", true);
  if (f.size > 10 * 1048576) return wmMessage("Ce logo est trop lourd (10 Mo maximum).", true);
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    if (wmLogoUrl) URL.revokeObjectURL(wmLogoUrl);
    wmLogo = img;
    wmLogoUrl = url;
    $("wmLogoName").textContent = f.name;
    wmMessage("");
    wmSchedule();
  };
  img.onerror = () => { URL.revokeObjectURL(url); wmMessage("Impossible de lire ce logo.", true); };
  img.src = url;
});

document.querySelectorAll("#wmTypes .chip").forEach((c) => c.addEventListener("click", () => wmSetType(c.dataset.type)));
document.querySelectorAll("#wmPos button").forEach((b) => b.addEventListener("click", () => wmSetPos(b.dataset.pos)));
[wmText, wmColor, wmBold, wmOutline, wmSize, wmOpacity, wmAngle, wmGap].forEach((el) => el.addEventListener("input", () => { wmLabels(); wmSchedule(); }));
wmFont.addEventListener("change", wmSchedule);
wmFmt.addEventListener("change", () => { wmQualBox.hidden = wmFmt.value !== "jpeg"; wmSchedule(); });

$("wmSave").addEventListener("click", () => {
  if (!wmBase) return;
  wmDraw();
  const jpeg = wmFmt.value === "jpeg";
  wmCanvas.toBlob((b) => {
    if (!b) return wmMessage("Impossible de créer l'image.", true);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wmName}-filigrane.${jpeg ? "jpg" : "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, jpeg ? "image/jpeg" : "image/png", jpeg ? parseFloat(wmQual.value) : undefined);
});

wmLabels();
wmSetPos("br");

// ---------- Créateur de cartes mentales ----------
const MP_KEY = "clippo_mindmap", MP_MAX = 60, MP_DEPTH = 4;
const MP_FONT = '"DM Sans", system-ui, sans-serif';
const MP_COLORS = ["#e63e6d", "#2f80ed", "#0d9f8a", "#e17b12", "#8b5cf6", "#c2410c", "#0891b2", "#4d7c0f"];
const MP_GAPX = 60, MP_GAPY = 14, MP_COLW = 210;
const mpTitle = $("mpTitle"), mpTree = $("mpTree"), mpBg = $("mpBg"), mpFit = $("mpFit");
const mpStage = $("mpStage"), mpCanvas = $("mpCanvas"), mpStatus = $("mpStatus"), mpInfo = $("mpInfo"), mpAddBranch = $("mpAddBranch");
const mpMeasure = document.createElement("canvas").getContext("2d");
let mp = { title: "", nodes: [] }, mpSeq = 0, mpFocusId = 0, mpRaf = 0;

function mpMessage(msg, isError = false) {
  mpStatus.textContent = msg;
  mpStatus.classList.toggle("error", isError);
}
function mpCount(list) { return list.reduce((s, n) => s + 1 + mpCount(n.children), 0); }
function mpNewNode(text) { return { id: ++mpSeq, text: text || "", children: [] }; }
function mpClean(list, depth, budget) {
  const out = [];
  if (!Array.isArray(list) || depth > MP_DEPTH) return out;
  for (const n of list) {
    if (budget.n >= MP_MAX) break;
    if (!n || typeof n.text !== "string") continue;
    budget.n++;
    out.push({ id: ++mpSeq, text: n.text.slice(0, 60), children: mpClean(n.children, depth + 1, budget) });
  }
  return out;
}
function mpLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(MP_KEY) || "null");
    if (d && typeof d === "object") return { title: String(d.title || "").slice(0, 50), nodes: mpClean(d.nodes, 1, { n: 0 }) };
  } catch { /* données illisibles */ }
  return { title: "", nodes: [] };
}
function mpPersist() {
  try { localStorage.setItem(MP_KEY, JSON.stringify({ title: mp.title, nodes: mp.nodes })); }
  catch { mpMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}

// --- Dessin ---
function mpWrap(ctx, text, maxW) {
  const lines = [];
  let cur = "";
  text.split(/\s+/).filter(Boolean).forEach((word) => {
    let w = word;
    while (ctx.measureText(w).width > maxW && w.length > 1) { // coupe les mots trop longs
      let i = w.length - 1;
      while (i > 1 && ctx.measureText(w.slice(0, i)).width > maxW) i--;
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, i));
      w = w.slice(i);
    }
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  });
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
function mpBuild(n, depth, color, mc) {
  const size = depth === 1 ? 17 : 15;
  mc.font = `${depth === 1 ? 700 : 500} ${size}px ${MP_FONT}`;
  const lines = mpWrap(mc, n.text.trim() || "…", 180);
  const lw = Math.max(...lines.map((l) => mc.measureText(l).width));
  const o = { depth, color, size, lines, w: Math.ceil(lw) + 28, h: lines.length * (size + 4) + 20, cy: 0, x: 0, sub: 0, children: [] };
  o.children = n.children.map((c) => mpBuild(c, depth + 1, color, mc));
  return o;
}
function mpSub(o) {
  const kids = o.children.reduce((s, c) => s + mpSub(c), 0);
  o.sub = Math.max(o.h + MP_GAPY, kids);
  return o.sub;
}
function mpPlace(o, top) {
  o.cy = top + o.sub / 2;
  const total = o.children.reduce((s, c) => s + c.sub, 0);
  let y = top + (o.sub - total) / 2;
  o.children.forEach((c) => { mpPlace(c, y); y += c.sub; });
}
function mpX(o, side, cx0, rw) {
  o.x = cx0 + side * (rw / 2 + MP_GAPX + (o.depth - 1) * (MP_COLW + MP_GAPX) + MP_COLW / 2);
  o.children.forEach((c) => mpX(c, side, cx0, rw));
}
function mpRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function mpEdgeTree(ctx, o, px, py, ph, side) {
  const x1 = px + side * ph, x2 = o.x - side * (o.w / 2), mx = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, py);
  ctx.bezierCurveTo(mx, py, mx, o.cy, x2, o.cy);
  ctx.strokeStyle = o.color;
  ctx.lineWidth = Math.max(2, 6 - o.depth * 1.2);
  ctx.lineCap = "round";
  ctx.stroke();
  o.children.forEach((c) => mpEdgeTree(ctx, c, o.x, o.cy, o.w / 2, side));
}
function mpNodeDraw(ctx, o, dark) {
  mpRound(ctx, o.x - o.w / 2, o.cy - o.h / 2, o.w, o.h, o.depth === 1 ? 16 : 12);
  if (o.depth === 1) { ctx.fillStyle = o.color; ctx.fill(); }
  else { ctx.fillStyle = o.color + (dark ? "44" : "26"); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = o.color; ctx.stroke(); }
  ctx.font = `${o.depth === 1 ? 700 : 500} ${o.size}px ${MP_FONT}`;
  ctx.fillStyle = o.depth === 1 ? "#ffffff" : dark ? "#f6f3ff" : "#15112e";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lh = o.size + 4, y0 = o.cy - (o.lines.length * lh) / 2 + lh / 2;
  o.lines.forEach((l, i) => ctx.fillText(l, o.x, y0 + i * lh));
  o.children.forEach((c) => mpNodeDraw(ctx, c, dark));
}

function mpDraw() {
  const title = mp.title.trim();
  const empty = !title && !mp.nodes.length;
  mpStage.hidden = empty;
  if (empty) return;
  mpStage.classList.toggle("fit", mpFit.checked);
  const dark = mpBg.value === "dark", mc = mpMeasure;
  mc.font = `800 20px ${MP_FONT}`;
  const rl = mpWrap(mc, title || "Idée centrale", 220);
  const rw = Math.ceil(Math.max(...rl.map((l) => mc.measureText(l).width))) + 44;
  const rh = rl.length * 26 + 28;
  const branches = mp.nodes.map((n, i) => mpBuild(n, 1, MP_COLORS[i % MP_COLORS.length], mc));
  branches.forEach(mpSub);
  const nR = Math.ceil(branches.length / 2);
  const right = branches.slice(0, nR), left = branches.slice(nR);
  const sum = (a) => a.reduce((s, b) => s + b.sub, 0);
  const hR = sum(right), hL = sum(left), inner = Math.max(hR, hL, rh + MP_GAPY);
  const depthOf = (o) => 1 + (o.children.length ? Math.max(...o.children.map(depthOf)) : 0);
  const dR = right.length ? Math.max(...right.map(depthOf)) : 0, dL = left.length ? Math.max(...left.map(depthOf)) : 0;
  const span = (d) => (d ? MP_GAPX + d * MP_COLW + (d - 1) * MP_GAPX : 0);
  const PAD = 30, wR = rw / 2 + span(dR), wL = rw / 2 + span(dL);
  const W = Math.ceil(wL + wR + PAD * 2), H = Math.ceil(inner + PAD * 2);
  const cx0 = PAD + wL, cy0 = PAD + inner / 2;
  let y = PAD + (inner - hR) / 2;
  right.forEach((b) => { mpPlace(b, y); y += b.sub; mpX(b, 1, cx0, rw); });
  y = PAD + (inner - hL) / 2;
  left.forEach((b) => { mpPlace(b, y); y += b.sub; mpX(b, -1, cx0, rw); });

  const s = Math.min(2, 4000 / Math.max(W, H));
  mpCanvas.width = Math.max(1, Math.round(W * s));
  mpCanvas.height = Math.max(1, Math.round(H * s));
  mpCanvas.style.width = W + "px";
  const ctx = mpCanvas.getContext("2d");
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.fillStyle = dark ? "#0c1730" : "#ffffff";
  ctx.fillRect(0, 0, W, H);
  right.forEach((b) => mpEdgeTree(ctx, b, cx0, cy0, rw / 2, 1));
  left.forEach((b) => mpEdgeTree(ctx, b, cx0, cy0, rw / 2, -1));
  mpRound(ctx, cx0 - rw / 2, cy0 - rh / 2, rw, rh, 22);
  ctx.fillStyle = dark ? "#ffffff" : "#15112e";
  ctx.fill();
  ctx.font = `800 20px ${MP_FONT}`;
  ctx.fillStyle = dark ? "#15112e" : "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y0 = cy0 - (rl.length * 26) / 2 + 13;
  rl.forEach((l, i) => ctx.fillText(l, cx0, y0 + i * 26));
  branches.forEach((b) => mpNodeDraw(ctx, b, dark));
}
function mpSched() {
  if (mpRaf) return;
  mpRaf = requestAnimationFrame(() => { mpRaf = 0; mpDraw(); });
}

// --- Éditeur de branches ---
function mpList(list, depth, color) {
  const ul = document.createElement("ul");
  ul.className = "mp-list";
  list.forEach((n, i) => {
    const col = color || MP_COLORS[i % MP_COLORS.length];
    const li = document.createElement("li");
    li.className = "mp-item";
    const row = document.createElement("div");
    row.className = "mp-row";
    row.style.borderLeftColor = col;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "text-in";
    inp.maxLength = 60;
    inp.value = n.text;
    inp.placeholder = depth === 1 ? "Branche" : "Sous-branche";
    inp.dataset.id = String(n.id);
    inp.setAttribute("aria-label", (depth === 1 ? "Branche " : "Sous-branche ") + (i + 1));
    inp.addEventListener("input", () => { n.text = inp.value; mpPersist(); mpSched(); });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "mp-btn";
    add.textContent = "+";
    add.title = "Ajouter une sous-branche";
    add.setAttribute("aria-label", "Ajouter une sous-branche");
    add.disabled = depth >= MP_DEPTH || mpCount(mp.nodes) >= MP_MAX;
    add.addEventListener("click", () => {
      const c = mpNewNode("");
      n.children.push(c);
      mpFocusId = c.id;
      mpPersist(); mpEditor(); mpSched();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "mp-btn";
    del.textContent = "×";
    del.title = "Supprimer";
    del.setAttribute("aria-label", "Supprimer cette branche");
    del.addEventListener("click", () => {
      if (n.children.length && !confirm("Supprimer cette branche et ses sous-branches ?")) return;
      list.splice(list.indexOf(n), 1);
      mpPersist(); mpEditor(); mpSched();
    });
    row.append(inp, add, del);
    li.appendChild(row);
    if (n.children.length) li.appendChild(mpList(n.children, depth + 1, col));
    ul.appendChild(li);
  });
  return ul;
}
function mpEditor() {
  mpTree.innerHTML = "";
  mpTree.appendChild(mpList(mp.nodes, 1, null));
  const total = mpCount(mp.nodes);
  mpAddBranch.disabled = total >= MP_MAX;
  mpInfo.textContent = total ? `${total} élément${total > 1 ? "s" : ""} sur ${MP_MAX} maximum` : "Ajoute ta première branche, ou charge un exemple.";
  if (mpFocusId) {
    const f = mpTree.querySelector(`[data-id="${mpFocusId}"]`);
    if (f) f.focus();
    mpFocusId = 0;
  }
}
function mpOutline(list, depth) {
  return list.map((n) => "  ".repeat(depth) + "- " + (n.text || "…") + "\n" + mpOutline(n.children, depth + 1)).join("");
}

mpAddBranch.addEventListener("click", () => {
  if (mpCount(mp.nodes) >= MP_MAX) return;
  const n = mpNewNode("");
  mp.nodes.push(n);
  mpFocusId = n.id;
  mpPersist(); mpEditor(); mpSched();
});
mpTitle.addEventListener("input", () => { mp.title = mpTitle.value; mpPersist(); mpSched(); });
mpBg.addEventListener("change", mpSched);
mpFit.addEventListener("change", mpSched);
$("mpExample").addEventListener("click", () => {
  if ((mp.title.trim() || mp.nodes.length) && !confirm("Remplacer ta carte actuelle par un exemple ?")) return;
  const mk = (t, ch) => ({ id: ++mpSeq, text: t, children: (ch || []).map((c) => (typeof c === "string" ? mk(c) : mk(c[0], c[1]))) });
  mp = { title: "Préparer le bac", nodes: [
    mk("Maths", ["Fonctions", "Probabilités", "Suites"]),
    mk("Français", ["Oral", ["Écrit", ["Dissertation", "Commentaire"]]]),
    mk("Histoire", ["Guerres mondiales", "Guerre froide"]),
    mk("Organisation", ["Planning", "Pauses"]),
  ] };
  mpTitle.value = mp.title;
  mpMessage("");
  mpPersist(); mpEditor(); mpSched();
});
$("mpClear").addEventListener("click", () => {
  if (!(mp.title.trim() || mp.nodes.length) || !confirm("Effacer toute ta carte ?")) return;
  mp = { title: "", nodes: [] };
  mpTitle.value = "";
  mpMessage("");
  mpPersist(); mpEditor(); mpDraw();
});
$("mpCopy").addEventListener("click", async () => {
  if (!mp.title.trim() && !mp.nodes.length) return mpMessage("Ta carte est vide.", true);
  try { await copyText((mp.title.trim() || "Carte mentale") + "\n" + mpOutline(mp.nodes, 0)); mpMessage("Liste copiée !"); }
  catch { mpMessage("Copie automatique impossible : sélectionne le texte et fais Ctrl + C.", true); }
});
$("mpDownload").addEventListener("click", () => {
  if (mpStage.hidden) return mpMessage("Ajoute une idée centrale ou une branche avant de télécharger.", true);
  mpDraw();
  const slug = mp.title.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  mpCanvas.toBlob((b) => {
    if (!b) return mpMessage("Impossible de créer l'image.", true);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = (slug || "carte-mentale") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
});

if (document.fonts && document.fonts.load) {
  Promise.all(['500 15px "DM Sans"', '700 17px "DM Sans"', '800 20px "DM Sans"'].map((f) => document.fonts.load(f))).then(mpSched).catch(() => {});
}
mp = mpLoad();
mpTitle.value = mp.title;
mpEditor();
mpDraw();

// ---------- Créateur de calendrier ----------
const CL_KEY = "clippo_calendar", CL_MAX = 100, CL_W = 1754, CL_H = 1240;
const CL_FONT = '"DM Sans", system-ui, sans-serif';
const CL_MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const CL_DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const CL_INIT = ["L", "M", "M", "J", "V", "S", "D"];
const clCanvas = $("clCanvas"), clMonthSel = $("clMonthSel"), clYear = $("clYear"), clFirst = $("clFirst"), clColor = $("clColor");
const clTitle = $("clTitle"), clHol = $("clHol"), clWeeks = $("clWeeks"), clStatus = $("clStatus"), clList = $("clList");
const clDate = $("clDate"), clText = $("clText");
const clToday = new Date();
let clMode = "month", clM = clToday.getMonth(), clY = clToday.getFullYear(), clEvents = [];
const clHolCache = {};

function clMessage(msg, isError = false) {
  clStatus.textContent = msg;
  clStatus.classList.toggle("error", isError);
}
function clPad(n) { return String(n).padStart(2, "0"); }
function clKey(y, m, d) { return y + "-" + clPad(m + 1) + "-" + clPad(d); }
function clValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}
function clEaster(y) { // calcul de la date de Pâques
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
function clHolidays(y) { // jours fériés de la France métropolitaine
  if (clHolCache[y]) return clHolCache[y];
  const e = clEaster(y), map = {};
  const put = (d, name) => { map[d.getMonth() + "-" + d.getDate()] = name; };
  const plus = (n) => new Date(y, e.getMonth(), e.getDate() + n);
  put(new Date(y, 0, 1), "Jour de l'An");
  put(plus(1), "Lundi de Pâques");
  put(new Date(y, 4, 1), "Fête du travail");
  put(new Date(y, 4, 8), "Victoire 1945");
  put(plus(39), "Ascension");
  put(plus(50), "Lundi de Pentecôte");
  put(new Date(y, 6, 14), "Fête nationale");
  put(new Date(y, 7, 15), "Assomption");
  put(new Date(y, 10, 1), "Toussaint");
  put(new Date(y, 10, 11), "Armistice 1918");
  put(new Date(y, 11, 25), "Noël");
  return (clHolCache[y] = map);
}
function clWeek(d) { // numéro de semaine ISO
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
}
function clFit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function clEventMap() {
  const m = {};
  clEvents.forEach((ev) => { (m[ev.date] = m[ev.date] || []).push(ev.text); });
  return m;
}
function clTitleDraw(ctx, st, y) {
  if (!st.title) return;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 34px ${CL_FONT}`;
  ctx.fillStyle = "#6b7488";
  ctx.fillText(clFit(ctx, st.title, CL_W / 2 - 60), CL_W - 60, y);
  ctx.textAlign = "left";
}

function clDrawMonth(ctx, st) {
  const W = CL_W, H = CL_H, M = 60;
  const first = new Date(st.y, st.m, 1), dim = new Date(st.y, st.m + 1, 0).getDate();
  const off = st.sun ? first.getDay() : (first.getDay() + 6) % 7;
  const rows = Math.ceil((off + dim) / 7);
  const now = new Date(), tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 84px ${CL_FONT}`;
  ctx.fillStyle = st.accent;
  ctx.fillText(CL_MONTHS[st.m], M, 112);
  const mw = ctx.measureText(CL_MONTHS[st.m]).width;
  ctx.font = `500 84px ${CL_FONT}`;
  ctx.fillStyle = "#15112e";
  ctx.fillText(String(st.y), M + mw + 24, 112);
  clTitleDraw(ctx, st, 104);

  const wk = st.weeks ? 56 : 0, gx = M + wk, cw = (W - M - gx) / 7;
  const top = 158, dn = 48, gy = top + dn, rh = (H - 48 - gy) / rows;
  ctx.fillStyle = st.accent;
  ctx.fillRect(gx, top, cw * 7, dn);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 24px ${CL_FONT}`;
  ctx.fillStyle = "#ffffff";
  for (let c = 0; c < 7; c++) ctx.fillText(CL_DAYS[(c + (st.sun ? 6 : 0)) % 7], gx + cw * c + cw / 2, top + dn / 2 + 1);
  if (wk) {
    ctx.fillStyle = "#e6ebf5";
    ctx.fillRect(M, top, wk, dn);
    ctx.fillStyle = "#6b7488";
    ctx.font = `700 18px ${CL_FONT}`;
    ctx.fillText("Sem.", M + wk / 2, top + dn / 2 + 1);
  }

  for (let r = 0; r < rows; r++) {
    if (wk) {
      ctx.font = `700 20px ${CL_FONT}`;
      ctx.fillStyle = "#8a93a8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(clWeek(new Date(st.y, st.m, r * 7 - off + 1 + (st.sun ? 1 : 0)))), M + wk / 2, gy + rh * r + rh / 2);
    }
    for (let c = 0; c < 7; c++) {
      const dayNum = r * 7 + c - off + 1;
      const date = new Date(st.y, st.m, dayNum);
      const inM = dayNum >= 1 && dayNum <= dim;
      const dow = date.getDay(), weekend = dow === 0 || dow === 6;
      const x = gx + cw * c, y = gy + rh * r;
      const hol = inM && st.hol ? st.holMap[date.getMonth() + "-" + date.getDate()] : "";
      ctx.fillStyle = !inM ? "#f4f6fa" : hol ? st.accent + "22" : weekend ? "#eef2fa" : "#ffffff";
      ctx.fillRect(x, y, cw, rh);
      ctx.strokeStyle = "#d3dae8";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, cw, rh);
      const isToday = inM && st.y === tY && st.m === tM && dayNum === tD;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (isToday) { ctx.fillStyle = st.accent; ctx.beginPath(); ctx.arc(x + 28, y + 28, 21, 0, Math.PI * 2); ctx.fill(); }
      ctx.font = `700 28px ${CL_FONT}`;
      ctx.fillStyle = isToday ? "#ffffff" : !inM ? "#b7bfd0" : hol ? st.accent : weekend ? "#6b7488" : "#15112e";
      ctx.fillText(String(date.getDate()), x + 28, y + 29);
      if (!inM) continue;
      ctx.textAlign = "left";
      if (hol) {
        ctx.font = `700 19px ${CL_FONT}`;
        ctx.fillStyle = st.accent;
        ctx.fillText(clFit(ctx, hol, cw - 66), x + 56, y + 29);
      }
      const evs = st.ev[clKey(st.y, st.m, dayNum)] || [];
      const maxL = Math.max(0, Math.floor((rh - 64) / 26));
      let shown = evs, more = 0;
      if (evs.length > maxL) { shown = evs.slice(0, Math.max(0, maxL - 1)); more = maxL ? evs.length - shown.length : 0; }
      ctx.font = `500 20px ${CL_FONT}`;
      shown.forEach((t, i) => {
        const ly = y + 70 + i * 26;
        ctx.fillStyle = st.accent;
        ctx.beginPath();
        ctx.arc(x + 18, ly, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#15112e";
        ctx.fillText(clFit(ctx, t, cw - 44), x + 30, ly);
      });
      if (more) {
        ctx.fillStyle = "#6b7488";
        ctx.fillText(`+ ${more} autre${more > 1 ? "s" : ""}`, x + 14, y + 70 + shown.length * 26);
      }
    }
  }
}

function clDrawYear(ctx, st) {
  const W = CL_W, H = CL_H, M = 60;
  const now = new Date(), tY = now.getFullYear(), tM = now.getMonth(), tD = now.getDate();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 84px ${CL_FONT}`;
  ctx.fillStyle = st.accent;
  ctx.fillText(String(st.y), M, 112);
  clTitleDraw(ctx, st, 104);
  const gap = 36, bw = (W - M * 2 - gap * 3) / 4, top = 150, bh = (H - top - 56 - gap * 2) / 3;
  for (let mi = 0; mi < 12; mi++) {
    const bx = M + (mi % 4) * (bw + gap), by = top + Math.floor(mi / 4) * (bh + gap), cw = bw / 7;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 30px ${CL_FONT}`;
    ctx.fillStyle = st.accent;
    ctx.fillText(CL_MONTHS[mi], bx, by + 30);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 18px ${CL_FONT}`;
    ctx.fillStyle = "#8a93a8";
    for (let c = 0; c < 7; c++) ctx.fillText(CL_INIT[(c + (st.sun ? 6 : 0)) % 7], bx + cw * c + cw / 2, by + 62);
    const ms = new Date(st.y, mi, 1), dim = new Date(st.y, mi + 1, 0).getDate();
    const off = st.sun ? ms.getDay() : (ms.getDay() + 6) % 7, rh = (bh - 84) / 6;
    for (let d = 1; d <= dim; d++) {
      const idx = off + d - 1, r = Math.floor(idx / 7), c = idx % 7;
      const cx = bx + cw * c + cw / 2, cy = by + 84 + rh * r + rh / 2;
      const dow = new Date(st.y, mi, d).getDay();
      const hol = st.hol && st.holMap[mi + "-" + d];
      const radius = Math.min(cw, rh) * 0.42;
      if (hol) { ctx.fillStyle = st.accent; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill(); }
      else if (st.y === tY && mi === tM && d === tD) { ctx.strokeStyle = st.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = `${hol ? 800 : 500} 22px ${CL_FONT}`;
      ctx.fillStyle = hol ? "#ffffff" : dow === 0 || dow === 6 ? "#8a93a8" : "#15112e";
      ctx.fillText(String(d), cx, cy + 1);
      if (st.ev[clKey(st.y, mi, d)]) {
        ctx.fillStyle = hol ? "#ffffff" : st.accent;
        ctx.beginPath();
        ctx.arc(cx, cy + radius * 0.8, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `500 20px ${CL_FONT}`;
  let lx = M;
  if (st.hol) {
    ctx.fillStyle = st.accent;
    ctx.beginPath();
    ctx.arc(lx + 8, H - 30, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#6b7488";
    ctx.fillText("Jour férié (France)", lx + 26, H - 29);
    lx += 270;
  }
  ctx.fillStyle = "#6b7488";
  ctx.fillText("Un point sous le numéro : un événement", lx, H - 29);
}

function clDraw() {
  const st = {
    y: clY, m: clM, accent: clColor.value, sun: clFirst.value === "sun", hol: clHol.checked, weeks: clWeeks.checked,
    title: clTitle.value.trim(), ev: clEventMap(), holMap: clHolidays(clY),
  };
  clCanvas.width = CL_W;
  clCanvas.height = CL_H;
  const ctx = clCanvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CL_W, CL_H);
  if (clMode === "month") clDrawMonth(ctx, st); else clDrawYear(ctx, st);
}

// --- Réglages et navigation ---
function clLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(CL_KEY) || "null");
    if (!d || typeof d !== "object") return;
    if (Array.isArray(d.events)) {
      clEvents = d.events.filter((e) => e && typeof e.text === "string" && clValidDate(e.date)).slice(0, CL_MAX)
        .map((e) => ({ id: String(e.id), date: String(e.date), text: e.text.slice(0, 40) }));
    }
    const s = d.settings || {};
    if (s.first === "sun") clFirst.value = "sun";
    if (typeof s.hol === "boolean") clHol.checked = s.hol;
    if (typeof s.weeks === "boolean") clWeeks.checked = s.weeks;
    if (/^#[0-9a-fA-F]{6}$/.test(s.color || "")) clColor.value = s.color;
    if (typeof s.title === "string") clTitle.value = s.title.slice(0, 40);
  } catch { /* données illisibles */ }
}
function clPersist() {
  try {
    localStorage.setItem(CL_KEY, JSON.stringify({
      events: clEvents,
      settings: { first: clFirst.value, hol: clHol.checked, weeks: clWeeks.checked, color: clColor.value, title: clTitle.value },
    }));
  } catch { clMessage("Impossible d'enregistrer : le stockage du navigateur est plein ou bloqué.", true); }
}
function clSync() {
  clMonthSel.value = String(clM);
  clYear.value = String(clY);
  clDraw();
}
function clSetMode(m) {
  clMode = m;
  document.querySelectorAll("#clModes .chip").forEach((c) => c.classList.toggle("active", c.dataset.mode === m));
  $("clMonthBox").hidden = m !== "month";
  $("clWeeksBox").hidden = m !== "month";
  $("clNav").classList.toggle("year", m === "year");
  clSync();
}
function clShift(d) {
  if (clMode === "year") clY += d;
  else {
    clM += d;
    if (clM < 0) { clM = 11; clY--; } else if (clM > 11) { clM = 0; clY++; }
  }
  clY = Math.max(1900, Math.min(2200, clY));
  clSync();
}
function clRenderEvents() {
  clList.innerHTML = "";
  const sorted = clEvents.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!sorted.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = "Aucun événement pour l'instant.";
    clList.appendChild(li);
    return;
  }
  sorted.forEach((ev) => {
    const li = document.createElement("li");
    li.className = "cl-item";
    const info = document.createElement("div");
    info.className = "cl-info";
    const s = document.createElement("strong");
    s.textContent = ev.text;
    const d = document.createElement("span");
    d.textContent = clValidDate(ev.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    info.append(s, d);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "todo-btn";
    del.textContent = "×";
    del.setAttribute("aria-label", "Supprimer : " + ev.text);
    del.addEventListener("click", () => { clEvents = clEvents.filter((x) => x.id !== ev.id); clPersist(); clRenderEvents(); clDraw(); });
    li.append(info, del);
    clList.appendChild(li);
  });
}

$("clModes").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => clSetMode(c.dataset.mode)));
$("clPrev").addEventListener("click", () => clShift(-1));
$("clNext").addEventListener("click", () => clShift(1));
clMonthSel.addEventListener("change", () => { clM = parseInt(clMonthSel.value, 10) || 0; clSync(); });
clYear.addEventListener("change", () => {
  const v = parseInt(clYear.value, 10);
  if (Number.isFinite(v)) clY = Math.max(1900, Math.min(2200, v));
  clSync();
});
[clFirst, clColor, clHol, clWeeks, clTitle].forEach((el) => el.addEventListener("input", () => { clPersist(); clDraw(); }));

$("clAdd").addEventListener("click", () => {
  const d = clValidDate(clDate.value), t = clText.value.trim().slice(0, 40);
  if (!d) return clMessage("Choisis une date.", true);
  if (!t) return clMessage("Écris le nom de l'événement (ex : Anniversaire de Léa).", true);
  if (clEvents.length >= CL_MAX) return clMessage(`Tu as atteint la limite de ${CL_MAX} événements. Supprime-en un.`, true);
  clEvents.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: clKey(d.getFullYear(), d.getMonth(), d.getDate()), text: t });
  clText.value = "";
  clY = Math.max(1900, Math.min(2200, d.getFullYear()));
  clM = d.getMonth();
  clMessage("Événement ajouté !");
  clPersist(); clRenderEvents(); clSync();
});
clText.addEventListener("keydown", (e) => { if (e.key === "Enter") $("clAdd").click(); });

$("clDownload").addEventListener("click", () => {
  clDraw();
  clCanvas.toBlob((b) => {
    if (!b) return clMessage("Impossible de créer l'image.", true);
    const url = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = url;
    a.download = clMode === "year" ? `calendrier-${clY}.png` : `calendrier-${clY}-${clPad(clM + 1)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, "image/png");
});
$("clPrint").addEventListener("click", () => {
  clDraw();
  document.body.classList.add("cl-print");
  window.print();
});
window.addEventListener("afterprint", () => document.body.classList.remove("cl-print"));

CL_MONTHS.forEach((n, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = n; clMonthSel.appendChild(o); });
clLoad();
clDate.value = clKey(clToday.getFullYear(), clToday.getMonth(), clToday.getDate());
clRenderEvents();
clSetMode("month");
if (document.fonts && document.fonts.load) {
  Promise.all(['500 20px "DM Sans"', '700 28px "DM Sans"', '800 84px "DM Sans"'].map((f) => document.fonts.load(f))).then(clDraw).catch(() => {});
}

// ---------- Podium des outils les plus utilisés ----------
const podBox = $("podBox");
if (podBox) {
  const POD_KEY = "clippo_usage", POD_REC_KEY = "clippo_recent", POD_REC_MAX = 8, POD_REC_SHOW = 5;
  const POD_MEDALS = ["🥇", "🥈", "🥉"];
  const podSearch = document.getElementById("homeSearch");
  const podTools = {};
  document.querySelectorAll("#home .tool-card[data-go]").forEach((c) => {
    const id = c.dataset.go;
    if (podTools[id]) return;
    const ico = c.querySelector(".tc-ico"), name = c.querySelector("strong");
    podTools[id] = { name: name ? name.textContent.trim() : id, icon: ico ? ico.textContent.trim() : "🧰" };
  });

  function podLoadUsage() {
    try {
      const o = JSON.parse(localStorage.getItem(POD_KEY) || "{}");
      const out = {};
      if (o && typeof o === "object" && !Array.isArray(o)) {
        Object.keys(o).forEach((id) => {
          const v = o[id];
          if (podTools[id] && Array.isArray(v) && Number(v[0]) > 0) out[id] = [Math.min(Math.floor(Number(v[0])), 999999), Number(v[1]) || 0];
        });
      }
      return out;
    } catch { return {}; }
  }
  function podLoadRecent() {
    try {
      const d = JSON.parse(localStorage.getItem(POD_REC_KEY) || "[]");
      return Array.isArray(d) ? [...new Set(d.map(String))].filter((id) => podTools[id]).slice(0, POD_REC_MAX) : [];
    } catch { return []; }
  }
  function podSave(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ } }

  let podUsage = podLoadUsage(), podRecent = podLoadRecent(), podLast = { id: "", t: 0 };
  try { localStorage.removeItem("clippo_favs"); } catch { /* ignoré */ }

  function podOpen(id) {
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) tab.click(); else openTab(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function podChip(id) {
    const t = podTools[id];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pod-chip";
    const i = document.createElement("span");
    i.textContent = t.icon;
    i.setAttribute("aria-hidden", "true");
    const n = document.createElement("span");
    n.textContent = t.name;
    b.append(i, n);
    b.addEventListener("click", () => podOpen(id));
    return b;
  }
  function podTop() {
    return Object.keys(podUsage).sort((a, b) => podUsage[b][0] - podUsage[a][0] || podUsage[b][1] - podUsage[a][1]).slice(0, 3);
  }

  function podRender() {
    const searching = !!(podSearch && podSearch.value.trim());
    podBox.hidden = searching;
    const top = podTop();
    const stage = $("podium");
    stage.innerHTML = "";
    [1, 0, 2].forEach((i) => { // ordre visuel : 2e, 1er, 3e
      const id = top[i];
      const col = document.createElement("div");
      col.className = "pod-col r" + (i + 1) + (id ? "" : " empty");
      const head = document.createElement(id ? "button" : "div");
      head.className = "pod-tool";
      const medal = document.createElement("span");
      medal.className = "pod-medal";
      medal.textContent = POD_MEDALS[i];
      medal.setAttribute("aria-hidden", "true");
      const ico = document.createElement("span");
      ico.className = "pod-ico";
      ico.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      const meta = document.createElement("small");
      if (id) {
        head.type = "button";
        head.setAttribute("aria-label", `${i + 1}. ${podTools[id].name}`);
        ico.textContent = podTools[id].icon;
        name.textContent = podTools[id].name;
        meta.textContent = "🔥 " + podUsage[id][0];
        head.addEventListener("click", () => podOpen(id));
      } else {
        ico.textContent = "?";
        name.textContent = "Libre";
        meta.textContent = "\u00a0";
      }
      head.append(medal, ico, name, meta);
      const block = document.createElement("div");
      block.className = "pod-block";
      block.setAttribute("aria-hidden", "true");
      block.textContent = String(i + 1);
      col.append(head, block);
      stage.appendChild(col);
    });
    $("podSub").textContent = top.length ? "Basé sur tes ouvertures d'outils" : "Ouvre des outils pour remplir ton podium";
    $("podReset").hidden = !top.length;

    const recEl = $("podRec");
    recEl.innerHTML = "";
    const rec = podRecent.slice(0, POD_REC_SHOW);
    rec.forEach((id) => recEl.appendChild(podChip(id)));
    $("podRecBox").hidden = !rec.length;
  }

  function podTrack(id) {
    if (!podTools[id]) return;
    const now = Date.now();
    if (podLast.id === id && now - podLast.t < 4000) return; // évite de compter deux fois le même clic
    podLast = { id, t: now };
    const u = podUsage[id] || [0, 0];
    podUsage[id] = [Math.min(u[0] + 1, 999999), now];
    podRecent = [id, ...podRecent.filter((x) => x !== id)].slice(0, POD_REC_MAX);
    podSave(POD_KEY, podUsage);
    podSave(POD_REC_KEY, podRecent);
    podRender();
  }

  $("podClear").addEventListener("click", () => { podRecent = []; podSave(POD_REC_KEY, podRecent); podRender(); });
  $("podReset").addEventListener("click", () => {
    if (!confirm("Remettre ton podium à zéro ?")) return;
    podUsage = {};
    podSave(POD_KEY, podUsage);
    podRender();
  });
  if (podSearch) podSearch.addEventListener("input", podRender);

  // Chaque ouverture d'outil est comptée (menu, cartes, raccourcis, liens directs)
  const podOpenTab = openTab;
  openTab = (id) => { podOpenTab(id); podTrack(id); };
  const podStart = location.hash.slice(1);
  if (podTools[podStart]) podTrack(podStart);
  podRender();
}
