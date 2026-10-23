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
const todoBar = $("todoBar"), todoClear = $("todoClear");
const TODO_KEY = "clippo_todos", TODO_MAX = 200;
let todoFilter = "all";
let todos = [];

function todoLoad() {
  try {
    const data = JSON.parse(localStorage.getItem(TODO_KEY) || "[]");
    return Array.isArray(data)
      ? data.filter((t) => t && typeof t.text === "string").slice(0, TODO_MAX).map((t) => ({ id: String(t.id), text: t.text.slice(0, 120), done: !!t.done }))
      : [];
  } catch { return []; }
}
function todoSave() {
  try { localStorage.setItem(TODO_KEY, JSON.stringify(todos)); } catch { /* stockage indisponible */ }
}

function todoStartEdit(li, t) {
  const span = li.querySelector(".todo-text");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "text-in todo-edit";
  input.maxLength = 120;
  input.value = t.text;
  span.replaceWith(input);
  input.focus();
  input.select();
  let finished = false;
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim();
    if (keep && v) t.text = v;
    todoSave();
    todoRender();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function todoRender() {
  const shown = todos.filter((t) => todoFilter === "all" || (todoFilter === "open" ? !t.done : t.done));
  todoList.innerHTML = "";
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "todo-empty";
    li.textContent = todos.length ? "Rien à afficher dans cette liste." : "Aucune tâche pour l'instant. Ajoute-en une !";
    todoList.appendChild(li);
  }
  shown.forEach((t) => {
    const li = document.createElement("li");
    li.className = "todo-item" + (t.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = t.done;
    cb.setAttribute("aria-label", "Terminée : " + t.text);
    cb.addEventListener("change", () => { t.done = cb.checked; todoSave(); todoRender(); });

    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = t.text; // texte brut : rien n'est interprété comme du code

    const edit = document.createElement("button");
    edit.className = "todo-btn";
    edit.type = "button";
    edit.textContent = "✎";
    edit.setAttribute("aria-label", "Modifier : " + t.text);
    edit.addEventListener("click", () => todoStartEdit(li, t));

    const del = document.createElement("button");
    del.className = "todo-btn";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", "Supprimer : " + t.text);
    del.addEventListener("click", () => { todos = todos.filter((x) => x.id !== t.id); todoSave(); todoRender(); });

    li.append(cb, text, edit, del);
    todoList.appendChild(li);
  });

  const done = todos.filter((t) => t.done).length, open = todos.length - done;
  todoCount.textContent = todos.length ? `${open} à faire · ${done} terminée${done > 1 ? "s" : ""}` : "";
  todoBar.style.width = todos.length ? Math.round((done / todos.length) * 100) + "%" : "0%";
  todoClear.hidden = done === 0;
}

function todoAddTask() {
  const text = todoInput.value.trim();
  if (!text) return;
  if (todos.length >= TODO_MAX) { todoInput.value = ""; return; }
  todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: text.slice(0, 120), done: false });
  todoInput.value = "";
  todoSave();
  todoRender();
  todoInput.focus();
}

todoAdd.addEventListener("click", todoAddTask);
todoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") todoAddTask(); });
$("todoFilters").querySelectorAll(".chip").forEach((chip) => chip.addEventListener("click", () => {
  todoFilter = chip.dataset.filter;
  $("todoFilters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  todoRender();
}));
todoClear.addEventListener("click", () => { todos = todos.filter((t) => !t.done); todoSave(); todoRender(); });

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

// ---------- Quiz du cours (scan + quiz, sur l'appareil) ----------
const sqFile = $("sqFile"), sqText = $("sqText"), sqGo = $("sqGo"), sqStatus = $("sqStatus");
const sqSetup = $("sqSetup"), sqRun = $("sqRun"), sqForm = $("sqForm"), sqSubmit = $("sqSubmit"), sqResult = $("sqResult");
const SQ_STOP = new Set("cependant pourtant alors ainsi aussi donc lorsque quand parce comme depuis pendant entre dans cette ces ses leur leurs plusieurs chaque toujours souvent egalement ensuite notamment premier premiere seconde autres certains certaines pouvoir devoir faire avoir etre peut peuvent sont avait etait seront ceux celles".split(" "));
let sqQuestions = [], sqLibReady;

function sqMessage(msg, isError = false) {
  sqStatus.textContent = msg;
  sqStatus.classList.toggle("error", isError);
}
function sqEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function sqNorm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function sqLev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function sqShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// --- Lecture des photos (OCR dans le navigateur) ---
function sqLoadOcr() {
  if (window.Tesseract) return Promise.resolve();
  if (!sqLibReady) {
    sqLibReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = () => { sqLibReady = null; reject(new Error("Impossible de charger le lecteur de texte. Vérifie ta connexion.")); };
      document.head.appendChild(s);
    });
  }
  return sqLibReady;
}
function sqToCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image illisible.")); };
    img.src = url;
  });
}

sqFile.addEventListener("change", async () => {
  const files = Array.from(sqFile.files).filter((f) => f.type.startsWith("image/")).slice(0, 3);
  sqFile.value = "";
  if (!files.length) return;
  sqGo.disabled = true;
  try {
    sqMessage("Chargement du lecteur de texte… (la première fois, ça peut prendre une minute)");
    await sqLoadOcr();
    for (let i = 0; i < files.length; i++) {
      const canvas = await sqToCanvas(files[i]);
      const { data } = await window.Tesseract.recognize(canvas, "fra", {
        logger: (m) => { if (m.status === "recognizing text") sqMessage(`Lecture de la photo ${i + 1}/${files.length}… ${Math.round(m.progress * 100)}%`); },
      });
      sqText.value = (sqText.value.trim() + "\n" + data.text.trim()).trim();
    }
    sqMessage(sqText.value.trim().length < 150
      ? "Peu de texte lu. Essaie une photo plus nette, ou écris ton cours dans la case."
      : "Terminé ! Relis le texte et corrige-le si besoin, puis crée ton quiz.");
  } catch (e) {
    console.error(e);
    sqMessage(e.message || "La lecture de la photo a échoué.", true);
  } finally {
    sqGo.disabled = false;
  }
});

// --- Création du quiz ---
function sqPickKeyword(sentence) {
  const words = (sentence.match(/[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’-]*/g) || []).map((w) => w.replace(/['’-]+$/g, ""));
  let best = null, bestScore = 0;
  words.forEach((w, i) => {
    if (SQ_STOP.has(sqNorm(w))) return;
    const isNum = /\d{2,}/.test(w);
    if (!isNum && w.length < 6) return;
    let score = w.length + (isNum ? 6 : 0) + (i > 0 && /^[A-ZÀ-Ý]/.test(w) ? 4 : 0);
    if (score > bestScore) { best = w; bestScore = score; }
  });
  return best;
}

function sqBuild(text) {
  const sentences = (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]?/g) || [])
    .map((s) => s.trim())
    .filter((s) => { const n = s.split(" ").length; return n >= 6 && n <= 35; });
  const items = [];
  sentences.forEach((s) => { const k = sqPickKeyword(s); if (k) items.push({ sentence: s, answer: k }); });
  const pool = [...new Set(items.map((i) => i.answer))];
  return sqShuffle(items).slice(0, 10).map((it, i) => {
    const blank = it.sentence.split(it.answer).join("_____");
    const dist = pool
      .filter((w) => sqNorm(w) !== sqNorm(it.answer))
      .map((w) => ({ w, k: Math.abs(w.length - it.answer.length) + Math.random() * 3 }))
      .sort((a, b) => a.k - b.k).slice(0, 3).map((x) => x.w);
    if (dist.length < 3 || i % 4 === 3) return { type: "open", blank, answer: it.answer, sentence: it.sentence };
    if (i % 4 === 1) {
      const isTrue = Math.random() < 0.5;
      const shown = isTrue ? it.sentence : it.sentence.split(it.answer).join(dist[0]);
      return { type: "qcm", prompt: "Vrai ou faux ?", blank: shown, answer: isTrue ? "Vrai" : "Faux", sentence: it.sentence, choices: ["Vrai", "Faux"], correct: isTrue ? 0 : 1 };
    }
    const choices = sqShuffle([it.answer, ...dist]);
    return { type: "qcm", blank, answer: it.answer, sentence: it.sentence, choices, correct: choices.indexOf(it.answer) };
  });
}
    
function sqShowQuiz() {
  sqSetup.hidden = true;
  sqRun.hidden = false;
  sqResult.hidden = true;
  sqSubmit.hidden = false;
  sqForm.innerHTML = "";
  sqQuestions.forEach((q, i) => {
    const box = sqEl("div", "qz-q");
    box.appendChild(sqEl("strong", "", `${i + 1}. ${q.prompt || "Complète"} : ${q.blank}`));
    if (q.type === "qcm") {
      q.choices.forEach((c, k) => {
        const lab = sqEl("label", "qz-choice");
        const r = document.createElement("input");
        r.type = "radio"; r.name = "sq" + i; r.value = String(k);
        lab.append(r, sqEl("span", "", c));
        box.appendChild(lab);
      });
    } else {
      const t = document.createElement("input");
      t.type = "text"; t.className = "text-in"; t.name = "sq" + i; t.maxLength = 60;
      t.placeholder = "Écris le mot qui manque…"; t.autocomplete = "off";
      box.appendChild(t);
    }
    sqForm.appendChild(box);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

sqGo.addEventListener("click", () => {
  const text = sqText.value.trim();
  if (text.length < 200) return sqMessage("Le texte est trop court pour faire un quiz (200 caractères minimum).", true);
  sqQuestions = sqBuild(text);
  if (sqQuestions.length < 3) return sqMessage("Je n'ai pas trouvé assez de phrases complètes. Vérifie la ponctuation du texte ou ajoute plus de cours.", true);
  sqMessage("");
  sqShowQuiz();
});

// --- Correction ---
sqSubmit.addEventListener("click", () => {
  const given = sqQuestions.map((q, i) => {
    if (q.type === "qcm") {
      const c = sqForm.querySelector(`input[name="sq${i}"]:checked`);
      return c ? parseInt(c.value, 10) : null;
    }
    return sqForm.querySelector(`input[name="sq${i}"]`).value.trim();
  });
  const ok = sqQuestions.map((q, i) => {
    if (q.type === "qcm") return given[i] === q.correct;
    const n = sqNorm(given[i] || ""), a = sqNorm(q.answer);
    return !!n && (n === a || (a.length >= 5 && sqLev(n, a) <= 1));
  });
  const good = ok.filter(Boolean).length;
  const note = (good / sqQuestions.length) * 20;

    sqResult.innerHTML = "";
  const head = sqEl("div", "qz-score");
  head.append(sqEl("small", "", "Ta note"), sqEl("strong", "", grFmt(note) + " / 20"),
    sqEl("span", "gr-info", `${good} bonne${good > 1 ? "s" : ""} réponse${good > 1 ? "s" : ""} sur ${sqQuestions.length} · ${grMention(note)}`));
  sqResult.appendChild(head);

  const wrong = sqQuestions.filter((_, i) => !ok[i]);
  if (wrong.length) {
    sqResult.appendChild(sqEl("h3", "fc-title", "À revoir dans ton cours"));
    const ul = sqEl("ul", "qz-review");
    wrong.forEach((q) => ul.appendChild(sqEl("li", "", q.sentence)));
    sqResult.appendChild(ul);
  } else {
    sqResult.appendChild(sqEl("p", "", "Bravo, tout est juste ! 🎉"));
  }

  sqResult.appendChild(sqEl("h3", "fc-title", "Correction détaillée"));
  sqQuestions.forEach((q, i) => {
    const box = sqEl("div", "qz-q " + (ok[i] ? "good" : "bad"));
    box.appendChild(sqEl("strong", "", `${ok[i] ? "✅" : "❌"} ${i + 1}. ${q.blank}`));
    const mine = q.type === "qcm" ? (given[i] === null ? "aucune" : q.choices[given[i]]) : (given[i] || "aucune");
    box.appendChild(sqEl("p", "", "Ta réponse : " + mine));
    if (!ok[i]) {
      box.appendChild(sqEl("p", "qz-exp", "Bonne réponse : " + q.answer));
      box.appendChild(sqEl("p", "qz-exp", "Dans ton cours : " + q.sentence));
    }
    sqResult.appendChild(box);
  });

  const row = sqEl("div", "row");
  const again = sqEl("button", "ghost-btn", "Nouveau quiz sur ce cours");
  again.addEventListener("click", () => { sqQuestions = sqBuild(sqText.value); sqShowQuiz(); });
  const fresh = sqEl("button", "ghost-btn", "Nouveau cours");
  fresh.addEventListener("click", () => { sqText.value = ""; sqRun.hidden = true; sqSetup.hidden = false; sqMessage(""); });
  row.append(again, fresh);
  sqResult.appendChild(row);

  sqSubmit.hidden = true;
  sqResult.hidden = false;
  sqResult.scrollIntoView({ behavior: "smooth", block: "start" });
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

// ---------- Fiche de révision (sur l'appareil) ----------
const rvText = $("rvText"), rvFile = $("rvFile"), rvDrop = $("rvDrop"), rvGo = $("rvGo");
const rvSetup = $("rvSetup"), rvOut = $("rvOut"), rvSheet = $("rvSheet"), rvStatus = $("rvStatus"), rvLen = $("rvLen");
const RV_STOP = new Set("alors ainsi aussi autre autres avant avec avoir avait avaient apres beaucoup bien cela celle celles celui cependant certain certaine certains certaines cette chaque comme comment dans depuis donc dont elle elles encore entre etre etait etaient etant fait faire font leur leurs lors lorsque mais meme mieux moins notamment nous pour pourtant plus plusieurs puis quand quel quelle quelles quels sans selon sera seront seulement sont sous tout toute toutes tous tres vers votre vous avons ils ont peut peuvent permet permettent ensuite premier premiere seconde ceux ceci toujours souvent egalement ces ses".split(" "));
const RV_PRON = new Set(["il", "elle", "ils", "elles", "ce", "cela", "ceci", "cette", "ces", "on", "ca", "qui", "que", "mais", "et", "donc"]);
const RV_DEF = /^(.{2,60}?)\s+(est|sont|désigne|désignent|signifie|correspond|correspondent|s'appelle|s’appelle|se définit)\s+(.+)$/i;
let rvData = null;

function rvMessage(msg, isError = false) {
  rvStatus.textContent = msg;
  rvStatus.classList.toggle("error", isError);
}
function rvEl(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function rvNorm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }

// --- Photos (réutilise le lecteur du Quiz du cours) ---
async function rvReadPhotos(list) {
  const files = Array.from(list).filter((f) => f.type.startsWith("image/")).slice(0, 3);
  if (!files.length) return;
  if (typeof sqLoadOcr !== "function") return rvMessage("Le lecteur de photos est indisponible. Colle ton texte à la place.", true);
  rvGo.disabled = true;
  try {
    rvMessage("Chargement du lecteur de texte… (la première fois, ça peut prendre une minute)");
    await sqLoadOcr();
    for (let i = 0; i < files.length; i++) {
      const canvas = await sqToCanvas(files[i]);
      const { data } = await window.Tesseract.recognize(canvas, "fra", {
        logger: (m) => { if (m.status === "recognizing text") rvMessage(`Lecture de la photo ${i + 1}/${files.length}… ${Math.round(m.progress * 100)}%`); },
      });
      rvText.value = (rvText.value.trim() + "\n" + data.text.trim()).trim();
    }
    rvMessage(rvText.value.trim().length < 200
      ? "Peu de texte lu. Essaie une photo plus nette, ou écris ton cours dans la case."
      : "Terminé ! Relis le texte, corrige-le si besoin, puis crée ta fiche.");
  } catch (e) {
    console.error(e);
    rvMessage(e.message || "La lecture de la photo a échoué.", true);
  } finally {
    rvGo.disabled = false;
  }
}
rvFile.addEventListener("change", () => { const f = rvFile.files; rvReadPhotos(f).then(() => { rvFile.value = ""; }); });
["dragenter", "dragover"].forEach((ev) => rvDrop.addEventListener(ev, (e) => { e.preventDefault(); rvDrop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => rvDrop.addEventListener(ev, (e) => { e.preventDefault(); rvDrop.classList.remove("over"); }));
rvDrop.addEventListener("drop", (e) => rvReadPhotos(e.dataTransfer.files));

// --- Analyse du cours ---
function rvSentences(text) {
  const out = [];
  text.split(/\n+/).forEach((line) => {
    line.replace(/\s+/g, " ").trim().split(/(?<=[.!?;])\s+/).forEach((raw) => {
      const s = raw.trim().replace(/^[-•*–·]+\s*/, "").replace(/^\d{1,2}[.)]\s+/, "");
      const n = s.split(" ").length;
      if (n >= 4 && n <= 50) out.push(s);
    });
  });
  return out;
}

function rvAnalyze(text, n) {
  const sents = rvSentences(text);
  if (sents.length < 3) return null;
  const freq = new Map(), show = new Map();
  const info = sents.map((s) => {
    const words = s.match(/[A-Za-zÀ-ÿ0-9]+/g) || [];
    const keys = [];
    words.forEach((w) => {
      const k = rvNorm(w);
      if (k.length < 4 || /^\d+$/.test(k) || RV_STOP.has(k)) return;
      freq.set(k, (freq.get(k) || 0) + 1);
      if (!show.has(k)) show.set(k, w.toLowerCase());
      keys.push(k);
    });
    return { s, keys: [...new Set(keys)], n: words.length };
  });

  const scored = info.map((o, i) => {
    let score = o.keys.reduce((a, k) => a + (freq.get(k) > 1 ? freq.get(k) : 0.3), 0) / Math.sqrt(o.n + 4);
    if (/\d{4}/.test(o.s)) score *= 1.15;
    if (RV_DEF.test(o.s)) score *= 1.2;
    if (i === 0) score *= 1.2;
    return { i, score };
  });
  const picked = scored.slice().sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i);
  const essential = picked.map((p) => sents[p.i]);

  const all = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  let kw = all.filter(([, c]) => c >= 2).slice(0, 12);
  if (kw.length < 4) kw = all.slice(0, 8);
  const keywords = kw.map(([k]) => ({ key: k, label: show.get(k) }));

  const defs = [];
  sents.forEach((s) => {
    const m = RV_DEF.exec(s);
    if (!m) return;
    const term = m[1].trim(), tw = term.split(" ");
    if (term.length < 3 || tw.length > 6 || RV_PRON.has(rvNorm(tw[0])) || /[,;:]/.test(term) || /\b(qui|que|dont)\b/i.test(term)) return;
    if (m[3].split(" ").length < 3) return;
    defs.push({ term, tail: m[2] + " " + m[3] });
  });

  const figures = sents.filter((s) => /\d{2,}/.test(s)).slice(0, 6);
  return { essential, keywords, defs: defs.slice(0, 8), figures, total: sents.length };
}

// --- Affichage ---
function rvMark(parent, text, keys) {
  (text.match(/[A-Za-zÀ-ÿ0-9]+|[^A-Za-zÀ-ÿ0-9]+/g) || []).forEach((part) => {
    if (keys.has(rvNorm(part))) parent.appendChild(rvEl("mark", "", part));
    else parent.appendChild(document.createTextNode(part));
  });
}

function rvRender() {
  const d = rvData, keys = new Set(d.keywords.map((k) => k.key));
  rvSheet.innerHTML = "";
  rvSheet.appendChild(rvEl("h2", "rv-title", "Fiche de révision"));

  rvSheet.appendChild(rvEl("h3", "rv-h", "L'essentiel"));
  const ul = rvEl("ul", "rv-list");
  d.essential.forEach((s) => { const li = rvEl("li"); rvMark(li, s, keys); ul.appendChild(li); });
  rvSheet.appendChild(ul);

  if (d.keywords.length) {
    rvSheet.appendChild(rvEl("h3", "rv-h", "Mots-clés"));
    const chips = rvEl("div", "rv-chips");
    d.keywords.forEach((k) => chips.appendChild(rvEl("span", "rv-chip", k.label)));
    rvSheet.appendChild(chips);
  }
  if (d.defs.length) {
    rvSheet.appendChild(rvEl("h3", "rv-h", "Définitions"));
    const dl = rvEl("ul", "rv-list");
    d.defs.forEach((x) => {
      const li = rvEl("li");
      li.appendChild(rvEl("strong", "", x.term));
      li.appendChild(document.createTextNode(" " + x.tail));
      dl.appendChild(li);
    });
    rvSheet.appendChild(dl);
  }
  if (d.figures.length) {
    rvSheet.appendChild(rvEl("h3", "rv-h", "Dates et chiffres"));
    const fl = rvEl("ul", "rv-list");
    d.figures.forEach((s) => fl.appendChild(rvEl("li", "", s)));
    rvSheet.appendChild(fl);
  }
  rvSheet.appendChild(rvEl("p", "gr-note", `Fiche créée à partir de ${d.total} phrases de ton cours.`));
  $("rvCards").hidden = !d.defs.length || typeof fcSave !== "function";
}

function rvPlain(d) {
  const L = ["FICHE DE RÉVISION", "", "L'ESSENTIEL"];
  d.essential.forEach((s) => L.push("• " + s));
  if (d.keywords.length) L.push("", "MOTS-CLÉS", d.keywords.map((k) => k.label).join(", "));
  if (d.defs.length) { L.push("", "DÉFINITIONS"); d.defs.forEach((x) => L.push("• " + x.term + " " + x.tail)); }
  if (d.figures.length) { L.push("", "DATES ET CHIFFRES"); d.figures.forEach((s) => L.push("• " + s)); }
  return L.join("\n");
}

// --- Boutons ---
rvGo.addEventListener("click", () => {
  const text = rvText.value.trim();
  if (text.length < 200) return rvMessage("Le texte est trop court pour faire une fiche (200 caractères minimum).", true);
  const d = rvAnalyze(text, parseInt(rvLen.value, 10));
  if (!d) return rvMessage("Je n'ai pas trouvé assez de phrases. Vérifie la ponctuation du texte ou ajoute plus de cours.", true);
  rvData = d;
  rvRender();
  rvMessage("");
  rvSetup.hidden = true;
  rvOut.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("rvCopy").addEventListener("click", async () => {
  if (!rvData) return;
  try { await copyText(rvPlain(rvData)); rvMessage("Fiche copiée !"); }
  catch { rvMessage("Copie automatique impossible : sélectionne le texte de la fiche et fais Ctrl + C.", true); }
});
$("rvPrint").addEventListener("click", () => window.print());
$("rvCards").addEventListener("click", () => {
  if (!rvData || typeof fcSave !== "function") return;
  let added = 0;
  rvData.defs.forEach((x) => {
    const q = ("Définis : " + x.term).slice(0, 200);
    if (fcCards.length >= FC_MAX || fcCards.some((c) => c.q === q)) return;
    fcCards.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), q, a: (x.term + " " + x.tail).slice(0, 300), known: false });
    added++;
  });
  fcSave();
  fcRender();
  rvMessage(added ? `${added} flashcard${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""} dans l'outil Flashcards.` : "Ces flashcards existent déjà.");
});
$("rvBack").addEventListener("click", () => { rvOut.hidden = true; rvSetup.hidden = false; rvMessage(""); });
$("rvNew").addEventListener("click", () => { rvText.value = ""; rvData = null; rvOut.hidden = true; rvSetup.hidden = false; rvMessage(""); });

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

// ---------- Accueil : recherche d'outils, défilement, compteur ----------
const homeSearch = $("homeSearch"), homeEmpty = $("homeEmpty");
const hmNorm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function homeFilter() {
  const q = hmNorm(homeSearch.value.trim());
  let total = 0;
  document.querySelectorAll("#home .home-cat").forEach((cat) => {
    let shown = 0;
    cat.querySelectorAll(".tool-card").forEach((card) => {
      const ok = !q || hmNorm(card.textContent).includes(q);
      card.hidden = !ok;
      if (ok) shown++;
    });
    cat.hidden = !shown;
    total += shown;
  });
  homeEmpty.hidden = total > 0;
}

if (homeSearch) {
  homeSearch.addEventListener("input", homeFilter);
  homeSearch.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const visible = [...document.querySelectorAll("#home .tool-card")].filter((c) => !c.hidden);
    if (visible.length === 1) visible[0].click();
    else $("tools").scrollIntoView({ behavior: "smooth" });
  });
  $("homeCount").textContent = document.querySelectorAll("#home .tool-card").length;
}
document.querySelectorAll("[data-scroll]").forEach((b) => b.addEventListener("click", () => {
  const t = document.getElementById(b.dataset.scroll);
  if (t) t.scrollIntoView({ behavior: "smooth" });
}));
