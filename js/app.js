// ---------- storage helpers (work when opened locally; fail quietly otherwise)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let notes = store.get("schools-notes", {});       // id -> { level, text }
let home = store.get("schools-home", null);
let details = store.get("schools-details", {});   // id -> { fee, langs, …, q0…, c<id> }
let customQs = store.get("schools-custom-qs", []); // [{ id, text }]
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function setDetail(id, key, val) {
  details[id] = details[id] || {}; details[id][key] = val; store.set("schools-details", details);
}
function setNote(id, key, val) {
  notes[id] = notes[id] || {}; notes[id][key] = val; store.set("schools-notes", notes);
}

// ---------- map
const map = L.map("map", { zoomControl: true }).setView([42.67, 23.32], 12);
// Esri tiles work without an API key, even when the page is opened as a local file
// (CARTO and OSM tiles refuse requests without a key / Referer).
L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: 'Подложка &copy; Esri, HERE, Garmin, &copy; OpenStreetMap | Местоположения: Google Maps'
}).addTo(map);

const gmaps = (name, pid) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=${pid}`;

const markers = {}; // id -> [marker]
SCHOOLS.forEach(s => {
  markers[s.id] = s.campuses.map(([lat, lng, addr, phone, pid]) => {
    const icon = L.divIcon({
      className: "", iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26],
      html: `<div class="pin" style="background:${AREAS[s.area].hex}"><span>${s.id}</span></div>`
    });
    const m = L.marker([lat, lng], { icon, title: s.name }).addTo(map);
    m.bindPopup(`<h3>${s.id}. ${s.name}</h3><p>${addr}</p>${phone ? `<p>${phone}</p>` : ""}
      <p><a href="${gmaps(s.name, pid)}" target="_blank" rel="noopener">Отвори в Google Maps</a></p>`);
    m.on("click", () => selectRow(s.id, false));
    return m;
  });
});

const allLatLngs = SCHOOLS.flatMap(s => s.campuses.map(c => [c[0], c[1]]));
const fitAll = () => { map.invalidateSize(); map.fitBounds(allLatLngs, { padding: [30, 30] }); };
fitAll();
// The container may have no size yet on first run (fonts/CSS still loading) — refit once laid out.
window.addEventListener("load", fitAll);

// ---------- home point & distances
let homeMarker = null, arming = false;
const homeBtn = document.getElementById("homeBtn"), homeHint = document.getElementById("homeHint");
function drawHome() {
  if (homeMarker) homeMarker.remove();
  if (!home) { homeHint.textContent = "Кликни на картата, за да видиш разстоянията"; return; }
  homeMarker = L.marker(home, { icon: L.divIcon({ className: "", html: '<div class="home-pin">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 24] }), zIndexOffset: 1000 }).addTo(map);
  homeHint.textContent = "Разстояния по права линия от дома";
  homeBtn.textContent = "Премести дома";
}
homeBtn.addEventListener("click", () => {
  arming = !arming; homeBtn.classList.toggle("armed", arming);
  homeHint.textContent = arming ? "Кликни върху мястото на картата" : (home ? "Разстояния по права линия от дома" : "Кликни на картата, за да видиш разстоянията");
});
map.on("click", e => {
  if (!arming) return;
  home = [e.latlng.lat, e.latlng.lng]; store.set("schools-home", home);
  arming = false; homeBtn.classList.remove("armed"); drawHome(); renderList();
});
function km(s) {
  if (!home || !s.campuses.length) return null;
  return Math.min(...s.campuses.map(c => map.distance(home, [c[0], c[1]]))) / 1000;
}

// ---------- filters & list
const active = new Set(Object.keys(AREAS));
const chips = document.getElementById("chips");
Object.entries(AREAS).forEach(([k, a]) => {
  const b = document.createElement("button");
  b.className = "chip"; b.setAttribute("aria-pressed", "true");
  b.innerHTML = `<span class="dot" style="background:${a.color}"></span>${a.label}`;
  b.onclick = () => {
    active.has(k) ? active.delete(k) : active.add(k);
    b.setAttribute("aria-pressed", active.has(k)); renderList();
  };
  chips.appendChild(b);
});
const q = document.getElementById("q");
q.addEventListener("input", renderList);

const listEl = document.getElementById("list");
function renderList() {
  const term = q.value.trim().toLowerCase();
  let rows = SCHOOLS.filter(s => active.has(s.area) &&
    (!term || (s.name + " " + s.hood + " " + s.campuses.map(c => c[2]).join(" ")).toLowerCase().includes(term)));
  if (home) rows = rows.slice().sort((a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9));

  SCHOOLS.forEach(s => {
    const show = rows.includes(s);
    markers[s.id].forEach(m => show ? m.addTo(map) : m.remove());
  });

  listEl.innerHTML = rows.map(s => {
    const d = km(s);
    const addr = s.campuses.length ? s.campuses.map(c => c[2]).join("<br>") : "Няма намерен адрес";
    return `<li data-id="${s.id}" class="${s.campuses.length ? "" : "nomap"}">
      <span class="num ${s.campuses.length ? "" : "hollow"}" style="background:${AREAS[s.area].hex}">${s.id}</span>
      <div><div class="name">${s.name}</div><div class="addr">${s.hood} · ${addr}</div>${s.flag ? `<div class="flag">${s.flag}</div>` : ""}</div>
      <span class="dist">${d != null ? d.toFixed(1) + " км" : ""}</span></li>`;
  }).join("") || `<li class="nomap"><span></span><div class="addr">Няма училища по този филтър. Включи още райони или изчисти търсенето.</div></li>`;

  listEl.querySelectorAll("li[data-id]").forEach(li =>
    li.addEventListener("click", () => selectRow(+li.dataset.id, true)));
}
function selectRow(id, fly) {
  listEl.querySelectorAll("li").forEach(li => li.classList.toggle("sel", +li.dataset.id === id));
  const ms = markers[id];
  if (!ms || !ms.length) return;
  if (fly) {
    if (ms.length === 1) map.flyTo(ms[0].getLatLng(), 15, { duration: .6 });
    else map.flyToBounds(L.latLngBounds(ms.map(m => m.getLatLng())), { padding: [60, 60], duration: .6 });
    ms[0].openPopup();
  } else {
    listEl.querySelector(`li[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// ---------- table tab
const LEVELS = ["", "★ Силен интерес", "Може би", "Не ни пасва"];
function renderTable() {
  document.getElementById("tbody").innerHTML = SCHOOLS.map(s => {
    const n = notes[s.id] || {};
    return `<tr>
      <td>${s.id}</td>
      <td><strong>${s.name}</strong>${s.flag ? `<div class="flag">${s.flag}</div>` : ""}</td>
      <td>${AREAS[s.area].label}<div class="addr">${s.hood}</div></td>
      <td>${s.campuses.map(c => `<a href="${gmaps(s.name, c[4])}" target="_blank" rel="noopener">${c[2]}</a>`).join("<br>") || "—"}</td>
      <td>${s.campuses.map(c => c[3]).filter(Boolean).join("<br>") || "—"}</td>
      <td><select data-id="${s.id}" data-f="level">${LEVELS.map(l => `<option ${n.level === l ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td><textarea data-id="${s.id}" data-f="text" placeholder="Такса, часове, впечатления…">${esc(n.text)}</textarea></td>
    </tr>`;
  }).join("");
  document.querySelectorAll("#tbody [data-id]").forEach(el =>
    el.addEventListener("input", () => setNote(el.dataset.id, el.dataset.f, el.value)));
}

// ---------- compare tab
const cmpFilter = document.getElementById("cmpFilter");
cmpFilter.value = store.get("schools-cmp-filter", "all");
cmpFilter.addEventListener("change", () => { store.set("schools-cmp-filter", cmpFilter.value); renderCompare(); });
document.getElementById("cmpHead").innerHTML =
  `<tr><th>#</th><th>Училище</th><th>Интерес</th>${FIELDS.map(f => `<th>${f.label}</th>`).join("")}</tr>`;
function renderCompare() {
  const f = cmpFilter.value;
  const rows = SCHOOLS.filter(s => {
    const lvl = notes[s.id]?.level || "";
    return f === "all" || (f === "nofit" && lvl !== LEVELS[3]) || (f === "star" && lvl === LEVELS[1]);
  });
  document.getElementById("cmpBody").innerHTML = rows.map(s => {
    const d = details[s.id] || {};
    return `<tr>
      <td><span class="num" style="background:${AREAS[s.area].hex}">${s.id}</span></td>
      <td><strong>${s.name}</strong><div class="addr">${s.hood}</div></td>
      <td class="lvl">${notes[s.id]?.level || "—"}</td>
      ${FIELDS.map(fl => `<td><textarea data-id="${s.id}" data-k="${fl.key}" placeholder="${esc(fl.ph)}">${esc(d[fl.key])}</textarea></td>`).join("")}
    </tr>`;
  }).join("") || `<tr><td colspan="${FIELDS.length + 3}" class="addr">Няма училища с тази оценка. Задай интерес в таб „Таблица и бележки“ или избери „всички училища“.</td></tr>`;
  document.querySelectorAll("#cmpBody textarea").forEach(el =>
    el.addEventListener("input", () => setDetail(el.dataset.id, el.dataset.k, el.value)));
}

// ---------- questions tab (one school at a time — for use at the conference)
const askSchool = document.getElementById("askSchool"), askLevel = document.getElementById("askLevel");
const askList = document.getElementById("askList"), askProgress = document.getElementById("askProgress");
askSchool.innerHTML = SCHOOLS.map(s => `<option value="${s.id}">${s.id}. ${esc(s.name)}</option>`).join("");
askLevel.innerHTML = LEVELS.map(l => `<option value="${l}">${l || "Интерес: —"}</option>`).join("");
askSchool.value = store.get("schools-ask-current", 1);
function allQuestions() {
  return [
    ...FIELDS.map(f => ({ key: f.key, text: f.q, tag: f.label })),
    ...QUESTIONS.map((t, i) => ({ key: "q" + i, text: t })),
    ...customQs.map(c => ({ key: "c" + c.id, text: c.text, custom: c.id }))
  ];
}
function updateProgress() {
  const d = details[askSchool.value] || {}, qs = allQuestions();
  askProgress.textContent = `Отговорени: ${qs.filter(q => (d[q.key] || "").trim()).length} от ${qs.length}`;
}
function renderAsk() {
  const id = askSchool.value, d = details[id] || {}, s = SCHOOLS.find(x => x.id === +id);
  askLevel.value = notes[id]?.level || "";
  askList.innerHTML = (s.flag ? `<p class="flag">${s.flag}</p>` : "") + allQuestions().map(q => `
    <div class="q ${(d[q.key] || "").trim() ? "done" : ""}">
      <div class="q-head"><label for="a-${q.key}">${esc(q.text)}${q.tag ? ` <span class="tag">→ ${q.tag}</span>` : ""}</label>
      ${q.custom ? `<button class="del" data-del="${q.custom}" title="Изтрий въпроса за всички училища">Изтрий</button>` : ""}</div>
      <textarea id="a-${q.key}" data-k="${q.key}" placeholder="Отговор…">${esc(d[q.key])}</textarea>
    </div>`).join("");
  askList.querySelectorAll("textarea").forEach(el => el.addEventListener("input", () => {
    setDetail(id, el.dataset.k, el.value);
    el.closest(".q").classList.toggle("done", !!el.value.trim()); updateProgress();
  }));
  askList.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("Да изтрия ли този въпрос за всички училища?")) return;
    customQs = customQs.filter(c => c.id !== +b.dataset.del); store.set("schools-custom-qs", customQs); renderAsk();
  }));
  updateProgress();
}
function stepSchool(dir) {
  const i = SCHOOLS.findIndex(x => x.id === +askSchool.value);
  askSchool.value = SCHOOLS[(i + dir + SCHOOLS.length) % SCHOOLS.length].id;
  store.set("schools-ask-current", +askSchool.value); renderAsk();
}
askSchool.addEventListener("change", () => { store.set("schools-ask-current", +askSchool.value); renderAsk(); });
document.getElementById("askPrev").addEventListener("click", () => stepSchool(-1));
document.getElementById("askNext").addEventListener("click", () => stepSchool(1));
askLevel.addEventListener("change", () => setNote(askSchool.value, "level", askLevel.value));
document.getElementById("addQ").addEventListener("submit", e => {
  e.preventDefault();
  const inp = document.getElementById("addQText"), text = inp.value.trim();
  if (!text) return;
  customQs.push({ id: Date.now(), text }); store.set("schools-custom-qs", customQs);
  inp.value = ""; renderAsk();
});

// ---------- backup (localStorage lives in one browser only)
const BACKUP_KEYS = ["schools-notes", "schools-home", "schools-details", "schools-custom-qs"];
document.getElementById("exportBtn").addEventListener("click", () => {
  const data = { app: "sofia-schools", saved: new Date().toISOString() };
  BACKUP_KEYS.forEach(k => data[k] = store.get(k, null));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = `училища-бележки-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "sofia-schools") throw new Error("wrong file");
    if (!confirm(`Да заменя ли текущите бележки с копието от ${(data.saved || "").slice(0, 10)}?`)) return;
    BACKUP_KEYS.forEach(k => { if (data[k] != null) store.set(k, data[k]); });
    location.reload();
  } catch { alert("Файлът не е копие от тази страница."); }
});

// ---------- tabs
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + b.dataset.tab));
  if (b.dataset.tab === "map") setTimeout(() => map.invalidateSize(), 0);
  if (b.dataset.tab === "table") renderTable();
  if (b.dataset.tab === "compare") renderCompare();
  if (b.dataset.tab === "ask") renderAsk();
}));

drawHome(); renderList(); renderTable();
