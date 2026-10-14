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

// ---------- Téléchargeur ----------
const QUALITIES = {
  mp4: [["1080", "1080p (Full HD)"], ["720", "720p (HD)"], ["480", "480p"], ["360", "360p"]],
  mp3: [["320", "320 kbps (max)"], ["192", "192 kbps"], ["128", "128 kbps"]],
};
let type = "mp4";
const urlInput = $("url"), qualitySel = $("quality"), status = $("status"), dlBtn = $("dlBtn");

function fillQualities() {
  qualitySel.innerHTML = QUALITIES[type].map(([v, l], i) => `<option value="${v}" ${i === 1 ? "selected" : ""}>${l}</option>`).join("");
}
fillQualities();

document.querySelectorAll(".seg-btn").forEach((b) =>
  b.addEventListener("click", () => {
    type = b.dataset.type;
    document.querySelectorAll(".seg-btn").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-checked", x === b);
    });
    fillQualities();
  })
);

function setStatus(msg, isError = false) {
  status.textContent = msg;
  status.classList.toggle("error", isError);
}

// Aperçu (titre + miniature) quand un lien est collé
let infoTimer;
urlInput.addEventListener("input", () => {
  clearTimeout(infoTimer);
  $("preview").hidden = true;
  const url = urlInput.value.trim();
  if (!url) return setStatus("");
  infoTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok) return setStatus(d.error, true);
      $("thumb").src = d.thumbnail || "";
      $("vtitle").textContent = d.title;
      $("vmeta").textContent = [d.uploader, d.duration ? Math.round(d.duration) + " s" : ""].filter(Boolean).join(" • ");
      $("preview").hidden = false;
      setStatus("");
    } catch { setStatus("Impossible de joindre le serveur.", true); }
  }, 500);
});

dlBtn.addEventListener("click", async () => {
  const url = urlInput.value.trim();
  if (!url) return setStatus("Colle d'abord un lien YouTube ou TikTok.", true);
  dlBtn.disabled = true; dlBtn.classList.add("loading");
  setStatus("Préparation du fichier… ça peut prendre un moment.");
  try {
    const r = await fetch(`/api/download?url=${encodeURIComponent(url)}&type=${type}&quality=${qualitySel.value}`);
    if (!r.ok) throw new Error((await r.json()).error || "Erreur");
    const blob = await r.blob();
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get("Content-Disposition") || "")?.[1];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name ? decodeURIComponent(name) : `clippo.${type}`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("Téléchargé !");
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    dlBtn.disabled = false; dlBtn.classList.remove("loading");
  }
});

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
