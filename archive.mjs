// Archive des courses : télécharge sur OpenF1 chaque course terminée et l'enregistre dans data/
// pour que le site n'ait plus besoin d'OpenF1 pour les GP passés (OpenF1 est fermé aux visiteurs
// gratuits pendant les séances en direct). Lancé chaque lundi par GitHub Actions, ou à la main.
// Usage : node archive.mjs [--year 2026] [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sharePages } from "./share.mjs";

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
let lastCall = 0;
async function api(endpoint, params) {
  const url = `${API}/${endpoint}?${typeof params === "string" ? params : new URLSearchParams(params)}`;
  // Accès gratuit OpenF1 : 30 appels par minute au plus. On en fait 25 (un toutes les 2,4 s), et on patiente plus longtemps si OpenF1 freine.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const wait = 2400 - (Date.now() - lastCall); if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    let res;
    try { res = await fetch(url); } catch { await sleep(10000 * attempt); continue; }
    if (res.ok) return res.json();
    if (res.status === 404) return [];
    if (res.status === 401 || res.status === 403) throw new Closed("OpenF1 est fermé aux visiteurs gratuits en ce moment (séance en direct ?) : on réessaiera plus tard.");
    if (res.status === 429 || res.status >= 500) { console.log(`  OpenF1 ${res.status} sur ${endpoint}, nouvel essai dans ${15 * attempt} s…`); await sleep(15000 * attempt); continue; }
    throw new Error(`OpenF1 HTTP ${res.status} sur ${endpoint}`);
  }
  throw new Error(`OpenF1 ne répond pas (${endpoint})`);
}

/* ---------- Tracé du circuit : positions GPS d'un tour propre du vainqueur ---------- */
// On essaie ses tours propres du plus rapide au plus lent (jusqu'à 5) : certains tours n'ont pas de positions chez OpenF1
async function traceOf(sk, pack) {
  const winner = [...pack.results].filter((r) => r.position === 1 && !r.dnf && !r.dns && !r.dsq)[0];
  const st = winner && analyse(pack.data).drivers.get(winner.driver_number);
  const ok = st ? st.laps.filter((l) => !l.reason && l.ds != null && l.t).sort((x, y) => x.t - y.t) : [];
  const iso = (ms) => new Date(ms).toISOString();
  for (const lap of ok.slice(0, 5)) {
    const q = `session_key=${sk}&driver_number=${winner.driver_number}&date>${encodeURIComponent(iso(lap.ds - 300))}&date<${encodeURIComponent(iso(lap.ds + lap.t * 1000 + 300))}`;
    const pts = (await api("location", q)).filter((p) => p.x != null && p.y != null && !(p.x === 0 && p.y === 0)).sort((p, q2) => Date.parse(p.date) - Date.parse(q2.date));
    if (pts.length >= 40) return pts.map((p) => [Math.round(p.x), Math.round(p.y)]);
  }
  return null;
}

/* ---------- Une course : mêmes données que le site, plus le tracé du circuit ---------- */
async function archiveRace(s) {
  const sk = s.session_key, raw = {};
  for (const ep of ["drivers", "laps", "stints", "pit", "race_control", "weather", "session_result", "starting_grid"]) raw[ep] = await api(ep, { session_key: sk });
  if (!raw.laps.length || !raw.session_result.length) { console.log(`  ${s.country_name} : pas encore de données complètes, ignoré.`); return false; }
  if (!raw.starting_grid.length) raw.starting_grid = gridFromPositions(await api("position", { session_key: sk }));
  const seen = new Map(); for (const d of raw.drivers) if (!seen.has(d.driver_number)) seen.set(d.driver_number, d);
  const pack = {
    data: compactRace(raw),
    drivers: [...seen.values()].map((d) => ({ driver_number: d.driver_number, name_acronym: d.name_acronym, full_name: d.full_name, first_name: d.first_name, last_name: d.last_name, team_name: d.team_name, team_colour: d.team_colour })),
    results: raw.session_result.map((r) => ({ driver_number: r.driver_number, position: r.position, number_of_laps: r.number_of_laps, dnf: r.dnf, dns: r.dns, dsq: r.dsq, duration: typeof r.duration === "number" ? r.duration : null, gap_to_leader: r.gap_to_leader, points: r.points })),
    grid: raw.starting_grid.map((g) => ({ driver_number: g.driver_number, position: g.position })),
  };
  const trace = await traceOf(sk, pack);
  fs.writeFileSync(path.join(DATA, `${sk}.json`), JSON.stringify({ v: 1, saved: new Date().toISOString(), pack, trace }));
  console.log(`  ${s.country_name} ${s.year} archivé (${pack.data.laps.length} tours${trace ? ", tracé inclus" : ", sans tracé"}).`);
  return true;
}

// Points marqués dans une séance (course ou sprint) : [code, nom, écurie, couleur, points]
const capName = (d) => String(d.last_name || d.full_name || d.name_acronym || "").toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
function pointsOf(results, drivers) {
  return results.filter((r) => r.points > 0).map((r) => { const d = drivers.find((x) => x.driver_number === r.driver_number) || {}; return [d.name_acronym || String(r.driver_number), capName(d), d.team_name || "", "#" + (d.team_colour || "898781"), r.points]; });
}
// Résumé pour l'écran d'accueil du site : vainqueur, petit tracé (environ 90 points) et points (page Championnat)
function summary(sk) {
  try {
    const { pack, trace } = JSON.parse(fs.readFileSync(path.join(DATA, `${sk}.json`), "utf8"));
    const w = pack.results.find((r) => r.position === 1 && !r.dnf && !r.dns && !r.dsq);
    const d = w && pack.drivers.find((x) => x.driver_number === w.driver_number);
    const out = {};
    if (d) out.winner = { code: d.name_acronym, name: capName(d), color: "#" + (d.team_colour || "898781"), team: d.team_name || "" };
    if (trace && trace.length > 20) { const step = Math.max(1, Math.floor(trace.length / 90)); out.outline = trace.filter((_, i) => i % step === 0); }
    out.pts = pointsOf(pack.results, pack.drivers);
    return out;
  } catch { return {}; }
}

/* ---------- Toutes les courses terminées de l'année ---------- */
fs.mkdirSync(DATA, { recursive: true });
let added = 0, failed = 0;
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
      if (!FORCE && fs.existsSync(file)) {
        // Course déjà archivée mais sans tracé : on retente seulement le tracé
        try {
          const saved = JSON.parse(fs.readFileSync(file, "utf8"));
          if (!saved.trace) { const t = await traceOf(s.session_key, saved.pack); if (t) { saved.trace = t; fs.writeFileSync(file, JSON.stringify(saved)); added++; console.log(`  ${s.country_name} ${s.year} : tracé ajouté.`); } }
          // Course archivée avant l'ajout de la météo : un seul appel pour la compléter
          if (saved.pack?.data && !("wx" in saved.pack.data)) {
            const w = await api("weather", { session_key: s.session_key });
            saved.pack.data.wx = w.length ? compactRace({ laps: [], stints: [], pit: [], race_control: [], weather: w }).wx : null;
            fs.writeFileSync(file, JSON.stringify(saved)); added++; console.log(`  ${s.country_name} ${s.year} : météo ajoutée.`);
          }
        } catch (e) { if (e instanceof Closed) throw e; }
        archived.push(s); continue;
      }
      // Une course en échec ne bloque pas les autres : elle sera reprise la prochaine fois
      try { if (await archiveRace(s)) { archived.push(s); added++; } }
      catch (e) { if (e instanceof Closed) throw e; failed++; console.log(`  ${s.country_name} ${s.year} : échec (${e.message}), on réessaiera la prochaine fois.`); }
    }
    // Liste des courses lue par le site (seulement celles qui sont archivées)
    const keep = ["session_key", "meeting_key", "session_name", "session_type", "date_start", "date_end", "country_name", "location", "circuit_short_name", "year", "is_cancelled"];
    fs.writeFileSync(path.join(DATA, `races-${year}.json`), JSON.stringify(archived.map((s) => ({ ...Object.fromEntries(keep.map((k) => [k, s[k]])), ...summary(s.session_key) }))));
    // Pages de partage (titre + image par GP, pour LinkedIn, WhatsApp…)
    const shared = await sharePages(archived, DATA);
    console.log(`  ${shared} page(s) de partage à jour dans gp/.`);
    // Sprints : seuls les points comptent (classement du championnat)
    const sprints = sessions.filter((s) => s.session_name === "Sprint" && !s.is_cancelled && Date.now() - new Date(s.date_end) > 12 * 3600e3).sort((x, y) => new Date(x.date_start) - new Date(y.date_start));
    const sprintOut = [];
    for (const s of sprints) {
      const file = path.join(DATA, `sprint-${s.session_key}.json`);
      try {
        if (FORCE || !fs.existsSync(file)) {
          const results = await api("session_result", { session_key: s.session_key });
          if (!results.length) continue;
          const drivers = await api("drivers", { session_key: s.session_key });
          fs.writeFileSync(file, JSON.stringify({ session_key: s.session_key, date_start: s.date_start, meeting_key: s.meeting_key, location: s.location, country_name: s.country_name, pts: pointsOf(results, drivers) }));
          console.log(`  Sprint ${s.country_name} ${s.year} archivé.`);
        }
        sprintOut.push(JSON.parse(fs.readFileSync(file, "utf8")));
      } catch (e) { if (e instanceof Closed) throw e; failed++; console.log(`  Sprint ${s.country_name} : échec (${e.message}).`); }
    }
    fs.writeFileSync(path.join(DATA, `sprints-${year}.json`), JSON.stringify(sprintOut));
  }
} catch (e) {
  if (e instanceof Closed) { console.log(e.message); process.exit(0); }
  throw e;
}
console.log(added ? `${added} course(s) ajoutée(s) à l'archive.` : "Archive déjà à jour.");
if (failed) console.log(`${failed} course(s) en échec, reprises au prochain passage.`);
