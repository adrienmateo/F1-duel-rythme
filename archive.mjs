// Archive des courses : télécharge sur OpenF1 chaque course terminée et l'enregistre dans data/
// pour que le site n'ait plus besoin d'OpenF1 pour les GP passés (OpenF1 est fermé aux visiteurs
// gratuits pendant les séances en direct). Lancé chaque lundi par GitHub Actions, ou à la main.
// Usage : node archive.mjs [--year 2026] [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, "data");
const API = process.env.OPENF1_API || "https://api.openf1.org/v1";
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const FORCE = args.includes("--force");
const now = new Date();
const YEARS = opt("--year") ? [+opt("--year")] : [now.getFullYear(), ...(now.getMonth() < 2 ? [now.getFullYear() - 1] : [])];

/* ---------- Calcul partagé avec le site (lu dans index.html, comme report.mjs) ---------- */
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const cfg = html.match(/const CFG = \{[^\n]*\};/)?.[0], med = html.match(/const median = [^\n]*;/)?.[0];
const a = html.indexOf("/* ======================= Calcul"), b = html.indexOf("/* ======================= Rendu");
if (!cfg || !med || a < 0 || b < 0) throw new Error("Impossible de lire le calcul dans index.html");
const { analyse, compactRace, gridFromPositions } = new Function(`${cfg}\n${med}\n${html.slice(a, b)}\nreturn { analyse, compactRace, gridFromPositions };`)();

/* ---------- OpenF1, avec pauses et nouvelles tentatives ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Closed extends Error {}
async function api(endpoint, params) {
  const url = `${API}/${endpoint}?${typeof params === "string" ? params : new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) { await sleep(450); return res.json(); }
    if (res.status === 404) { await sleep(450); return []; }
    if (res.status === 401 || res.status === 403) throw new Closed("OpenF1 est fermé aux visiteurs gratuits en ce moment (séance en direct ?) : on réessaiera plus tard.");
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * attempt); continue; }
    throw new Error(`OpenF1 HTTP ${res.status} sur ${endpoint}`);
  }
  throw new Error(`OpenF1 ne répond pas (${endpoint})`);
}

/* ---------- Une course : mêmes données que le site, plus le tracé du circuit ---------- */
async function archiveRace(s) {
  const sk = s.session_key, raw = {};
  for (const ep of ["drivers", "laps", "stints", "pit", "race_control", "session_result", "starting_grid"]) raw[ep] = await api(ep, { session_key: sk });
  if (!raw.laps.length || !raw.session_result.length) { console.log(`  ${s.country_name} : pas encore de données complètes, ignoré.`); return false; }
  if (!raw.starting_grid.length) raw.starting_grid = gridFromPositions(await api("position", { session_key: sk }));
  const seen = new Map(); for (const d of raw.drivers) if (!seen.has(d.driver_number)) seen.set(d.driver_number, d);
  const pack = {
    data: compactRace(raw),
    drivers: [...seen.values()].map((d) => ({ driver_number: d.driver_number, name_acronym: d.name_acronym, full_name: d.full_name, first_name: d.first_name, last_name: d.last_name, team_name: d.team_name, team_colour: d.team_colour })),
    results: raw.session_result.map((r) => ({ driver_number: r.driver_number, position: r.position, number_of_laps: r.number_of_laps, dnf: r.dnf, dns: r.dns, dsq: r.dsq, duration: typeof r.duration === "number" ? r.duration : null, gap_to_leader: r.gap_to_leader, points: r.points })),
    grid: raw.starting_grid.map((g) => ({ driver_number: g.driver_number, position: g.position })),
  };
  // Tracé : positions du meilleur tour propre du vainqueur (même choix que le site)
  let trace = null;
  const winner = [...raw.session_result].filter((r) => r.position === 1 && !r.dnf && !r.dns && !r.dsq)[0];
  const st = winner && analyse(pack.data).drivers.get(winner.driver_number);
  const ok = st ? st.laps.filter((l) => !l.reason && l.s && l.ds != null && l.t) : [];
  if (ok.length) {
    const lap = ok.reduce((x, l) => (l.t < x.t ? l : x));
    const iso = (ms) => new Date(ms).toISOString();
    const q = `session_key=${sk}&driver_number=${winner.driver_number}&date>${encodeURIComponent(iso(lap.ds - 300))}&date<${encodeURIComponent(iso(lap.ds + lap.t * 1000 + 300))}`;
    const pts = (await api("location", q)).filter((p) => p.x != null && p.y != null && !(p.x === 0 && p.y === 0)).sort((p, q2) => Date.parse(p.date) - Date.parse(q2.date));
    if (pts.length >= 40) trace = pts.map((p) => [Math.round(p.x), Math.round(p.y)]);
  }
  fs.writeFileSync(path.join(DATA, `${sk}.json`), JSON.stringify({ v: 1, saved: new Date().toISOString(), pack, trace }));
  console.log(`  ${s.country_name} ${s.year} archivé (${pack.data.laps.length} tours${trace ? ", tracé inclus" : ", sans tracé"}).`);
  return true;
}

// Résumé pour l'écran d'accueil du site : vainqueur et petit tracé (environ 90 points)
function summary(sk) {
  try {
    const { pack, trace } = JSON.parse(fs.readFileSync(path.join(DATA, `${sk}.json`), "utf8"));
    const w = pack.results.find((r) => r.position === 1 && !r.dnf && !r.dns && !r.dsq);
    const d = w && pack.drivers.find((x) => x.driver_number === w.driver_number);
    const out = {};
    if (d) out.winner = { code: d.name_acronym, name: String(d.last_name || d.full_name || d.name_acronym).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()), color: "#" + (d.team_colour || "898781") };
    if (trace && trace.length > 20) { const step = Math.max(1, Math.floor(trace.length / 90)); out.outline = trace.filter((_, i) => i % step === 0); }
    return out;
  } catch { return {}; }
}

/* ---------- Toutes les courses terminées de l'année ---------- */
fs.mkdirSync(DATA, { recursive: true });
let added = 0;
try {
  for (const year of YEARS) {
    const sessions = await api("sessions", { year, session_type: "Race" });
    const done = sessions.filter((s) => s.session_name === "Race" && !s.is_cancelled && new Date(s.date_end) < now)
      .sort((x, y) => new Date(x.date_start) - new Date(y.date_start));
    console.log(`${year} : ${done.length} course(s) terminée(s).`);
    const archived = [];
    for (const s of done) {
      const file = path.join(DATA, `${s.session_key}.json`);
      // Une course terminée depuis moins de 12 h peut encore être complétée par OpenF1 : on la reprendra plus tard
      if (Date.now() - new Date(s.date_end) < 12 * 3600e3) { console.log(`  ${s.country_name} : trop récente, ce sera pour la prochaine fois.`); continue; }
      if (!FORCE && fs.existsSync(file)) { archived.push(s); continue; }
      if (await archiveRace(s)) { archived.push(s); added++; }
    }
    // Liste des courses lue par le site (seulement celles qui sont archivées)
    const keep = ["session_key", "meeting_key", "session_name", "session_type", "date_start", "date_end", "country_name", "location", "circuit_short_name", "year", "is_cancelled"];
    fs.writeFileSync(path.join(DATA, `races-${year}.json`), JSON.stringify(archived.map((s) => ({ ...Object.fromEntries(keep.map((k) => [k, s[k]])), ...summary(s.session_key) }))));
  }
} catch (e) {
  if (e instanceof Closed) { console.log(e.message); process.exit(0); }
  throw e;
}
console.log(added ? `${added} course(s) ajoutée(s) à l'archive.` : "Archive déjà à jour.");
