#!/usr/bin/env node
// F1 – écarts de rythme de course entre coéquipiers (source : OpenF1)
//
// Usage :
//   node compute_gaps.mjs                  → dernière course terminée de l'année en cours
//   node compute_gaps.mjs --session 9998   → une course précise (session_key)
//   node compute_gaps.mjs --year 2025      → toutes les courses d'une saison (backfill)
//
// Résultat : data/race_gaps.json (une entrée par course, réécrite si relancée).
// Aucune dépendance : Node 18+ (fetch natif).

import fs from "node:fs";
import path from "node:path";

const API = "https://api.openf1.org/v1";
const OUT = path.resolve("data/race_gaps.json");
const FIXTURES = process.env.F1_FIXTURES; // dossier de JSON locaux (tests hors ligne)

// ---- Paramètres de nettoyage --------------------------------------------
const CFG = {
  maxPctOfMedian: 1.07, // tour > 107 % du médian du pilote = trafic/incident → exclu
  minCleanLaps: 10,     // en dessous : abandon précoce, pas de comparaison
  scBufferLaps: 1,      // tours exclus en plus après la fin d'une neutralisation
  delayMs: 400,         // espacement des appels (limite : 3 req/s, 30 req/min)
};

// ---- Accès API ------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  if (FIXTURES) {
    const file = path.join(FIXTURES, `${endpoint}.json`);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${API}/${endpoint}?${qs}`);
    if (res.ok) {
      await sleep(CFG.delayMs);
      return res.json();
    }
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`${endpoint} → HTTP ${res.status}`);
  }
  throw new Error(`${endpoint} → échec après 3 tentatives`);
}

// ---- Outils statistiques --------------------------------------------------
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x, d = 3) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

// ---- Tours neutralisés (SC, VSC, drapeau rouge) ---------------------------
function neutralisedLaps(raceControl, totalLaps) {
  const out = new Set();
  const events = raceControl
    .filter((m) => m.lap_number != null)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let startLap = null;
  for (const m of events) {
    const msg = (m.message || "").toUpperCase();
    const isStart =
      msg.includes("SAFETY CAR DEPLOYED") || // couvre aussi "VIRTUAL SAFETY CAR DEPLOYED"
      m.flag === "RED";
    const isEnd =
      msg.includes("SAFETY CAR IN THIS LAP") ||
      msg.includes("VIRTUAL SAFETY CAR ENDING") ||
      (m.flag === "GREEN" && startLap != null) ||
      msg.includes("RESUME");

    if (isStart && startLap == null) startLap = m.lap_number;
    else if (isEnd && startLap != null) {
      for (let l = startLap; l <= m.lap_number + CFG.scBufferLaps; l++) out.add(l);
      startLap = null;
    }
  }
  if (startLap != null) for (let l = startLap; l <= totalLaps; l++) out.add(l); // fin sous SC
  return out;
}

// ---- Calcul pour une course ----------------------------------------------
async function analyseRace(session) {
  const sk = session.session_key;
  const [drivers, laps, stints, pits, raceControl] = [
    await get("drivers", { session_key: sk }),
    await get("laps", { session_key: sk }),
    await get("stints", { session_key: sk }),
    await get("pit", { session_key: sk }),
    await get("race_control", { session_key: sk }),
  ];

  const totalLaps = Math.max(0, ...laps.map((l) => l.lap_number || 0));
  const neutral = neutralisedLaps(raceControl, totalLaps);

  // Tours d'entrée aux stands, par pilote
  const inLaps = new Map();
  for (const p of pits) {
    if (!inLaps.has(p.driver_number)) inLaps.set(p.driver_number, new Set());
    inLaps.get(p.driver_number).add(p.lap_number);
  }

  // Composé de pneu pour un tour donné
  const compoundOf = (dn, lap) =>
    stints.find((s) => s.driver_number === dn && lap >= s.lap_start && lap <= s.lap_end)
      ?.compound ?? "UNKNOWN";

  // 1) Filtres « structurels »
  const byDriver = new Map();
  for (const l of laps) {
    const dn = l.driver_number;
    if (
      l.lap_duration == null ||
      l.lap_number <= 1 ||
      l.is_pit_out_lap ||
      inLaps.get(dn)?.has(l.lap_number) ||
      neutral.has(l.lap_number)
    ) continue;
    if (!byDriver.has(dn)) byDriver.set(dn, []);
    byDriver.get(dn).push({ lap: l.lap_number, t: l.lap_duration, c: compoundOf(dn, l.lap_number) });
  }

  // 2) Filtre 107 % du médian du pilote
  const stats = new Map();
  for (const [dn, arr] of byDriver) {
    const m0 = median(arr.map((x) => x.t));
    const clean = arr.filter((x) => x.t <= m0 * CFG.maxPctOfMedian);
    const perCompound = {};
    for (const x of clean) (perCompound[x.c] ??= []).push(x.t);
    stats.set(dn, {
      median: median(clean.map((x) => x.t)),
      n: clean.length,
      perCompound: Object.fromEntries(
        Object.entries(perCompound).map(([c, ts]) => [c, { median: median(ts), n: ts.length }])
      ),
    });
  }

  // 3) Paires de coéquipiers
  const info = new Map(drivers.map((d) => [d.driver_number, d]));
  const teams = new Map();
  for (const d of drivers) {
    if (!teams.has(d.team_name)) teams.set(d.team_name, []);
    teams.get(d.team_name).push(d.driver_number);
  }

  const pairs = [];
  for (const [team, dns] of teams) {
    if (dns.length !== 2) continue;
    const [a, b] = dns.map((dn) => ({ dn, s: stats.get(dn) }));
    const usable = (x) => x.s && x.s.n >= CFG.minCleanLaps;
    const base = {
      team,
      team_colour: info.get(a.dn)?.team_colour ?? null,
      drivers: [a, b].map((x) => ({
        number: x.dn,
        code: info.get(x.dn)?.name_acronym,
        name: info.get(x.dn)?.full_name,
        median_s: round(x.s?.median),
        clean_laps: x.s?.n ?? 0,
      })),
    };
    if (!usable(a) || !usable(b)) {
      pairs.push({ ...base, valid: false, reason: "échantillon insuffisant (abandon ?)" });
      continue;
    }

    const [fast, slow] = a.s.median <= b.s.median ? [a, b] : [b, a];
    const gap_s = slow.s.median - fast.s.median;

    // Écart à pneus identiques : moyenne pondérée sur les composés communs
    let wSum = 0, gSum = 0;
    for (const c of Object.keys(fast.s.perCompound)) {
      const pf = fast.s.perCompound[c], ps = slow.s.perCompound[c];
      if (!ps || c === "UNKNOWN" || pf.n < 3 || ps.n < 3) continue;
      const w = Math.min(pf.n, ps.n);
      const g = ((ps.median - pf.median) / pf.median) * 100;
      gSum += g * w; wSum += w;
    }

    pairs.push({
      ...base,
      valid: true,
      faster: info.get(fast.dn)?.name_acronym,
      gap_s: round(gap_s),
      gap_pct: round((gap_s / fast.s.median) * 100),
      // Même référence que gap_pct : >0 = le plus rapide l'est aussi à pneus identiques,
      // <0 = son avantage venait de la stratégie pneus
      same_compound_gap_pct: wSum ? round(gSum / wSum) : null,
    });
  }

  return {
    session_key: sk,
    meeting_key: session.meeting_key,
    year: session.year,
    date: session.date_start,
    gp: session.country_name,
    circuit: session.circuit_short_name,
    total_laps: totalLaps,
    neutralised_laps: [...neutral].sort((x, y) => x - y),
    pairs,
  };
}

// ---- Sélection des courses -----------------------------------------------
async function pickSessions(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  if (arg("--session")) return get("sessions", { session_key: arg("--session") });

  const year = arg("--year") ?? new Date().getFullYear();
  const races = (await get("sessions", { year, session_type: "Race" }))
    .filter((s) => s.session_name === "Race" && !s.is_cancelled) // exclut les sprints
    .filter((s) => new Date(s.date_end) < new Date())
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

  return arg("--year") ? races : races.slice(-1);
}

// ---- Main ----------------------------------------------------------------
const sessions = await pickSessions(process.argv);
if (!sessions.length) { console.log("Aucune course terminée trouvée."); process.exit(0); }

const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { races: [] };

for (const s of sessions) {
  process.stdout.write(`→ ${s.year} ${s.country_name} (session ${s.session_key})… `);
  try {
    const race = await analyseRace(s);
    db.races = db.races.filter((r) => r.session_key !== race.session_key).concat(race);
    console.log(`${race.pairs.filter((p) => p.valid).length} duels valides`);
  } catch (e) {
    console.log(`échec : ${e.message}`);
  }
}

db.races.sort((a, b) => new Date(a.date) - new Date(b.date));
db.updated_at = new Date().toISOString();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(db, null, 2));
console.log(`✓ ${OUT} (${db.races.length} courses)`);
