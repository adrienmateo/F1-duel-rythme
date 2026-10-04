
/* ======================= Parcours : accueil « Choisis ton Grand Prix », adresses, chapitres plein écran sur mobile ======================= */
// Adresses : #<lieu>-<année> pour un GP, #<lieu>-<année>/<chapitre> pour un chapitre (mobile).
// Le bouton retour du navigateur ou du téléphone suit toujours le parcours.
const NAV = { home: false, homeWait: [], chap: null, slot: null };
const CHAPTERS = [
  { id: "course", sec: "course", k: "La course" },
  { id: "rythme", sec: "rythme", k: "Le rythme" },
  { id: "duels", sec: "duels", k: "Les duels" },
  { id: "pneus", sec: "strategies", k: "Les pneus" },
  { id: "explorer", sec: "explorer", k: "Explorer" },
];
const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const slugOf = (r) => `${slugify(r.location || r.circuit_short_name || r.country_name)}-${r.year}`;
const parseHash = () => { const [g, c] = decodeURIComponent(location.hash.slice(1)).split("/"); return { g: g || "", c: c || "" }; };
function navGo(hash, replace) { if (location.hash !== hash) history[replace ? "replaceState" : "pushState"](null, "", hash || location.pathname); navRoute(); }
const navGP = (sk, replace) => { const r = RACES.find((x) => x.session_key === +sk); if (r) navGo("#" + slugOf(r), replace); };
// La voiture du haut de page attend que l'accueil soit refermé
const homeClosed = () => (NAV.home ? new Promise((r) => NAV.homeWait.push(r)) : Promise.resolve());

/* --- Accueil --- */
const PAYS = { Australia: "Australie", China: "Chine", Japan: "Japon", Bahrain: "Bahreïn", "Saudi Arabia": "Arabie saoudite", "United States": "États-Unis", Italy: "Italie", Monaco: "Monaco", Spain: "Espagne", Canada: "Canada", Austria: "Autriche", "United Kingdom": "Grande-Bretagne", Hungary: "Hongrie", Belgium: "Belgique", Netherlands: "Pays-Bas", Azerbaijan: "Azerbaïdjan", Singapore: "Singapour", Mexico: "Mexique", Brazil: "Brésil", "United Arab Emirates": "Abu Dhabi", Qatar: "Qatar" };
const paysFr = (r) => (r.country_name === "United States" && r.location && !/austin/i.test(r.location) ? r.location : PAYS[r.country_name] || r.country_name);
const dateFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
function winnerOf(r) {
  if (r.winner) return r.winner;
  const p = store.get(r.session_key); if (!p) return null;
  const w = p.results.find((x) => x.position === 1 && !x.dnf && !x.dns && !x.dsq), d = w && p.drivers.find((x) => x.driver_number === w.driver_number);
  return d ? { code: d.name_acronym, name: d.last_name || d.name_acronym, color: "#" + (d.team_colour || "898781") } : null;
}
function outlineOf(r) {
  if (r.outline) return r.outline;
  try { return JSON.parse(localStorage.getItem(`f1duel:v4:trace:${r.session_key}`)); } catch { return null; }
}
function outlineSvg(pts, w, h, pad, cls) {
  if (!pts || pts.length < 10) return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1)), ox = (w - (x1 - x0) * sc) / 2, oy = (h - (y1 - y0) * sc) / 2;
  const d = "M" + pts.map(([x, y]) => `${(ox + (x - x0) * sc).toFixed(1)},${(h - (oy + (y - y0) * sc)).toFixed(1)}`).join("L") + "Z";
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/></svg>`;
}
function renderHome() {
  const el = $("#home"); if (!el) return;
  $("#home-years").innerHTML = [...$("#year").options].map((o) => `<button data-y="${o.value}" aria-pressed="${o.value === $("#year").value}">${o.value}</button>`).join("");
  $$("#home-years button").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.y === $("#year").value) return;
    $("#year").value = b.dataset.y; $("#home-feat").innerHTML = `<p class="home-empty">Chargement des Grands Prix…</p>`; $("#home-list").innerHTML = "";
    try { await loadRaces(+b.dataset.y); } catch (e) { $("#home-feat").innerHTML = `<p class="home-empty">${esc(e.message)}</p>`; return; }
    renderHome();
  }));
  $("#home-y").textContent = $("#year").value;
  if (!RACES.length) { $("#home-feat").innerHTML = `<p class="home-empty">Aucun Grand Prix disponible pour le moment.</p>`; $("#home-list").innerHTML = ""; return; }
  const list = [...RACES].reverse(), f = list[0], fw = winnerOf(f);
  const round = (r) => "R" + String(RACES.indexOf(r) + 1).padStart(2, "0");
  $("#home-feat").innerHTML = `<button class="hf" data-sk="${f.session_key}">
      <span class="hf-top"><span class="eyebrow">Dernier GP · ${round(f)}</span><span class="mono">${dateFr(f.date_start)}</span></span>
      ${outlineSvg(outlineOf(f), 320, 150, 14, "hf-map")}
      <span class="hf-name">${esc(paysFr(f))}</span>
      ${fw ? `<span class="hf-win"><i style="background:${fw.color}"></i>Vainqueur : <b>${esc(fw.name)}</b></span>` : ""}
      <span class="hf-cta">Voir le GP <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span>
    </button>`;
  $("#home-list").innerHTML = list.slice(1).map((r) => { const w = winnerOf(r); return `<button class="hr" data-sk="${r.session_key}">
      <span class="hr-r">${round(r)}</span><span class="hr-t"><b>${esc(paysFr(r))}</b><small>${dateFr(r.date_start)}${w ? " · " + esc(w.name) : ""}</small></span>${outlineSvg(outlineOf(r), 64, 40, 4, "hr-map")}</button>`; }).join("");
  $$("#home [data-sk]").forEach((b) => b.addEventListener("click", () => navGP(b.dataset.sk)));
}
function showHome(on) {
  NAV.home = on; const el = $("#home");
  document.body.classList.toggle("at-home", on);
  if (on) { renderHome(); el.hidden = false; requestAnimationFrame(() => el.classList.add("on")); el.scrollTop = 0; }
  else { el.classList.remove("on"); setTimeout(() => { if (!NAV.home) el.hidden = true; }, 320); NAV.homeWait.splice(0).forEach((r) => r()); }
}

/* --- Chapitres plein écran (mobile) --- */
function mobileNav() { return MOB(); }
function renderChapterCards() {
  const box = $("#mchaps"); if (!box) return;
  const first = (id) => ($("#" + id)?.textContent || "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0] || "";
  const duels = computeDuels().filter((d) => d.valid);
  const sw = (cols) => `<span class="mc-sw">${cols.slice(0, 4).map((c) => `<i style="background:${c}"></i>`).join("")}</span>`;
  const info = {
    course: [first("read-course"), sw(finishers.slice(0, 3).map((d) => d.color))],
    rythme: [first("read-rythme"), sw(paced.slice(0, 3).map((d) => d.color))],
    duels: [first("read-duels"), sw(duels.slice(0, 3).map((d) => d.color))],
    pneus: [first("read-strat"), `<span class="mc-sw">${["S", "M", "H"].map((c) => `<i style="background:${COMP[c].c}"></i>`).join("")}</span>`],
    explorer: ["Compare jusqu'à 4 pilotes : temps au tour, écart en piste.", sw(finishers.slice(0, 2).map((d) => d.color))],
  };
  box.innerHTML = `<div class="mc-title">Comprendre la course</div>` + CHAPTERS.map((c) => {
    const h2 = $(`#${c.sec} h2`)?.textContent || c.k, [txt, prev] = info[c.id];
    return `<button class="mc" data-ch="${c.id}"><span class="mc-txt"><span class="mc-k">${c.k}</span><b>${esc(h2)}</b><small>${esc(txt)}</small></span>${prev}<svg class="mc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></button>`;
  }).join("");
  $$("#mchaps .mc").forEach((b) => b.addEventListener("click", () => { const { g } = parseHash(); navGo(`#${g}/${b.dataset.ch}`); }));
}
function openChapter(id) {
  const c = CHAPTERS.find((x) => x.id === id); if (!c) return closeChapter();
  const ov = $("#mchap"), body = $("#mchap-body");
  if (NAV.chap !== id) {
    putBack();
    const sec = $("#" + c.sec); if (!sec) return;
    NAV.slot = document.createComment("chapitre"); sec.before(NAV.slot); body.appendChild(sec); NAV.chap = id;
    sec.classList.add("in");
    const i = CHAPTERS.indexOf(c), nx = CHAPTERS[(i + 1) % CHAPTERS.length];
    $("#mchap-next").innerHTML = `<span><small>Chapitre suivant</small><b>${nx.k}</b></span><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg>`;
    $("#mchap-next").onclick = () => { const { g } = parseHash(); navGo(`#${g}/${nx.id}`, true); };
    $("#mchap-title").textContent = RACE ? `${RACE.country_name} ${RACE.year}` : "";
    ov.scrollTop = 0;
  }
  ov.hidden = false; document.body.classList.add("in-chap");
  requestAnimationFrame(() => ov.classList.add("on"));
  setTimeout(() => {
    Object.values(charts).forEach((ch) => { if (ch.el && body.contains(ch.el)) { if (ch.inst) ch.inst.resize(); else if (ch.el.offsetParent) draw(ch.el.id); } });
    $$(".mswipe", body).forEach((w) => w._refit && w._refit()); placeIndicators(); placeCursor();
  }, 380);
}
function putBack() { if (NAV.chap && NAV.slot) { const c = CHAPTERS.find((x) => x.id === NAV.chap), sec = $("#" + c.sec); NAV.slot.replaceWith(sec); } NAV.chap = null; NAV.slot = null; }
function closeChapter() {
  const ov = $("#mchap"); if (!ov || ov.hidden) return;
  ov.classList.remove("on"); document.body.classList.remove("in-chap");
  setTimeout(() => { if (!ov.classList.contains("on")) { ov.hidden = true; putBack(); stopReplay(); } }, 360);
}

/* --- Routeur --- */
let navLoading = null;
async function navRoute() {
  const { g, c } = parseHash();
  if (!g) { closeChapter(); showHome(true); return; }
  let r = RACES.find((x) => slugOf(x) === g);
  if (!r) { // GP d'une autre saison : on charge sa liste
    const y = +(g.match(/-(\d{4})$/) || [])[1];
    if (y && y !== +$("#year").value && [...$("#year").options].some((o) => +o.value === y)) { $("#year").value = y; try { await loadRaces(y); } catch {} r = RACES.find((x) => slugOf(x) === g); }
  }
  if (!r) { navGo("", true); return; }
  showHome(false);
  if ($("#gp").value !== String(r.session_key) || !RACE || RACE.session_key !== r.session_key) {
    $("#gp").value = r.session_key;
    if (!(navLoading && navLoading.sk === r.session_key)) { navLoading = { sk: r.session_key, p: loadGP(r.session_key) }; navLoading.p.finally(() => { if (navLoading?.sk === r.session_key) navLoading = null; }); }
  }
  if (c && mobileNav()) openChapter(c);
  else { closeChapter(); if (c) { const ch = CHAPTERS.find((x) => x.id === c); ch && $("#" + ch.sec)?.scrollIntoView({ behavior: "smooth" }); } }
}
addEventListener("popstate", navRoute);
$("#mchap-back").addEventListener("click", () => { const { g } = parseHash(); if (history.length > 1) history.back(); else navGo("#" + g); });
$$(".brand").forEach((b) => { b.style.cursor = "pointer"; b.addEventListener("click", () => navGo("")); });
// Glisser depuis le bord gauche pour revenir (comme une app)
(() => {
  const ov = $("#mchap"); let sx = null, sy = 0;
  ov.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t.clientX < 30) { sx = t.clientX; sy = t.clientY; } }, { passive: true });
  ov.addEventListener("touchmove", (e) => { if (sx == null) return; const t = e.touches[0], dx = t.clientX - sx; if (dx > 0 && Math.abs(t.clientY - sy) < 70) ov.style.transform = `translateX(${dx}px)`; }, { passive: true });
  ov.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; ov.style.transform = ""; sx = null; if (dx > 90) $("#mchap-back").click(); });
})();
