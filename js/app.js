// ---------- storage helpers (work when opened locally; fail quietly otherwise)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
let notes = store.get("schools-notes", {});       // id -> { level, text }
const home = HOME.latlng; // fixed home — see HOME in data/schools.js
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

// campus c = [lat, lng, addr, phone, placeId]; candidates have no Google placeId → search by address
const gmaps = (s, c) => c[4]
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name)}&query_place_id=${c[4]}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name.split(" — ")[0] + ", " + c[2] + ", София")}`;
const isCand = s => s.src === "found";
const isMain = s => s.src === "state" && s.zone === "прилежащо";
const candTag = s => isCand(s) ? `<span class="cand-tag" title="Не е в списъка от SOFIA SCHOOL EXPO — намерено при търсене">Кандидат</span>`
  : s.src === "state" ? `<span class="state-tag${isMain(s) ? " main" : ""}" title="Общинско училище за адреса на дома (ИСОДЗ)">${isMain(s) ? "Прилежащо" : "Гранично"}</span>` : "";
// Colour = category (not district): private with interest / прилежащо / гранично / others.
// The colours themselves live in CSS (--cat-*). Shape = source: teardrop expo, outlined candidate, square municipal.
const INTEREST = ["★ Силен интерес", "Може би"]; // same strings as LEVELS[1], LEVELS[2]
const CATS = {
  fav:    { label: "Частни с интерес",    z: 600 },
  main:   { label: "Прилежащо общинско",  z: 700 },
  border: { label: "Гранично прилежащи",  z: 400 },
  other:  { label: "Други",               z: 0 }
};
const catOf = s => s.src === "state" ? (isMain(s) ? "main" : "border")
  : INTEREST.includes(notes[s.id]?.level) ? "fav" : "other";
const colorOf = s => `var(--cat-${catOf(s)})`;
const isStar = s => notes[s.id]?.level === INTEREST[0];
const pinCls = s => (isCand(s) ? " cand" : s.src === "state" ? " state" : "") +
  (catOf(s) === "other" ? " dim" : "") + (isStar(s) ? " star" : "");
const badge = (s, cls = "num") => `<span class="${cls}${pinCls(s)}" style="--c:${colorOf(s)}">${s.id}</span>`;
const pinIcon = s => L.divIcon({
  className: "", iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26],
  html: `<div class="pin${pinCls(s)}" style="--c:${colorOf(s)}"><span>${s.id}</span></div>`
});

const markers = {}; // id -> [marker]
SCHOOLS.forEach(s => {
  markers[s.id] = s.campuses.map(c => {
    const [lat, lng, addr, phone] = c;
    const m = L.marker([lat, lng], { icon: pinIcon(s), title: s.name, zIndexOffset: CATS[catOf(s)].z }).addTo(map);
    m.bindPopup(`<h3>${s.id}. ${esc(s.name)} ${candTag(s)}</h3><p>${addr}</p>${phone ? `<p>${phone}</p>` : ""}
      ${s.note ? `<p class="note">${s.note}</p>` : ""}${s.flag ? `<p class="flag">${s.flag}</p>` : ""}
      <p><a href="${gmaps(s, c)}" target="_blank" rel="noopener">Google Maps</a>${s.web ? ` · <a href="${s.web}" target="_blank" rel="noopener">Сайт</a>` : ""}</p>`);
    m.on("click", () => selectRow(s.id, false));
    return m;
  });
});

const allLatLngs = SCHOOLS.flatMap(s => s.campuses.map(c => [c[0], c[1]]));
const fitAll = () => { map.invalidateSize(); map.fitBounds(allLatLngs, { padding: [30, 30] }); };
fitAll();
// If the map had no size when first fitted (background window, etc.), Leaflet zooms to max —
// refit once the container gets a real size. Only the first time, so the user's view survives tab switches.
let needsFit = map.getSize().x === 0 || map.getSize().y === 0;
new ResizeObserver(([e]) => {
  if (!e.contentRect.width || !e.contentRect.height) return;
  if (needsFit) { needsFit = false; fitAll(); }
}).observe(document.getElementById("map"));

// ---------- home point & distances
const homeIcon = () => L.divIcon({ className: "", html: '<div class="home-pin">🏠</div>', iconSize: [28, 28], iconAnchor: [14, 24] });
function drawHome() {
  L.marker(home, { icon: homeIcon(), zIndexOffset: 1000, title: "Дом" })
    .bindPopup(`<h3>🏠 Дом</h3><p>${HOME.label}</p>`).addTo(map);
}
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
  b.textContent = a.label;
  b.onclick = () => {
    active.has(k) ? active.delete(k) : active.add(k);
    b.setAttribute("aria-pressed", active.has(k)); renderList();
  };
  chips.appendChild(b);
});
// Source filter: expo list vs. candidates found by search; plus "hide rejected"
const activeSrc = new Set(store.get("schools-src2", Object.keys(SOURCES)));
let hideNo = store.get("schools-hide-no", false);
const srcChips = document.getElementById("srcChips");
Object.entries(SOURCES).forEach(([k, src]) => {
  const b = document.createElement("button");
  const n = SCHOOLS.filter(s => s.src === k).length;
  b.className = "chip"; b.setAttribute("aria-pressed", activeSrc.has(k));
  b.innerHTML = `<span class="dot src-${k}"></span>${src.label} <span class="cnt">${n}</span>`;
  b.onclick = () => {
    activeSrc.has(k) ? activeSrc.delete(k) : activeSrc.add(k);
    b.setAttribute("aria-pressed", activeSrc.has(k)); store.set("schools-src2", [...activeSrc]); renderList();
  };
  srcChips.appendChild(b);
});
const noBtn = document.createElement("button");
noBtn.className = "chip"; noBtn.setAttribute("aria-pressed", hideNo);
noBtn.textContent = "Скрий „Не ни пасва“";
noBtn.onclick = () => { hideNo = !hideNo; noBtn.setAttribute("aria-pressed", hideNo); store.set("schools-hide-no", hideNo); renderList(); };
srcChips.appendChild(noBtn);

const q = document.getElementById("q");
q.addEventListener("input", renderList);

const listEl = document.getElementById("list");
function renderList() {
  const term = q.value.trim().toLowerCase();
  let rows = SCHOOLS.filter(s => active.has(s.area) && activeSrc.has(s.src) &&
    !(hideNo && notes[s.id]?.level === LEVELS[3]) &&
    (!term || (s.name + " " + s.hood + " " + (s.note || "") + " " + s.campuses.map(c => c[2]).join(" ")).toLowerCase().includes(term)));
  if (home) rows = rows.slice().sort((a, b) => (km(a) ?? 1e9) - (km(b) ?? 1e9));

  SCHOOLS.forEach(s => {
    const show = rows.includes(s);
    markers[s.id].forEach(m => {
      // Re-colour: the category depends on the interest level, which can change in other tabs.
      m.setIcon(pinIcon(s)); m.setZIndexOffset(CATS[catOf(s)].z);
      show ? m.addTo(map) : m.remove();
    });
  });
  document.getElementById("legend").innerHTML = Object.entries(CATS).map(([k, c]) =>
    `<span><i class="sw" style="background:var(--cat-${k})"></i>${c.label} <span class="cnt">${SCHOOLS.filter(s => catOf(s) === k).length}</span></span>`
  ).join("") + `<span><i class="sw ring"></i>★ силен интерес</span>`;

  listEl.innerHTML = rows.map(s => {
    const d = km(s);
    const addr = s.campuses.length ? s.campuses.map(c => c[2]).join("<br>") : "Няма намерен адрес";
    return `<li data-id="${s.id}" class="${s.campuses.length ? "" : "nomap"}">
      ${s.campuses.length ? badge(s) : `<span class="num hollow">${s.id}</span>`}
      <div><div class="name">${s.name} ${candTag(s)}</div><div class="addr">${s.hood} · ${addr}</div>${s.note && s.src !== "expo" ? `<div class="note">${s.note}</div>` : ""}${s.flag ? `<div class="flag">${s.flag}</div>` : ""}</div>
      <span class="dist">${d != null ? d.toFixed(1) + " км" : ""}</span></li>`;
  }).join("") || `<li class="nomap"><span></span><div class="addr">Няма училища по този филтър. Включи още райони и източници или изчисти търсенето.</div></li>`;

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
      <td><strong>${s.name}</strong> ${candTag(s)}${s.note ? `<div class="note">${s.note}</div>` : ""}${s.flag ? `<div class="flag">${s.flag}</div>` : ""}${s.web ? `<div class="addr"><a href="${s.web}" target="_blank" rel="noopener">Сайт</a></div>` : ""}</td>
      <td>${AREAS[s.area].label}<div class="addr">${s.hood}</div></td>
      <td>${s.campuses.map(c => `<a href="${gmaps(s, c)}" target="_blank" rel="noopener">${c[2]}</a>`).join("<br>") || "—"}</td>
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
    return f === "all" || (f === "nofit" && lvl !== LEVELS[3]) || (f === "star" && lvl === LEVELS[1]) ||
      (f === "expo" && s.src === "expo") || (f === "found" && s.src === "found");
  });
  document.getElementById("cmpBody").innerHTML = rows.map(s => {
    const d = details[s.id] || {};
    return `<tr>
      <td>${badge(s)}</td>
      <td><strong>${s.name}</strong> ${candTag(s)}<div class="addr">${s.hood}</div></td>
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
askSchool.innerHTML = Object.entries(SOURCES).map(([k, src]) => `<optgroup label="${src.label}">${
  SCHOOLS.filter(s => s.src === k).map(s => `<option value="${s.id}">${s.id}. ${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
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
const BACKUP_KEYS = ["schools-notes", "schools-details", "schools-custom-qs"];
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

// ---------- picks tab: schools marked "★ Силен интерес" or "Може би"
let picksMap = null, picksLayer = null, picksPts = [];
const fitPicks = () => picksPts.length
  ? picksMap.fitBounds(picksPts, { padding: [36, 36], maxZoom: 14 }) : picksMap.setView([42.67, 23.32], 11);
const picksList = document.getElementById("picksList"), picksCount = document.getElementById("picksCount");
function renderPicks() {
  const rank = l => l === LEVELS[1] ? 0 : 1;
  const picks = SCHOOLS.filter(s => [LEVELS[1], LEVELS[2]].includes(notes[s.id]?.level))
    .sort((a, b) => rank(notes[a.id].level) - rank(notes[b.id].level) || (km(a) ?? 1e9) - (km(b) ?? 1e9) || a.id - b.id);
  const stars = picks.filter(s => notes[s.id].level === LEVELS[1]).length;
  picksCount.textContent = picks.length
    ? `${stars} със силен интерес · ${picks.length - stars} „може би“" · подредени по разстояние от дома"`
    : "";

  // Municipal schools for the home address (from ИСОДЗ): main one + border ones, nearest first.
  const st = SCHOOLS.filter(s => s.src === "state").sort((a, b) => isMain(b) - isMain(a) || km(a) - km(b));
  document.getElementById("stateBox").innerHTML = `
    <h3>Общинско училище по адреса <span class="hint">— ${HOME.label}, по ИСОДЗ</span></h3>
    <ul>${st.map(s => `<li class="${isMain(s) ? "main" : ""}">${badge(s)}
      <span><strong>${s.name}</strong> ${candTag(s)}<span class="addr"> · ${s.campuses[0][2]} · ${km(s).toFixed(1)} км</span></span></li>`).join("")}</ul>
    <p class="hint">При прием в общинско училище прилежащото дава първа група (адресът да не е сменян 3+ години).
      Граничните дават по-нисък приоритет. Проверено на kg.sofia.bg, 10.10.2026.</p>`;

  // Map with just the picks (+ home). Created on first show — Leaflet needs a visible container.
  if (!picksMap) {
    picksMap = L.map("picksMap", { scrollWheelZoom: false });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Подложка &copy; Esri, &copy; OpenStreetMap"
    }).addTo(picksMap);
    picksLayer = L.layerGroup().addTo(picksMap);
    // Refit when the map box changes size (tab shown, phone rotated, window resized).
    new ResizeObserver(([e]) => { if (e.contentRect.width) { picksMap.invalidateSize(); fitPicks(); } })
      .observe(document.getElementById("picksMap"));
  }
  picksMap.invalidateSize();
  picksLayer.clearLayers();
  const pts = picksPts = [];
  picks.forEach(s => s.campuses.forEach(c => {
    L.marker([c[0], c[1]], { title: s.name, zIndexOffset: CATS[catOf(s)].z + (isStar(s) ? 50 : 0), icon: pinIcon(s) }).bindPopup(`<h3>${s.id}. ${esc(s.name)}</h3><p>${c[2]}</p>`)
      .on("click", () => document.getElementById("pick-" + s.id)?.scrollIntoView({ behavior: "smooth", block: "center" }))
      .addTo(picksLayer);
    pts.push([c[0], c[1]]);
  }));
  L.marker(home, { zIndexOffset: 1000, icon: homeIcon() }).addTo(picksLayer);
  pts.push(home);
  st.filter(isMain).forEach(s => s.campuses.forEach(c => {
    L.marker([c[0], c[1]], { title: s.name, icon: pinIcon(s) })
      .bindPopup(`<h3>${esc(s.name)}</h3><p>Прилежащо общинско училище · ${c[2]}</p>`).addTo(picksLayer);
    pts.push([c[0], c[1]]);
  }));
  fitPicks();

  picksList.innerHTML = picks.map(s => {
    const n = notes[s.id], d = details[s.id] || {}, dist = km(s);
    const filled = FIELDS.filter(f => (d[f.key] || "").trim());
    return `<article class="pick ${n.level === LEVELS[1] ? "is-star" : ""}" id="pick-${s.id}">
      <header>
        ${badge(s)}
        <div class="pick-title"><h3>${s.name} ${candTag(s)}</h3>
          <div class="addr">${AREAS[s.area].label} · ${s.hood}${dist != null ? ` · <strong>${dist.toFixed(1)} км</strong> от дома` : ""}</div></div>
        <select data-id="${s.id}" data-f="level" aria-label="Интерес">${LEVELS.map(l => `<option value="${l}" ${n.level === l ? "selected" : ""}>${l || "—"}</option>`).join("")}</select>
      </header>
      <div class="pick-body">
        <div>
          ${s.campuses.map(c => `<div><a href="${gmaps(s, c)}" target="_blank" rel="noopener">${c[2]}</a>${c[3] ? ` · <a href="tel:${c[3].replace(/\s/g, "")}">${c[3]}</a>` : ""}</div>`).join("") || `<div class="addr">Няма адрес</div>`}
          ${s.web ? `<div><a href="${s.web}" target="_blank" rel="noopener">Сайт на училището</a></div>` : ""}
          ${s.note ? `<div class="note">${s.note}</div>` : ""}${s.flag ? `<div class="flag">${s.flag}</div>` : ""}
        </div>
        <dl class="facts">${filled.length
          ? filled.map(f => `<dt>${f.label}</dt><dd>${esc(d[f.key])}</dd>`).join("")
          : `<dd class="addr">Още няма отговори от въпросите.</dd>`}</dl>
      </div>
      <textarea data-id="${s.id}" data-f="text" placeholder="Бележки: такса, впечатления…">${esc(n.text)}</textarea>
      <button class="to-ask" data-ask="${s.id}">Въпроси за конференцията →</button>
    </article>`;
  }).join("") || `<p class="empty">Още няма избрани училища. Задай „★ Силен интерес“ или „Може би“ в таб „Таблица и бележки“ или от картата.</p>`;

  picksList.querySelectorAll("textarea[data-id]").forEach(el =>
    el.addEventListener("input", () => setNote(el.dataset.id, "text", el.value)));
  picksList.querySelectorAll("select[data-id]").forEach(el => el.addEventListener("change", () => {
    setNote(el.dataset.id, "level", el.value); renderPicks();
  }));
  picksList.querySelectorAll("[data-ask]").forEach(b => b.addEventListener("click", () => {
    askSchool.value = b.dataset.ask; store.set("schools-ask-current", +b.dataset.ask);
    document.querySelector('nav.tabs [data-tab="ask"]').click();
  }));
}

// ---------- tabs
document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("nav.tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + b.dataset.tab));
  if (b.dataset.tab === "map") setTimeout(() => { map.invalidateSize(); renderList(); }, 0);
  if (b.dataset.tab === "picks") setTimeout(renderPicks, 0);
  if (b.dataset.tab === "table") renderTable();
  if (b.dataset.tab === "compare") renderCompare();
  if (b.dataset.tab === "ask") renderAsk();
}));

drawHome(); renderList(); renderTable();
