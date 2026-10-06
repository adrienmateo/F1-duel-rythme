/* ======================= Configuration ======================= */
const API = "https://api.openf1.org/v1";
const CFG = { fieldSlowPct: 1.05, maxPct: 1.07, minClean: 10, scBuffer: 1, minCompoundLaps: 3, maxDrivers: 8, gapMs: 400 };
const FUEL = 0.06; // s gagnées par tour grâce à l'allègement en carburant (estimation, sert à corriger l'usure)

/* ======================= Accès API (file d'attente + cache) ======================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
const calls = [];
const memo = new Map();
async function api(endpoint, params) {
  const qs = typeof params === "string" ? params : new URLSearchParams(params).toString();
  const url = `${API}/${endpoint}?${qs}`;
  if (memo.has(url)) return memo.get(url);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = lastCall + CFG.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    // OpenF1 gratuit : 30 appels par minute au plus. On reste sous la barre en patientant en silence.
    for (;;) { while (calls.length && Date.now() - calls[0] > 60000) calls.shift(); if (calls.length < 28) break; await sleep(60000 - (Date.now() - calls[0]) + 50); }
    lastCall = Date.now(); calls.push(lastCall);
    let res;
    try { res = await fetch(url); }
    catch { throw new Error(navigator.onLine === false ? "Pas de connexion internet : impossible de charger les données." : "Les données ne sont pas disponibles en ce moment (une séance de F1 est peut-être en cours). Les GP s'afficheront de nouveau à la fin de la séance."); }
    if (res.ok) { const data = await res.json(); memo.set(url, data); return data; }
    if (res.status === 429) { await sleep(5000 * attempt); continue; } // trop d'appels : on attend sans rien afficher de plus
    if (res.status === 404) return [];
    if (res.status >= 500) { await sleep(2000 * attempt); continue; }
    throw new Error("Les données de ce Grand Prix n'ont pas pu être chargées. Réessaie dans un moment.");
  }
  throw new Error("Les données ne répondent pas pour le moment. Réessaie dans une minute.");
}
const store = {
  key: (sk) => `f1duel:v4:${sk}`,
  get(sk) { try { const v = localStorage.getItem(this.key(sk)); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(sk, data) {
    const v = JSON.stringify(data);
    try { localStorage.setItem(this.key(sk), v); }
    catch { try { Object.keys(localStorage).filter((k) => k.startsWith("f1duel:")).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(this.key(sk), v); } catch {} }
  },
};

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* ======================= Calcul ======================= */
// Ce bloc (jusqu'à « Rendu ») est aussi exécuté par report.mjs : le site et le mail donnent les mêmes chiffres.

// Format allégé commun au site et au compte rendu
// laps : [pilote, tour, durée, sortie des stands, début du tour (ms), secteur 1, secteur 2, secteur 3]
function compactRace(raw) {
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  return {
    laps: raw.laps.filter((l) => l.lap_number).map((l) => [l.driver_number, l.lap_number, num(l.lap_duration), l.is_pit_out_lap ? 1 : 0, l.date_start ? Date.parse(l.date_start) : null, num(l.duration_sector_1), num(l.duration_sector_2), num(l.duration_sector_3)]),
    stints: raw.stints.map((s) => [s.driver_number, s.lap_start, s.lap_end, s.compound]),
    pits: raw.pit.map((p) => [p.driver_number, p.lap_number, num(p.lane_duration ?? p.pit_duration), num(p.stop_duration)]),
    rc: raw.race_control.map((m) => [m.date, m.lap_number ?? null, m.flag || "", m.message || "", m.category || ""]),
  };
}

// Grille de départ : quand OpenF1 n'a pas « starting_grid », on prend la première position connue de chaque pilote
function gridFromPositions(positions) {
  const first = new Map();
  for (const p of [...positions].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) if (!first.has(p.driver_number) && p.position) first.set(p.driver_number, p.position);
  return [...first].map(([driver_number, position]) => ({ driver_number, position }));
}

// 1) Messages de la direction de course → plages SC / VSC / drapeau rouge
function neutralFromMessages(rc, lapOfDate, totalLaps) {
  const ranges = []; let open = null;
  const events = rc.map(([date, lap, flag, message, category]) => ({ t: Date.parse(date), lap: lap ?? lapOfDate(Date.parse(date)), flag, msg: message.toUpperCase(), category }))
    .filter((e) => e.lap != null).sort((a, b) => a.t - b.t);
  const close = (lap) => { ranges.push({ kind: open.kind, start: open.start, end: Math.min(totalLaps, lap + CFG.scBuffer) }); open = null; };
  for (const e of events) {
    let kind = null;
    if (e.msg.includes("VIRTUAL SAFETY CAR DEPLOYED") || e.msg.includes("VSC DEPLOYED")) kind = "VSC";
    else if (e.msg.includes("SAFETY CAR DEPLOYED")) kind = "SC";
    else if (e.flag === "RED" || e.msg.includes("RED FLAG")) kind = "Rouge";
    const ends = e.msg.includes("SAFETY CAR IN THIS LAP") || e.msg.includes("SAFETY CAR ENDING") || e.msg.includes("VSC ENDING")
      || (e.flag === "GREEN" && e.msg.includes("TRACK CLEAR")) || e.msg.includes("RESUME");
    if (kind) { if (open && open.kind !== kind) close(e.lap - 1); if (!open) open = { kind, start: e.lap }; }
    else if (ends && open) close(e.lap);
  }
  if (open) ranges.push({ kind: open.kind, start: open.start, end: totalLaps });
  return ranges;
}

// 2) Filet de sécurité : tours où TOUT le peloton roule lentement (SC, VSC, drapeaux jaunes…)
function neutralFromPace(rows, pitSet, totalLaps) {
  const byLap = new Map();
  for (const [dn, lap, t, pitOut] of rows) {
    if (t == null || lap <= 1 || pitOut || pitSet.has(`${dn}:${lap}`)) continue;
    if (!byLap.has(lap)) byLap.set(lap, []);
    byLap.get(lap).push(t);
  }
  const fieldMed = new Map([...byLap].filter(([, ts]) => ts.length >= 3).map(([lap, ts]) => [lap, median(ts)]));
  const base = median([...fieldMed.values()]);
  const ranges = []; let cur = null;
  for (let lap = 2; lap <= totalLaps; lap++) {
    const slow = fieldMed.has(lap) && fieldMed.get(lap) > base * CFG.fieldSlowPct;
    if (slow) { if (cur) cur.end = lap; else cur = { kind: "Ralenti", start: lap, end: lap }; }
    else if (cur) { ranges.push(cur); cur = null; }
  }
  if (cur) ranges.push(cur);
  return ranges;
}

function mergeRanges(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && last.kind === r.kind && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else if (last && r.start <= last.end) { out.push({ ...r, start: last.end + 1 }); if (out.at(-1).start > out.at(-1).end) out.pop(); }
    else out.push({ ...r });
  }
  return out;
}

function analyse(data) {
  const timed = data.laps.filter((l) => l[2] != null);
  const totalLaps = Math.max(0, ...timed.map((l) => l[1] || 0));
  const pitSet = new Set(data.pits.map(([dn, lap]) => `${dn}:${lap}`));

  // Début de chaque tour pour le leader : sert à dater les messages sans numéro de tour
  const leaderStart = new Map();
  for (const [, lap, , , ds] of data.laps) if (ds != null && (!leaderStart.has(lap) || ds < leaderStart.get(lap))) leaderStart.set(lap, ds);
  const lapOfDate = (t) => { let best = null; for (const [lap, ds] of leaderStart) if (ds <= t && (best == null || lap > best)) best = lap; return best; };

  // Fenêtre de course : on ignore les messages d'avant le départ et d'après l'arrivée
  const raceStart = leaderStart.get(1) ?? -Infinity;
  const lastLapTimes = data.laps.filter((l) => l[1] === totalLaps && l[2] != null && l[4] != null).map((l) => l[4] + l[2] * 1000);
  const raceEnd = lastLapTimes.length ? Math.min(...lastLapTimes) : Infinity;
  const rcInRace = data.rc.filter(([date]) => { const t = Date.parse(date); return !(t < raceStart - 60000) && !(t > raceEnd); });
  // Une neutralisation qui « démarre » au dernier tour est en pratique un message de fin de course : on l'ignore.
  const msgRanges = mergeRanges(neutralFromMessages(rcInRace, lapOfDate, totalLaps)).filter((r) => r.start < totalLaps);
  const lapKind = new Map();
  for (const r of msgRanges) for (let l = r.start; l <= r.end; l++) if (!lapKind.has(l)) lapKind.set(l, r.kind);
  const paceRanges = neutralFromPace(data.laps, pitSet, totalLaps).filter((r) => {
    let hit = false; for (let l = r.start; l <= r.end; l++) if (lapKind.has(l)) hit = true; return !hit;
  });
  for (const r of paceRanges) for (let l = r.start; l <= r.end; l++) lapKind.set(l, r.kind);
  const neutral = { ranges: [...msgRanges, ...paceRanges].sort((a, b) => a.start - b.start), laps: lapKind };

  const compoundOf = (dn, lap) => data.stints.find((s) => s[0] === dn && lap >= s[1] && lap <= (s[2] ?? 999))?.[3] || "UNKNOWN";
  const perDriver = new Map(), starts = new Map();
  for (const [dn, lap, t, pitOut, ds, s1, s2, s3] of data.laps) {
    if (!starts.has(dn)) starts.set(dn, new Map());
    starts.get(dn).set(lap, { ds, t, pitOut });
    if (t == null) continue;
    let reason = null;
    if (lap <= 1) reason = "Départ";
    else if (pitOut) reason = "Sortie des stands";
    else if (pitSet.has(`${dn}:${lap}`)) reason = "Entrée aux stands";
    else if (lapKind.has(lap)) { const k = lapKind.get(lap); reason = k === "Rouge" ? "Drapeau rouge" : k === "Ralenti" ? "Peloton ralenti" : k; }
    if (!perDriver.has(dn)) perDriver.set(dn, []);
    perDriver.get(dn).push({ lap, t, c: compoundOf(dn, lap), reason, ds, s: s1 != null && s2 != null && s3 != null ? [s1, s2, s3] : null });
  }

  const result = new Map();
  for (const [dn, laps] of perDriver) {
    laps.sort((a, b) => a.lap - b.lap);
    const m0 = median(laps.filter((x) => !x.reason).map((x) => x.t));
    for (const x of laps) if (!x.reason && x.t > m0 * CFG.maxPct) x.reason = "Tour lent (>107 %)";
    const clean = laps.filter((x) => !x.reason);
    const perCompound = {};
    for (const x of clean) (perCompound[x.c] ??= []).push(x.t);
    // Heure de passage sur la ligne à la fin de chaque tour (pour l'écart cumulé et les positions)
    const st = starts.get(dn) || new Map(), lineAt = new Map();
    const reliableStart = (lap) => { const q = st.get(lap); return q && q.ds != null && !q.pitOut ? q.ds : null; };
    const lastLap = Math.max(0, ...st.keys());
    let prevEnd = null;
    for (let lap = 1; lap <= lastLap; lap++) {
      const q = st.get(lap);
      let end = null;
      if (prevEnd != null && q?.t != null) end = prevEnd + q.t * 1000;
      else if (reliableStart(lap + 1) != null) end = reliableStart(lap + 1);
      else if (q?.ds != null && q?.t != null && !q.pitOut) end = q.ds + q.t * 1000;
      if (end != null) lineAt.set(lap, end);
      prevEnd = end;
    }
    result.set(dn, {
      laps, n: clean.length, median: median(clean.map((x) => x.t)),
      perCompound: Object.fromEntries(Object.entries(perCompound).map(([c, ts]) => [c, { median: median(ts), n: ts.length }])),
      stints: data.stints.filter((s) => s[0] === dn).sort((a, b) => a[1] - b[1]).map((s) => ({ c: s[3] || "UNKNOWN", from: s[1], to: s[2] })),
      pits: data.pits.filter((p) => p[0] === dn).map((p) => p[1]),
      stops: data.pits.filter((p) => p[0] === dn).map((p) => ({ lap: p[1], lane: p[2] ?? null, stop: p[3] ?? null })),
      lineAt,
    });
  }
  return { totalLaps, neutral, drivers: result };
}

// Écart « à pneus égaux », en secondes par tour : uniquement sur les gommes utilisées par les deux pilotes,
// pondéré par le nombre de tours. Positif : d est plus lent que ref sur le même pneu.
function sameCompoundGap(d, ref) {
  let w = 0, g = 0;
  for (const [c, pd] of Object.entries(d.perCompound)) {
    const pr = ref.perCompound[c];
    if (!pr || c === "UNKNOWN" || pd.n < CFG.minCompoundLaps || pr.n < CFG.minCompoundLaps) continue;
    const k = Math.min(pd.n, pr.n);
    g += (pd.median - pr.median) * k; w += k;
  }
  return w ? g / w : null;
}

/* ======================= Rendu ======================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fr = (x, d = 3) => x.toFixed(d).replace(".", ",");
const gapS = (x) => (x == null ? "—" : (x >= 0 ? "+" : "−") + fr(Math.abs(x)) + " s");
const raceT = (t) => { const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60); return `${h} h ${String(m).padStart(2, "0")} min ${fr(t % 60, 3).padStart(6, "0")} s`; };
const lapT = (t) => { const m = Math.floor(t / 60); return `${m}:${fr(t - m * 60).padStart(6, "0")}`; };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const last = (n) => String(n).split(" ").slice(-1)[0];
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
const COMP = {
  S: { name: "Tendre", c: "#da291c" }, M: { name: "Médium", c: "#f2b705" }, H: { name: "Dur", c: "#b8bcc4" },
  I: { name: "Intermédiaire", c: "#43b02a" }, W: { name: "Pluie", c: "#0067ad" }, "?": { name: "Inconnu", c: "#898781" },
};
const LETTER = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W", UNKNOWN: "?" };
const NK = { SC: "SC", VSC: "VSC", Rouge: "Drapeau rouge", Ralenti: "Ralenti" };
const NKlong = { SC: "Safety car", VSC: "Virtual safety car", Rouge: "Drapeau rouge", Ralenti: "Peloton ralenti" };

/* ---------- État de la course affichée ---------- */
let RACE = null;                 // session OpenF1
let LAPS = 1, NEUTRAL = [];
let drivers = [], byCode = {}, finishers = [], dnfs = [], paced = [], TEAMS = [], DNF = {}, EVENTS = [];

/* ---------- Modèle : on transforme les données OpenF1 en objets prêts à afficher ---------- */
function buildModel(session, raw) {
  const A = analyse(raw.data);
  RACE = session; LAPS = Math.max(1, A.totalLaps); NEUTRAL = A.neutral.ranges;
  const results = new Map(raw.results.map((r) => [r.driver_number, r]));
  const gridPos = new Map(raw.grid.map((g) => [g.driver_number, g.position]));
  const isOut = (r) => !r || r.dnf || r.dns || r.dsq;
  const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

  drivers = raw.drivers.filter((x) => A.drivers.has(x.driver_number)).map((x) => {
    const s = A.drivers.get(x.driver_number), r = results.get(x.driver_number);
    const first = x.first_name || "", lastN = x.last_name || "";
    const name = first && lastN ? `${first} ${titleCase(lastN)}` : titleCase(x.full_name || x.broadcast_name || x.name_acronym);
    const laps = [];
    for (const l of s.laps) laps[l.lap - 1] = { lap: l.lap, t: l.t, comp: LETTER[l.c] || "?", reason: l.reason, s: l.s, ds: l.ds };
    const clean = s.laps.filter((l) => !l.reason).map((l) => laps[l.lap - 1]);
    const withS = clean.filter((l) => l.s);
    const stints = s.stints.map((st) => [LETTER[st.c] || "?", st.from, st.to ?? LAPS]);
    const compAt = (lap) => (stints.find(([, a, b]) => lap >= a && lap <= b) || [laps[lap - 1]?.comp || null])[0];
    const out = isOut(r) && !!r;
    return {
      dn: x.driver_number, code: x.name_acronym || String(x.driver_number), name, last: lastN ? titleCase(lastN) : last(name),
      team: x.team_name || "—", color: "#" + (x.team_colour || "898781"),
      s, laps, clean, stints, compAt, pits: s.pits, stops: s.stops,
      median: s.n >= CFG.minClean ? s.median : null,
      best: clean.length ? Math.min(...clean.map((l) => l.t)) : null,
      bestS: withS.length ? [0, 1, 2].map((k) => Math.min(...withS.map((l) => l.s[k]))) : null,
      medS: withS.length ? [0, 1, 2].map((k) => median(withS.map((l) => l.s[k]))) : null,
      grid: gridPos.get(x.driver_number) || null,
      result: r || null, out: !r || isOut(r), outLap: r ? r.number_of_laps ?? null : null,
      status: !r ? "inconnu" : r.dsq ? "disqualifié" : r.dns ? "non partant" : r.dnf ? "abandon" : "classé",
      pos: [], gapLead: [], cum: [], drs: 0, deg: [],
    };
  });
  drivers.forEach((d) => { d.ideal = d.bestS ? d.bestS.reduce((a, b) => a + b, 0) : null; });
  byCode = Object.fromEntries(drivers.map((d) => [d.code, d]));

  // Recalage sur le résultat officiel : les heures de passage s'obtiennent en additionnant les temps au tour,
  // ce qui accumule de petites erreurs. Pour chaque pilote arrivé dans le même tour que le vainqueur, on répartit
  // l'écart entre l'écart calculé et l'écart officiel à l'arrivée sur tous ses tours.
  const win = drivers.find((d) => d.result?.position === 1 && !isOut(d.result));
  const wEnd = win && win.s.lineAt.get(win.result.number_of_laps ?? LAPS);
  if (wEnd != null) drivers.forEach((d) => {
    const r = d.result, n = r?.number_of_laps, g = d === win ? 0 : r?.gap_to_leader;
    if (!r || isOut(r) || typeof g !== "number" || n !== win.result.number_of_laps) return;
    const end = d.s.lineAt.get(n); if (end == null) return;
    const delta = wEnd + g * 1000 - end; if (!delta || Math.abs(delta) > 30000) return;
    const adj = new Map(); d.s.lineAt.forEach((t, lap) => adj.set(lap, t + delta * Math.min(1, lap / n))); d.s.lineAt = adj;
  });
  // Positions et écarts : heure de passage sur la ligne de chaque pilote, tour par tour
  const t0 =Math.min(...drivers.map((d) => d.s.lineAt.get(1)).filter((v) => v != null));
  for (let lap = 1; lap <= LAPS; lap++) {
    const at = drivers.map((d) => [d, d.s.lineAt.get(lap)]).filter(([, t]) => t != null).sort((a, b) => a[1] - b[1]);
    if (!at.length) continue;
    const lead = at[0][1];
    at.forEach(([d, t], k) => {
      d.pos[lap - 1] = k + 1; d.gapLead[lap - 1] = (t - lead) / 1000; d.cum[lap - 1] = (t - t0) / 1000;
      // Bataille : moins d'une seconde derrière la voiture devant, hors neutralisation et hors stands
      if (k && lap > 1 && !A.neutral.laps.has(lap) && !d.pits.includes(lap) && !d.pits.includes(lap - 1) && (t - at[k - 1][1]) < 1000) d.drs++;
    });
  }

  // Classement final : l'ordre officiel d'abord, puis les non classés
  finishers = drivers.filter((d) => !d.out).sort((a, b) => (a.result.position ?? 99) - (b.result.position ?? 99));
  dnfs = drivers.filter((d) => d.out).sort((a, b) => (b.outLap ?? b.laps.length) - (a.outLap ?? a.laps.length));
  [...finishers, ...dnfs].forEach((d, i) => { d.finish = d.result?.position ?? i + 1; d.order = i + 1; });
  DNF = Object.fromEntries(dnfs.map((d) => [d.code, d.outLap ?? d.laps.length]));
  paced = drivers.filter((d) => d.median != null).sort((a, b) => a.median - b.median);
  paced.forEach((d, i) => (d.paceRank = i + 1));

  // Usure des pneus : pente des temps au tour sur chaque relais (≥ 6 tours propres), corrigée du carburant
  drivers.forEach((d) => d.stints.forEach(([c, a, b]) => {
    const pts = d.clean.filter((l) => l.lap >= a && l.lap <= b).map((l) => [l.lap - a, l.t + FUEL * l.lap]);
    if (pts.length < 6 || c === "?") return;
    const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
    const k = pts.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    if (isFinite(k)) d.deg.push({ c, a, b, len: n, k });
  }));

  // Écuries (pour les duels)
  const teams = new Map();
  for (const d of drivers) { if (!teams.has(d.team)) teams.set(d.team, []); teams.get(d.team).push(d); }
  TEAMS = [...teams].filter(([, ds]) => ds.length === 2).map(([team, ds]) => ({ team, color: ds[0].color, ds }));

  // Faits de course pour la direction de course et le replay
  const ev = [];
  NEUTRAL.forEach((r) => {
    const stopped = drivers.filter((d) => d.pits.some((p) => p >= r.start && p <= r.end)).length;
    const n = r.end - r.start + 1;
    ev.push({ lap: r.start, cls: "sc", kind: r.kind,
      txt: r.kind === "Ralenti" ? `Peloton ralenti${n > 1 ? ` jusqu'au tour ${r.end}` : ""}` : `<b>${NKlong[r.kind]}</b>${n > 1 ? ` jusqu'au tour ${r.end}` : ""}`,
      detail: r.kind === "Ralenti" ? "Tout le peloton roule plus lentement sans message officiel : drapeaux jaunes probables."
        : `${plural(n, "tour")} neutralisé${n > 1 ? "s" : ""}.${stopped ? ` ${stopped} pilote${stopped > 1 ? "s" : ""} en profite${stopped > 1 ? "nt" : ""} pour s'arrêter.` : ""}` });
  });
  const outByLap = new Map();
  dnfs.filter((d) => d.result && !d.result.dns).forEach((d) => { const l = Math.max(1, Math.min(LAPS, (d.outLap ?? 0) + 1)); if (!outByLap.has(l)) outByLap.set(l, []); outByLap.get(l).push(d); });
  for (const [lap, ds] of outByLap) {
    const names = ds.map((d) => d.last);
    const de = (n) => (/^[aeiouyhàâéèêîôû]/i.test(n) ? "d'" : "de ") + n;
    const was = ds.length === 1 && ds[0].pos[ds[0].outLap - 1] ? ` Il était P${ds[0].pos[ds[0].outLap - 1]}.` : "";
    ev.push({ lap, cls: "out", txt: ds.length === 1 ? `${ds[0].result.dsq ? "Disqualification" : "Abandon"} ${de(names[0])}` : `${names.slice(0, -1).join(", ")} et ${names.at(-1)} : ${ds.length} abandons`,
      detail: ds.length === 1 ? `${ds[0].team}, après ${plural(ds[0].outLap ?? 0, "tour")}.${was}` : `Après ${plural(lap - 1, "tour")}.` });
  }
  const [w, p2] = finishers;
  if (w) ev.push({ lap: LAPS, cls: "", txt: "Drapeau à damier", detail: `${w.name} gagne${p2 ? ` avec ${gapS(winnerGap())} d'avance` : ""}.` });
  EVENTS = ev.sort((a, b) => a.lap - b.lap);
  // Haut de page et replay : les faits marquants repérés dans les données (voir moments.js)
  FACTS = buildFacts(); EVENTS = selectFacts(FACTS);
}
function winnerGap() {
  const [w, p2] = finishers; if (!w || !p2) return null;
  const g = p2.result?.gap_to_leader;
  if (typeof g === "number") return g;
  const a = w.cum[LAPS - 1], b = p2.cum[LAPS - 1];
  return a != null && b != null ? b - a : null;
}
const resultGap = (d) => { const g = d.result?.gap_to_leader; if (typeof g === "number") return gapS(g); if (typeof g === "string" && g) return g.replace(/(\d+)\s*LAPS?/i, (m, n) => `${n} tour${n > 1 ? "s" : ""}`); return d === finishers[0] ? "" : gapS(d.cum[LAPS - 1] - finishers[0].cum[LAPS - 1]); };
const isNeutral = (lap) => NEUTRAL.find((r) => lap >= r.start && lap <= r.end);

/* ======================= Section 1 : Le GP en 30 secondes ======================= */
function renderHero() {
  const [p1, p2, p3] = finishers;
  const g = winnerGap();
  const verb = g == null ? "remporte le GP devant" : g < 1.5 ? "résiste à" : g < 8 ? "devance" : "domine";
  $("#headline").textContent = p1 ? (p2 ? `${p1.last} ${verb} ${p2.last}` : `${p1.last} gagne`) : `${RACE.country_name} ${RACE.year}`;
  $("#gp-eyebrow").textContent = `Le GP en 30 secondes · ${new Date(RACE.date_start).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;
  $("#gp-meta").textContent = `${LAPS} tours · ${RACE.location || RACE.circuit_short_name || ""}`;
  const fastest = paced[0];
  // Classement complet : podium mis en valeur, puis le reste en lignes compactes, non classés à la fin
  const move = (d) => { if (!d.grid || d.out) return ""; const m = d.grid - d.finish; return m ? `<span class="mv ${m > 0 ? "up" : "down"}" title="Parti P${d.grid}">${m > 0 ? "▲" : "▼"}${Math.abs(m)}</span>` : `<span class="mv" title="Parti P${d.grid}">=</span>`; };
  const row = (d, i) => `<button class="tower-row ${i === 0 ? "p1" : ""} ${i > 2 ? "compact" : ""} ${d.out ? "is-out" : ""}" data-driver="${d.code}">
      <span class="pos">${d.out ? "—" : "P" + d.finish}</span><span class="bar" style="background:${d.color}"></span>
      <span class="name">${esc(d.last)}</span>${move(d)}
      ${d.out ? `<span class="val mono">${d.status === "abandon" ? `abandon T${(d.outLap ?? 0) + 1}` : d.status}</span>`
        : i === 0 ? (d === fastest ? '<span class="tag">MEILLEUR RYTHME</span>' : `<span class="val mono">${d.result?.duration ? raceT(d.result.duration) : ""}</span>`) : `<span class="val mono">${esc(resultGap(d))}</span>`}
    </button>`;
  const all = [...finishers, ...dnfs];
  $("#tower").classList.remove("open"); $("#tower").parentElement.classList.remove("open");
  $("#tower").innerHTML = all.slice(0, 3).map(row).join("") + (all.length > 3
    ? `<div class="tower-more" id="tower-more"><div>${all.slice(3).map((d, i) => row(d, i + 3)).join("")}</div></div>
       <button class="tower-toggle" id="tower-toggle" aria-expanded="false" aria-controls="tower-more"><span>Voir tout le classement (${all.length} pilotes)</span>${IC.chev}</button>` : "");
  fitTower();
  $("#tower-toggle")?.addEventListener("click", () => {
    const t = $("#tower"), more = $("#tower-more"), open = !t.classList.contains("open");
    t.classList.toggle("open", open); t.parentElement.classList.toggle("open", open);
    more.style.maxHeight = (open ? more.scrollHeight : fitTower.h) + "px";
    $("#tower-toggle").setAttribute("aria-expanded", open);
    labelTower();
    if (!open) t.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  });
  const segs = []; let prev = 1;
  NEUTRAL.forEach((r) => { if (r.start > prev) segs.push(`<span style="flex:${r.start - prev}"></span>`); segs.push(`<span class="sc" style="flex:${r.end - r.start + 1}" title="${NKlong[r.kind]} T${r.start}–${r.end}"></span>`); prev = r.end + 1; });
  if (prev <= LAPS) segs.push(`<span style="flex:${LAPS - prev + 1}"></span>`);
  renderFrise();

  const movers = finishers.filter((d) => d.grid).sort((a, b) => (b.grid - b.finish) - (a.grid - a.finish));
  const duels = computeDuels().filter((x) => x.valid);
  const nLaps = NEUTRAL.filter((r) => r.kind !== "Ralenti").reduce((s, r) => s + r.end - r.start + 1, 0);
  const kpis = [];
  if (g != null) kpis.push({ v: gapS(g), l: "entre le vainqueur et le 2e", more: "Voir le 2e", go: () => showDriver(p2.code) });
  if (false) kpis.push(nLaps ? { v: plural(nLaps, "tour"), l: `sous neutralisation (${NEUTRAL.filter((r) => r.kind !== "Ralenti").map((r) => `${NK[r.kind]} T${r.start}${r.end > r.start ? "–" + r.end : ""}`).join(", ")})`, more: "Voir la course", go: () => (location.hash = "course") }
    : { v: "0 tour", l: "sous safety car : course jamais neutralisée", more: "Voir la course", go: () => (location.hash = "course") });
  if (movers[0] && movers[0].grid - movers[0].finish > 0) kpis.push({ v: `+${movers[0].grid - movers[0].finish} places`, l: `plus belle remontée : ${movers[0].last} (P${movers[0].grid} → P${movers[0].finish})`, more: "Voir son GP", go: () => showDriver(movers[0].code) });
  if (false && duels[0]) kpis.push({ v: gapS(duels[0].gap), l: `plus grand écart entre coéquipiers (${duels[0].team})`, more: "Voir le duel", go: () => showDuel(duels[0]) });
  $("#kpis").innerHTML = kpis.map((k, i) => `<button class="kpi lift" data-k="${i}"><span class="v mono">${k.v}</span><span class="l">${esc(k.l)}</span><span class="more">${k.more} →</span></button>`).join("");
  $$("#kpis .kpi").forEach((b) => b.addEventListener("click", () => kpis[+b.dataset.k].go()));
  $$("#tower .tower-row").forEach((b) => b.addEventListener("click", () => showDriver(b.dataset.driver)));
}

// Le classement remplit la hauteur de la carte « direction de course », puis le bouton déplie le reste
function fitTower() {
  const t = $("#tower"), more = $("#tower-more"), btn = $("#tower-toggle");
  if (!more || t.classList.contains("open")) return;
  const rows = [...more.querySelectorAll(".tower-row")];
  more.style.transition = "none"; more.style.maxHeight = "0px"; void more.offsetHeight; // hauteur naturelle de la carte voisine
  t.style.setProperty("--tg", "0px");
  const side = t.parentElement.getBoundingClientRect().width > t.getBoundingClientRect().width * 1.5; // deux colonnes
  const rowH = rows[0] ? rows[0].offsetHeight + 2 : 34;
  let n;
  if (side) {
    const podium = [...t.querySelectorAll(":scope > .tower-row")].reduce((s, r) => s + r.offsetHeight + 2, 0);
    const pad = parseFloat(getComputedStyle(t).paddingTop) + parseFloat(getComputedStyle(t).paddingBottom);
    const free = $("#log").offsetHeight - pad - podium - btn.offsetHeight - 8;
    n = Math.max(0, Math.floor(free / rowH));
  } else n = 5;
  n = Math.min(n, rows.length);
  // L'espace restant (moins d'une ligne) est réparti entre les lignes : pas de trou en bas de la carte
  t.style.setProperty("--tg", "0px");
  if (side && n < rows.length) {
    const podium = [...t.querySelectorAll(":scope > .tower-row")].reduce((s, r) => s + r.offsetHeight + 2, 0);
    const pad = parseFloat(getComputedStyle(t).paddingTop) + parseFloat(getComputedStyle(t).paddingBottom);
    const left = $("#log").offsetHeight - pad - podium - btn.offsetHeight - 8 - n * rowH;
    t.style.setProperty("--tg", Math.max(0, Math.min(14, left / (n + 3))) + "px");
  }
  fitTower.h = n ? rows[n - 1].offsetTop + rows[n - 1].offsetHeight - rows[0].offsetTop + 6 : 0;
  fitTower.hidden = rows.length - n;
  more.style.maxHeight = fitTower.h + "px"; void more.offsetHeight; more.style.transition = "";
  btn.hidden = fitTower.hidden === 0;
  labelTower();
}
function labelTower() {
  const open = $("#tower").classList.contains("open"), s = $("#tower-toggle span");
  if (s) s.textContent = open ? "Replier le classement" : `Voir tout le classement (${fitTower.hidden} pilote${fitTower.hidden > 1 ? "s" : ""} de plus)`;
}
addEventListener("resize", () => { if ($("#tower-more")) fitTower(); });
if (document.fonts) document.fonts.ready.then(() => $("#tower-more") && fitTower());

/* ======================= Duels ======================= */
function computeDuels() {
  return TEAMS.map(({ team, color, ds }) => {
    const [a, b] = ds;
    if (a.median == null || b.median == null) return { team, color, valid: false, out: [a, b].filter((x) => x.median == null).map((x) => x.name) };
    const [fast, slow] = a.median <= b.median ? [a, b] : [b, a];
    return { team, color, valid: true, fast, slow, gap: slow.median - fast.median, same: sameCompoundGap(slow.s, fast.s) };
  }).sort((x, y) => (y.valid - x.valid) || ((y.gap || 0) - (x.gap || 0)));
}
function renderDuels() {
  const duels = computeDuels();
  const valid = duels.filter((d) => d.valid);
  if (!valid.length) { $("#read-duels").textContent = "Aucun duel comparable sur cette course."; $("#duel-list").innerHTML = ""; return; }
  const max = valid[0].gap;
  const strat = valid.filter((d) => d.same != null && d.same < 0);
  const tight = valid[valid.length - 1];
  $("#read-duels").innerHTML = `<b>${valid[0].fast.last}</b> a dominé ${valid[0].slow.last} de <b>${gapS(valid[0].gap)}</b> au tour.` + (tight !== valid[0] ? ` Le duel le plus serré est chez ${tight.team} (${gapS(tight.gap)}).` : "") +
    (strat.length ? ` Chez ${strat[0].team}, l'écart venait de la stratégie : à pneus égaux, ${strat[0].slow.last} était plus rapide.` : "");
  $("#duel-list").innerHTML = `<div class="duel duel-head x-grid x-only"><span class="fine">Écurie</span><span class="fine">Écart de rythme médian</span><span class="fine who-h">Duel</span></div>` +
    duels.map((d, i) => d.valid ? `<button class="duel lift" data-d="${i}" data-codes="${d.fast.code} ${d.slow.code}">
      <span class="team"><i class="dot" style="background:${d.color}"></i>${esc(d.team)}</span>
      <span class="track"><span class="fill" style="display:block;background:${d.color}" data-w="${Math.max(0.6, (d.gap / max) * 100)}"></span></span>
      <span class="who"><span class="pair"><b>${d.fast.code}</b> <span class="slow">› ${d.slow.code}</span></span>${d.same != null && d.same < 0 ? `<span class="strat" title="À pneus égaux, ${esc(d.slow.last)} était plus rapide">STRAT</span>` : "<span></span>"}<span class="gap">${gapS(d.gap)}</span></span>
    </button>` : `<div class="na">${esc(d.team)} non comparable : ${esc(d.out.join(", "))} sans assez de tours représentatifs.</div>`).join("");
  $$("#duel-list .duel[data-d]").forEach((b) => b.addEventListener("click", () => showDuel(duels[+b.dataset.d])));
  const grow = () => $$("#duels .duel .fill").forEach((f, k) => setTimeout(() => (f.style.width = f.dataset.w + "%"), reduce ? 0 : k * 60));
  if (renderDuels.seen) setTimeout(grow, 50); else whenVisible($("#duels"), () => { renderDuels.seen = true; grow(); });
}

/* ======================= Graphiques (ECharts) ======================= */
const charts = {};
function theme() {
  return { ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), line: css("--line"), track: css("--track"), surface: css("--surface"),
    accent: css("--accent"), purple: css("--purple"), good: css("--good"), bad: css("--bad"), grey: css("--grey-line"), sc: css("--sc"), scInk: css("--sc-ink"),
    s: [css("--s1"), css("--s2"), css("--s3"), css("--s4")] };
}
function base(T) {
  return {
    animationDuration: reduce ? 0 : 1100, animationEasing: "cubicOut", animationDurationUpdate: reduce ? 0 : 600,
    textStyle: { fontFamily: "IBM Plex Sans, system-ui, sans-serif", color: T.ink2 },
    tooltip: { backgroundColor: T.surface, borderColor: T.line, borderWidth: 1, padding: [10, 12], textStyle: { color: T.ink, fontSize: 13 }, extraCssText: "border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.18);" },
    grid: { left: 48, right: 64, top: 24, bottom: 40, containLabel: false },
  };
}
const axisCommon = (T) => ({ axisLine: { lineStyle: { color: T.line } }, axisTick: { show: false }, axisLabel: { color: T.muted, fontFamily: "JetBrains Mono, monospace", fontSize: 11 }, splitLine: { lineStyle: { color: T.track } } });
const neutralArea = (T, upto = LAPS, label = true) => ({ silent: true, itemStyle: { color: T.sc, opacity: 0.16 },
  label: { show: label, position: "insideTop", color: T.scInk, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
  data: NEUTRAL.filter((r) => r.start <= upto).map((r) => [{ xAxis: r.start - 1, name: r.kind === "Rouge" ? "Rouge" : r.kind === "Ralenti" ? "" : NK[r.kind] }, { xAxis: Math.min(r.end, upto) - 1 }]) });
function mount(id, build, after) {
  const el = document.getElementById(id);
  charts[id] = { el, build, inst: null };
  whenVisible(el, () => { draw(id); after && after(); });
}
function draw(id) {
  const c = charts[id];
  if (!c || !c.el || !window.echarts) return;
  if (c.inst) c.inst.dispose();
  c.inst = echarts.init(c.el, null, { renderer: "svg" });
  c.inst.setOption(c.build(theme()));
  if (c.onClick) c.inst.on("click", c.onClick);
  if (id === "ch-course") setTimeout(bindCursor, 0);
  return c.inst;
}
function update(id, notMerge = true) { const c = charts[id]; if (c && c.inst) c.inst.setOption(c.build(theme()), { notMerge }); }
function whenVisible(el, fn) {
  let done = false; const go = () => { if (!done) { done = true; fn(); } };
  if (!("IntersectionObserver" in window)) return go();
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: "0px 0px -15% 0px" });
  io.observe(el);
  setTimeout(go, 2500);
}
new ResizeObserver(() => { Object.values(charts).forEach((c) => c.inst && c.inst.resize()); placeCursor(); }).observe(document.body);

/* ======================= Pilote suivi, replay ======================= */
let follow = [], showField = false, holdTicks = 0, coursePinned = [], courseMode = "pos";
let replayLap = 1, playing = false, playT = null, rythmeReveal = false;
let exSel = [], exMode = "laps", exAll = false;
// Raison d'un tour lent, en mots simples (sans pourcentage)
const slowWhy = (r) => (/lent/i.test(r) ? "tour lent (trafic, erreur…)" : r === "SC" || r === "VSC" || r === "Rouge" ? NKlong[r] : r);
const isMate2 = (d) => drivers.filter((x) => x.team === d.team)[1] === d;
const dashIf = (d, set) => (isMate2(d) && set.some((c) => c !== d.code && byCode[c]?.team === d.team) ? [6, 4] : "solid");
const F = (code) => !follow.length || follow.includes(code);
const coursePins = () => (follow.length ? follow : coursePinned);
const IC = {
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>',
  pause: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.5 2.9 1-6.1L3.1 9.5l6.1-.9z"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>',
};

function toggleFollow(code) {
  if (!byCode[code]) return;
  const i = follow.indexOf(code);
  if (i >= 0) follow.splice(i, 1); else follow.push(code);
  applyFollow(true);
}
function applyFollow(announce) {
  const pill = $("#follow");
  if (follow.length) {
    $("#follow-txt").innerHTML = follow.length === 1 ? `Pilote suivi : <b>${esc(byCode[follow[0]].last)}</b>`
      : follow.length === 2 ? `Duel suivi : ${follow.map((c) => `<b>${esc(byCode[c].last)}</b>`).join(" contre ")}`
      : `<b>${follow.length} pilotes</b> suivis : ${follow.slice(0, 4).join(", ")}${follow.length > 4 ? "…" : ""}`;
    pill.hidden = false; requestAnimationFrame(() => pill.classList.add("on"));
  } else { pill.classList.remove("on"); setTimeout(() => { if (!follow.length) pill.hidden = true; }, 250); }
  renderCourseChips(); syncPickBtn();
  ["ch-course", "ch-rythme", "ch-strat", "ch-deg", "ch-drs"].forEach((id) => update(id, false));
  $$("#duel-list .duel[data-codes]").forEach((r) => { const has = follow.some((c) => r.dataset.codes.split(" ").includes(c)); r.classList.toggle("followed", follow.length > 0 && has); r.classList.toggle("dimmed", follow.length > 0 && !has); });
  if (follow.length >= 2 && follow.length <= 4) { exSel = [...follow]; renderExChips(); readEx(); update("ch-ex"); }
  renderBoard();
  if (announce && follow.length) toast(`${follow.length === 1 ? "Pilote suivi" : follow.length === 2 ? "Duel suivi" : follow.length + " pilotes suivis"} : mis en avant dans <b>tous les graphiques</b>`);
}

/* --- La course --- */
const CAR_PATH = "path://M0,0 L0.01,0 L0.01,0.01 Z M40,20 L39.99,20 L39.99,19.99 Z M3.5,7.4 L11,5.6 L18.5,5.4 L21.5,7 L29,8.3 L36.5,9.2 L39.5,10 L36.5,10.8 L29,11.7 L21.5,13 L18.5,14.6 L11,14.4 L3.5,12.6 Z M15.5,8.7 L14,10 L15.5,11.3 L19.5,11 L19.5,9 Z", CAR_DARK = "path://M0,0 L0.01,0 L0.01,0.01 Z M40,20 L39.99,20 L39.99,19.99 Z M0,2 L3,2 L3,18 L0,18 Z M5,0.6 L11.5,0.6 L11.5,4.8 L5,4.8 Z M5,15.2 L11.5,15.2 L11.5,19.4 L5,19.4 Z M27,1.4 L32,1.4 L32,5 L27,5 Z M27,15 L32,15 L32,18.6 L27,18.6 Z M36,2.2 L38.4,2.2 L38.4,17.8 L36,17.8 Z";
function buildCourse(T) {
  const o = base(T);
  const laps = Array.from({ length: LAPS }, (_, i) => i + 1);
  const pins = coursePins();
  const series = drivers.map((d, n) => {
    const pin = pins.indexOf(d.code);
    const src = courseMode === "pos" ? d.pos : d.gapLead;
    const data = laps.map((_, k) => (k < replayLap && src[k] != null ? (courseMode === "pos" ? src[k] : +src[k].toFixed(3)) : null));
    return {
      name: d.code, type: "line", data, symbol: "none", smooth: 0.15, smoothMonotone: "x", z: pin >= 0 ? 5 : 2,
      silent: !(showField || !pins.length) && pin < 0,
      lineStyle: { width: pin >= 0 ? (pins.length > 6 ? 2.2 : 3) : 1.2, color: pin >= 0 ? d.color : T.grey, opacity: pin >= 0 ? 1 : showField || !pins.length ? 0.7 : 0, type: pin >= 0 ? dashIf(d, pins) : "solid" },
      emphasis: { focus: "series", lineStyle: { width: 3.5, color: pin >= 0 ? d.color : T.accent } },
      endLabel: { show: pin >= 0, formatter: "{a}", color: T.ink, fontFamily: "JetBrains Mono, monospace", fontWeight: 700, fontSize: 12, distance: 22 },
      // Petite F1 aux couleurs de l'écurie en tête de ligne

      ...(n === 0 ? { markArea: neutralArea(T, replayLap) } : {}),
    };
  });
  // Petite F1 aux couleurs de l'écurie en tête de ligne de chaque pilote suivi
  const head = Math.min(replayLap, LAPS) - 1;
  const heads = pins.map((c) => byCode[c]).filter((d) => d && (courseMode === "pos" ? d.pos : d.gapLead)[head] != null)
    .map((d) => { const v = (courseMode === "pos" ? d.pos : d.gapLead)[head]; return { d, value: [head, courseMode === "pos" ? v : +v.toFixed(3)] }; });
  // Deux couches alignées : roues et ailerons sombres, puis la carrosserie aux couleurs de l'écurie
  series.push({ type: "scatter", silent: true, z: 8, animation: false, tooltip: { show: false },
    data: heads.map(({ value }) => ({ value, symbol: CAR_DARK, symbolSize: [36, 18], itemStyle: { color: "#15171b", opacity: 1 } })) });
  series.push({ type: "scatter", silent: true, z: 9, animation: false, tooltip: { show: false },
    data: heads.map(({ d, value }) => ({ value, symbol: CAR_PATH, symbolSize: [36, 18], itemStyle: { color: d.color, opacity: 1 } })) });
  const pd = pins.map((c) => byCode[c]).filter(Boolean);
  const maxPos = showField || !pd.length ? drivers.length : Math.min(drivers.length, Math.max(1, ...pd.flatMap((d) => d.pos.filter((v) => v != null))) + 1);
  const gaps = pd.flatMap((d) => d.gapLead.filter((v) => v != null));
  const maxGap = showField || !pd.length ? null : Math.ceil(Math.max(5, Math.min(...[Math.max(...gaps, 5), 200])) / 5) * 5;
  return {
    ...o, animation: !(playing || replayLap < LAPS), grid: { ...o.grid, right: 56 },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => { const d = byCode[p.seriesName]; return `<b>${esc(d.name)}</b> · tour ${p.dataIndex + 1}<br>${courseMode === "pos" ? "Position P" + p.value : "Écart au leader " + gapS(p.value)}<br><span style="opacity:.7">Clic : suivre ce pilote</span>`; } },
    xAxis: { type: "category", data: laps, boundaryGap: false, name: "Tour", nameLocation: "end", nameTextStyle: { color: T.muted }, ...axisCommon(T), splitLine: { show: false } },
    yAxis: courseMode === "pos"
      ? { type: "value", inverse: true, min: 1, max: maxPos, interval: 1, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (maxPos <= 12 || v % 2 ? "P" + v : "") } }
      : { type: "value", inverse: true, min: 0, ...(maxGap ? { max: maxGap } : {}), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => "+" + v + " s" } },
    series,
  };
}
function renderCourseChips() {
  const pins = coursePins();
  $("#course-chips").innerHTML = finishers.concat(dnfs).map((d) => `<button class="chip" aria-pressed="${pins.includes(d.code)}" data-code="${d.code}" title="Suivre ${esc(d.name)}"><span class="sw" style="background:${d.color};border-color:${pins.includes(d.code) ? "transparent" : d.color}"></span>${d.code}</button>`).join("")
    + `<button class="chip field" id="all">Tous</button><button class="chip field" id="none">Aucun</button><button class="chip field" id="field" aria-pressed="${showField}">${showField ? "Masquer" : "Afficher"} le reste du peloton</button>`;
  $$("#course-chips .chip[data-code]").forEach((b) => b.addEventListener("click", () => toggleFollow(b.dataset.code)));
  $("#field").addEventListener("click", () => { showField = !showField; renderCourseChips(); update("ch-course", false); });
  $("#all").addEventListener("click", () => { follow = drivers.map((d) => d.code); applyFollow(); });
  $("#none").addEventListener("click", () => { follow = []; coursePinned = []; applyFollow(); });
}
function readCourse() {
  const w = finishers[0];
  const led = w ? w.pos.filter((p) => p === 1).length : 0;
  const sc = NEUTRAL.filter((r) => r.kind !== "Ralenti");
  $("#read-course").innerHTML = w ? `<b>${w.last}</b>${w.grid ? `, parti P${w.grid},` : ""} mène ${plural(led, "tour")} sur ${LAPS}.` +
    (sc.length ? ` ${sc.map((r) => `${NKlong[r.kind]} au tour ${r.start}`).join(", ")} : ceux qui s'arrêtent à ce moment perdent moins de temps.` : " Aucune neutralisation : la course se joue en piste et aux stands.") +
    ` Lance le replay ou fais glisser la poignée sous le graphique pour voir le classement et les pneus à chaque tour, et choisis autant de pilotes que tu veux.` : "";
}
function renderBoard() {
  const box = $("#board"); if (!box || !drivers.length) return;
  const lap = Math.max(1, replayLap);
  const rows = MOB() ? (boardAll ? drivers.length : Math.min(8, drivers.length)) : matchMedia("(max-width: 860px)").matches ? 10 : Math.min(22, drivers.length);
  box.querySelector(".brows").style.height = rows * 26 + "px";
  const alive = drivers.filter((d) => d.pos[lap - 1] != null).sort((a, b) => a.pos[lap - 1] - b.pos[lap - 1]);
  $("#board-lap").textContent = `Tour ${lap}/${LAPS}`;
  const nr = isNeutral(lap);
  $("#board-sc").hidden = !nr || nr.kind === "Ralenti"; if (nr) $("#board-sc").textContent = NKlong[nr.kind].toUpperCase();
  drivers.forEach((d) => {
    let row = box.querySelector(`[data-b="${d.code}"]`);
    if (!row) { row = document.createElement("button"); row.className = "brow"; row.dataset.b = d.code; row.addEventListener("click", () => toggleFollow(d.code)); box.querySelector(".brows").appendChild(row); }
    const k = alive.indexOf(d), out = k < 0;
    row.style.transform = `translateY(${(out ? rows : Math.min(k, rows)) * 26}px)`;
    row.style.opacity = !out && k < rows ? (F(d.code) ? 1 : 0.35) : 0;
    row.tabIndex = !out && k < rows ? 0 : -1;
    row.classList.toggle("fol", follow.includes(d.code));
    const c = d.compAt(lap);
    row.innerHTML = `<span class="bp">P${k + 1}</span><span class="bsw" style="background:${d.color}"></span><span class="bc">${d.code}</span>${c ? `<span class="bt" title="${COMP[c].name}" style="--tc:${COMP[c].c}">${c}</span>` : "<span></span>"}<span class="bg">${k ? gapS(d.gapLead[lap - 1]) : "Leader"}</span>`;
  });
}
function placeCursor() {
  const c = charts["ch-course"]; if (!c || !c.inst) return;
  const x = c.inst.convertToPixel({ xAxisIndex: 0 }, replayLap - 1);
  if (!isFinite(x)) return;
  $("#lapcur").style.transform = `translateX(${x}px)`; $("#lapcur").hidden = false;
  const h = $("#lc-handle"); h.textContent = "T" + replayLap; h.setAttribute("aria-valuenow", replayLap); h.setAttribute("aria-valuemax", LAPS);
}
function setReplay(l, fromPlay) {
  replayLap = Math.max(1, Math.min(LAPS, l));
  $("#lapr").value = replayLap; $("#lapn").textContent = `Tour ${replayLap}/${LAPS}`;
  update("ch-course", false); renderBoard(); placeCursor();
  if (!fromPlay) stopReplay();
}
function playReplay() {
  if (playing) return stopReplay();
  if (replayLap >= LAPS) replayLap = 0;
  playing = true; $("#board").classList.add("playing"); $("#play").innerHTML = IC.pause + "Pause"; $("#play").classList.add("on");
  const step = Math.max(60, Math.min(170, 8500 / LAPS));
  playT = setInterval(() => {
    if (holdTicks > 0) return holdTicks--;
    if (replayLap >= LAPS) return stopReplay();
    setReplay(replayLap + 1, true);
    const ev = EVENTS.find((e) => e.lap === replayLap);
    if (ev) { showNote(ev); holdTicks = reduce ? 0 : Math.round(1500 / step); }
  }, reduce ? 60 : step);
}
function showNote(ev) {
  const n = $("#note");
  n.className = "note " + ev.cls;
  n.innerHTML = `<span class="nlap">T${ev.lap}</span><span><b>${ev.txt.replace(/<[^>]+>/g, "")}</b><br>${esc(ev.detail)}</span>`;
  n.hidden = false; n.classList.remove("on"); void n.offsetWidth; n.classList.add("on");
  clearTimeout(showNote.t); showNote.t = setTimeout(() => n.classList.remove("on"), 2600);
}
function stopReplay() {
  if (!playing) return;
  playing = false; clearInterval(playT); $("#board").classList.remove("playing");
  $("#play").innerHTML = IC.play + (replayLap >= LAPS ? "Rejouer la course" : "Reprendre"); $("#play").classList.remove("on");
  update("ch-course", false);
}
// Poignée du tour : glisser, cliquer sur un tour vide, ou flèches du clavier
function bindCursor() {
  const i = charts["ch-course"]?.inst; if (!i || i.__cur) { placeCursor(); return; }
  i.__cur = true;
  const box = $("#ch-course").parentElement;
  i.getZr().on("click", (e) => { if (e.target) return; const v = i.convertFromPixel({ xAxisIndex: 0 }, e.offsetX); const l = Math.round(v) + 1; if (l >= 1 && l <= LAPS) setReplay(l); });
  placeCursor();
}
(function cursorHandle() {
  const cur = $("#lapcur"), h = $("#lc-handle"), box = $("#ch-course").parentElement;
  const lapFromX = (clientX) => { const i = charts["ch-course"]?.inst; if (!i) return replayLap; const r = box.getBoundingClientRect(); return Math.round(i.convertFromPixel({ xAxisIndex: 0 }, clientX - r.left)) + 1; };
  let drag = false;
  h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); cur.classList.add("dragging"); stopReplay(); e.preventDefault(); });
  h.addEventListener("pointermove", (e) => { if (!drag) return; const l = lapFromX(e.clientX); if (l !== replayLap && isFinite(l)) setReplay(l); });
  const end = () => { drag = false; cur.classList.remove("dragging"); };
  h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
  h.addEventListener("keydown", (e) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, PageDown: -5, PageUp: 5 }[e.key];
    if (k) { e.preventDefault(); setReplay(replayLap + k); }
    if (e.key === "Home") { e.preventDefault(); setReplay(1); } if (e.key === "End") { e.preventDefault(); setReplay(LAPS); }
  });
})();

/* --- Le rythme : les points glissent du rang au rythme vers l'arrivée --- */
function buildRythme(T) {
  const o = base(T);
  const rows = rythmeRows();
  const n = MOB() && !allRythme ? Math.max(...rows.map((d) => Math.max(d.paceRank, d.order))) + 1 : Math.max(drivers.length, ...rows.map((d) => d.finish));
  return {
    ...o, animationDurationUpdate: reduce ? 0 : 1200, animationEasingUpdate: "cubicInOut", grid: { left: 56, right: 24, top: 10, bottom: 36 },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => {
      const d = rows[p.value[0]]; const delta = d.paceRank - d.finish;
      return `<b>${esc(d.name)}</b><br>${d.paceRank}<sup>e</sup> rythme · ${d.out ? d.status : "arrivée P" + d.finish}<br><span style="color:${delta > 0 ? T.good : delta < 0 ? T.bad : T.muted}">${d.out ? "" : delta > 0 ? "+" + delta + " places" : delta < 0 ? delta + " places" : "conforme à son rythme"}</span><br><span style="opacity:.7">Clic : suivre ce pilote</span>`; } },
    xAxis: { type: "value", min: 1, max: n, interval: 1, position: "top", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (v === 1 || v % 5 === 0 ? "P" + v : "") } },
    yAxis: { type: "category", data: rows.map((d) => d.code), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, color: T.ink, fontWeight: 700 }, splitLine: { show: true, lineStyle: { color: T.track } } },
    series: [{
      type: "custom", data: rows.map((d, i) => [i, d.paceRank, rythmeReveal ? d.order : d.paceRank]), encode: { y: 0, x: [1, 2] },
      renderItem: (params, api) => {
        const y = api.value(0), a = api.coord([api.value(1), y]), b = api.coord([api.value(2), y]);
        const d = rows[y], delta = d.paceRank - d.order, op = F(d.code) ? 1 : 0.18;
        const col = d.out ? T.muted : delta > 0 ? T.good : delta < 0 ? T.bad : T.muted;
        return { type: "group", children: [
          { type: "line", transition: ["shape"], shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: col, lineWidth: follow.includes(d.code) ? 5 : 3, opacity: 0.85 * op, lineDash: d.out ? [4, 4] : null } },
          { type: "circle", shape: { cx: a[0], cy: a[1], r: 6 }, style: { fill: T.purple, opacity: op } },
          { type: "circle", transition: ["shape"], shape: { cx: b[0], cy: b[1], r: follow.includes(d.code) ? 8 : 6 }, style: { fill: d.out ? T.surface : T.ink, stroke: d.out ? T.muted : T.surface, lineWidth: 2, opacity: op } },
        ] };
      },
    }],
  };
}
function readRythme() {
  if (!paced.length) { $("#read-rythme").textContent = "Pas assez de tours représentatifs pour comparer les rythmes."; return; }
  const fin = paced.filter((d) => !d.out);
  const worst = [...fin].sort((a, b) => (a.paceRank - a.order) - (b.paceRank - b.order))[0];
  const bestG = [...fin].sort((a, b) => (b.paceRank - b.order) - (a.paceRank - a.order))[0];
  let t = `<b>${paced[0].last}</b> avait le meilleur rythme de course${paced[0] === finishers[0] ? ", et gagne" : `, mais termine ${paced[0].out ? "hors classement" : "P" + paced[0].finish}`}.`;
  if (worst && worst.order - worst.paceRank >= 2) t += ` <b>${worst.last}</b> avait le ${worst.paceRank}<sup>e</sup> rythme mais termine P${worst.finish} : la course lui a coûté ${worst.order - worst.paceRank} places.`;
  if (bestG && bestG.paceRank - bestG.order >= 2) t += ` À l'inverse, ${bestG.last} finit ${bestG.paceRank - bestG.order} places au-dessus de son rythme.`;
  $("#read-rythme").innerHTML = t + ` Pointillés : non classé.`;
  $("#tbl-rythme").innerHTML = `<thead><tr><th>Pilote</th><th>Écurie</th><th>Temps médian</th><th>Écart</th><th>Meilleur tour</th><th>Tours propres</th><th>Arrivée</th></tr></thead><tbody>` +
    paced.map((d) => `<tr><td class="mono"><b>${d.code}</b></td><td>${esc(d.team)}</td><td class="mono">${lapT(d.median)}</td><td class="mono">${d === paced[0] ? "réf." : gapS(d.median - paced[0].median)}</td><td class="mono">${d.best ? lapT(d.best) : "—"}</td><td class="mono">${d.clean.length}</td><td class="mono">${d.out ? d.status : "P" + d.finish}</td></tr>`).join("") + "</tbody>";
}

/* --- Les stratégies --- */
function buildStrat(T) {
  const o = base(T);
  const rows = MOB() && !allStrat ? finishers.slice(0, 10).reverse() : [...finishers, ...dnfs].reverse();
  const data = [];
  rows.forEach((d, i) => d.stints.forEach(([c, a, b]) => { const end = Math.min(b ?? LAPS, DNF[d.code] || LAPS); if (end >= a) data.push([i, a, end, c, d.code]); }));
  return {
    ...o, grid: { left: 56, right: 24, top: 28, bottom: 30 },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => { const [, a, b, c, code] = p.value; return `<b>${esc(byCode[code].name)}</b><br>${COMP[c].name} · tours ${a} à ${b} (${b - a + 1} tours)`; } },
    xAxis: { type: "value", min: 0, max: LAPS, position: "top", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (v ? "T" + v : "") } },
    yAxis: { type: "category", data: rows.map((d) => d.code), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, color: T.ink, fontWeight: 700 } },
    series: [{
      type: "custom", data, encode: { y: 0, x: [1, 2] },
      renderItem: (params, api) => {
        const y = api.value(0), a = api.coord([api.value(1) - 1, y]), b = api.coord([api.value(2), y]);
        const h = api.size([0, 1])[1] * 0.62, c = api.value(3), code = rows[y].code, op = F(code) ? 0.95 : 0.15;
        const w = Math.max(0, b[0] - a[0] - 3);
        return { type: "group", children: [
          { type: "rect", shape: { x: a[0] + 1.5, y: a[1] - h / 2, width: w, height: h, r: 5 }, style: { fill: COMP[c].c, opacity: op, stroke: follow.includes(code) ? T.ink : null, lineWidth: 2 } },
          ...(w > 26 ? [{ type: "text", style: { x: a[0] + 9, y: a[1], text: c, fill: "#111111", font: "700 11px JetBrains Mono, monospace", verticalAlign: "middle", opacity: op } }] : []),
        ] };
      },
    }],
  };
}
function readStrat() {
  const fin = finishers;
  const counts = {}; fin.forEach((d) => { const n = d.pits.length; counts[n] = (counts[n] || 0) + 1; });
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${c} pilote${c > 1 ? "s" : ""} à <b>${n == 0 ? "zéro arrêt" : plural(+n, "arrêt")}</b>`);
  const sc = NEUTRAL.filter((r) => r.kind === "SC" || r.kind === "VSC");
  const scStop = drivers.filter((d) => d.pits.some((p) => sc.some((r) => p >= r.start && p <= r.end)));
  $("#read-strat").innerHTML = (parts.length ? parts.join(", ") + " parmi les classés." : "") +
    (scStop.length ? ` ${scStop.length} pilote${scStop.length > 1 ? "s se sont arrêtés" : " s'est arrêté"} <b>sous neutralisation</b>, dont ${scStop.slice(0, 3).map((d) => d.last).join(", ")} : un arrêt qui coûte moins de temps.` : "");
  const used = [...new Set(drivers.flatMap((d) => d.stints.map((s) => s[0])))];
  $("#tyre-legend").innerHTML = Object.entries(COMP).filter(([k]) => used.includes(k)).map(([, c]) => `<span><i class="dot" style="background:${c.c}"></i>${c.name}</span>`).join("");
}

/* --- Lignes « Comment lire » : ce que montre le graphique, en une phrase, juste au-dessus --- */
const sw = (c, round) => `<i class="hw" style="background:${c}${round ? ";border-radius:50%" : ""}"></i>`;
function setHow(id, html) { const el = $("#" + id); if (el) el.innerHTML = `<span class="hw-k">Comment lire</span><span>${html}</span>`; }
function renderHow() {
  setHow("how-course", courseMode === "pos"
    ? `Chaque ligne est un pilote, à la couleur de son écurie. <b>En haut = en tête</b>. La petite F1 montre où il est au tour affiché. ${sw("var(--sc)")} bande jaune = safety car ou VSC.`
    : `Chaque ligne est un pilote. <b>Tout en haut = le leader</b> ; plus une ligne descend, plus le pilote est loin derrière lui (en secondes). ${sw("var(--sc)")} bande jaune = safety car ou VSC.`);
  setHow("how-duels", `Une ligne par écurie : le pilote de gauche était le plus rapide des deux. <b>Plus la barre est longue, plus l'écart était grand</b> (en secondes par tour, sur un tour typique). Clique sur une écurie pour revoir le duel.`);
  setHow("how-strat", `Une ligne par pilote, du départ (à gauche) à l'arrivée (à droite). La couleur indique le pneu : ${sw(COMP.S.c)}tendre ${sw(COMP.M.c)}médium ${sw(COMP.H.c)}dur. <b>Chaque changement de couleur = un arrêt aux stands.</b>`);
  const ref = byCode[exSel[0]], rn = ref ? `<b>${esc(ref.last)}</b>` : "le pilote de référence";
  setHow("how-ex", {
    laps: `Une ligne par pilote, un point par tour : <b>plus c'est bas, plus le tour est rapide</b>. ${exAll ? "Tous les tours sont tracés, sauf le départ ; chaque point a la couleur du pneu utilisé (" + sw(COMP.S.c, 1) + "tendre " + sw(COMP.M.c, 1) + "médium " + sw(COMP.H.c, 1) + "dur). Survole un pic pour sa raison (stands, safety car…)." : "Seuls les tours rapides sont tracés ; « Afficher tous les tours » ajoute les tours aux stands et sous neutralisation."}`,
    gap: `Distance en piste entre chaque pilote et ${rn}, tour par tour. <b>Au-dessus de zéro = derrière ${rn}</b>, en dessous = devant lui.`,
    box: `Une case par tour, comparée au rythme habituel du pilote sur le même train de pneus : ${sw("var(--good)")}dans son rythme ${sw("#e3a008")}un peu lent ${sw("var(--bad)")}tour perdu ${sw("var(--track)")}départ, stands ou safety car.`,
    circuit: `Deux pilotes refont leur meilleur tour sur le vrai tracé. Chaque secteur prend la couleur du plus rapide. Avec plus de 2 pilotes sélectionnés, choisis les deux à rejouer juste en dessous.`,
  }[$("[data-ex][aria-selected=true]")?.dataset.ex || exMode] || "");
}
// « Comparé à » : le premier pilote de la sélection sert de référence ; un clic en choisit un autre
function renderExRef() {
  const el = $("#ex-ref"); if (!el) return;
  const mode = $("[data-ex][aria-selected=true]")?.dataset.ex || exMode, sel = exSel.filter((c) => byCode[c]);
  el.hidden = sel.length < 2 || mode === "box" || mode === "circuit";
  const all = $("#ex-all"); if (all) { all.hidden = mode !== "laps"; all.setAttribute("aria-pressed", exAll); }
  el.innerHTML = `<span class="ex-ref-k">Comparé à</span>` + sel.map((c, i) => `<button aria-pressed="${!i}" data-ref="${c}"><i style="background:${byCode[c].color}"></i>${byCode[c].last}</button>`).join("");
  $$("#ex-ref [data-ref]").forEach((b) => b.addEventListener("click", () => setExRef(b.dataset.ref)));
}
function setExRef(c) {
  if (exSel[0] === c || !exSel.includes(c)) return;
  exSel = [c, ...exSel.filter((x) => x !== c)];
  exChanged();
}
$("#ex-all")?.addEventListener("click", () => { exAll = !exAll; exChanged(); });
// Après tout changement de sélection : chips, phrase, graphiques, circuit
function exChanged() {
  renderExChips(); readEx(); sizeEx(); update("ch-ex");
  if (typeof exRefresh === "function" && MOB()) exRefresh(); else exCircuitRefresh();
}

/* --- Explorer --- */
// Régularité d'un pilote : chaque tour comparé à son temps médian sur le même relais, carburant retiré.
// 0 = dans son rythme (moins de 0,4 s au-dessus), 1 = un peu lent (jusqu'à 1 s), 2 = tour perdu, 3 = hors course (départ, stands, neutralisation)
function regOf(d) {
  const fc = (l) => l.t + FUEL * l.lap, all = median(d.clean.map(fc));
  const ref = (lap) => { const st = d.stints.find(([, a, b]) => lap >= a && lap <= b); const ls = st ? d.clean.filter((l) => l.lap >= st[1] && l.lap <= st[2]) : []; return ls.length >= 4 ? median(ls.map(fc)) : all; };
  const cells = []; let ok = 0, n = 0;
  d.laps.forEach((l) => {
    if (!l || l.t == null) return;
    const slow = l.reason && /lent/i.test(l.reason);
    if (l.reason && !slow) { cells.push({ lap: l.lap, k: 3, d: 0, t: l.t, why: l.reason }); return; }
    const dl = +(fc(l) - ref(l.lap)).toFixed(3), k = slow || dl > 1 ? 2 : dl > 0.4 ? 1 : 0;
    n++; if (!k) ok++;
    cells.push({ lap: l.lap, k, d: dl, t: l.t, why: slow ? "lent" : "" });
  });
  return { cells, ok, n };
}
function buildEx(T) {
  const o = base(T);
  const sel = exSel.map((c) => byCode[c]).filter(Boolean);
  const col = (i) => sel[i].color;
  if (exMode === "box") {
    // Régularité : une case par tour, comparée au rythme du pilote sur le même relais (carburant retiré)
    const rows = [...sel].reverse(), R = rows.map(regOf), AMB = "#e3a008";
    const fill = (k) => [T.good, AMB, T.bad, T.track][k];
    const data = []; R.forEach((r, y) => r.cells.forEach((c) => data.push([c.lap, y, c.k, c.d, c.t, c.why || ""])));
    return { ...o, grid: { left: 48, right: 74, top: 30, bottom: 34 },
      tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => { const [lap, y, k, d, t, why] = p.value; return `<b>${esc(rows[y].name)}</b> · tour ${lap}<br>${lapT(t)}<br>${k === 3 ? esc(why) : k === 2 && why ? "Tour perdu" : d <= 0 ? `${gapS(d)} : plus vite que son rythme` : `${gapS(d)} sur son rythme`}`; } },
      xAxis: { type: "value", min: 0.5, max: LAPS + 0.5, name: "Tour", nameLocation: "end", nameGap: 8, ...axisCommon(T), splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (Number.isInteger(v) && (v === 1 || v % 10 === 0) ? v : "") } },
      yAxis: [{ type: "category", data: rows.map((d) => d.code), ...axisCommon(T), axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, color: T.ink, fontWeight: 700, fontSize: 12 } },
        { type: "category", position: "right", data: R.map((r) => `${r.ok} / ${r.n}`), ...axisCommon(T), axisLine: { show: false }, splitLine: { show: false }, axisLabel: { ...axisCommon(T).axisLabel, color: T.ink2 } }],
      series: [{ type: "custom", data, encode: { x: 0, y: 1 }, renderItem: (params, api) => {
        const lap = api.value(0), y = api.value(1), k = api.value(2), a = api.coord([lap - 0.5, y]), b = api.coord([lap + 0.5, y]);
        const h = Math.min(30, api.size([0, 1])[1] * 0.6), w = Math.max(1, b[0] - a[0] - 2);
        return { type: "rect", shape: { x: a[0] + 1, y: a[1] - h / 2, width: w, height: h, r: Math.min(3, w / 3) }, style: { fill: fill(k), opacity: 0.92 } };
      } }] };
  }
  if (exMode === "gap") {
    const ref = sel[0];
    return { ...o, legend: { top: 0, textStyle: { color: T.ink2 } }, tooltip: { ...o.tooltip, trigger: "axis", valueFormatter: (v) => (v == null ? "—" : gapS(v)) },
      xAxis: { type: "category", data: Array.from({ length: LAPS }, (_, i) => i + 1), boundaryGap: false, name: "Tour", ...axisCommon(T), splitLine: { show: false } },
      yAxis: { type: "value", name: `Écart à ${ref.code}`, nameTextStyle: { color: T.muted, align: "left" }, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (v > 0 ? "+" : "") + v + " s" } },
      series: sel.map((d, i) => ({ name: d.code, type: "line", symbol: "none", smooth: 0.2, lineStyle: { width: 2.5, color: col(i), type: dashIf(d, exSel) }, itemStyle: { color: col(i) },
        areaStyle: i ? { color: col(i), opacity: 0.06 } : undefined,
        data: Array.from({ length: LAPS }, (_, k) => (d.cum[k] == null || ref.cum[k] == null ? null : +(d.cum[k] - ref.cum[k]).toFixed(3))),
        ...(i === 0 ? { markArea: neutralArea(T, LAPS, false) } : {}) })) };
  }
  // Tours lents (stands, neutralisation, trafic) : cachés par défaut, en points creux avec le bouton « Afficher tous les tours »
  // Comme GP Tempo : une ligne continue par pilote. Avec « Afficher tous les tours », les tours lents rejoignent la ligne
  // et chaque tour devient un point à la couleur du pneu (le tour 1, trop à part, reste toujours exclu).
  return { ...o, legend: { top: 0, textStyle: { color: T.ink2 }, data: sel.map((d) => d.code) },
    tooltip: { ...o.tooltip, trigger: "axis", formatter: (ps) => { const k = ps[0]?.dataIndex ?? 0, lap = (ps[0]?.axisValue ?? k + 1);
      return `<b>Tour ${lap}</b><br>` + sel.map((d, i) => { const l = d.laps[+lap - 1]; if (!l || !l.t || l.lap <= 1) return ""; if (l.reason && !exAll) return "";
        return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col(i)};margin-right:6px"></span>${d.code} <b>${lapT(l.t)}</b>${l.reason ? ` <span style="color:${T.muted}">· ${esc(slowWhy(l.reason))}</span>` : ""}`; }).filter(Boolean).join("<br>"); } },
    xAxis: { type: "category", data: Array.from({ length: LAPS }, (_, i) => i + 1), boundaryGap: false, name: "Tour", ...axisCommon(T), splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => lapT(v).slice(0, -2) } },
    series: sel.map((d, i) => ({ name: d.code, type: "line", symbol: "circle", symbolSize: exAll ? 8 : 5, showSymbol: exAll, smooth: 0.35, connectNulls: true, lineStyle: { width: 2.2, color: col(i), type: dashIf(d, exSel) }, itemStyle: { color: col(i) },
      data: Array.from({ length: LAPS }, (_, k) => { const l = d.laps[k]; if (!l || !l.t || l.lap <= 1 || (l.reason && !exAll)) return null;
        const v = +l.t.toFixed(3); return exAll ? { value: v, itemStyle: { color: (COMP[l.comp] || COMP["?"]).c, borderColor: col(i), borderWidth: 1.6 } } : v; }),
      ...(i === 0 ? { markArea: neutralArea(T) } : {}) })) };
}
function renderExChips() {
  renderExRef(); renderHow();
  $("#ex-chips").innerHTML = finishers.concat(dnfs).map((d) => { const on = exSel.includes(d.code); return `<button class="chip" aria-pressed="${on}" data-code="${d.code}"><span class="sw" style="background:${d.color};border-color:${on ? "transparent" : d.color}"></span>${d.code}</button>`; }).join("");
  $$("#ex-chips .chip").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.code, i = exSel.indexOf(c);
    if (i >= 0) { if (exSel.length > 1) exSel.splice(i, 1); else return; }
    else { if (exSel.length >= 4) { toast("4 pilotes au maximum : retire d'abord un pilote."); return; } exSel.push(c); }
    exChanged();
  }));
}
function readEx() {
  if (exMode === "box") {
    const r = exSel.map((c) => byCode[c]).filter((d) => d && d.clean.length >= 3).map((d) => [d, regOf(d)]).sort((a, b) => b[1].ok / (b[1].n || 1) - a[1].ok / (a[1].n || 1));
    if (!r.length) { $("#read-ex").textContent = "Pas assez de tours pour juger la régularité."; return; }
    $("#read-ex").innerHTML = `<b>${r[0][0].last}</b> est le plus régulier de la sélection : ${r[0][1].ok} tours dans son rythme sur ${r[0][1].n}.` + (r.length > 1 ? " " + r.slice(1).map(([d, x]) => `${d.last} : ${x.ok} sur ${x.n}`).join(", ") + "." : "");
    return;
  }
  renderExRef(); renderHow();
  const all = exSel.map((c) => byCode[c]).filter(Boolean), ref = all[0];
  if (all.length < 2) { $("#read-ex").textContent = "Ajoute un deuxième pilote pour comparer."; return; }
  if (exMode === "gap") {
    // Écart en piste à l'arrivée (ou au dernier tour commun), par rapport à la référence
    const parts = all.slice(1).map((d) => { let k = Math.min(d.cum.length, ref.cum.length) - 1; while (k >= 0 && (d.cum[k] == null || ref.cum[k] == null)) k--; if (k < 0) return null; const g = d.cum[k] - ref.cum[k];
      return `${esc(d.last)} <b>${fr(Math.abs(g), 1)} s ${g > 0 ? "derrière" : "devant"}</b>${k + 1 < LAPS ? ` (au tour ${k + 1})` : ""}`; }).filter(Boolean);
    $("#read-ex").innerHTML = `Comparé à <b>${esc(ref.last)}</b>, à l'arrivée : ${parts.join(", ")}.`;
    return;
  }
  if (ref.median == null) { $("#read-ex").innerHTML = `${esc(ref.last)} n'a pas assez de tours représentatifs : choisis un autre pilote de référence.`; return; }
  const others = all.slice(1).filter((d) => d.median != null);
  $("#read-ex").innerHTML = `Comparé à <b>${esc(ref.last)}</b>, sur un tour typique (temps médian, hors stands et neutralisations) : ` +
    others.map((d) => { const g = d.median - ref.median; return `${esc(d.last)} <b>${fr(Math.abs(g))} s ${g > 0 ? "plus lent" : "plus rapide"}</b>`; }).join(", ") + " par tour.";
}

/* ======================= Mode expert : analyses « Sous le capot » ======================= */
function renderPits() {
  const stops = drivers.flatMap((d) => d.stops.map((s) => ({ ...s, d }))).filter((s) => s.stop != null || s.lane != null);
  // Pas de durée d'arrêt connue : on n'affiche pas le bloc plutôt que d'expliquer ce qui manque
  $("#u-pits").hidden = !stops.length;
  if (!stops.length) { $("#read-pits").textContent = ""; $("#pitlist").innerHTML = ""; return; }
  const hasStop = stops.some((s) => s.stop != null);
  const key = (s) => (hasStop ? s.stop ?? Infinity : s.lane ?? Infinity);
  const sorted = stops.filter((s) => isFinite(key(s))).sort((a, b) => key(a) - key(b));
  const max = Math.max(...sorted.slice(0, 10).map(key));
  const laneMed = median(stops.map((s) => s.lane).filter((v) => v != null && v < 60));
  const f = sorted[0], sl = sorted[sorted.length - 1];
  $("#read-pits").innerHTML = hasStop
    ? `Arrêt le plus rapide : <b>${esc(f.d.team)}</b> pour ${esc(f.d.last)}, <b>${fr(f.stop, 2)} s</b> à l'arrêt. Le plus lent : ${fr(sl.stop, 2)} s pour ${esc(sl.d.last)}.${laneMed ? ` Le temps total passé dans la voie des stands tourne autour de ${fr(laneMed, 1)} s.` : ""}`
    : `Temps passé dans la voie des stands (entrée à sortie) : le plus court pour <b>${esc(f.d.last)}</b> (${esc(f.d.team)}), <b>${fr(f.lane, 1)} s</b>.`;
  $("#how-pits").innerHTML = hasStop ? "le temps de chaque arrêt : immobilisé sous le cric, et en tout dans la voie des stands." : "le temps de chaque passage aux stands, de l'entrée à la sortie de la voie.";
  $("#pitlist").innerHTML = sorted.slice(0, 10).map((s, i) => `<div class="pit"><span class="rk">${i + 1}</span><span><b class="mono">${s.d.code}</b> <span class="fine">${esc(s.d.team)} · T${s.lap}</span></span><span class="bar"><i style="width:${(key(s) / max) * 100}%"></i></span><span class="v">${hasStop ? `${fr(s.stop, 2)} s${s.lane != null ? ` <small>· voie ${fr(s.lane, 1)} s</small>` : ""}` : `${fr(s.lane, 1)} s <small>· voie</small>`}</span></div>`).join("");
}
function buildDrs(T) {
  const o = base(T);
  const rows = [...drivers].filter((d) => d.drs > 0).sort((a, b) => a.drs - b.drs).slice(-12);
  return { ...o, grid: { left: 56, right: 40, top: 8, bottom: 28 },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => `<b>${esc(byCode[p.name].name)}</b><br>${p.value} tours à moins d'une seconde de la voiture devant` },
    xAxis: { type: "value", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => v + " t." } },
    yAxis: { type: "category", data: rows.map((d) => d.code), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, color: T.ink, fontWeight: 700 } },
    series: [{ type: "bar", data: rows.map((d) => ({ value: d.drs, name: d.code, itemStyle: { color: follow.includes(d.code) ? T.accent : T.purple, opacity: F(d.code) ? 1 : 0.25 } })), barWidth: "58%", itemStyle: { borderRadius: [0, 6, 6, 0] },
      label: { show: true, position: "right", color: T.ink2, fontFamily: "JetBrains Mono, monospace", fontSize: 11 } }] };
}
function readDrs() {
  const r = [...drivers].sort((a, b) => b.drs - a.drs);
  $("#read-drs").innerHTML = r[0]?.drs ? `<b>${esc(r[0].last)}</b> a passé ${r[0].drs} tours à moins d'une seconde de la voiture devant : le pilote le plus souvent en bataille. Un chiffre élevé signale un pilote plus rapide bloqué dans le trafic. Tours neutralisés et arrêts exclus.` : "Pas de bataille rapprochée mesurée sur cette course.";
}
function renderSectors() {
  const rows = paced.filter((d) => d.bestS).slice(0, 14);
  if (!rows.length) { $("#read-sect").textContent = ""; $("#tbl-sect").innerHTML = ""; return; }
  const best = [0, 1, 2].map((k) => Math.min(...rows.map((d) => d.bestS[k])));
  const bestIdeal = Math.min(...rows.map((d) => d.ideal));
  $("#tbl-sect").innerHTML = `<thead><tr><th>Pilote</th><th>Secteur 1</th><th>Secteur 2</th><th>Secteur 3</th><th>Tour idéal</th><th>Meilleur tour</th><th>Marge</th></tr></thead><tbody>` +
    rows.map((d) => {
      const rel = [0, 1, 2].map((k) => d.bestS[k] - best[k]); const strong = rel.indexOf(Math.min(...rel));
      return `<tr><td class="mono"><b>${d.code}</b></td>` + [0, 1, 2].map((k) => `<td class="mono ${d.bestS[k] === best[k] ? "ob" : k === strong ? "gb" : ""}">${fr(d.bestS[k])}</td>`).join("") +
        `<td class="mono ${d.ideal === bestIdeal ? "ob" : ""}">${lapT(d.ideal)}</td><td class="mono">${lapT(d.best)}</td><td class="mono">${gapS(d.best - d.ideal)}</td></tr>`;
    }).join("") + "</tbody>";
  const marg = [...rows].sort((a, b) => (b.best - b.ideal) - (a.best - a.ideal))[0];
  const owner = [0, 1, 2].map((k) => rows.find((d) => d.bestS[k] === best[k]));
  $("#read-sect").innerHTML = `Meilleurs secteurs : ${owner.map((d, k) => `S${k + 1} <b>${d.code}</b>`).join(", ")}. Le « tour idéal » additionne les meilleurs secteurs d'un pilote.` + (marg.best - marg.ideal >= 0.05 ? ` <b>${esc(marg.last)}</b> laisse ${gapS(marg.best - marg.ideal)} sur la table entre ce potentiel et son meilleur tour réel.` : " Chacun a quasiment réuni ses meilleurs secteurs dans un même tour.");
}
function readDsect() {
  const sd = computeDuels().filter((d) => d.valid && d.fast.medS && d.slow.medS).map((d) => ({ ...d, sec: [0, 1, 2].map((k) => d.slow.medS[k] - d.fast.medS[k]) }));
  if (!sd.length) { $("#read-dsect").textContent = "Pas de temps de secteur disponibles pour comparer les coéquipiers."; return; }
  const mixed = sd.find((d) => d.sec.some((v) => v < 0));
  const top = sd[0], k = top.sec.indexOf(Math.max(...top.sec));
  $("#read-dsect").innerHTML = `En rythme médian, chez ${esc(top.team)}, ${esc(top.fast.last)} fait la différence surtout dans le <b>secteur ${k + 1}</b> (${gapS(top.sec[k])} par tour).` + (mixed ? ` Chez ${esc(mixed.team)}, le duel est partagé : ${esc(mixed.slow.last)} reprend du temps dans le secteur ${mixed.sec.findIndex((v) => v < 0) + 1}.` : "") + ` Sur le circuit : le meilleur tour de chacun.`;
}
function buildDeg(T) {
  const o = base(T);
  const rows = [...finishers].filter((d) => d.deg.length).reverse();
  const data = []; rows.forEach((d, i) => d.deg.forEach((g) => data.push({ value: [+g.k.toFixed(3), i], c: g.c, d, g })));
  return { ...o, grid: { left: 56, right: 30, top: 10, bottom: 32 },
    tooltip: { ...o.tooltip, trigger: "item", formatter: (p) => { const { d, g } = p.data; return `<b>${esc(d.name)}</b><br>${COMP[g.c].name}, tours ${g.a} à ${g.b}<br>${g.k >= 0 ? "+" : "−"}${fr(Math.abs(g.k))} s par tour d'usure`; } },
    xAxis: { type: "value", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (v > 0 ? "+" : "") + fr(v, 2) + " s/t" } },
    yAxis: { type: "category", data: rows.map((d) => d.code), ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, color: T.ink, fontWeight: 700 }, splitLine: { show: true, lineStyle: { color: T.track } } },
    series: [{ type: "scatter", symbolSize: (v, p) => (follow.includes(p.data.d.code) ? 17 : 13), data: data.map((x) => ({ ...x, itemStyle: { color: COMP[x.c].c, borderColor: follow.includes(x.d.code) ? T.ink : T.surface, borderWidth: 2, opacity: F(x.d.code) ? 1 : 0.18 } })) }] };
}
function readDeg() {
  const all = finishers.flatMap((d) => d.deg.map((g) => ({ d, g })));
  if (!all.length) { $("#read-deg").textContent = "Pas assez de tours propres par relais pour mesurer l'usure."; return; }
  const byC = Object.keys(COMP).map((c) => ({ c, v: median(all.filter((x) => x.g.c === c).map((x) => x.g.k)) })).filter((x) => x.v != null).sort((a, b) => a.v - b.v);
  const keeper = [...all].sort((a, b) => a.g.k - b.g.k)[0];
  $("#read-deg").innerHTML = (byC.length > 1 ? `Le <b>${COMP[byC[0].c].name.toLowerCase()}</b> a le mieux tenu (${gapS(byC[0].v)} par tour en médiane), le ${COMP[byC.at(-1).c].name.toLowerCase()} le moins bien (${gapS(byC.at(-1).v)}).` : `Usure médiane : ${gapS(byC[0].v)} par tour.`) +
    ` <b>${esc(keeper.d.last)}</b> a le mieux préservé ses pneus (${COMP[keeper.g.c].name.toLowerCase()}, tours ${keeper.g.a} à ${keeper.g.b}). Temps corrigés de l'allègement en carburant.`;
}

/* ======================= Circuit animé : le duel secteur par secteur ======================= */
const circ = { duel: null, raf: 0, token: 0, duels: [] };
const NS = "http://www.w3.org/2000/svg";
function bestLapOf(d) { const ok = d.clean.filter((l) => l.s && l.ds != null); return ok.length ? ok.reduce((a, l) => (l.t < a.t ? l : a)) : null; }
async function fetchTrace(d, lap) {
  const iso = (ms) => new Date(ms).toISOString();
  const q = `session_key=${RACE.session_key}&driver_number=${d.dn}&date>${encodeURIComponent(iso(lap.ds - 300))}&date<${encodeURIComponent(iso(lap.ds + lap.t * 1000 + 300))}`;
  const pts = await api("location", q);
  return pts.filter((p) => p.x != null && p.y != null && !(p.x === 0 && p.y === 0)).map((p) => ({ t: (Date.parse(p.date) - lap.ds) / 1000, x: p.x, y: p.y })).sort((a, b) => a.t - b.t);
}
function setupCircuit() {
  // Le circuit vit dans l'Explorer : il rejoue les deux premiers pilotes choisis
  circ.custom = {}; circ.duel = null; circ.pairSel = null;
  $("#circ").innerHTML = ""; $("#cside").innerHTML = ""; $("#circ-who").innerHTML = ""; msgCircuit("");
  syncCircuitDuel();
}
function syncCircuitDuel() {
  // Sur le circuit, on rejoue toujours 2 pilotes : ceux choisis dans « Sur le circuit », sinon les deux premiers de la sélection
  const ok = exSel.map((c) => byCode[c]).filter((d) => d && bestLapOf(d));
  const note = $("#circ-note"), box = $("#circ-pair");
  if (ok.length < 2) { circ.duel = null; if (box) box.innerHTML = ""; if (note) note.textContent = "Choisis au moins deux pilotes ci-dessus pour les voir sur le circuit."; return false; }
  let ps = (circ.pairSel || []).map((c) => ok.find((d) => d.code === c)).filter(Boolean);
  if (ps.length < 2 || ps[0] === ps[1]) ps = ok.slice(0, 2);
  circ.pairSel = ps.map((d) => d.code);
  const [a, b] = ps, key = a.code + "-" + b.code;
  circ.duel = (circ.custom[key] ||= { team: a.team === b.team ? a.team : `${a.team} / ${b.team}`, color: a.color, valid: true, fast: a, slow: b });
  if (note) note.textContent = "";
  if (box) {
    const opt = (sel, other) => ok.filter((d) => d !== other).map((d) => `<option value="${d.code}"${d === sel ? " selected" : ""}>${esc(d.last)}</option>`).join("");
    box.innerHTML = ok.length > 2
      ? `<span class="circ-pair-k">Sur le circuit, 2 pilotes :</span><label class="visually-hidden" for="cp-a">Premier pilote</label><select id="cp-a" style="--c:${a.color}">${opt(a, b)}</select><span>contre</span><label class="visually-hidden" for="cp-b">Second pilote</label><select id="cp-b" style="--c:${b.color}">${opt(b, a)}</select>`
      : "";
    $$("#circ-pair select").forEach((s) => s.addEventListener("change", () => { circ.pairSel = [$("#cp-a").value, $("#cp-b").value]; exCircuitRefresh(); }));
  }
  return true;
}
// L'onglet « Sur le circuit » de l'Explorer
function exCircuitRefresh() { const was = circ.duel; syncCircuitDuel(); if (circ.duel && circ.duel !== was && $("#circ").closest("[hidden]") === null && $("#circ").offsetParent) playCircuit(); }
function showExCircuit(on) {
  $("#ex-circ").hidden = !on; $("#ch-ex").hidden = on; $("#read-ex").hidden = on;
  if (on && syncCircuitDuel()) playCircuit(); else if (!on) { circ.token++; cancelAnimationFrame(circ.raf); }
}
function msgCircuit(t) { const m = $("#circ-msg"); m.textContent = t || ""; m.hidden = !t; }
async function playCircuit() {
  if (!circ.duel) return;
  const token = ++circ.token;
  cancelAnimationFrame(circ.raf);
  const T = theme(), cols = [T.s[0], T.s[1]];
  const D = [circ.duel.fast, circ.duel.slow].map((d, k) => ({ d, col: cols[k], lap: bestLapOf(d) }));
  D.forEach((x) => (x.s = x.lap.s));
  $("#circ-who").innerHTML = `<span class="cw" style="color:${cols[0]}">${D[0].d.code}</span><span class="fine">contre</span><span class="cw" style="color:${cols[1]}">${D[1].d.code}</span><span class="fine">· ${esc(circ.duel.team)} · meilleurs tours (${lapT(D[0].lap.t)} et ${lapT(D[1].lap.t)})</span>`;
  $("#cside").innerHTML = [0, 1, 2].map((i) => `<div class="srow" id="sr${i}"><b>S${i + 1}</b><span class="sv">—</span></div>`).join("") + `<div class="stot" id="stot">&nbsp;</div>`;
  const svg = $("#circ");
  // Tracé réel : positions OpenF1 des deux meilleurs tours
  let traces = circ.duel._traces;
  if (!traces) {
    msgCircuit("Chargement du tracé…");
    try { traces = await Promise.all(D.map((x) => fetchTrace(x.d, x.lap))); circ.duel._traces = traces; }
    catch { traces = [[], []]; }
    if (token !== circ.token) return;
  }
  const ok = traces.every((tr) => tr.length > 20);
  msgCircuit(ok ? "" : "Tracé indisponible pour cette course : voici le duel secteur par secteur.");
  svg.innerHTML = "";
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  let cars = [], tags = [], secs = [], posOf = null;
  if (ok) {
    const all = traces[0];
    const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const W = 680, H = 400, pad = MOB() ? 16 : 34, sc = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    const P = (p) => [ox + (p.x - x0) * sc, H - (oy + (p.y - y0) * sc)];
    const path = (pts) => pts.map((p, i) => (i ? "L" : "M") + P(p).map((v) => v.toFixed(1)).join(" ")).join(" ");
    const dAll = path(all) + " Z";
    mk("path", { d: dAll, class: "edge" }); mk("path", { d: dAll, class: "base" });
    const cutT = [0, D[0].s[0], D[0].s[0] + D[0].s[1], Infinity];
    secs = [0, 1, 2].map((i) => mk("path", { d: path(all.filter((p, j) => p.t >= cutT[i] - 0.3 && p.t <= cutT[i + 1] + 0.3)), class: "sec", stroke: T.muted }));
    [1, 2].forEach((i) => { const j = all.findIndex((p) => p.t >= cutT[i]); const a = all[Math.max(0, j - 1)], b = all[Math.min(all.length - 1, j + 1)]; if (!a || !b) return;
      const [ax, ay] = P(a), [bx, by] = P(b), [cx, cy] = P(all[j] || b), ang = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
      mk("line", { x1: cx - Math.cos(ang) * 13, y1: cy - Math.sin(ang) * 13, x2: cx + Math.cos(ang) * 13, y2: cy + Math.sin(ang) * 13, class: "tick" });
      mk("text", { x: cx + Math.cos(ang) * 24, y: cy + Math.sin(ang) * 24 + 4, class: "slab", "text-anchor": "middle" }).textContent = `S${i}|S${i + 1}`; });
    const [sx, sy] = P(all[0]); mk("circle", { cx: sx, cy: sy, r: 4, class: "sf-dot" });
    posOf = (k, t) => { const tr = traces[k]; let j = tr.findIndex((p) => p.t >= t); if (j < 0) j = tr.length - 1; if (j === 0) return P(tr[0]);
      const a = tr[j - 1], b = tr[j], f = (t - a.t) / ((b.t - a.t) || 1); return P({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }); };
    cars = D.map((x) => mk("circle", { r: MOB() ? 13 : 8, class: "car", fill: x.col, cx: sx, cy: sy }));
    tags = D.map((x, k) => { const t = mk("text", { class: "ctag", "text-anchor": "middle", fill: x.col, x: sx, y: sy + (k ? 26 : -16) }); t.textContent = x.d.code; return t; });
  }
  const done = [false, false, false], SCALE = 0.07; let t0 = null;
  const frame = (now) => {
    if (token !== circ.token) return;
    if (t0 == null) t0 = reduce || !ok ? now - 1e6 : now;
    const t = (now - t0) / 1000 / SCALE;
    if (ok) D.forEach((x, k) => { const tt = Math.min(t, x.lap.t); const [px, py] = posOf(k, tt); cars[k].setAttribute("cx", px); cars[k].setAttribute("cy", py); tags[k].setAttribute("x", px); tags[k].setAttribute("y", py + (k ? 26 : -16)); });
    [0, 1, 2].forEach((i) => {
      if (done[i] || t < Math.max(...D.map((x) => x.s.slice(0, i + 1).reduce((a, b) => a + b, 0)))) return;
      done[i] = true;
      const w = D[0].s[i] <= D[1].s[i] ? 0 : 1, g = Math.abs(D[0].s[i] - D[1].s[i]);
      if (secs[i]) { secs[i].setAttribute("stroke", D[w].col); secs[i].classList.add("won"); }
      const r = $("#sr" + i); r.style.setProperty("--c", D[w].col); r.classList.add("done");
      r.querySelector(".sv").innerHTML = `<b style="color:${D[w].col}">${D[w].d.code}</b> gagne +${fr(g)} s`;
    });
    const tot = D.map((x) => x.lap.t);
    if (t >= Math.max(...tot)) { const w = tot[0] <= tot[1] ? 0 : 1; $("#stot").innerHTML = `Tour : <span style="color:${D[w].col}">${D[w].d.code}</span> +${fr(Math.abs(tot[0] - tot[1]))} s`; return; }
    circ.raf = requestAnimationFrame(frame);
  };
  circ.raf = requestAnimationFrame(frame);
}

/* ======================= Pop-ups et panneau latéral ======================= */
let lastFocus = null;
function openDialog(title, html, after, opts = {}) {
  lastFocus = document.activeElement;
  const ov = $("#overlay"), dlg = $("#dialog");
  ov.classList.toggle("drawer", !!opts.drawer); dlg.classList.toggle("drawer", !!opts.drawer);
  dlg.innerHTML = `<div class="dialog-head"><h2 id="dlg-title" style="margin:0">${title}</h2><button class="icon-btn" id="dlg-x" aria-label="Fermer">${IC.x}</button></div>` + html;
  ov.hidden = false; requestAnimationFrame(() => requestAnimationFrame(() => ov.classList.add("open")));
  $("#dlg-x").addEventListener("click", closeDialog); $("#dlg-x").focus();
  if (after) setTimeout(after, reduce ? 0 : 160);
}
function closeDialog() {
  const ov = $("#overlay"); ov.classList.remove("open");
  setTimeout(() => { ov.hidden = true; if (charts["ch-dlg"]?.inst) charts["ch-dlg"].inst.dispose(); delete charts["ch-dlg"]; lastFocus && lastFocus.focus(); }, reduce ? 0 : 360);
}
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeDialog(); });
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#overlay").hidden) closeDialog(); });

function showDriver(code) {
  const d = byCode[code]; if (!d) return;
  openDialog(esc(d.name), `<p class="read">${esc(d.team)}${d.grid ? ` · parti P${d.grid}` : ""}, ${d.out ? `${d.status}${d.outLap ? ` après ${plural(d.outLap, "tour")}` : ""}` : `arrivé P${d.finish}`}.</p>
    <div class="stat-grid">
      <div class="stat"><div class="k">Rythme de course</div><div class="v">${d.paceRank ? d.paceRank + "<sup>e</sup>" : "—"}</div></div>
      <div class="stat"><div class="k">Temps médian</div><div class="v">${d.median ? lapT(d.median) : "—"}</div></div>
      <div class="stat"><div class="k">Meilleur tour</div><div class="v">${d.best ? lapT(d.best) : "—"}</div></div>
      <div class="stat"><div class="k">Arrêts</div><div class="v">${d.pits.length}</div></div>
    </div>
    <div class="fine" style="font-weight:600">Position tour par tour</div>
    <div class="chart" id="ch-dlg" style="height:220px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" id="dlg-follow">${IC.star}${follow.includes(code) ? "Ne plus suivre" : "Suivre ce pilote"}</button>${drivers.some((x) => x.team === d.team && x !== d) ? `<button class="btn" id="dlg-go">Comparer à son coéquipier →</button>` : ""}</div>`, () => {
    charts["ch-dlg"] = { el: $("#ch-dlg"), build: (T) => ({ ...base(T), grid: { left: 40, right: 16, top: 10, bottom: 28 },
      tooltip: { ...base(T).tooltip, trigger: "axis", valueFormatter: (v) => (v == null ? "—" : "P" + v) },
      xAxis: { type: "category", data: Array.from({ length: LAPS }, (_, i) => i + 1), boundaryGap: false, ...axisCommon(T), splitLine: { show: false } },
      yAxis: { type: "value", inverse: true, min: 1, max: drivers.length, ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => "P" + v } },
      series: [{ type: "line", data: Array.from({ length: LAPS }, (_, k) => d.pos[k] ?? null), symbol: "none", smooth: 0.2, lineStyle: { width: 3, color: d.color }, areaStyle: { color: d.color, opacity: 0.08 }, markArea: neutralArea(T, LAPS, false) }] }) };
    draw("ch-dlg");
    $("#dlg-follow").addEventListener("click", () => { toggleFollow(code); closeDialog(); });
    $("#dlg-go")?.addEventListener("click", () => { const mate = drivers.find((x) => x.team === d.team && x !== d); exSel = [d.code, mate.code]; renderExChips(); readEx(); closeDialog(); navGo(`#${parseHash().g}/explorer`, !!NAV.chap); setTimeout(() => update("ch-ex"), 300); });
  }, { drawer: true });
}
function showDuel(du) {
  const A = du.fast, B = du.slow;
  const gap = Array.from({ length: LAPS }, (_, k) => (A.cum[k] != null && B.cum[k] != null ? +(B.cum[k] - A.cum[k]).toFixed(3) : null));
  const end = gap.reduce((m, v, i) => (v != null ? i + 1 : m), 1);
  openDialog(`${esc(du.team)} · ${A.code} contre ${B.code}`, `<p class="read"><b>${esc(A.name)}</b> a été plus rapide que ${esc(B.name)} de <b>${gapS(du.gap)}</b> par tour en rythme médian.${du.same == null ? "" : du.same < 0 ? ` À pneus égaux, c'est ${esc(B.last)} le plus rapide (${gapS(-du.same)}) : l'écart venait de la stratégie.` : ` À pneus égaux, l'écart est de ${gapS(du.same)} : l'avantage tient sur le même pneu.`}</p>
    <div class="duel-live">
      <div class="dl-side"><span class="dl-code" style="color:var(--s1)">${A.code}</span><span class="fine">${esc(A.last)}</span></div>
      <div class="dl-mid"><div class="dl-gap mono" id="dl-gap">+0,000 s</div><div class="fine" id="dl-lap">Tour 1/${end}</div></div>
      <div class="dl-side r"><span class="dl-code" style="color:var(--s2)">${B.code}</span><span class="fine">${esc(B.last)}</span></div>
    </div>
    <div class="chart" id="ch-dlg" style="height:230px"></div>
    <div class="stat-grid">
      <div class="stat"><div class="k">Écart médian</div><div class="v">${gapS(du.gap)}</div></div>
      <div class="stat"><div class="k">À pneus égaux</div><div class="v">${du.same == null ? "—" : gapS(du.same)}</div></div>
      <div class="stat"><div class="k">Arrivée</div><div class="v">${A.out ? "Abandon" : "P" + A.finish} · ${B.out ? "Abandon" : "P" + B.finish}</div></div>
    </div>
    ${A.medS && B.medS ? `<div class="x-only" style="font:700 11px var(--mono);letter-spacing:.1em;color:var(--purple)">OÙ SE JOUE L'ÉCART (RYTHME MÉDIAN)</div>
    <div class="stat-grid x-grid x-only">${[0, 1, 2].map((k) => { const v = B.medS[k] - A.medS[k]; return `<div class="stat"><div class="k">Secteur ${k + 1}</div><div class="v" style="color:${v >= 0 ? "var(--good)" : "var(--bad)"}">${v >= 0 ? A.code : B.code} ${gapS(Math.abs(v))}</div></div>`; }).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn ghost" id="dl-replay">${IC.play}Rejouer le duel</button><button class="btn" id="dlg-go">Analyser dans Explorer →</button></div>`, () => {
    let k = 0, timer = null;
    charts["ch-dlg"] = { el: $("#ch-dlg"), build: (T) => ({ ...base(T), animation: false, grid: { left: 54, right: 16, top: 16, bottom: 28 },
      tooltip: { ...base(T).tooltip, trigger: "axis", formatter: (ps) => { const i = ps[0].dataIndex, v = i <= k ? gap[i] : null; return v == null ? "" : `Tour ${i + 1}<br>${v >= 0 ? A.code : B.code} devant de <b>${gapS(Math.abs(v))}</b>`; } },
      xAxis: { type: "category", data: Array.from({ length: LAPS }, (_, i) => i + 1), boundaryGap: false, ...axisCommon(T), splitLine: { show: false } },
      yAxis: { type: "value", ...axisCommon(T), axisLabel: { ...axisCommon(T).axisLabel, formatter: (v) => (v ? fr(Math.abs(v), Math.abs(v) < 1 ? 1 : 0) + " s" : "0") } },
      series: [{ type: "line", showSymbol: false, smooth: 0.2, lineStyle: { width: 2.5, color: T.s[1] }, itemStyle: { color: T.s[1] }, areaStyle: { color: T.s[1], opacity: 0.14 },
        data: gap.map((v, i) => (v != null && i <= k && (v <= 0 || gap[i - 1] < 0 || gap[i + 1] < 0) ? Math.min(v, 0) : null)) },
        { type: "line", showSymbol: false, smooth: 0.2, lineStyle: { width: 2.5, color: T.s[0] }, itemStyle: { color: T.s[0] }, areaStyle: { color: T.s[0], opacity: 0.14 },
        data: gap.map((v, i) => (v != null && i <= k && (v >= 0 || gap[i - 1] > 0 || gap[i + 1] > 0) ? Math.max(v, 0) : null)),
        markArea: neutralArea(T, k + 1, false),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: T.line, type: "solid" }, data: [{ yAxis: 0 }] } }] }) };
    draw("ch-dlg");
    const paint = () => {
      const v = gap[k] ?? 0;
      $("#dl-gap").textContent = (v >= 0 ? A.code : B.code) + " " + gapS(Math.abs(v));
      $("#dl-gap").style.color = v >= 0 ? "var(--s1)" : "var(--s2)";
      $("#dl-lap").textContent = `Tour ${k + 1}/${end}`;
      update("ch-dlg", false);
    };
    const run = () => { clearInterval(timer); k = reduce ? end - 1 : 0; paint(); if (reduce) return;
      timer = setInterval(() => { if (!$("#ch-dlg") || k >= end - 1) return clearInterval(timer); k++; paint(); }, Math.max(40, 3500 / end)); };
    run();
    $("#dl-replay").addEventListener("click", run);
    $("#dlg-go").addEventListener("click", () => { clearInterval(timer); exSel = [A.code, B.code]; renderExChips(); readEx(); closeDialog(); navGo(`#${parseHash().g}/explorer`, !!NAV.chap); setTimeout(() => update("ch-ex"), 300); });
  });
}

/* ======================= Contrôles : thème, niveau, navigation ======================= */
const root = document.documentElement;
function isDark() { return root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function syncThemeIcon() { const d = isDark(); $("#ico-sun").hidden = !d; $("#ico-moon").hidden = d; $("#theme").setAttribute("aria-label", d ? "Passer en mode clair" : "Passer en mode sombre"); }
try { const t = localStorage.getItem("ddr-theme"); if (t) root.dataset.theme = t; } catch {}
function switchTheme() {
  const apply = () => { root.dataset.theme = isDark() ? "light" : "dark"; try { localStorage.setItem("ddr-theme", root.dataset.theme); } catch {} syncThemeIcon(); Object.keys(charts).forEach((id) => charts[id].inst && draw(id)); if (circ.duel && $("#circ").childNodes.length) playCircuit(); };
  if (!document.startViewTransition || reduce) return apply();
  const r = $("#theme").getBoundingClientRect();
  root.style.setProperty("--vx", r.left + r.width / 2 + "px"); root.style.setProperty("--vy", r.top + r.height / 2 + "px");
  document.startViewTransition(apply);
}
$("#theme").addEventListener("click", switchTheme);
syncThemeIcon();

let toastT;
function toast(html) { const t = $("#toast"); t.innerHTML = html; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600); }
function setLevel(l) {
  const was = document.body.dataset.level;
  if (was === l) return;
  // Les cartes « Sous le capot » glissent en place (transition de vue native, si le navigateur la connaît)
  if (document.startViewTransition && !reduce && was) { document.startViewTransition(() => applyLevel(l, was)); return; }
  applyLevel(l, was);
}
function applyLevel(l, was) {
  document.body.dataset.level = l;
  $("#lvl-ess")?.setAttribute("aria-pressed", l === "essentiel"); $("#lvl-exp")?.setAttribute("aria-pressed", l === "expert");
  if (l === "expert" && was !== "expert") toast("Mode expert : <b>5 analyses</b> à déplier, signalées par « Sous le capot »");
  if (l !== "expert") { if (courseMode !== "pos") selectCourse("pos"); }
  setTimeout(() => { Object.values(charts).forEach((c) => c.inst && c.inst.resize()); placeIndicators(); placeCursor(); }, 60);
}
function selectCourse(m) { courseMode = m; renderHow(); $$("[data-course]").forEach((b) => b.setAttribute("aria-selected", b.dataset.course === m)); update("ch-course", true); }
$$("[data-course]").forEach((b) => b.addEventListener("click", () => selectCourse(b.dataset.course)));
// La régularité n'a besoin que d'une bande par pilote : graphique plus bas
function sizeEx() { const el = $("#ch-ex"), h = exMode === "box" ? `${90 + exSel.length * 56}px` : ""; if (el.style.height !== h) { el.style.height = h; charts["ch-ex"]?.inst?.resize(); } }
function selectEx(m) {
  $$("[data-ex]").forEach((b) => b.setAttribute("aria-selected", b.dataset.ex === m));
  const fine = $("#ex-fine"); if (fine) fine.textContent = m === "circuit" ? "2 pilotes sur le circuit" : "Jusqu'à 4 pilotes";
  if (m === "circuit") { showExCircuit(true); renderExRef(); renderHow(); exCircuitRefresh(); return; }
  showExCircuit(false); exMode = m; readEx(); sizeEx(); update("ch-ex");
}
$$("[data-ex]").forEach((b) => b.addEventListener("click", () => selectEx(b.dataset.ex)));

const links = $$("nav.sections a");
const spy = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); }), { rootMargin: "-40% 0px -55% 0px" });
$$("main > section[id]").forEach((s) => spy.observe(s));

/* --- Accordéons « Sous le capot » --- */
function setupAccordions() {
  $$(".under").forEach((u, i) => {
    const head = u.querySelector(".under-head"), read = u.querySelector(".read");
    const body = document.createElement("div"); body.className = "acc-body"; body.id = "acc-" + i;
    const inner = document.createElement("div"); inner.className = "acc-inner";
    [...u.children].filter((c) => c !== head && c !== read).forEach((c) => inner.appendChild(c));
    body.appendChild(inner); u.appendChild(body);
    const btn = document.createElement("button");
    btn.className = "acc-btn"; btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", body.id);
    while (head.firstChild) btn.appendChild(head.firstChild);
    btn.insertAdjacentHTML("beforeend", `<span class="acc-cta"><span class="acc-t">Voir le détail</span>${IC.chev}</span>`);
    head.appendChild(btn);
    btn.addEventListener("click", () => {
      const open = !u.classList.contains("open");
      u.classList.toggle("open", open); btn.setAttribute("aria-expanded", open);
      btn.querySelector(".acc-t").textContent = open ? "Replier" : "Voir le détail";
      if (open) setTimeout(() => { $$(".chart", inner).forEach((el) => { const c = charts[el.id]; if (c) (c.inst ? c.inst.resize() : draw(el.id)); }); if (inner.querySelector("#circ")) playCircuit(); }, reduce ? 0 : 350);
    });
  });
}

/* --- Indicateur glissant sous l'onglet actif --- */
const indicators = [];
function setupIndicators() {
  $$(".tabs, .seg, nav.sections").forEach((box) => {
    const ind = document.createElement("span"); ind.className = "ind"; ind.setAttribute("aria-hidden", "true");
    box.prepend(ind); indicators.push([box, ind]);
    new MutationObserver(placeIndicators).observe(box, { attributes: true, subtree: true, attributeFilter: ["aria-selected", "aria-pressed", "class"] });
  });
  placeIndicators(); addEventListener("resize", placeIndicators);
  if (document.fonts) document.fonts.ready.then(placeIndicators);
}
function placeIndicators() {
  indicators.forEach(([box, ind]) => {
    const sel = box.querySelector('[aria-selected="true"], [aria-pressed="true"], a.on');
    if (!sel || !sel.offsetParent) { ind.style.opacity = 0; return; }
    ind.style.opacity = 1;
    ind.style.transform = `translate(${sel.offsetLeft}px, ${sel.offsetTop}px)`;
    ind.style.width = sel.offsetWidth + "px"; ind.style.height = sel.offsetHeight + "px";
  });
}

/* --- Micro-interactions --- */
document.addEventListener("pointerdown", (e) => {
  const host = e.target.closest(".btn, .lift, .chip, .tabs button, .seg button, .icon-btn, .tower-row, .log-row, .acc-btn, .brow");
  if (!host || reduce) return;
  const r = host.getBoundingClientRect(), size = Math.max(r.width, r.height);
  if (getComputedStyle(host).position === "static") host.style.position = "relative";
  host.style.overflow = "hidden";
  const s = document.createElement("span"); s.className = "rip";
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  host.appendChild(s); setTimeout(() => s.remove(), 600);
});
if (matchMedia("(hover: hover)").matches && !reduce) document.addEventListener("pointermove", (e) => {
  const c = e.target.closest(".card, .kpi"); if (!c) return;
  const r = c.getBoundingClientRect(); c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px");
});
function countUp() {
  $$("#kpis .v, #tower > .tower-row:not(.p1) .val").forEach((el) => {
    const txt = el.textContent, m = txt.match(/(\d+)(?:,(\d+))?/); if (!m || reduce) return;
    const dec = m[2] ? m[2].length : 0, target = parseFloat(m[1] + "." + (m[2] || "0")), t0 = performance.now(), dur = 1000;
    const step = (now) => { const p = Math.min(1, (now - t0) / dur), e2 = 1 - Math.pow(1 - p, 3);
      el.textContent = txt.replace(m[0], (target * e2).toFixed(dec).replace(".", ",")); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}
addEventListener("scroll", () => { const h = document.documentElement; $("#progress").style.transform = `scaleX(${h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)})`; }, { passive: true });

/* ======================= Inscription aux comptes rendus (Netlify Forms) ======================= */
(function subscription() {
  const form = $("#sub-form"), email = $("#sub-email"), consent = $("#sub-consent"), status = $("#sub-status");
  let mode = "abonnement";
  const setMode = (m) => {
    mode = m;
    const unsub = m === "desabonnement";
    $("#sub-form-name").value = m;
    $("#sub-title").textContent = unsub ? "Se désinscrire" : "Le compte rendu après chaque GP";
    $("#sub-intro").textContent = unsub ? "Indique l'adresse inscrite : tu ne recevras plus les comptes rendus." : "Le résumé de la course, les duels entre coéquipiers et les stratégies, par mail.";
    $("#sub-btn").textContent = unsub ? "Me désinscrire" : "S'inscrire";
    $("#sub-consent-wrap").hidden = unsub; $("#sub-fine").hidden = unsub;
    $("#sub-switch").textContent = unsub ? "Revenir à l'inscription" : "Se désinscrire";
    status.textContent = ""; status.className = "sub-status";
  };
  $("#sub-switch").addEventListener("click", () => setMode(mode === "abonnement" ? "desabonnement" : "abonnement"));
  const fromHash = () => { if (location.hash === "#desinscription") { setMode("desabonnement"); $("#abonnement").scrollIntoView(); } };
  fromHash(); addEventListener("hashchange", fromHash);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const say = (msg, ok) => { status.textContent = msg; status.className = `sub-status ${ok ? "ok" : "err"}`; };
    const value = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return say("Cette adresse e-mail n'a pas l'air valide.", false);
    if (mode === "abonnement" && !consent.checked) return say("Coche la case pour confirmer ton inscription.", false);
    if (location.protocol === "file:") return say("L'inscription fonctionne une fois le site en ligne (Netlify).", false);
    $("#sub-btn").disabled = true;
    try {
      const body = new URLSearchParams({ "form-name": mode, email: value, consentement: mode === "abonnement" ? "oui" : "", site_web: form.site_web.value });
      const res = await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
      if (!res.ok) throw new Error(res.status);
      form.reset();
      say(mode === "abonnement" ? "C'est noté : tu recevras le prochain compte rendu." : "C'est fait : tu ne recevras plus les comptes rendus.", true);
    } catch { say("L'envoi a échoué. Réessaie dans un instant.", false); }
    finally { $("#sub-btn").disabled = false; }
  });
})();

/* ======================= Chargement d'une course ======================= */
function setStatus(msg, kind) {
  const el = $("#status");
  if (!msg) { el.hidden = true; return; }
  el.hidden = false; el.classList.toggle("error", kind === "error");
  el.innerHTML = (kind === "load" ? '<span class="spin" aria-hidden="true"></span>' : "") + `<span>${esc(msg)}</span>`;
}
let RACES = [], offline = null, ARCH = new Set();
// Archive publiée avec le site (dossier data/, mise à jour chaque lundi par GitHub Actions)
async function fromArchive(file) {
  if (location.protocol === "file:") return null;
  try { const r = await fetch(`data/${file}`, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function loadRaces(year) {
  $("#gp").disabled = true; $("#gp").innerHTML = "<option>Chargement…</option>";
  const arch = (await fromArchive(`races-${year}.json`)) || [];
  ARCH = new Set(arch.map((s) => s.session_key));
  // La liste des courses est gardée dans le navigateur : pendant une séance en direct, OpenF1 coupe l'accès gratuit,
  // et les GP déjà consultés restent ainsi disponibles
  const listKey = `f1duel:v4:races:${year}`;
  let sessions;
  try { sessions = await api("sessions", { year, session_type: "Race" }); try { localStorage.setItem(listKey, JSON.stringify(sessions)); } catch {} }
  catch (e) {
    // OpenF1 fermé : courses archivées + courses déjà consultées sur cet appareil
    const saved = (() => { try { return JSON.parse(localStorage.getItem(listKey)); } catch { return null; } })() || [];
    const byKey = new Map([...saved, ...arch].map((x) => [x.session_key, x]));
    if (!byKey.size) throw e;
    sessions = [...byKey.values()]; offline = arch.length ? null : e.message;
    if (arch.length) sessions = sessions.filter((x) => ARCH.has(x.session_key) || store.get(x.session_key));
  }
  const now = new Date();
  RACES = sessions.filter((s) => s.session_name === "Race" && !s.is_cancelled && new Date(s.date_end) < now && (!offline || store.get(s.session_key))).sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const am = new Map(arch.map((x) => [x.session_key, x]));
  RACES.forEach((r) => { const a = am.get(r.session_key); if (a) { if (a.winner) r.winner = a.winner; if (a.outline) r.outline = a.outline; } });
  if (!RACES.length) { if (offline) throw new Error(offline); $("#gp").innerHTML = "<option>Aucune course terminée</option>"; return false; }
  $("#gp").innerHTML = RACES.map((r) => `<option value="${r.session_key}">${esc(r.country_name)} ${r.year}</option>`).join("");
  $("#gp").value = RACES.at(-1).session_key; $("#gp").disabled = false;
  return true;
}
async function fetchRace(sk) {
  const cached = store.get(sk);
  if (cached) return cached;
  if (ARCH.has(+sk)) {
    setStatus("Chargement de la course…", "load");
    const a = await fromArchive(`${sk}.json`);
    if (a && a.pack) {
      if (a.trace) try { localStorage.setItem(`f1duel:v4:trace:${sk}`, JSON.stringify(a.trace)); } catch {}
      store.set(sk, a.pack);
      return a.pack;
    }
  }
  const steps = [["drivers", "des pilotes"], ["laps", "des tours"], ["stints", "des relais de pneus"], ["pit", "des arrêts aux stands"], ["race_control", "de la direction de course"], ["session_result", "du classement"], ["starting_grid", "de la grille de départ"]];
  const raw = {};
  for (const [i, [ep, label]] of steps.entries()) {
    setStatus(`Chargement ${label} (${i + 1}/${steps.length})…`, "load");
    hcProgress(i / (steps.length + 1));
    raw[ep] = await api(ep, { session_key: sk });
  }
  hcProgress(steps.length / (steps.length + 1));
  if (!raw.starting_grid.length) { setStatus("Chargement de la grille de départ…", "load"); raw.starting_grid = gridFromPositions(await api("position", { session_key: sk })); }
  const seen = new Map();
  for (const d of raw.drivers) if (!seen.has(d.driver_number)) seen.set(d.driver_number, d);
  const pack = {
    data: compactRace(raw),
    drivers: [...seen.values()].map((d) => ({ driver_number: d.driver_number, name_acronym: d.name_acronym, full_name: d.full_name, first_name: d.first_name, last_name: d.last_name, team_name: d.team_name, team_colour: d.team_colour })),
    results: raw.session_result.map((r) => ({ driver_number: r.driver_number, position: r.position, number_of_laps: r.number_of_laps, dnf: r.dnf, dns: r.dns, dsq: r.dsq, duration: typeof r.duration === "number" ? r.duration : null, gap_to_leader: r.gap_to_leader, points: r.points })),
    grid: raw.starting_grid.map((g) => ({ driver_number: g.driver_number, position: g.position })),
  };
  if (pack.data.laps.length && pack.results.length) store.set(sk, pack);
  return pack;
}

let first = true, loadSeq = 0;
async function loadGP(sk) {
  const session = RACES.find((r) => r.session_key === +sk);
  if (!session) return;
  const myLoad = ++loadSeq;
  $("main").classList.add("loading"); stopReplay();
  const hTok = hcBegin();
  $("#round").textContent = "R" + String(RACES.indexOf(session) + 1).padStart(2, "0");
  try {
    const pack = await fetchRace(sk);
    if (myLoad !== loadSeq) return; // un autre GP a été demandé entre-temps
    if (!pack.data.laps.length) throw new Error("Les temps au tour de cette course ne sont pas encore disponibles. Réessaie un peu plus tard.");
    buildModel(session, pack);
    setStatus(offline ? "Une séance de F1 est en cours : seuls les GP déjà disponibles sont affichés pour le moment." : "");
    renderAll();
    if (NAV.home) renderHome(); // l'accueil affiche le vainqueur dès que la course est chargée
    hcRun(hTok);
    if (!first && !NAV.home) toast(`${esc(session.country_name)} ${session.year} chargé`);
    first = false;
  } catch (e) {
    setStatus(e.message, "error"); hcFail();
  } finally { if (myLoad === loadSeq) { $("main").classList.remove("loading"); fitTower(); } }
}
function renderAll() {
  follow = []; $("#follow").classList.remove("on"); $("#follow").hidden = true; showField = false;
  coursePinned = finishers.slice(0, 3).map((d) => d.code);
  exSel = (finishers.length >= 2 ? finishers.slice(0, 2) : drivers.slice(0, 2)).map((d) => d.code);
  replayLap = LAPS; $("#lapr").max = LAPS; $("#lapr").value = LAPS; $("#lapn").textContent = `Tour ${LAPS}/${LAPS}`;
  $("#play").innerHTML = IC.play + "Rejouer la course";
  $(".brows").innerHTML = "";
  renderHero(); renderMoments(); renderDuels();
  readCourse(); renderCourseChips(); renderBoard();
  readRythme(); readStrat(); renderExChips(); readEx();
  renderPits(); readDrs(); renderSectors(); readDsect(); readDeg();
  setupCircuit();
  if (!renderAll.mounted) {
    renderAll.mounted = true;
    mount("ch-course", buildCourse);
    charts["ch-rythme"] = { el: $("#ch-rythme"), build: buildRythme, inst: null };
    whenVisible($("#ch-rythme"), () => { draw("ch-rythme"); setTimeout(() => { rythmeReveal = true; update("ch-rythme", false); }, reduce ? 0 : 700); });
    mount("ch-strat", buildStrat); mount("ch-ex", buildEx);
    ["ch-drs", "ch-deg"].forEach((id, i) => (charts[id] = { el: document.getElementById(id), build: [buildDrs, buildDeg][i], inst: null }));
    charts["ch-course"].onClick = (p) => toggleFollow(p.seriesName);
    charts["ch-rythme"].onClick = (p) => toggleFollow(rythmeRows()[p.value[0]]?.code);
    charts["ch-strat"].onClick = (p) => toggleFollow(p.value[4]);
    charts["ch-deg"].onClick = (p) => toggleFollow(p.data.d.code);
    charts["ch-drs"].onClick = (p) => toggleFollow(p.name);
    whenVisible($("#kpis"), countUp);
    // Le circuit se joue quand il devient visible (accordéon ouvert)
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !$("#circ").childNodes.length && circ.duel) playCircuit(); }, { threshold: 0.3 }); io.observe($("#circ"));
  } else {
    rythmeReveal = false;
    Object.keys(charts).forEach((id) => { if (charts[id].inst && id !== "ch-dlg") draw(id); });
    if (charts["ch-rythme"].inst) setTimeout(() => { rythmeReveal = true; update("ch-rythme", false); }, reduce ? 0 : 700);
    countUp();
    if (!$("#ex-circ").hidden && circ.duel) playCircuit();
  }
  placeCursor();
  mobileRender(); renderChapterCards();
}

/* ======================= Démarrage ======================= */
document.body.dataset.level = "expert"; // plus de mode Essentiel / Expert : toutes les analyses sont affichées, les plus détaillées en blocs dépliables
setupAccordions(); setupIndicators();
$("#play").innerHTML = IC.play + "Rejouer la course";
$("#play").addEventListener("click", playReplay);
$("#lapr").addEventListener("input", (e) => setReplay(+e.target.value));
$("#follow-x").innerHTML = IC.x;
$("#follow-x").addEventListener("click", () => { follow = []; applyFollow(); });
$("#cplay").innerHTML = IC.play + "Rejouer le tour";
$("#cplay").addEventListener("click", () => circ.duel && playCircuit());
$("#dsect-go").addEventListener("click", () => {
  // Le duel le plus serré entre coéquipiers, ouvert sur le circuit de l'Explorer
  const d = computeDuels().filter((x) => x.valid && bestLapOf(x.fast) && bestLapOf(x.slow))[0];
  if (d) { exSel = [d.fast.code, d.slow.code]; renderExChips(); readEx(); update("ch-ex"); }
  selectEx("circuit");
  const { g } = parseHash(); navGo(`#${g}/explorer`, !!NAV.chap);
});
$("#gp").addEventListener("change", () => navGP($("#gp").value));
$("#year").addEventListener("change", async () => {
  try { $("main").classList.add("loading"); if (await loadRaces(+$("#year").value)) navGP(RACES.at(-1).session_key); else setStatus(`Aucune course terminée pour ${$("#year").value}.`, "error"); }
  catch (e) { setStatus(e.message, "error"); } finally { $("main").classList.remove("loading"); }
});
if (!reduce && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  $$("main > section").forEach((sct, i) => { if (i) { sct.classList.add("reveal"); io.observe(sct); } });
}
(async function init() {
  if (!window.echarts) setStatus("La bibliothèque de graphiques n'a pas pu être chargée. Recharge la page.", "error");
  const now = new Date().getFullYear();
  $("#year").innerHTML = Array.from({ length: now - 2023 + 1 }, (_, i) => now - i).map((y) => `<option value="${y}">${y}</option>`).join("");
  try {
    setStatus("Recherche des courses…", "load");
    let ok = await loadRaces(now);
    if (!ok && now > 2023) { $("#year").value = now - 1; ok = await loadRaces(now - 1); }
    if (!ok) { setStatus("Aucune course terminée trouvée.", "error"); return; }
    setStatus("");
    // Lien direct vers un GP : on y va. Sinon l'accueil, et le dernier GP se charge déjà en coulisse.
    if (parseHash().g) await navRoute();
    else { showHome(true); $("#gp").value = RACES.at(-1).session_key; await loadGP(RACES.at(-1).session_key); }
  } catch (e) { setStatus(e.message, "error"); $("main").classList.remove("loading"); }
})();
