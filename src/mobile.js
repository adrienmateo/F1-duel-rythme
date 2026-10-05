
/* ======================= Mobile : vertical pour changer de section, horizontal pour changer de vue ======================= */
const MOB = () => matchMedia("(max-width: 640px)").matches;
let boardAll = false, allRythme = false, allStrat = false, gapsAll = false;
const rythmeRows = () => { const r = [...paced].sort((a, b) => b.paceRank - a.paceRank); return MOB() && !allRythme ? r.slice(-10) : r; };
function openSheet(id) { $("#mscrim").classList.add("on"); $("#" + id).classList.add("on"); }
function closeSheets() { $("#mscrim").classList.remove("on"); $$(".msheet").forEach((x) => x.classList.remove("on")); }
function syncPickBtn() {
  const b = $("#mpick"); if (!b || !drivers.length) return;
  const pins = coursePins();
  b.innerHTML = `<span>Pilotes affichés : <b>${pins.length ? pins.slice(0, 3).join(", ") + (pins.length > 3 ? "…" : "") : "aucun"}</b></span><span class="sw-row">${pins.slice(0, 4).map((c) => `<i style="background:${byCode[c].color}"></i>`).join("")}</span>`;
}

// Une rangée de cartes à glisser, avec pastilles en haut et points en bas
function makeSwipe(anchor, slides) {
  const wrap = document.createElement("div"); wrap.className = "mswipe";
  const tabs = document.createElement("div"); tabs.className = "mtabs"; tabs.setAttribute("role", "tablist");
  const track = document.createElement("div"); track.className = "mslides";
  const dots = document.createElement("div"); dots.className = "mdots";
  anchor.before(wrap);
  slides.forEach(([label, els, xs], i) => {
    const sl = document.createElement("div"); sl.className = "mslide" + (xs ? " xs" : "");
    els.forEach((e) => e && sl.appendChild(e)); track.appendChild(sl);
    const b = document.createElement("button"); b.textContent = label; b.className = xs ? "xs" : ""; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", i === 0);
    b.addEventListener("click", () => track.scrollTo({ left: sl.offsetLeft - track.offsetLeft, behavior: reduce ? "auto" : "smooth" }));
    tabs.appendChild(b); const dot = document.createElement("i"); if (xs) dot.className = "xs"; dots.appendChild(dot);
  });
  dots.firstChild?.classList.add("on");
  const idx = () => Math.round(track.scrollLeft / ((track.firstChild?.offsetWidth || 1) + 12));
  const fit = (i) => { const sl = track.children[i]; if (sl) track.style.height = sl.scrollHeight + "px"; };
  setTimeout(() => fit(0), 50);
  const ro = new ResizeObserver(() => fit(idx())); [...track.children].forEach((c) => ro.observe(c));
  wrap.append(tabs, track, dots);
  let raf = 0, lastI = 0;
  const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
    const i = idx();
    fit(i);
    [...tabs.children].forEach((b, k) => b.setAttribute("aria-selected", k === i));
    [...dots.children].forEach((d, k) => d.classList.toggle("on", k === i));
    const t = tabs.children[i]; if (t) tabs.scrollTo({ left: t.offsetLeft - 40, behavior: "smooth" });
    const cur = track.children[i];
    cur?.querySelectorAll(".chart").forEach((el) => { const c = charts[el.id]; if (c && !c.inst) draw(el.id); else c?.inst?.resize(); });
    if (i !== lastI && cur?.querySelector("#circ")) playCircuit();
    lastI = i;
  }); };
  track.addEventListener("scroll", onScroll, { passive: true });
  wrap._reset = () => { track.scrollTo({ left: 0 }); onScroll(); };
  wrap._refit = () => fit(idx());
  return wrap;
}
// Carte « Sous le capot » : le bloc expert de la section, ouvert, sans accordéon
function expertCard(sel) { const u = $(sel); if (!u) return null; u.classList.add("open", "in-slide"); return u; }

/* --- Le rythme : les écarts en liste --- */
function renderGaps() {
  const el = $("#m-gaps"); if (!el) return;
  if (!paced.length) { el.innerHTML = `<p class="empty-note">Pas assez de tours représentatifs.</p>`; return; }
  const list = gapsAll ? paced : paced.slice(0, 10);
  el.innerHTML = `<div class="mlist-head"><span>Rythme médian par tour</span><span>Écart</span></div>` + list.map((d, i) => `<button class="mrow" data-c="${d.code}"><span class="p">${i + 1}</span><span class="b" style="background:${d.color}"></span><span class="n">${d.code}</span><span class="t">${lapT(d.median)}</span><span class="g">${i ? gapS(d.median - paced[0].median) : "réf."}</span></button>`).join("") +
    (paced.length > 10 ? `<button class="see-all" id="gaps-all">${gapsAll ? "Afficher le top 10" : `Voir les ${paced.length} pilotes`}</button>` : "");
  $$("#m-gaps .mrow").forEach((b) => b.addEventListener("click", () => showDriver(b.dataset.c)));
  $("#gaps-all")?.addEventListener("click", () => { gapsAll = !gapsAll; renderGaps(); });
}
/* --- Les stratégies : à retenir --- */
function renderKeep() {
  const el = $("#m-keep"); if (!el) return;
  const counts = {}; finishers.forEach((d) => { const n = d.pits.length; counts[n] = (counts[n] || 0) + 1; });
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const sc = NEUTRAL.filter((r) => r.kind === "SC" || r.kind === "VSC");
  const scStops = drivers.reduce((s, d) => s + d.pits.filter((p) => sc.some((r) => p >= r.start && p <= r.end)).length, 0);
  let long = null; drivers.forEach((d) => d.stints.forEach(([c, a, b]) => { const e = Math.min(b ?? LAPS, DNF[d.code] || LAPS), n = e - a + 1; if (n > 0 && (!long || n > long.n)) long = { d, c, n }; }));
  const tile = (v, l) => `<div class="mst"><span class="v">${v}</span><span class="l">${l}</span></div>`;
  el.innerHTML = (top[0] ? tile(top[0][1], `pilote${top[0][1] > 1 ? "s" : ""} classé${top[0][1] > 1 ? "s" : ""} à ${top[0][0]} arrêt${top[0][0] > 1 ? "s" : ""}`) : "") +
    (top[1] ? tile(top[1][1], `à ${top[1][0]} arrêt${top[1][0] > 1 ? "s" : ""}`) : "") +
    tile(scStops, sc.length ? "arrêts sous neutralisation, moins coûteux" : "course sans neutralisation") +
    (long ? tile(`${long.n} t.`, `plus long relais : ${esc(long.d.last)} en ${COMP[long.c].name.toLowerCase()}`) : "");
}

/* --- Explorer allégé --- */
const EXM = [["laps", "Temps au tour"], ["gap", "Écart en piste"], ["box", "Régularité"]];
function exBuild(mode) { return (T) => { const m = exMode; exMode = mode; const o = buildEx(T); exMode = m; o.grid = { ...(o.grid || {}), left: 54, right: 12, top: 36, bottom: 28 }; if (o.legend) o.legend = { ...o.legend, top: 2, left: "center" }; return o; }; }
function exRefresh() { EXM.forEach(([m]) => updateBase("ch-ex-" + m)); syncExPick(); exCircuitRefresh(); }
function syncExPick() {
  const el = $("#expick"); if (!el) return;
  el.innerHTML = `<span class="lbl">Pilotes</span>` + exSel.filter((c) => byCode[c]).map((c) => `<button class="pp" data-c="${c}" title="Retirer"><i style="background:${byCode[c].color}"></i>${c}${exSel.length > 1 ? '<span class="x">×</span>' : ""}</button>`).join("") + (exSel.length < 4 ? `<button class="add" id="ex-add">+ Ajouter</button>` : "");
  $$("#expick .pp").forEach((b) => b.addEventListener("click", () => { if (exSel.length > 1) { exSel = exSel.filter((x) => x !== b.dataset.c); exChanged(); } }));
  $("#ex-add")?.addEventListener("click", () => { $("#ex-chips-slot").appendChild($("#ex-chips")); openSheet("msheet-ex"); });
  $$("#exquick button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sel === exSel.join(",")));
}
function renderExQuick() {
  const qr = $("#exquick"); if (!qr) return;
  const duels = computeDuels().filter((d) => d.valid);
  const quick = [["Le podium", finishers.slice(0, 3).map((d) => d.code), null, false],
    ...(duels[0] ? [["Duel du jour", [duels[0].fast.code, duels[0].slow.code], null, true]] : []),
    ...TEAMS.map((t) => [t.team, t.ds.map((d) => d.code), t.color, false])];
  qr.innerHTML = quick.map(([l, sel, col, hot]) => `<button class="${hot ? "hot" : ""}" data-sel="${sel.join(",")}">${col ? `<i style="background:${col}"></i>` : ""}${esc(l)}</button>`).join("");
  $$("button", qr).forEach((b) => b.addEventListener("click", () => { exSel = b.dataset.sel.split(",").slice(0, 4); exChanged(); }));
}

/* --- Les duels : groupes de 4 écuries, puis la carte Circuit --- */
let duelSwipe = null;
function buildDuelSwipe() {
  const list = $("#duel-list");
  const rows = [...list.querySelectorAll(".duel[data-codes]")], na = [...list.querySelectorAll(".na")];
  rows.forEach((r) => r.style.setProperty("--dot", byCode[r.dataset.codes.split(" ")[0]]?.color || "var(--muted)"));
  const groups = []; for (let i = 0; i < rows.length; i += 4) groups.push(rows.slice(i, i + 4));
  if (na.length) (groups.length ? groups[groups.length - 1] : (groups[0] = [])).push(...na);
  const anchor = document.createElement("div");
  if (duelSwipe) { duelSwipe.before(anchor); duelSwipe.remove(); } else list.before(anchor);
  duelSwipe = makeSwipe(anchor, [...groups.map((g, i) => [i * 4 + 1 === Math.min(rows.length, i * 4 + 4) ? `${i * 4 + 1}` : `${i * 4 + 1}–${Math.min(rows.length, i * 4 + 4)}`, g])]);
  anchor.remove();
  list.style.display = "none";
}

let mobileReady = false, swipes = [];
let updateBase = update;
function setupMobileOnce() {
  mobileReady = true;
  // Menu ☰ : niveau et thème
  $("#mburger").addEventListener("click", () => openSheet("msheet-menu"));
  $("#mscrim").addEventListener("click", closeSheets);
  const syncMenu = () => { $$("#msheet-menu [data-lv]").forEach((b) => b.setAttribute("aria-pressed", document.body.dataset.level === b.dataset.lv)); $("#m-theme").textContent = isDark() ? "Désactiver" : "Activer"; };
  $$("#msheet-menu [data-lv]").forEach((b) => b.addEventListener("click", () => { setLevel(b.dataset.lv); setTimeout(syncMenu, 120); }));
  $("#m-theme").addEventListener("click", () => { switchTheme(); setTimeout(syncMenu, 80); });
  $$("#msheet-menu a").forEach((a) => a.addEventListener("click", closeSheets));
  syncMenu();
  // Pilotes de la course dans un panneau
  $("#mpick").addEventListener("click", () => { $("#m-chips-slot").appendChild($("#course-chips")); openSheet("msheet-pilots"); });
  $("#m-done").addEventListener("click", () => { closeSheets(); $("#course").scrollIntoView({ behavior: "smooth" }); });
  $("#board-all").addEventListener("click", () => { boardAll = !boardAll; $("#board-all").textContent = boardAll ? "Replier le classement" : "Voir tout le classement"; renderBoard(); });
  const addAll = (chartId, label, get, set) => {
    const b = document.createElement("button"); b.className = "see-all"; b.textContent = label; b.dataset.label = label;
    $("#" + chartId).after(b);
    b.addEventListener("click", () => { set(!get()); b.textContent = get() ? "Afficher le top 10" : label; $("#" + chartId).style.height = get() ? "620px" : ""; update(chartId); charts[chartId]?.inst?.resize(); });
    return b;
  };
  const rAll = addAll("ch-rythme", "Voir tous les pilotes", () => allRythme, (v) => (allRythme = v));
  const sAll = addAll("ch-strat", "Voir tous les pilotes", () => allStrat, (v) => (allStrat = v));
  // Textes : deux lignes visibles, le reste sur demande
  $$("main > section > .read").forEach((p) => {
    p.classList.add("clamp");
    const b = document.createElement("button"); b.className = "more-btn"; b.textContent = "En savoir plus";
    p.after(b);
    b.addEventListener("click", () => { const c = p.classList.toggle("clamp"); b.textContent = c ? "En savoir plus" : "Réduire"; });
  });
  // Les sections en cartes
  const grid = $("#gp-section .hero-grid");
  swipes.push(makeSwipe(grid, [["Podium", [$("#tower")]], ["Les faits", [$("#log")]], ["Chiffres clés", [$("#kpis")]]]));
  grid.remove();
  const cw = $("#course .course-wrap");
  swipes.push(makeSwipe(cw, [["Graphique", [$("#course .chart-box")]], ["Classement au tour", [$("#board")]], ["Les batailles", [expertCard("#course .under")], true]]));
  cw.remove();
  const rl = $("#rythme .legend-inline"), gaps = document.createElement("div"); gaps.className = "mlist"; gaps.id = "m-gaps";
  const aR = document.createElement("div"); rl.before(aR);
  swipes.push(makeSwipe(aR, [["Rythme contre arrivée", [rl, $("#ch-rythme"), rAll]], ["Les écarts", [gaps]], ["Les secteurs", [expertCard("#rythme .under")], true]]));
  aR.remove();
  expertCard("#duels .under");
  const tl = $("#tyre-legend"), keep = document.createElement("div"); keep.className = "mstats"; keep.id = "m-keep";
  const aS = document.createElement("div"); tl.before(aS);
  swipes.push(makeSwipe(aS, [["Les relais", [tl, $("#ch-strat"), sAll]], ["À retenir", [keep]], ["L'usure", [expertCard("#u-deg")], true], ["Arrêts aux stands", [expertCard("#u-pits")], true]]));
  aS.remove();
  // Explorer allégé : raccourcis, pilotes sur une ligne, graphiques en cartes
  const sec = $("#explorer"), read = $("#read-ex");
  const qr = document.createElement("div"); qr.className = "exquick"; qr.id = "exquick";
  const pick = document.createElement("div"); pick.className = "expick"; pick.id = "expick";
  sec.querySelector(".ex-top").after(qr, pick);
  read.classList.remove("clamp"); if (read.nextElementSibling?.classList.contains("more-btn")) read.nextElementSibling.remove();
  const aE = document.createElement("div"); read.after(aE);
  const exc = $("#ex-circ"); exc.hidden = false;
  swipes.push(makeSwipe(aE, EXM.map(([m, label]) => { const d = document.createElement("div"); d.className = "chart exc"; d.id = "ch-ex-" + m; return [label, [d]]; }).concat([["Sur le circuit", [exc]]])));
  aE.remove();
  EXM.forEach(([m]) => { charts["ch-ex-" + m] = { el: $("#ch-ex-" + m), build: exBuild(m), inst: null }; });
  whenVisible(sec, () => EXM.forEach(([m]) => draw("ch-ex-" + m)));
  $("#ex-done").addEventListener("click", () => { closeSheets(); exRefresh(); sec.scrollIntoView({ behavior: "smooth" }); });
  $("#ex-chips").addEventListener("click", () => setTimeout(exRefresh, 0));
  update = function (id, nm) { updateBase(id, nm); if (id === "ch-ex") { EXM.forEach(([m]) => updateBase("ch-ex-" + m)); syncExPick(); } };
  // Repasser en Essentiel depuis une carte experte : retour à la première carte
  new MutationObserver(() => $$(".mswipe").forEach((w) => { const t = w.querySelector(".mslides"); const i = Math.round(t.scrollLeft / ((t.firstChild?.offsetWidth || 1) + 12)); if (t.children[i]?.classList.contains("xs") && document.body.dataset.level !== "expert") w._reset(); else w._refit(); })).observe(document.body, { attributes: true, attributeFilter: ["data-level"] });
  // Barre d'onglets : section affichée
  const tabs = $$(".mbar a");
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) tabs.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); }), { rootMargin: "-40% 0px -55% 0px" });
  $$("main > section[id]").forEach((x) => io.observe(x));
  addEventListener("scroll", () => { if (scrollY < 120) tabs.forEach((a, k) => a.classList.toggle("on", k === 0)); }, { passive: true });
  tabs[0].classList.add("on");
}
// Après chaque chargement de GP
function mobileRender() {
  if (!MOB()) return;
  if (!mobileReady) setupMobileOnce();
  buildDuelSwipe();
  renderGaps(); renderKeep(); renderExQuick(); syncExPick(); syncPickBtn();
  EXM.forEach(([m]) => { if (charts["ch-ex-" + m]?.inst) draw("ch-ex-" + m); });
  swipes.concat(duelSwipe ? [duelSwipe] : []).forEach((w) => w._reset());
  setTimeout(() => $$(".mswipe").forEach((w) => w._refit()), 300);
}
