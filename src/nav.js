
/* ======================= Parcours : accueil « Choisis ton Grand Prix », adresses, chapitres plein écran sur mobile ======================= */
// Adresses : #<lieu>-<année> pour un GP, #<lieu>-<année>/<chapitre> pour un chapitre (mobile).
// Le bouton retour du navigateur ou du téléphone suit toujours le parcours.
const NAV = { home: false, homeWait: [], chap: null, slot: null, pushed: false };
const CHAPTERS = [
  { id: "moments", sec: "moments", k: "Les moments" },
  { id: "course", sec: "course", k: "La course" },
  { id: "duels", sec: "duels", k: "Les duels" },
  { id: "pneus", sec: "strategies", k: "Stratégies" },
  { id: "explorer", sec: "explorer", k: "Explorer" },
];
const slugify = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const slugOf = (r) => `${slugify(r.location || r.circuit_short_name || r.country_name)}-${r.year}`;
const parseHash = () => { const [g, c] = decodeURIComponent(location.hash.slice(1)).split("/"); return { g: g || "", c: c || "" }; };
function navGo(hash, replace) { if (NAV.chap && hash.includes("/") && location.hash.includes("/")) replace = true; // un seul chapitre dans l'historique
  if (location.hash !== hash) { history[replace ? "replaceState" : "pushState"](null, "", hash || location.pathname); if (!replace) NAV.pushed = hash.includes("/"); } navRoute(); }
const navGP = (sk, replace) => { const r = RACES.find((x) => x.session_key === +sk); if (r) navGo("#" + slugOf(r), replace); };
// La voiture du haut de page attend que l'accueil soit refermé
const homeClosed = () => (NAV.home ? new Promise((r) => NAV.homeWait.push(r)) : Promise.resolve());

/* --- Accueil --- */
const PAYS = { Australia: "Australie", China: "Chine", Japan: "Japon", Bahrain: "Bahreïn", "Saudi Arabia": "Arabie saoudite", "United States": "États-Unis", Italy: "Italie", Monaco: "Monaco", Spain: "Espagne", Canada: "Canada", Austria: "Autriche", "United Kingdom": "Grande-Bretagne", Hungary: "Hongrie", Belgium: "Belgique", Netherlands: "Pays-Bas", Azerbaijan: "Azerbaïdjan", Singapore: "Singapour", Mexico: "Mexique", Brazil: "Brésil", "United Arab Emirates": "Abu Dhabi", Qatar: "Qatar" };
// Lieux qui ne sont pas dans le pays annoncé par OpenF1 (course de remplacement mal étiquetée)
const LIEU_PAYS = { "Kuala Lumpur": "Malaisie", Sepang: "Malaisie", Imola: "Émilie-Romagne", "Portimão": "Portugal", Istanbul: "Turquie", Mugello: "Toscane", "Nürburg": "Eifel" };
const VILLES = { "Monte Carlo": "Monaco", "Mexico City": "Mexico", "São Paulo": "São Paulo", "Spa-Francorchamps": "Spa", "Miami Gardens": "Miami", "Marina Bay": "Singapour", "Yas Marina": "Abou Dabi", Barcelona: "Barcelone", Montréal: "Montréal" };
const villeFr = (r) => VILLES[r.location] || r.location || "";
const paysFr = (r) => LIEU_PAYS[r.location] || (r.country_name === "United States" && r.location && !/austin/i.test(r.location) ? villeFr(r) : PAYS[r.country_name] || r.country_name);
// Nom affiché d'un GP : pays en français, plus la ville quand le pays a deux courses dans l'année
function gpName(r) {
  const p = paysFr(r), twin = RACES.some((x) => x.session_key !== r.session_key && x.year === r.year && paysFr(x) === p);
  return twin && r.location ? `${p} · ${villeFr(r)}` : p;
}
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
  // Aucun résultat sur l'accueil (pas de spoiler) : le vainqueur se découvre sur la page du GP
  const list = [...RACES].reverse(), f = list[0];
  const round = (r) => "R" + String(RACES.indexOf(r) + 1).padStart(2, "0");
  // La saison : une case par GP (pleine = couru, rouge = le dernier, vide = à venir) et le prochain GP
  const season = (SEASON.length ? SEASON : RACES).filter((r) => r.year === f.year);
  const all = [...new Map([...season, ...RACES].map((r) => [r.session_key, r])).values()].sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const next = all.find((r) => new Date(r.date_start) > new Date() && !RACES.includes(r));
  const days = next ? Math.ceil((new Date(next.date_start) - Date.now()) / 864e5) : 0;
  $("#home-season").innerHTML = `<div class="hs-dots">${all.map((r) => { const done = RACES.includes(r), last = r === f, t = `${done ? round(r) + " · " : ""}${gpName(r)} · ${dateFr(r.date_start)}${done ? "" : " · à venir"}`;
      return done ? `<button class="hs-dot on${last ? " last" : ""}" data-sk="${r.session_key}" title="${esc(t)}" aria-label="${esc(t)}"></button>` : `<span class="hs-dot" title="${esc(t)}"></span>`; }).join("")}</div>
    <div class="hs-txt"><span><b>${RACES.length}</b> GP courus sur ${all.length}</span>${next ? `<span>Prochain : <b>${esc(gpName(next))}</b> · ${dateFr(next.date_start)}${days <= 14 ? ` · ${days <= 1 ? "demain" : `dans ${days} jours`}` : ""}</span>` : ""}</div>`;
  const ol = outlineOf(f) || [];
  $("#home-mark").innerHTML = ol.length >= 10 ? outlineSvg(ol, 260, 130, 8, "hm-map") : "";
  $("#home-feat").innerHTML = `<button class="hf" data-sk="${f.session_key}">
      <span class="hf-top"><span class="eyebrow">Dernier GP · ${round(f)}</span><span class="mono">${dateFr(f.date_start)}</span></span>
      ${ol.length >= 10 ? outlineSvg(ol, 320, 150, 14, "hf-map") : ""}
      <span class="hf-name">${esc(gpName(f))}</span>
      <span class="hf-sub">${esc(villeFr(f))}<small>Le résultat est sur la page du GP</small></span>
      <span class="hf-cta">Voir le GP <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span>
    </button>`;
  $("#home-list").innerHTML = list.slice(1).map((r) => `<button class="hr" data-sk="${r.session_key}">
      <span class="hr-r">${round(r)}</span><span class="hr-t"><b>${esc(gpName(r))}</b><small>${dateFr(r.date_start)}</small></span>${outlineSvg(outlineOf(r), 64, 40, 4, "hr-map")}</button>`).join("");
  $$("#home [data-sk]").forEach((b) => b.addEventListener("click", () => navGP(b.dataset.sk)));
}
function showHome(on) {
  NAV.home = on; const el = $("#home");
  document.body.classList.toggle("at-home", on);
  if (on) { renderHome(); el.hidden = false; requestAnimationFrame(() => el.classList.add("on")); el.scrollTop = 0; homeX(); }
  else { el.classList.remove("on"); setTimeout(() => { if (!NAV.home) el.hidden = true; }, 320); NAV.homeWait.splice(0).forEach((r) => r()); }
}

/* --- Chapitres : sommaire en cartes, chapitre ouvert en plein écran (mobile) ou en grand panneau (ordinateur) --- */
function mobileNav() { return true; }
// Petit aperçu dessiné à partir des données de la course, pour la carte du chapitre (ordinateur)
function chapPreview(id) {
  const W = id === "course" ? 300 : 520, H = 92, svg = (inner) => `<svg class="mc-prev" viewBox="0 0 ${W} ${H}" preserveAspectRatio="${id === "course" ? "none" : "xMinYMid meet"}" aria-hidden="true">${inner}</svg>`;
  const t = (x, y, txt, cls = "pv-t", anchor = "start") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}" dominant-baseline="middle">${esc(txt)}</text>`;
  try {
    if (id === "moments") {
      if (!MOMENTS.length) return "";
      const X = (lap) => 12 + ((lap ?? LAPS) - 1) / Math.max(1, LAPS - 1) * (W - 24);
      return svg(`<line x1="12" x2="${W - 12}" y1="46" y2="46" class="pv-axis"/>` + NEUTRAL.map((r) => `<rect x="${X(r.start)}" y="40" width="${Math.max(3, X(r.end) - X(r.start))}" height="12" rx="3" fill="var(--sc)" opacity=".55"/>`).join("") +
        MOMENTS.map((m, i) => `<circle cx="${X(m.lap)}" cy="46" r="11" fill="${m.main.color}"/><text x="${X(m.lap)}" y="47" class="pv-n" text-anchor="middle" dominant-baseline="middle">${i + 1}</text><text x="${X(m.lap)}" y="76" class="pv-t" text-anchor="middle" dominant-baseline="middle">${m.lap ? "T" + m.lap : "course"}</text>`).join(""));
    }
    if (id === "course") {
      const N = Math.max(2, drivers.length), X = (lap) => 4 + ((lap - 1) / Math.max(1, LAPS - 1)) * (W - 8), Y = (p) => 6 + ((p - 1) / (N - 1)) * (H - 12);
      const line = (d, cls, col) => { const pts = d.pos.map((p, k) => (p ? `${X(k + 1).toFixed(1)},${Y(p).toFixed(1)}` : null)).filter(Boolean); return pts.length > 1 ? `<polyline points="${pts.join(" ")}" class="${cls}"${col ? ` stroke="${col}"` : ""}/>` : ""; };
      return svg(finishers.slice(3, 10).map((d) => line(d, "pv-ghost")).join("") + finishers.slice(0, 3).reverse().map((d) => line(d, "pv-line", d.color)).join(""));
    }
    if (id === "rythme") {
      const top = paced.slice(0, 4); if (!top.length) return "";
      const span = Math.max(0.3, (top[top.length - 1].median - top[0].median) * 1.4), rh = H / 4;
      return svg(top.map((d, i) => { const y = i * rh + rh / 2, w = (W - 120) * (1 - (d.median - top[0].median) / span);
        return t(0, y, d.code, "pv-code") + `<rect x="46" y="${y - 7}" width="${w.toFixed(1)}" height="14" rx="4" fill="${d.color}"/>` + t(W, y, i ? gapS(d.median - top[0].median) : "réf.", "pv-t", "end"); }).join(""));
    }
    if (id === "duels") {
      const ds = computeDuels().filter((d) => d.valid).slice(0, 3); if (!ds.length) return "";
      const rh = H / 3, max = ds[0].gap || 1;
      return svg(ds.map((d, i) => { const y = i * rh + rh / 2, w = 30 + (W - 210) * (d.gap / max);
        return t(0, y, d.fast.code, "pv-code") + `<rect x="46" y="${y - 6}" width="${w.toFixed(1)}" height="12" rx="4" fill="${d.color}"/>` + t(52 + w, y, d.slow.code, "pv-t") + t(W, y, gapS(d.gap), "pv-t", "end"); }).join(""));
    }
    if (id === "pneus") {
      const rows = finishers.slice(0, 5), rh = H / 5, X = (lap) => 46 + ((lap - 1) / Math.max(1, LAPS)) * (W - 46);
      return svg(rows.map((d, i) => { const y = i * rh + rh / 2;
        return t(0, y, d.code, "pv-code") + d.stints.map(([c, a, b]) => `<rect x="${(X(a) + 1).toFixed(1)}" y="${y - 6}" width="${Math.max(2, X(Math.min(b, LAPS) + 1) - X(a) - 3).toFixed(1)}" height="12" rx="4" fill="${(COMP[c] || COMP.U || { c: "#999" }).c}"/>`).join(""); }).join(""));
    }
    if (id === "explorer") {
      const two = finishers.slice(0, 2).filter((d) => d.clean.length >= 3); if (!two.length) return "";
      const rh = H / 2, X = (lap) => 46 + ((lap - 1) / Math.max(1, LAPS)) * (W - 46), cw = Math.max(1.5, (W - 46) / Math.max(1, LAPS) - 1.5);
      const col = ["var(--good)", "#e3a008", "var(--bad)", "var(--track)"];
      return svg(two.map((d, i) => { const y = i * rh + rh / 2;
        return t(0, y, d.code, "pv-code") + regOf(d).cells.map((c) => `<rect x="${X(c.lap).toFixed(1)}" y="${y - 9}" width="${cw.toFixed(1)}" height="18" rx="2" fill="${col[c.k]}"/>`).join(""); }).join(""));
    }
  } catch (e) { return ""; }
  return "";
}
function renderChapterCards() {
  const box = $("#mchaps"); if (!box || !drivers.length) return;
  const first = (id) => ($("#" + id)?.textContent || "").replace(/\s+/g, " ").trim().split(/(?<=\.)\s/)[0] || "";
  const duels = computeDuels().filter((d) => d.valid);
  const sw = (cols) => `<span class="mc-sw">${cols.slice(0, 4).map((c) => `<i style="background:${c}"></i>`).join("")}</span>`;
  const info = {
    moments: [(typeof MOMENTS !== "undefined" && MOMENTS.length ? MOMENTS.map((m) => (m.lap ? "T" + m.lap + " " : "") + m.txt.replace(/<[^>]+>/g, "")).join(" · ") : first("read-moments")), sw(MOMENTS.map((m) => m.main.color))],
    course: [first("read-course"), sw(finishers.slice(0, 3).map((d) => d.color))],
    rythme: [first("read-rythme"), sw(paced.slice(0, 3).map((d) => d.color))],
    duels: [first("read-duels"), sw(duels.slice(0, 3).map((d) => d.color))],
    pneus: [(() => { const c = {}; finishers.forEach((d) => (c[d.pits.length] = (c[d.pits.length] || 0) + 1)); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? `Le plus courant : ${+top[0] === 0 ? "aucun arrêt" : plural(+top[0], "arrêt")} (${top[1]} pilote${top[1] > 1 ? "s" : ""}). Qui a choisi quels pneus, et quand.` : ""; })(), `<span class="mc-sw mc-tyres">${[...new Set(drivers.flatMap((d) => d.stints.map((st) => st[0])))].filter((c) => COMP[c] && c !== "?").map((c) => `<span><i style="background:${COMP[c].c}"></i>${COMP[c].name}</span>`).join("")}</span>`],
    explorer: ["Choisis jusqu'à 4 pilotes : temps au tour, écart en piste, régularité, et leur meilleur tour sur le circuit.", sw(finishers.slice(0, 2).map((d) => d.color))],
  };
  box.innerHTML = `<div class="mc-title">Comprendre la course</div>` + CHAPTERS.map((c, i) => {
    const h2 = $(`#${c.sec} h2`)?.textContent || c.k, [txt, prev] = info[c.id];
    return `<button class="mc mc-${c.id}" data-ch="${c.id}"><span class="mc-txt"><span class="mc-k"><span class="mc-n">0${i + 1}</span>${c.k}</span><b>${esc(h2)}</b><small>${esc(txt)}</small></span>${prev}${chapPreview(c.id)}<span class="mc-go">Ouvrir<svg class="mc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></span></button>`;
  }).join("");
  $$("#mchaps .mc").forEach((b) => b.addEventListener("click", () => { const { g } = parseHash(); navGo(`#${g}/${b.dataset.ch}`); }));
}
function markNav(sec) { $$("nav.sections a").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + sec)); }
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
    $("#mchap-title").textContent = RACE ? `${gpName(RACE)} ${RACE.year}` : "";
    $("#mchap-k").textContent = `${String(i + 1).padStart(2, "0")} · ${c.k}`;
    ov.scrollTop = 0;
  }
  ov.hidden = false; document.body.classList.add("in-chap"); markNav(c.sec);
  requestAnimationFrame(() => ov.classList.add("on"));
  setTimeout(() => {
    Object.values(charts).forEach((ch) => { if (ch.el && body.contains(ch.el)) { if (ch.inst) ch.inst.resize(); else if (ch.el.offsetParent) draw(ch.el.id); } });
    $$(".mswipe", body).forEach((w) => w._refit && w._refit()); placeIndicators(); placeCursor();
  }, 380);
}
function putBack() { if (NAV.chap && NAV.slot) { const c = CHAPTERS.find((x) => x.id === NAV.chap), sec = $("#" + c.sec); NAV.slot.replaceWith(sec); } NAV.chap = null; NAV.slot = null; }
function closeChapter() {
  const ov = $("#mchap"); if (!ov || ov.hidden) return;
  ov.classList.remove("on"); document.body.classList.remove("in-chap"); markNav("gp-section");
  setTimeout(() => { if (!ov.classList.contains("on")) { ov.hidden = true; putBack(); stopReplay(); placeIndicators(); } }, 360);
}
// Revenir au sommaire : on dépile l'historique si le chapitre a été ouvert depuis le site, sinon on remplace l'adresse
function chapBack() { const { g } = parseHash(); if (NAV.pushed) { NAV.pushed = false; history.back(); } else navGo("#" + g, true); }

/* --- Routeur --- */
let navLoading = null;
async function navRoute() {
  const { g, c } = parseHash();
  if (g.startsWith("paddock=")) { pkImport(g.slice(8)); history.replaceState(null, "", location.pathname); closeChapter(); showHome(true); return; } // lien de sauvegarde de la collection
  if (g === "championnat") { closeChapter(); showChamp(true); return; }
  showChamp(false);
  if (!g) { closeChapter(); showHome(true); return; }
  let r = RACES.find((x) => slugOf(x) === g);
  if (!r) { // GP d'une autre saison : on charge sa liste
    const y = +(g.match(/-(\d{4})$/) || [])[1];
    if (y && y !== +$("#year").value && [...$("#year").options].some((o) => +o.value === y)) { $("#year").value = y; try { await loadRaces(y); } catch {} r = RACES.find((x) => slugOf(x) === g); }
  }
  if (!r) { navGo("", true); return; }
  showHome(false); NAV.fromGP = true;
  if ($("#gp").value !== String(r.session_key) || !RACE || RACE.session_key !== r.session_key) {
    $("#gp").value = r.session_key;
    if (!(navLoading && navLoading.sk === r.session_key)) { navLoading = { sk: r.session_key, p: loadGP(r.session_key) }; navLoading.p.finally(() => { if (navLoading?.sk === r.session_key) navLoading = null; }); }
  }
  if (c) openChapter(c); else closeChapter();
}
addEventListener("popstate", navRoute);
$("#mchap-back").addEventListener("click", chapBack);
$("#mchap-x").addEventListener("click", chapBack);
$("#mchap").addEventListener("click", (e) => { if (e.target === e.currentTarget) chapBack(); }); // clic à côté du panneau (ordinateur)
// Croix et Échap de l'accueil : retour au GP déjà chargé (seulement si on vient d'un GP)
function homeX() { const x = $("#home-x"); if (x) x.hidden = !(RACE && NAV.fromGP); }
$("#home-x")?.addEventListener("click", () => RACE && navGP(RACE.session_key));
addEventListener("keydown", (e) => { if (e.key === "Escape" && NAV.home && RACE && NAV.fromGP && !document.querySelector(".pk-modal, .overlay:not([hidden])")) navGP(RACE.session_key); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && NAV.chap && !document.querySelector(".msheet.on, .overlay:not([hidden])")) chapBack(); });
// Liens internes (menu du haut, raccourcis) : un chapitre s'ouvre, le reste défile jusqu'à la bonne partie
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]'); if (!a || a.closest("#home")) return;
  const id = a.getAttribute("href").slice(1), ch = CHAPTERS.find((x) => x.sec === id), el = document.getElementById(id);
  if (!ch && !el) return;
  e.preventDefault(); if (typeof closeSheets === "function") closeSheets();
  const { g } = parseHash();
  if (ch) { navGo(`#${g}/${ch.id}`, !!NAV.chap); return; }
  if (NAV.chap) navGo("#" + g, true);
  setTimeout(() => (id === "gp-section" ? scrollTo({ top: 0, behavior: "smooth" }) : el.scrollIntoView({ behavior: "smooth" })), NAV.chap ? 380 : 0);
}, true);
$$(".brand").forEach((b) => { b.style.cursor = "pointer"; b.addEventListener("click", () => navGo("")); });
// Glisser depuis le bord gauche pour revenir (comme une app)
(() => {
  const ov = $("#mchap"); let sx = null, sy = 0;
  ov.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t.clientX < 30) { sx = t.clientX; sy = t.clientY; } }, { passive: true });
  ov.addEventListener("touchmove", (e) => { if (sx == null) return; const t = e.touches[0], dx = t.clientX - sx; if (dx > 0 && Math.abs(t.clientY - sy) < 70) ov.style.transform = `translateX(${dx}px)`; }, { passive: true });
  ov.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; ov.style.transform = ""; sx = null; if (dx > 90) $("#mchap-back").click(); });
})();

/* --- Typographie française : espace fine insécable avant ? ! : ; » et après « (le signe ne se retrouve jamais seul en début de ligne) --- */
function frTypo(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && !n.parentElement.closest("script, style, textarea, input, code") && /( [?!:;»]|« )/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
  const list = []; while (w.nextNode()) list.push(w.currentNode);
  list.forEach((n) => { n.nodeValue = n.nodeValue.replace(/ ([?!:;»])/g, " $1").replace(/« /g, "« "); });
}
(() => {
  let pend = new Set(), raf = 0;
  const run = () => { raf = 0; const roots = [...pend]; pend = new Set(); roots.forEach((r) => r.isConnected && frTypo(r)); };
  new MutationObserver((ms) => { ms.forEach((m) => { const t = m.type === "characterData" ? m.target.parentElement : m.target; if (t) pend.add(t); }); if (!raf) raf = requestAnimationFrame(run); })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  frTypo(document.body);
})();

/* --- Partager un GP : lien vers sa page de partage (titre + image) quand elle existe, sinon l'adresse du GP --- */
function shareUrl() {
  if (!RACE) return location.href;
  const base = location.href.split("#")[0].replace(/[^/]*$/, ""), slug = slugOf(RACE);
  return ARCH.has(RACE.session_key) && location.protocol !== "file:" ? `${base}gp/${slug}.html` : `${base}#${slug}`;
}
$("#share-gp")?.addEventListener("click", async () => {
  const url = shareUrl(), title = `${gpName(RACE)} ${RACE.year} · ${$("#headline").textContent}`;
  try { if (navigator.share) { await navigator.share({ title, url }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); toast("Lien du GP copié"); } catch { prompt("Copie ce lien :", url); }
});

/* --- Championnat : points pilotes et écuries (courses + sprints archivés), masqué par défaut pour ne rien dévoiler --- */
let CHAMP = null; // { year, races, sprints }
async function champData(year) {
  if (CHAMP && CHAMP.year === year) return CHAMP;
  const races = (await fromArchive(`races-${year}.json`)) || [], sprints = (await fromArchive(`sprints-${year}.json`)) || [];
  CHAMP = { year, races: races.filter((r) => r.pts && r.pts.length).sort((a, b) => new Date(a.date_start) - new Date(b.date_start)), sprints };
  return CHAMP;
}
// Le bouton « Championnat » n'apparaît que si l'archive contient des points
async function champButtons() {
  const d = await champData(+$("#year").value);
  $$(".champ-open").forEach((b) => (b.hidden = !d.races.length));
}
const champSeen = () => { try { return localStorage.getItem("f1duel:champ") === "1"; } catch { return false; } };
const champSet = (v) => { try { v ? localStorage.setItem("f1duel:champ", "1") : localStorage.removeItem("f1duel:champ"); } catch {} };
async function renderChamp() {
  const d = await champData(+$("#year").value), body = $("#champ-body");
  const last = d.races.at(-1), nR = d.races.length;
  $("#champ-eyebrow").textContent = last ? `Championnat ${d.year} · après ${nR} GP${d.sprints.length ? ` et ${d.sprints.length} sprint${d.sprints.length > 1 ? "s" : ""}` : ""} · ${gpName(last)}` : `Championnat ${d.year}`;
  $("#champ-back-t").textContent = RACE && NAV.fromGP ? `${gpName(RACE)} ${RACE.year}` : "Tous les Grands Prix";
  const shown = champSeen(); $("#champ-hide").hidden = !shown;
  if (!shown) {
    body.innerHTML = `<div class="champ-mask"><div class="champ-blur" aria-hidden="true">${[70, 62, 55, 49, 41, 35, 28].map((w, i) => `<i style="width:${w}%;background:${["#27F4D2", "#3671C6", "#FF8000", "#E8002D", "#229971", "#64C4FF", "#B6BABD"][i]}"></i>`).join("")}</div>
      <div class="champ-veil"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><path d="M4 4l16 16"/></svg>
      <b>Classement masqué</b><p>Il contient les résultats de toutes les courses déjà courues. Pas encore vu le dernier GP ?</p>
      <button type="button" class="btn" id="champ-show">Révéler le classement</button><small>Ton choix est gardé sur cet appareil</small></div></div>`;
    $("#champ-show").addEventListener("click", () => { champSet(true); renderChamp(); });
    return;
  }
  // Totaux : courses + sprints ; on garde la dernière écurie et la dernière couleur connues de chaque pilote
  const D = new Map(), Tm = new Map();
  const add = (pts) => pts.forEach(([code, name, team, color, p]) => {
    const e = D.get(code) || { code, name, team, color, pts: 0, wins: 0 }; e.pts += p; e.team = team || e.team; e.color = color || e.color; D.set(code, e);
    const t = Tm.get(team) || { team, color, pts: 0 }; t.pts += p; t.color = color || t.color; Tm.set(team, t);
  });
  d.races.forEach((r) => add(r.pts));
  d.sprints.forEach((s) => add(s.pts || []));
  d.races.forEach((r) => { const e = r.winner && D.get(r.winner.code); if (e) e.wins++; }); // départage à égalité de points
  const drv = [...D.values()].sort((a, b) => b.pts - a.pts || b.wins - a.wins), tms = [...Tm.values()].filter((t) => t.team).sort((a, b) => b.pts - a.pts);
  const fmt = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
  const rows = (list, max, kind) => list.map((e, i) => `<div class="cr${i >= 10 && kind === "d" ? " more" : ""}"><span class="cr-p">P${i + 1}</span><span class="cr-n">${kind === "d" ? `<i style="background:${e.color}"></i>${esc(e.name)}` : esc(e.team)}</span><span class="cr-b"><span style="width:${(e.pts / max) * 100}%;background:${e.color}"></span></span><span class="cr-v">${fmt(e.pts)}</span></div>`).join("");
  const wins = d.races.map((r) => `<span class="cw" style="background:${r.winner?.color || "var(--track)"}" title="${esc(`${gpName(r)} · ${r.winner?.name || ""}`)}"></span>`).join("");
  body.innerHTML = `<div class="champ-grid">
    <div class="card champ-card"><div class="champ-h"><b>Pilotes</b><span>points</span></div>${rows(drv, drv[0]?.pts || 1, "d")}${drv.length > 10 ? `<button type="button" class="see-all" id="champ-more">Voir les ${drv.length - 10} autres pilotes</button>` : ""}</div>
    <div class="champ-side"><div class="card champ-card"><div class="champ-h"><b>Écuries</b><span>points</span></div>${rows(tms, tms[0]?.pts || 1, "t")}</div>
      <div class="card champ-card champ-wins"><b>Les victoires de la saison</b><div class="cw-row">${wins}</div><small>Une case par GP, à la couleur de l'écurie gagnante. Survole une case pour le GP et son vainqueur.</small></div></div></div>
    <p class="fine">Points des Grands Prix${d.sprints.length ? " et des sprints" : ""} archivés. Pénalités appliquées après coup par les commissaires : non prises en compte.</p>`;
  $("#champ-more")?.addEventListener("click", (e) => { body.querySelectorAll(".cr.more").forEach((r) => r.classList.add("on")); e.currentTarget.remove(); });
}
function showChamp(on) {
  const el = $("#champ"); if (!el) return;
  if (on === !el.hidden && on) { renderChamp(); return; }
  if (on) { NAV.champ = true; document.body.classList.add("at-home"); renderChamp(); el.hidden = false; requestAnimationFrame(() => el.classList.add("on")); el.scrollTop = 0; }
  else if (NAV.champ) { NAV.champ = false; el.classList.remove("on"); setTimeout(() => { if (!NAV.champ) el.hidden = true; }, 320); if (!NAV.home) document.body.classList.remove("at-home"); }
}
document.addEventListener("click", (e) => { if (e.target.closest(".champ-open")) { $("#msheet-menu")?.classList.remove("on"); $("#mscrim")?.classList.remove("on"); navGo("#championnat"); } });
$("#champ-back")?.addEventListener("click", () => (RACE && NAV.fromGP ? navGP(RACE.session_key) : navGo("")));
$("#champ-hide")?.addEventListener("click", () => { champSet(false); renderChamp(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && NAV.champ) $("#champ-back").click(); });
