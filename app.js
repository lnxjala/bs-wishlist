// ---------- INICIALIZAR FIREBASE ----------
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// El loader tiene una animación CSS de 5.2s que muestra family1 -> family2.
// LOADER_MIN_MS se ajusta para que alcance a verse esa transición completa
// al menos una vez, sin importar qué tan rápido responda Firebase.
const LOADER_MIN_MS = 3000;
const LOADER_MAX_MS = 6000; // seguro: si algo tarda o falla, igual se revela la página
const loaderStart = Date.now();
let eventLoaded = false;
let giftsLoaded = false;

function hideLoaderNow() {
  document.getElementById("loader-overlay")?.classList.add("hide");
}

function maybeHideLoader() {
  if (!(eventLoaded && giftsLoaded)) return;
  const wait = Math.max(0, LOADER_MIN_MS - (Date.now() - loaderStart));
  setTimeout(hideLoaderNow, wait);
}

setTimeout(hideLoaderNow, LOADER_MAX_MS);

const ICONS = {
  cuna: "🛏️", panales: "🧷", ropa: "👕",
  bano: "🛁", juguete: "🧸", otro: "🎁"
};

let currentGiftId = null;
let giftsCache = [];
let countdownTarget = null;
let countdownInterval = null;
let giftFilter = "disponibles";
let isClaimSubmitting = false; // evita doble reserva por doble clic

// ---------- HELPERS DE MODAL ----------
function openModal(id) { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }

document.querySelectorAll("[data-close]").forEach(btn => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-backdrop").forEach(bd => {
  bd.addEventListener("click", e => { if (e.target === bd) bd.classList.remove("open"); });
});

// ---------- UTIL ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function normalizeImageUrl(raw) {
  let url = (raw ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    if (/^\/\//.test(url)) url = "https:" + url;
    else url = "https://" + url;
  }
  const imgur = url.match(/imgur\.com\/(?:gallery\/|a\/)?([A-Za-z0-9]+)/i);
  if (imgur && !url.includes("i.imgur.com")) {
    url = `https://i.imgur.com/${imgur[1]}.jpg`;
  }
  return url;
}

function proxyImageUrl(url) {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=600&h=450&fit=cover&we`;
}

function isGiftComplete(gift) {
  return (gift.reservado || 0) >= (gift.cantidadNecesaria || 1);
}

function filterGifts(gifts) {
  if (giftFilter === "disponibles") return gifts.filter(g => !isGiftComplete(g));
  if (giftFilter === "completados") return gifts.filter(g => isGiftComplete(g));
  return gifts;
}

function updateFilterCounts(gifts) {
  const disponibles = gifts.filter(g => !isGiftComplete(g)).length;
  const completados = gifts.filter(g => isGiftComplete(g)).length;
  const btns = document.querySelectorAll(".filter-btn");
  btns.forEach(btn => {
    const f = btn.dataset.filter;
    let label = btn.dataset.label || btn.textContent.split(" (")[0];
    btn.dataset.label = label;
    if (f === "disponibles") btn.textContent = `${label} (${disponibles})`;
    else if (f === "completados") btn.textContent = `${label} (${completados})`;
    else btn.textContent = `${label} (${gifts.length})`;
  });
}

function isValidImageUrl(url) {
  if (!url) return false;
  if (url.startsWith("data:image/")) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getGiftImageUrl(gift) {
  const raw = gift.imagenUrl || gift.imageUrl || gift.imagen || "";
  return normalizeImageUrl(String(raw).trim());
}

function resetGiftForm() {
  document.getElementById("gift-form").reset();
  document.getElementById("gift-qty").value = "1";
  document.getElementById("gift-category").value = "cuna";
  document.getElementById("gift-image").value = "";
  document.getElementById("image-preview-wrap").hidden = true;
  document.getElementById("image-preview-box").replaceChildren();
  document.getElementById("upload-status").textContent = "";
  document.getElementById("upload-status").className = "upload-status";
}

function normalizeMapsUrl(raw) {
  const url = (raw ?? "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return "https://" + url;
}

function isValidMapsUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function loadImageWithFallback(img, wrap, url, icon) {
  img.referrerPolicy = "no-referrer";
  img.src = url;
  img.addEventListener("error", () => {
    if (img.dataset.retried) {
      wrap.replaceChildren();
      const span = document.createElement("span");
      span.className = "gift-image-placeholder";
      span.textContent = icon;
      wrap.appendChild(span);
      return;
    }
    img.dataset.retried = "1";
    img.referrerPolicy = "no-referrer";
    img.src = proxyImageUrl(url);
  });
}

function createGiftImageElement(gift) {
  const wrap = document.createElement("div");
  wrap.className = "gift-image-wrap";
  const icon = ICONS[gift.categoria] || "🎁";
  const url = getGiftImageUrl(gift);

  if (isValidImageUrl(url)) {
    const img = document.createElement("img");
    img.alt = gift.nombre || "";
    img.loading = "lazy";
    img.decoding = "async";
    loadImageWithFallback(img, wrap, url, icon);
    wrap.appendChild(img);
  } else {
    const span = document.createElement("span");
    span.className = "gift-image-placeholder";
    span.textContent = icon;
    wrap.appendChild(span);
  }
  return wrap;
}

function createGiftCardElement(gift) {
  const reservado = gift.reservado || 0;
  const necesario = gift.cantidadNecesaria || 1;
  const pct = Math.min(100, Math.round((reservado / necesario) * 100));
  const lleno = isGiftComplete(gift);

  const card = document.createElement("div");
  card.className = `gift-card${lleno ? " gift-card--complete" : ""}`;
  card.appendChild(createGiftImageElement(gift));

  const name = document.createElement("h3");
  name.className = "gift-name";
  name.textContent = gift.nombre || "";
  card.appendChild(name);

  if (gift.nota) {
    const note = document.createElement("p");
    note.className = "gift-note";
    note.textContent = gift.nota;
    card.appendChild(note);
  }

  if (necesario > 1) {
    const bar = document.createElement("div");
    bar.className = "gift-progress-bar";
    const fill = document.createElement("div");
    fill.className = `gift-progress-fill${lleno ? " full" : ""}`;
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }

  const status = document.createElement("p");
  status.className = "gift-status";
  if (necesario > 1) status.textContent = `${reservado}/${necesario}`;
  else status.textContent = lleno ? "Completo" : "Disponible";
  card.appendChild(status);

  const btn = document.createElement("button");
  if (lleno) {
    btn.className = "btn-full";
    btn.disabled = true;
    btn.textContent = "Completo";
  } else {
    btn.className = "btn-primary";
    btn.textContent = "Reservar";
    btn.dataset.claim = gift.id;
    if (isClaimSubmitting) btn.disabled = true;
  }
  card.appendChild(btn);
  return card;
}

function updateImagePreview() {
  const wrap = document.getElementById("image-preview-wrap");
  const box = document.getElementById("image-preview-box");
  const raw = document.getElementById("gift-image").value;
  const url = normalizeImageUrl(raw);

  if (!url) {
    wrap.hidden = true;
    box.replaceChildren();
    return;
  }

  wrap.hidden = false;
  if (!isValidImageUrl(url)) {
    box.innerHTML = `<span class="preview-error">URL no válida. Debe empezar con https://</span>`;
    return;
  }

  box.replaceChildren();
  const img = document.createElement("img");
  img.alt = "Vista previa";
  img.addEventListener("error", () => {
    if (img.dataset.retried) {
      box.innerHTML = `<span class="preview-error">No carga directo, pero se guardará igual. Prueba subir la foto a <a href="https://postimages.org/es/" target="_blank" rel="noopener">postimages.org</a> y pega el link directo.</span>`;
      return;
    }
    img.dataset.retried = "1";
    img.referrerPolicy = "no-referrer";
    img.src = proxyImageUrl(url);
  });
  img.referrerPolicy = "no-referrer";
  img.src = url;
  box.appendChild(img);
}

document.getElementById("gift-image").addEventListener("input", updateImagePreview);

// ---------- PANEL ADMIN: acordeón (solo una sección abierta) ----------
function initAdminAccordion() {
  const blocks = document.querySelectorAll("#admin-modal .admin-block");
  blocks.forEach(block => {
    block.addEventListener("toggle", () => {
      if (!block.open) return;
      blocks.forEach(other => {
        if (other !== block) other.open = false;
      });
    });
  });
}
initAdminAccordion();

// ---------- FILTROS DE REGALOS ----------
document.getElementById("gifts-filters").addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  giftFilter = btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderGifts(giftsCache);
});

// ---------- MÚSICA ----------
function initMusic() {
  const audio = document.getElementById("bg-music");
  const toggle = document.getElementById("music-toggle");
  if (!audio || !toggle || typeof MUSIC_FILE === "undefined" || !MUSIC_FILE) return;

  audio.src = MUSIC_FILE;

  audio.addEventListener("canplaythrough", () => { toggle.hidden = false; });
  audio.addEventListener("error", () => { toggle.hidden = true; });

  toggle.addEventListener("click", async () => {
    const playIcon = toggle.querySelector(".music-icon-play");
    const pauseIcon = toggle.querySelector(".music-icon-pause");
    if (audio.paused) {
      try {
        await audio.play();
        toggle.classList.add("playing");
        playIcon.hidden = true;
        pauseIcon.hidden = false;
        toggle.setAttribute("aria-label", "Pausar música");
      } catch {
        /* el navegador bloqueó autoplay */
      }
    } else {
      audio.pause();
      toggle.classList.remove("playing");
      playIcon.hidden = false;
      pauseIcon.hidden = true;
      toggle.setAttribute("aria-label", "Reproducir música");
    }
  });
}
initMusic();

// ---------- COUNTDOWN ----------
function pad(n) { return String(n).padStart(2, "0"); }

function startCountdown(targetDate) {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownTarget = targetDate;

  const countdownEl = document.getElementById("countdown");
  const doneEl = document.getElementById("countdown-done");
  if (!countdownEl || !doneEl) return;

  if (!targetDate || isNaN(targetDate.getTime())) {
    countdownEl.hidden = true;
    doneEl.hidden = true;
    return;
  }

  function tick() {
    const now = Date.now();
    const diff = countdownTarget.getTime() - now;

    if (diff <= 0) {
      countdownEl.hidden = true;
      doneEl.hidden = false;
      clearInterval(countdownInterval);
      return;
    }

    countdownEl.hidden = false;
    doneEl.hidden = true;

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    document.getElementById("cd-days").textContent = pad(days);
    document.getElementById("cd-hours").textContent = pad(hours);
    document.getElementById("cd-mins").textContent = pad(mins);
    document.getElementById("cd-secs").textContent = pad(secs);
  }

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function parseEventDateFromText(fecha, hora) {
  if (!fecha) return null;

  const months = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11
  };

  const m = fecha.toLowerCase().match(/(\d{1,2})\s+de\s+(\w+),?\s*(\d{4})/);
  if (m && months[m[2]] !== undefined) {
    let hours = 12;
    let mins = 0;
    if (hora) {
      const tm = hora.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (tm) {
        hours = parseInt(tm[1], 10);
        mins = parseInt(tm[2] || "0", 10);
        const ampm = (tm[3] || "").toLowerCase();
        if (ampm === "pm" && hours < 12) hours += 12;
        if (ampm === "am" && hours === 12) hours = 0;
      }
    }
    return new Date(parseInt(m[3], 10), months[m[2]], parseInt(m[1], 10), hours, mins);
  }

  const d = new Date(`${fecha} ${hora || ""}`.trim());
  return isNaN(d.getTime()) ? null : d;
}

function parseEventDate(data) {
  if (data.fechaEvento) {
    const raw = data.fechaEvento;
    if (raw && typeof raw.toDate === "function") return raw.toDate();
    if (raw && typeof raw.seconds === "number") return new Date(raw.seconds * 1000);
    if (typeof raw === "number") return new Date(raw);
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
  }
  return parseEventDateFromText(data.fecha, data.hora);
}

function toDatetimeLocalValue(date) {
  if (!date || isNaN(date.getTime())) return "";
  const pad2 = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// ---------- EVENTO (datos generales) ----------
db.collection("event").doc("info").onSnapshot(doc => {
  eventLoaded = true; maybeHideLoader();
  const data = doc.exists ? doc.data() : {};

  try {
    document.getElementById("event-title").textContent = data.titulo || "Dino Baby";
    document.getElementById("event-message").textContent =
      data.mensaje || "Un pequeño dinosaurio está en camino";

    const facts = [];
    if (data.fecha) facts.push(`📅 ${data.fecha}`);
    if (data.hora) facts.push(`🕓 ${data.hora}`);
    if (data.lugar) facts.push(`📍 ${data.lugar}`);
    document.getElementById("event-facts").innerHTML =
      facts.map(f => `<span class="event-fact">${escapeHtml(f)}</span>`).join("");

    const mapsUrl = normalizeMapsUrl(data.mapsUrl || "");
    const mapsWrap = document.getElementById("event-maps");
    const mapsLink = document.getElementById("event-maps-link");

    if (mapsUrl && isValidMapsUrl(mapsUrl)) {
      mapsWrap.hidden = false;
      mapsLink.href = mapsUrl;
    } else {
      mapsWrap.hidden = true;
      mapsLink.href = "#";
    }

    document.getElementById("event-title-input").value = data.titulo || "";
    document.getElementById("event-message-input").value = data.mensaje || "";
    document.getElementById("event-date-input").value = data.fecha || "";
    document.getElementById("event-time-input").value = data.hora || "";
    document.getElementById("event-place-input").value = data.lugar || "";
    document.getElementById("event-maps-input").value = data.mapsUrl || "";
  } catch (err) {
    console.error("Error actualizando datos del evento:", err);
  }

  const eventDate = parseEventDate(data);
  const datetimeInput = document.getElementById("event-datetime-input");
  if (datetimeInput) datetimeInput.value = toDatetimeLocalValue(eventDate);
  startCountdown(eventDate);
}, err => {
  eventLoaded = true; maybeHideLoader();
  console.error("Error leyendo evento:", err);
});

// ---------- REGALOS (tiempo real) ----------
db.collection("gifts").where("activo", "!=", false)
  .onSnapshot(snap => {
    giftsLoaded = true; maybeHideLoader();
    const gifts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    giftsCache = gifts;
    renderGifts(gifts);
    renderGrowth(gifts);
    if (document.getElementById("admin-modal").classList.contains("open")) {
      renderAdminList(gifts);
    }
  }, err => {
    giftsLoaded = true; maybeHideLoader();
    document.getElementById("gifts-grid").innerHTML =
      `<p class="empty-text">No se pudo conectar a la base de datos. Revisa firebase-config.js.</p>`;
    console.error(err);
  });

function renderGifts(gifts) {
  const grid = document.getElementById("gifts-grid");
  const filtersEl = document.getElementById("gifts-filters");

  if (!gifts.length) {
    grid.innerHTML = `<p class="empty-text">Aún no hay regalos en la lista. ¡El organizador puede agregar los primeros!</p>`;
    filtersEl.hidden = true;
    return;
  }

  filtersEl.hidden = false;
  updateFilterCounts(gifts);

  const filtered = filterGifts(gifts);

  if (!filtered.length) {
    const msg = giftFilter === "disponibles"
      ? "¡Todos los regalos ya están completos! 🎉"
      : giftFilter === "completados"
        ? "Aún no hay regalos completados."
        : "No hay regalos para mostrar.";
    grid.innerHTML = `<p class="empty-text">${msg}</p>`;
    return;
  }

  grid.replaceChildren();
  filtered.forEach(gift => grid.appendChild(createGiftCardElement(gift)));

  grid.querySelectorAll("[data-claim]").forEach(btn => {
    btn.addEventListener("click", () => openClaimModal(btn.dataset.claim));
  });
}

function renderGrowth(gifts) {
  const total = gifts.length;
  const completos = gifts.filter(g => (g.reservado || 0) >= (g.cantidadNecesaria || 1)).length;

  document.getElementById("growth-count").textContent = `${completos} de ${total}`;
  const pct = total ? completos / total : 0;
  const x2 = 10 + pct * 620;
  document.getElementById("growth-fill").setAttribute("x2", x2.toFixed(1));
}

// ---------- RESERVAR REGALO ----------
function openClaimModal(giftId) {
  if (isClaimSubmitting) return;
  const gift = giftsCache.find(g => g.id === giftId);
  if (!gift) return;
  currentGiftId = giftId;

  document.getElementById("claim-modal-title").textContent = `Reservar: ${gift.nombre}`;
  const restante = (gift.cantidadNecesaria || 1) - (gift.reservado || 0);
  document.getElementById("claim-modal-sub").textContent =
    gift.cantidadNecesaria > 1 ? `Quedan ${restante} por reservar.` : "";

  const qtyWrap = document.getElementById("claim-qty-wrap");
  const qtyInput = document.getElementById("claim-qty");
  if (gift.cantidadNecesaria > 1) {
    qtyWrap.style.display = "flex";
    qtyInput.max = restante;
    qtyInput.value = 1;
  } else {
    qtyWrap.style.display = "none";
  }

  document.getElementById("claim-error").textContent = "";
  document.getElementById("claim-form").reset();
  openModal("claim-modal");
}

document.getElementById("claim-form").addEventListener("submit", async e => {
  e.preventDefault();
  if (isClaimSubmitting) return;
  isClaimSubmitting = true;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Reservando…";

  const nombre = document.getElementById("claim-name").value.trim();
  const cantidad = parseInt(document.getElementById("claim-qty").value || "1", 10);
  const errorEl = document.getElementById("claim-error");
  errorEl.textContent = "";

  if (!nombre) {
    isClaimSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
    return;
  }

  try {
    await db.runTransaction(async tx => {
      const giftRef = db.collection("gifts").doc(currentGiftId);
      const giftDoc = await tx.get(giftRef);
      if (!giftDoc.exists) throw new Error("Este regalo ya no existe.");

      const necesario = giftDoc.data().cantidadNecesaria || 1;
      const reservadoActual = giftDoc.data().reservado || 0;
      const cantidadFinal = necesario > 1 ? cantidad : 1;

      if (reservadoActual + cantidadFinal > necesario) {
        throw new Error("Ese regalo ya no tiene cupo disponible. Otra persona se te adelantó, elige otro 💚");
      }

      tx.update(giftRef, { reservado: reservadoActual + cantidadFinal });

      const reservaRef = giftRef.collection("reservas").doc();
      tx.set(reservaRef, {
        nombreInvitado: nombre,
        cantidad: cantidadFinal,
        fecha: firebase.firestore.FieldValue.serverTimestamp()
      });
    });

    closeModal("claim-modal");
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo completar la reserva, intenta de nuevo.";
  } finally {
    isClaimSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = originalBtnText;
    renderGifts(giftsCache);
  }
});

// ---------- ADMIN: PIN ----------
document.getElementById("admin-toggle").addEventListener("click", () => {
  document.getElementById("pin-input").value = "";
  document.getElementById("pin-error").textContent = "";
  openModal("pin-modal");
});

document.getElementById("pin-form").addEventListener("submit", e => {
  e.preventDefault();
  const pin = document.getElementById("pin-input").value.trim();
  if (pin === ADMIN_PIN) {
    closeModal("pin-modal");
    openModal("admin-modal");
    renderAdminList(giftsCache);
  } else {
    document.getElementById("pin-error").textContent = "PIN incorrecto.";
  }
});

// ---------- ADMIN: AGREGAR REGALO ----------
document.getElementById("gift-form").addEventListener("submit", async e => {
  e.preventDefault();
  const nombre = document.getElementById("gift-name").value.trim();
  const categoria = document.getElementById("gift-category").value;
  const cantidadNecesaria = Math.max(1, parseInt(document.getElementById("gift-qty").value || "1", 10) || 1);
  const nota = document.getElementById("gift-note").value.trim();
  const rawImage = document.getElementById("gift-image").value.trim();
  const uploadStatus = document.getElementById("upload-status");
  const submitBtn = e.target.querySelector('button[type="submit"]');
  const errorEl = document.getElementById("admin-error");

  if (!nombre) return;
  if (submitBtn.disabled) return;

  let imagenUrl = "";
  if (rawImage) {
    imagenUrl = normalizeImageUrl(rawImage);
    if (!isValidImageUrl(imagenUrl)) {
      errorEl.textContent = "La URL de imagen no es válida. Debe empezar con http:// o https://";
      return;
    }
  }

  try {
    submitBtn.disabled = true;
    errorEl.textContent = "";
    uploadStatus.textContent = "Guardando regalo…";
    uploadStatus.className = "upload-status";

    const giftData = {
      nombre, categoria, cantidadNecesaria,
      reservado: 0,
      activo: true,
      creado: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (nota) giftData.nota = nota;
    if (imagenUrl) giftData.imagenUrl = imagenUrl;

    await db.collection("gifts").add(giftData);

    resetGiftForm();
    uploadStatus.textContent = "¡Regalo agregado correctamente! ✓";
    uploadStatus.className = "upload-status upload-status-ok";

    giftFilter = "todos";
    document.querySelectorAll(".filter-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.filter === "todos");
    });
  } catch (err) {
    console.error(err);
    uploadStatus.textContent = "";
    uploadStatus.className = "upload-status";
    errorEl.textContent = `No se pudo agregar el regalo: ${err.message || "Intenta de nuevo."}`;
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- ADMIN: EDITAR EVENTO ----------
document.getElementById("event-form").addEventListener("submit", async e => {
  e.preventDefault();
  const errorEl = document.getElementById("admin-error");

  const datetimeVal = document.getElementById("event-datetime-input").value;
  const fechaTexto = document.getElementById("event-date-input").value.trim();
  const horaTexto = document.getElementById("event-time-input").value.trim();
  const eventData = {
    titulo: document.getElementById("event-title-input").value.trim(),
    mensaje: document.getElementById("event-message-input").value.trim(),
    fecha: fechaTexto,
    hora: horaTexto,
    lugar: document.getElementById("event-place-input").value.trim(),
    mapsUrl: normalizeMapsUrl(document.getElementById("event-maps-input").value.trim())
  };

  if (datetimeVal) {
    eventData.fechaEvento = new Date(datetimeVal).toISOString();
  } else {
    const fromText = parseEventDateFromText(fechaTexto, horaTexto);
    if (fromText) eventData.fechaEvento = fromText.toISOString();
  }

  try {
    await db.collection("event").doc("info").set(eventData, { merge: true });
    errorEl.textContent = "";
  } catch (err) {
    errorEl.textContent = "No se pudieron guardar los datos del evento.";
    console.error(err);
  }
});

// ---------- ADMIN: LISTA CON NOMBRES ----------
async function renderAdminList(gifts) {
  const el = document.getElementById("admin-gift-list");
  if (!gifts.length) {
    el.innerHTML = `<p style="color:var(--ink-soft); font-size:0.85rem;">No hay regalos todavía.</p>`;
    return;
  }
  el.innerHTML = `<p style="color:var(--ink-soft); font-size:0.85rem;">Cargando reservas…</p>`;

  const rows = await Promise.all(gifts.map(async g => {
    const reservasSnap = await db.collection("gifts").doc(g.id).collection("reservas").get();
    const nombres = reservasSnap.docs.map(r => {
      const d = r.data();
      return d.cantidad > 1 ? `${d.nombreInvitado} (×${d.cantidad})` : d.nombreInvitado;
    });
    return { gift: g, nombres };
  }));

  el.replaceChildren();

  rows.forEach(({ gift, nombres }) => {
    const row = document.createElement("div");
    row.className = "admin-gift-row";

    const top = document.createElement("div");
    top.className = "admin-gift-row-top";

    const info = document.createElement("span");
    info.className = "admin-gift-row-info";

    const thumbWrap = document.createElement("span");
    thumbWrap.className = "admin-gift-thumb";
    const thumbUrl = getGiftImageUrl(gift);
    if (isValidImageUrl(thumbUrl)) {
      const thumbImg = document.createElement("img");
      thumbImg.referrerPolicy = "no-referrer";
      thumbImg.alt = "";
      loadImageWithFallback(thumbImg, thumbWrap, thumbUrl, ICONS[gift.categoria] || "🎁");
      thumbWrap.appendChild(thumbImg);
    } else {
      thumbWrap.classList.add("admin-gift-thumb--empty");
      thumbWrap.textContent = ICONS[gift.categoria] || "🎁";
    }

    info.appendChild(thumbWrap);
    info.append(` ${gift.nombre} — ${gift.reservado || 0}/${gift.cantidadNecesaria || 1}`);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn-remove";
    removeBtn.dataset.remove = gift.id;
    removeBtn.textContent = "Quitar";

    top.append(info, removeBtn);
    row.appendChild(top);

    const reservas = document.createElement("div");
    reservas.className = "admin-gift-reservas";
    if (nombres.length) {
      nombres.forEach(n => {
        const line = document.createElement("div");
        line.textContent = `• ${n}`;
        reservas.appendChild(line);
      });
    } else {
      reservas.textContent = "Nadie ha reservado aún.";
    }
    row.appendChild(reservas);
    el.appendChild(row);
  });

  el.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Quitar este regalo de la lista?")) return;
      try {
        await db.collection("gifts").doc(btn.dataset.remove).update({ activo: false });
      } catch (err) {
        document.getElementById("admin-error").textContent = "No se pudo quitar el regalo.";
        console.error(err);
      }
    });
  });
}
