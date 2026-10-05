
/* ======================= Les faits de course et les 3 moments ======================= */
// Le site repère seul les faits marquants dans les données (règles fixes, aucune IA) :
// changements de leader, safety car et ce qu'ils changent, départs, abandons qui comptent, plus belle remontée.
// Chaque fait a un score ; le haut de page montre les 6 plus importants dans l'ordre des tours,
// le chapitre « Les 3 moments » rejoue les 3 plus décisifs.
const posAt = (d, lap) => { for (let l = Math.min(lap, LAPS); l >= 1; l--) if (d.pos[l - 1]) return d.pos[l - 1]; return d.grid || null; };
const leaderAt = (lap) => drivers.find((d) => d.pos[lap - 1] === 1) || null;
const deName = (n) => (/^[aeiouyhàâéèêîôû]/i.test(n) ? "d'" : "de ") + n;
let FACTS = [], MOMENTS = [];
// Un fait compte plus s'il touche la tête de course : podium ×1,3, top 6 ×1,1, top 10 ×1, au-delà ×0,55
const wPos = (p) => (!p ? 0.55 : p <= 3 ? 1.3 : p <= 6 ? 1.1 : p <= 10 ? 1 : 0.55);
const FACT_MIN = 55, FACT_MAX = 5, FRISE_MAX = 4;
const pAt = (d, l) => (l === 0 ? d.grid : d.pos[l - 1]) || null; // tour 0 = la grille de départ

function buildFacts() {
  const out = [], win = finishers[0];
  // Départ : la plus grosse remontée au premier tour
  const start = drivers.filter((d) => d.grid && d.pos[0]).map((d) => [d, d.grid - d.pos[0]]).sort((a, b) => b[1] - a[1])[0];
  if (start && start[1] >= 3) {
    const [d, g] = start, passed = drivers.filter((x) => x !== d && x.grid && x.pos[0] && x.grid < d.grid && x.pos[0] > d.pos[0]);
    out.push({ lap: 1, cls: "up", label: "Départ", score: (40 + g * 4) * wPos(d.pos[0]), txt: `<b>${esc(d.last)}</b> gagne ${g} places au départ`,
      detail: `Parti P${d.grid}, il boucle le premier tour P${d.pos[0]}.`, ds: [d, ...passed.slice(0, 3)], win: [0, 3], main: d, from: 0, to: 1, who: d, short: `+${g} places au départ` });
  }
  // Changements de leader (on ignore les échanges de quelques tours dus aux arrêts aux stands)
  let cur = drivers.find((d) => d.grid === 1) || leaderAt(1);
  for (let lap = 1; lap <= LAPS; lap++) {
    const L = leaderAt(lap); if (!L || L === cur) continue;
    let held = 0; while (lap + held <= LAPS && leaderAt(lap + held) === L) held++;
    if (held < 3 && lap + held <= LAPS) continue;
    const prev = cur, inPit = prev && (prev.pits.includes(lap) || prev.pits.includes(lap - 1));
    // Simple échange pendant les arrêts : l'ancien leader reprend la tête juste après, ce n'est pas un vrai changement
    if (inPit && !(lap + held > LAPS)) { let back = false; for (let k = lap + held; k <= Math.min(LAPS, lap + held + 6); k++) if (leaderAt(k) === prev) { back = true; break; } if (back) continue; }
    const toEnd = lap + held > LAPS;
    out.push({ lap, cls: "lead", label: lap === 1 ? "Départ" : "Prise de tête", score: 70 + (L === win && toEnd ? 25 : 0) + Math.min(10, held / 3),
      txt: lap === 1 ? `<b>${esc(L.last)}</b> prend la tête au départ` : `<b>${esc(L.last)}</b> prend la tête`,
      detail: `${prev ? (inPit ? `Pendant l'arrêt aux stands ${deName(esc(prev.last))}. ` : `Devant ${esc(prev.last)}. `) : ""}${toEnd ? "Il ne la lâchera plus." : `Il la garde ${plural(held, "tour")}.`}`,
      ds: [L, prev].filter(Boolean), win: [Math.max(1, lap - 3), Math.min(LAPS, lap + 4)], main: L, from: Math.max(1, lap - 1), to: lap, who: L, short: "prend la tête" });
    cur = L;
  }
  // Safety car, VSC, drapeau rouge : qui en profite
  NEUTRAL.filter((r) => r.kind !== "Ralenti").forEach((r) => {
    const name = NKlong[r.kind], b = Math.max(1, r.start - 1), a = Math.min(LAPS, r.end + 3);
    const pitters = drivers.filter((d) => d.pits.some((p) => p >= r.start && p <= r.end));
    const gains = pitters.map((d) => [d, (posAt(d, b) || 0) - (posAt(d, a) || 0)]).filter(([d]) => posAt(d, b) && !(DNF[d.code] && DNF[d.code] < a)).sort((x, y) => y[1] - x[1]);
    const best = gains[0];
    if (best && best[1] >= 2) {
      const [d, g] = best, passed = drivers.filter((x) => x !== d && posAt(x, b) < posAt(d, b) && posAt(x, a) > posAt(d, a));
      out.push({ lap: r.start, cls: "sc", label: name, score: (50 + Math.min(40, g * 7)) * wPos(posAt(d, a)) + (r.kind === "Rouge" ? 15 : 0),
        txt: `<b>${name}</b> : ${esc(d.last)} s'arrête et gagne ${g} places`,
        detail: `Tours ${r.start} à ${r.end}. Un arrêt sous ${r.kind === "VSC" ? "VSC" : r.kind === "Rouge" ? "drapeau rouge" : "safety car"} coûte moins de temps : P${posAt(d, b)} avant, P${posAt(d, a)} à la relance.${pitters.length > 1 ? ` ${pitters.length} pilotes en ont profité pour s'arrêter.` : ""}`,
        ds: [d, ...passed.slice(0, 3)], win: [Math.max(1, r.start - 2), Math.min(LAPS, r.end + 4)], main: d, from: b, to: a, who: d, short: `s'arrête sous ${r.kind === "VSC" ? "VSC" : r.kind === "Rouge" ? "drapeau rouge" : "SC"} : +${g}` });
    } else {
      out.push({ lap: r.start, cls: "sc", label: name, score: r.kind === "Rouge" ? 75 : 25 + (r.end - r.start),
        txt: `<b>${name}</b>${r.end > r.start ? ` jusqu'au tour ${r.end}` : ""}`,
        detail: `${plural(r.end - r.start + 1, "tour")} neutralisé${r.end > r.start ? "s" : ""}.${pitters.length ? ` ${pitters.length} pilote${pitters.length > 1 ? "s" : ""} en profite${pitters.length > 1 ? "nt" : ""} pour s'arrêter, sans gain de places notable.` : ""}` });
    }
  });
  // Abandons qui comptent : un pilote dans le top 10 au moment de l'abandon
  dnfs.filter((d) => d.result && !d.result.dns && d.outLap).forEach((d) => {
    const p = posAt(d, d.outLap), lap = Math.min(LAPS, d.outLap + 1); if (!p || p > 10) return;
    const behind = drivers.filter((x) => x !== d && posAt(x, d.outLap) > p).sort((x, y) => posAt(x, d.outLap) - posAt(y, d.outLap));
    out.push({ lap, cls: "out", label: d.result.dsq ? "Disqualification" : "Abandon", score: 40 + (11 - p) * 5,
      txt: `${d.result.dsq ? "Disqualification" : "Abandon"} ${deName(`<b>${esc(d.last)}</b>`)}, alors ${p === 1 ? "en tête" : "P" + p}`,
      detail: `${esc(d.team)}, après ${plural(d.outLap, "tour")}.${behind[0] ? ` ${esc(behind[0].last)} récupère la place.` : ""}`,
      ds: [d, ...behind.slice(0, 2)], win: [Math.max(1, d.outLap - 3), Math.min(LAPS, d.outLap + 3)], main: behind[0] || d, from: d.outLap - 1, to: Math.min(LAPS, d.outLap + 2), who: d, short: `${d.result.dsq ? "disqualifié" : "abandon"} (P${p})` });
  });
  // Plus belle remontée de la course
  const up = finishers.filter((d) => d.grid).map((d) => [d, d.grid - d.finish]).sort((a, b) => b[1] - a[1])[0];
  if (up && up[1] >= 5) {
    const [d, g] = up;
    out.push({ lap: null, cls: "up", label: "Remontée", score: (45 + g * 2) * wPos(d.finish), txt: `<b>${esc(d.last)}</b> remonte de P${d.grid} à P${d.finish}`,
      detail: `${plural(g, "place")} gagnée${g > 1 ? "s" : ""} entre la grille et l'arrivée.`, ds: [d], win: [1, LAPS], main: d, from: 0, to: LAPS, who: d, short: `remonte de P${d.grid} à P${d.finish}` });
  }
  return out;
}
// Les faits retenus : au-dessus d'un seuil (une course calme en aura peu), 5 au plus, un même pilote une seule fois
// (sauf prise de tête). Les neutralisations sans gain restent pour les notes du replay (elles sont les bandes jaunes de la frise).
function selectFacts(all) {
  const seen = new Set(), top = [];
  [...all].filter((f) => f.who && f.score >= FACT_MIN).sort((a, b) => b.score - a.score).forEach((f) => {
    if (top.length >= FACT_MAX || (f.cls !== "lead" && seen.has(f.who))) return;
    if (f.cls !== "lead") seen.add(f.who); top.push(f);
  });
  top.push(...all.filter((f) => !f.who && f.lap && f.cls === "sc"));
  top.sort((a, b) => (a.lap ?? LAPS - 0.5) - (b.lap ?? LAPS - 0.5));
  const [w, p2] = finishers;
  if (w) { const g = winnerGap(); top.push({ lap: LAPS, cls: "", label: "Arrivée", score: 0, txt: `Drapeau à damier : <b>${esc(w.last)}</b> gagne`, detail: `${esc(w.name)} gagne${p2 && g != null ? ` avec ${gapS(g)} d'avance sur ${esc(p2.last)}` : ""}.` }); }
  return top;
}

/* --- Les 3 moments : chaque fait rejoué sur les quelques tours qui l'entourent --- */
function renderMoments() {
  const box = $("#moments-list"); if (!box) return;
  MOMENTS = [...FACTS].filter((f) => f.ds && f.ds.length).sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => (a.lap ?? LAPS) - (b.lap ?? LAPS));
  if (!MOMENTS.length) { $("#read-moments").textContent = "Une course sans rebondissement : l'ordre a peu changé du départ à l'arrivée."; box.innerHTML = ""; return; }
  $("#read-moments").innerHTML = `Les ${MOMENTS.length > 1 ? MOMENTS.length + " tournants" : "tournant"} de la course, rejoué${MOMENTS.length > 1 ? "s" : ""} avec les voitures concernées.`;
  box.innerHTML = MOMENTS.map((m, i) => {
    const d = m.main, pa = m.from ? posAt(d, m.from) : d.grid, pb = posAt(d, m.to), mv = pa && pb ? pa - pb : 0;
    return `<article class="mom" data-m="${i}">
      <div class="mom-k"><span class="mom-n">Moment ${i + 1}</span><span>${m.lap ? "Tour " + m.lap : "Toute la course"} · ${esc(m.label)}</span></div>
      <h3 class="mom-t">${m.txt}</h3>
      <p class="mom-d">${m.detail}</p>
      <div class="mom-ba"><span><small>${m.from ? "Tour " + m.from : "Grille"}</small><b>P${pa ?? "—"}</b></span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg><span><small>Tour ${m.to}</small><b>P${pb ?? "—"}</b></span>${mv ? `<span class="mv ${mv > 0 ? "up" : "down"}">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>` : ""}<span class="mom-who"><i style="background:${d.color}"></i>${esc(d.last)}</span><button class="btn ghost mom-play">${IC.play}Rejouer</button></div>
      <div class="mom-stage"><svg class="mom-svg" viewBox="0 0 640 ${momH(m)}" role="img" aria-label="Positions des pilotes concernés, tour par tour"></svg></div>
    </article>`;
  }).join("");
  $$(".mom", box).forEach((el) => {
    const m = MOMENTS[+el.dataset.m]; momDraw(el, m, m.win[0]);
    $(".mom-play", el).addEventListener("click", () => momPlay(el, m));
    whenVisible(el, () => setTimeout(() => momPlay(el, m), 300));
  });
}
const momRange = (m) => { const ps = []; for (let l = m.win[0]; l <= m.win[1]; l++) m.ds.forEach((d) => { const p = pAt(d, l); if (p) ps.push(p); }); return ps.length ? [Math.max(1, Math.min(...ps) - 1), Math.max(...ps) + 1] : [1, 2]; };
const momH = (m) => { const [a, b] = momRange(m); return 34 + Math.min(14, b - a + 1) * 24; };
function momDraw(el, m, at) {
  const svg = $(".mom-svg", el), W = Math.max(300, Math.round(svg.getBoundingClientRect().width) || 640), H = momH(m), [p0, p1] = momRange(m), [l0, l1] = m.win;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
  const X = (l) => 46 + ((l - l0) / Math.max(1, l1 - l0)) * (W - 100), Y = (p) => 14 + ((p - p0) / Math.max(1, p1 - p0)) * (H - 34);
  const posF = (d, t) => { const a = Math.floor(t), u = t - a, pa = pAt(d, a), pb = pAt(d, Math.min(l1, a + 1)); return pa && pb ? pa + (pb - pa) * u : pa || pb || null; };
  let s = "";
  NEUTRAL.forEach((r) => { if (r.end >= l0 && r.start <= l1) s += `<rect x="${X(Math.max(l0, r.start - 1))}" y="4" width="${Math.max(4, X(Math.min(l1, r.end)) - X(Math.max(l0, r.start - 1)))}" height="${H - 18}" class="mom-sc"/>`; });
  for (let p = p0; p <= p1; p++) s += `<line x1="46" x2="${W - 54}" y1="${Y(p)}" y2="${Y(p)}" class="mom-grid"/><text x="36" y="${Y(p)}" class="mom-lbl" text-anchor="end" dominant-baseline="middle">P${p}</text>`;
  const step = Math.max(1, Math.ceil((l1 - l0) / 8));
  for (let l = l0; l <= l1; l += step) s += `<text x="${X(l)}" y="${H - 4}" class="mom-lbl" text-anchor="middle">${l ? "T" + l : "Grille"}</text>`;
  m.ds.forEach((d) => {
    const pts = []; for (let l = l0; l <= Math.min(at, l1); l++) { const p = pAt(d, l); if (p) pts.push(`${X(l).toFixed(1)},${Y(p).toFixed(1)}`); }
    const pf = posF(d, Math.min(at, l1)); if (pf != null && at % 1) pts.push(`${X(at).toFixed(1)},${Y(pf).toFixed(1)}`);
    if (pts.length > 1) s += `<polyline points="${pts.join(" ")}" fill="none" stroke="${d.color}" stroke-width="${d === m.main ? 3.2 : 2}" stroke-linejoin="round" opacity="${d === m.main ? 1 : .55}"/>`;
  });
  svg.innerHTML = s;
  m.ds.forEach((d) => {
    const p = posF(d, Math.min(at, l1)); if (p == null || (DNF[d.code] && at > DNF[d.code] + 1)) return;
    const g = hcEl("g", { transform: `translate(${X(Math.min(at, l1)).toFixed(1)},${Y(p).toFixed(1)}) scale(.7)` }, svg);
    drawTopCar(g, d.color, String(d.dn));
    hcEl("text", { x: 30, y: 1, class: "mom-code", "dominant-baseline": "middle" }, g).textContent = d.code;
  });
}
function momPlay(el, m) {
  if (el._raf) cancelAnimationFrame(el._raf);
  const [l0, l1] = m.win, dur = reduce ? 0 : Math.min(5200, 900 + (l1 - l0) * 380), t0 = performance.now();
  const tick = (now) => { const u = dur ? Math.min(1, (now - t0) / dur) : 1; momDraw(el, m, l0 + (l1 - l0) * u); if (u < 1) el._raf = requestAnimationFrame(tick); else el._raf = 0; };
  el._raf = requestAnimationFrame(tick);
}

/* --- « La course en un coup d'œil » : une frise du départ à l'arrivée, avec les neutralisations et les faits --- */
function renderFrise() {
  const X = (lap) => ((Math.max(1, lap) - 1) / Math.max(1, LAPS - 1)) * 100;
  const evs = [...EVENTS.filter((e) => e.lap && e.who && e.label !== "Remontée")].sort((a, b) => b.score - a.score).slice(0, FRISE_MAX).sort((a, b) => a.lap - b.lap), w = finishers[0];
  // Étiquettes sur deux étages quand deux faits sont trop proches
  let lastX = [-99, -99, -99];
  const items = evs.map((e) => { const x = X(e.lap); let row = lastX.findIndex((lx) => x - lx >= 24); if (row < 0) row = lastX.indexOf(Math.min(...lastX)); lastX[row] = x; return { e, x, row }; });
  const bands = NEUTRAL.filter((r) => r.kind !== "Ralenti").map((r) => `<span class="fr-band" style="left:${X(r.start)}%;width:${Math.max(0.8, X(r.end) - X(r.start))}%" title="${NKlong[r.kind]} T${r.start}–${r.end}"><b>${NK[r.kind]}</b></span>`).join("");
  const ticks = [1, Math.round(LAPS / 4), Math.round(LAPS / 2), Math.round((3 * LAPS) / 4), LAPS].map((l) => `<span class="fr-tick" style="left:${X(l)}%">T${l}</span>`).join("");
  const edge = (x) => (x < 12 ? "l" : x > 85 ? "r" : "");
  const flat = `<div class="frise">
      <div class="fr-track">${bands}<span class="fr-flag" title="Arrivée"></span></div>
      <div class="fr-ticks">${ticks}</div>
      <div class="fr-evs">${items.map(({ e, x, row }, i) => `<button class="fr-ev r${row} ${edge(x)}" style="left:${x}%;--c:${e.who.color}" data-f="${i}"><i class="fr-dot"></i><span class="fr-lbl"><span class="fr-k">T${e.lap} · ${e.who.code}</span>${esc(e.short)}</span></button>`).join("")}</div>
    </div>`;
  const list = `<div class="fr-list">${items.map(({ e }, i) => `<button class="fr-li" style="--c:${e.who.color}" data-f="${i}"><span class="fr-lap">T${e.lap}</span><i class="fr-dot"></i><span><b>${e.who.last}</b> ${esc(e.short)}</span></button>`).join("")}
      ${NEUTRAL.filter((r) => r.kind !== "Ralenti").map((r) => `<div class="fr-li sc"><span class="fr-lap">T${r.start}</span><i class="fr-dot"></i><span>${NKlong[r.kind]} jusqu'au tour ${r.end}</span></div>`).join("")}
      ${w ? `<div class="fr-li end"><span class="fr-lap">T${LAPS}</span><i class="fr-dot"></i><span>Drapeau à damier : <b>${esc(w.last)}</b> gagne</span></div>` : ""}</div>`;
  $("#log").innerHTML = `<div class="log-title">LA COURSE EN UN COUP D'ŒIL</div>${flat}${list}`;
  // Étages des étiquettes : on mesure, puis chaque étiquette prend le premier étage où elle ne chevauche pas sa voisine
  const evEls = $$("#log .fr-ev"); if (evEls.length && $("#log .frise").offsetParent) {
    // Deux étages au plus : si ça ne tient pas, on bascule sur la liste (jamais d'étiquettes qui se chevauchent)
    const rowsEnd = [-1e9, -1e9]; let fits = true;
    evEls.forEach((el) => { el.classList.remove("r0", "r1", "r2"); const r = el.querySelector(".fr-lbl").getBoundingClientRect();
      // Étage où l'étiquette demande le moins de décalage ; jusqu'à 70 px on la pousse à droite, au-delà on bascule sur la liste
      const shifts = rowsEnd.map((end) => Math.max(0, end + 10 - r.left)), row = shifts.indexOf(Math.min(...shifts)), dx = shifts[row];
      const lbl = el.querySelector(".fr-lbl"); lbl.style.transform = dx ? `translateX(${dx}px)` : "";
      if (dx > 70 || r.right + dx > $("#log .frise").getBoundingClientRect().right + 12) { fits = false; return; }
      rowsEnd[row] = r.right + dx; el.classList.add("r" + row); });
    $("#log").classList.toggle("fr-fallback", !fits);
    $("#log .fr-evs").style.height = (rowsEnd.filter((v) => v > -1e9).length * 46 + 34) + "px";
  }
  // La liste mobile se trie par tour
  const L = $("#log .fr-list"); [...L.children].sort((a, b) => +a.querySelector(".fr-lap").textContent.slice(1) - +b.querySelector(".fr-lap").textContent.slice(1)).forEach((n) => L.appendChild(n));
  $$("#log [data-f]").forEach((b) => b.addEventListener("click", () => { const e = items[+b.dataset.f].e; openDialog(`Tour ${e.lap} · ${e.label}`, `<p class="read">${e.txt}. ${e.detail}</p>`); }));
}
