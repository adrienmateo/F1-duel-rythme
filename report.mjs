#!/usr/bin/env node
// Compte rendu automatique d'un Grand Prix, envoyé par mail.
//
//   node report.mjs                     → dernier GP terminé (s'il date de moins de 8 jours), envoi du mail
//   (depuis GitHub Actions, lancement à la demande : --force est toujours ajouté)
//   node report.mjs --dry-run           → génère out/report.html sans envoyer
//   node report.mjs --session 9998      → un GP précis (session_key OpenF1)
//   node report.mjs --force             → envoie même si le dernier GP date de plus de 8 jours
//
// Variables d'environnement (secrets GitHub) :
//   GMAIL_USER          adresse Gmail qui envoie
//   GMAIL_APP_PASSWORD  mot de passe d'application Google (pas ton mot de passe habituel)
//   MAIL_TO             destinataire(s), séparés par des virgules (défaut : GMAIL_USER)
//   DASHBOARD_URL       lien vers ton dashboard en ligne (facultatif)
//   MAKE_WEBHOOK_URL    webhook du scénario Make : s'il est défini, les données partent vers Make
//                       (Claude rédige, Make envoie le mail et remplit le Google Sheet). Sinon : mail direct.
//
// Le calcul est lu directement dans index.html : le mail et le dashboard donnent toujours les mêmes chiffres.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API = "https://api.openf1.org/v1";
const FIXTURES = process.env.F1_FIXTURES; // tests hors ligne
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };

/* ---------- 1. Calcul partagé avec le dashboard ---------- */
function loadAnalysis() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const cfg = html.match(/const CFG = \{[^\n]*\};/)?.[0];
  const med = html.match(/const median = [^\n]*;/)?.[0];
  const a = html.indexOf("/* ======================= Calcul");
  const b = html.indexOf("/* ======================= Rendu");
  if (!cfg || !med || a < 0 || b < 0) throw new Error("Impossible de lire le calcul dans index.html (structure modifiée ?)");
  return new Function(`${cfg}\n${med}\n${html.slice(a, b)}\nreturn { analyse, sameCompoundGap, compactRace, CFG, median };`)();
}
const { analyse, sameCompoundGap, compactRace, CFG } = loadAnalysis();

/* ---------- 2. OpenF1 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(endpoint, params = {}) {
  if (FIXTURES) {
    const all = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${endpoint}.json`), "utf8"));
    return params.session_key ? all.filter((x) => x.session_key == null || x.session_key == params.session_key) : all;
  }
  const url = `${API}/${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url);
    if (res.ok) { await sleep(400); return res.json(); }
    if (res.status === 404) return [];
    if (res.status === 429 || res.status >= 500) { await sleep(5000 * attempt); continue; }
    throw new Error(`${endpoint} → HTTP ${res.status}`);
  }
  throw new Error(`${endpoint} → OpenF1 ne répond pas`);
}

async function pickRace() {
  if (arg("--session")) {
    const s = (await api("sessions", { session_key: arg("--session") })).find((x) => String(x.session_key) === arg("--session"));
    if (!s) throw new Error(`Session ${arg("--session")} introuvable`);
    return s;
  }
  const year = new Date().getUTCFullYear();
  const races = (await api("sessions", { year, session_type: "Race" }))
    .filter((s) => s.session_name === "Race" && !s.is_cancelled && new Date(s.date_end) < new Date())
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
  const last = races.at(-1);
  if (!last) return null;
  const ageDays = (Date.now() - new Date(last.date_end)) / 86400000;
  if (ageDays > 8 && !flag("--force")) { console.log(`Pas de GP cette semaine (dernier : ${last.country_name}, il y a ${Math.round(ageDays)} j). Rien à envoyer.`); return null; }
  return last;
}

async function fetchAll(sk) {
  const get = (ep) => api(ep, { session_key: sk });
  const raw = {};
  for (const ep of ["drivers", "laps", "stints", "pit", "race_control", "session_result", "starting_grid"]) raw[ep] = await get(ep);
  // Même format allégé que le site (compactRace, lu dans index.html)
  const data = compactRace(raw);
  const seen = new Map();
  for (const d of raw.drivers) if (!seen.has(d.driver_number)) seen.set(d.driver_number, d);
  return { data, drivers: [...seen.values()], results: raw.session_result, grid: raw.starting_grid };
}

/* ---------- 3. Contenu du compte rendu ---------- */
function buildReport(session, { data, drivers, results, grid }) {
  if (!data.laps.length) throw new Error("OpenF1 n'a pas encore de temps au tour pour cette course.");
  const A = analyse(data);
  const info = new Map(drivers.map((d) => [d.driver_number, d]));
  const name = (dn) => info.get(dn)?.name_acronym || String(dn);
  const team = (dn) => info.get(dn)?.team_name || "";

  const res = [...results].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  const out = (r) => r.dnf || r.dns || r.dsq;
  const finishers = res.filter((r) => !out(r) && r.position);
  const gridPos = new Map(grid.map((g) => [g.driver_number, g.position]));

  const movers = finishers.filter((r) => gridPos.has(r.driver_number))
    .map((r) => ({ dn: r.driver_number, from: gridPos.get(r.driver_number), to: r.position, delta: gridPos.get(r.driver_number) - r.position }));

  const pace = [...A.drivers].filter(([, s]) => s.n >= CFG.minClean).map(([dn, s]) => ({ dn, median: s.median, n: s.n }))
    .sort((a, b) => a.median - b.median);
  pace.forEach((p) => { p.gap = p.median - pace[0].median; });

  const teams = new Map();
  for (const d of drivers) { const t = d.team_name || "?"; if (!teams.has(t)) teams.set(t, []); teams.get(t).push(d.driver_number); }
  const duels = [];
  for (const [t, dns] of teams) {
    if (dns.length !== 2) continue;
    const [a, b] = dns.map((dn) => ({ dn, s: A.drivers.get(dn) }));
    const ok = (x) => x.s && x.s.n >= CFG.minClean;
    if (!ok(a) || !ok(b)) { duels.push({ team: t, valid: false, out: [a, b].filter((x) => !ok(x)).map((x) => name(x.dn)) }); continue; }
    const [fast, slow] = a.s.median <= b.s.median ? [a, b] : [b, a];
    const gap = slow.s.median - fast.s.median;
    duels.push({ team: t, valid: true, fast: fast.dn, slow: slow.dn, gap, same: sameCompoundGap(slow.s, fast.s) });
  }
  duels.sort((x, y) => (y.valid - x.valid) || ((y.gap ?? 0) - (x.gap ?? 0)));

  const strategy = (finishers.length ? finishers : res).map((r) => {
    const s = A.drivers.get(r.driver_number);
    return { pos: r.position, dn: r.driver_number, stops: s?.pits.length ?? 0, tyres: s?.stints.map((x) => x.c) ?? [] };
  });
  const stopsCount = {};
  for (const s of strategy) stopsCount[s.stops] = (stopsCount[s.stops] || 0) + 1;

  // Points clés rédigés automatiquement
  const key = [];
  const win = finishers[0];
  if (win) key.push(`<b>${name(win.driver_number)}</b> (${team(win.driver_number)}) remporte le GP${finishers[1] ? `, devant ${name(finishers[1].driver_number)} et ${name(finishers[2]?.driver_number ?? "")}` : ""}.`);
  if (pace[0] && win && pace[0].dn !== win.driver_number) {
    const p = res.find((r) => r.driver_number === pace[0].dn);
    key.push(`Meilleur rythme de course : <b>${name(pace[0].dn)}</b>, ${p?.position ? `qui termine P${p.position}` : "pourtant non classé"}.`);
  } else if (pace[0]) key.push(`Le vainqueur avait aussi le meilleur rythme de course.`);
  const best = [...movers].sort((a, b) => b.delta - a.delta)[0];
  if (best && best.delta >= 3) key.push(`Plus belle remontée : <b>${name(best.dn)}</b>, de P${best.from} à P${best.to} (+${best.delta}).`);
  const kinds = { SC: "safety car", VSC: "VSC", Rouge: "drapeau rouge", Ralenti: "ralentissement du peloton" };
  key.push(A.neutral.ranges.length ? `Course neutralisée ${A.neutral.ranges.length} fois : ${A.neutral.ranges.map((r) => `${kinds[r.kind]} (T${r.start}${r.end > r.start ? "–" + r.end : ""})`).join(", ")}.` : "Aucune neutralisation.");
  const validDuels = duels.filter((d) => d.valid);
  if (validDuels.length) {
    const wide = validDuels[0], tight = validDuels.at(-1);
    key.push(`Duel le plus déséquilibré : ${wide.team}, <b>${name(wide.fast)}</b> devant ${name(wide.slow)} de ${fmt(wide.gap, 3)} s/tour.`);
    if (tight !== wide) key.push(`Duel le plus serré : ${tight.team}, ${name(tight.fast)} et ${name(tight.slow)} séparés de ${fmt(tight.gap, 3)} s/tour.`);
  }

  const roster = drivers.map((d) => ({ code: d.name_acronym, nom: d.full_name, ecurie: d.team_name }));
  return { session, A, name, team, res, out, movers, pace, duels, strategy, stopsCount, key, roster };
}

/* ---------- 4. Mise en forme du mail (HTML compatible clients mail) ---------- */
const fmt = (x, d) => x.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const lapTime = (t) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, "0").replace(".", ",")}`; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TYRE = { SOFT: ["S", "#da291c"], MEDIUM: ["M", "#f2b705"], HARD: ["H", "#a9a8a0"], INTERMEDIATE: ["I", "#43b02a"], WET: ["W", "#0067ad"], UNKNOWN: ["?", "#898781"] };
const chip = (c) => { const [l, col] = TYRE[c] || TYRE.UNKNOWN; return `<span style="display:inline-block;width:18px;height:18px;line-height:14px;border:2px solid ${col};border-radius:50%;text-align:center;font:700 10px Menlo,Consolas,monospace;color:#0b0b0b;margin-right:2px;box-sizing:border-box">${l}</span>`; };

function renderHtml(R, { ai = false } = {}) {
  const s = R.session;
  const C = { ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", line: "#e1e0d9", bg: "#f6f6f3", card: "#ffffff", accent: "#c8102e" };
  const th = `style="text-align:left;padding:6px 8px;font:600 11px Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};border-bottom:1px solid ${C.line}"`;
  const thr = th.replace("text-align:left", "text-align:right");
  const td = `style="padding:7px 8px;border-bottom:1px solid ${C.line};font:14px Arial,sans-serif;color:${C.ink}"`;
  const tdn = `style="padding:7px 8px;border-bottom:1px solid ${C.line};font:13px Menlo,Consolas,monospace;color:${C.ink};text-align:right;white-space:nowrap"`;
  const h2 = (t, sub) => `<h2 style="margin:0 0 2px;font:700 18px Arial,sans-serif;text-transform:uppercase;letter-spacing:.02em;color:${C.ink}">${t}</h2>${sub ? `<p style="margin:0 0 10px;font:12px Arial,sans-serif;color:${C.muted}">${sub}</p>` : ""}`;
  const card = (inner) => `<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:8px;padding:16px">${inner}</td></tr><tr><td style="height:12px"></td></tr>`;
  const signed = (x, d, u) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmt(Math.abs(x), d)}${u}`);
  const date = new Date(s.date_start).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

  const podium = R.res.slice(0, 10).map((r) => `<tr><td ${tdn.replace("text-align:right", "text-align:left")}>${R.out(r) ? "—" : `P${r.position}`}</td><td ${td}><b>${esc(R.name(r.driver_number))}</b> <span style="color:${C.muted}">${esc(R.team(r.driver_number))}</span></td><td ${tdn}>${r.points ? `${r.points} pts` : ""}</td></tr>`).join("");
  const outs = R.res.filter(R.out).map((r) => `${esc(R.name(r.driver_number))} (${r.dsq ? "disqualifié" : r.dns ? "non partant" : `abandon T${r.number_of_laps ?? "?"}`})`);

  const gains = [...R.movers].sort((a, b) => b.delta - a.delta).filter((m) => m.delta > 0).slice(0, 3);
  const losses = [...R.movers].sort((a, b) => a.delta - b.delta).filter((m) => m.delta < 0).slice(0, 3);
  const moverRow = (m) => `<tr><td ${td}><b>${esc(R.name(m.dn))}</b></td><td ${tdn}>P${m.from} → P${m.to}</td><td ${tdn} style="color:${m.delta > 0 ? "#006300" : C.accent}">${m.delta > 0 ? "▲" : "▼"} ${Math.abs(m.delta)}</td></tr>`;

  const paceRows = R.pace.slice(0, 5).map((p, i) => `<tr><td ${tdn.replace("text-align:right", "text-align:left")}>${i + 1}</td><td ${td}><b>${esc(R.name(p.dn))}</b> <span style="color:${C.muted}">${esc(R.team(p.dn))}</span></td><td ${tdn}>${lapTime(p.median)}</td><td ${tdn}>${i ? `+${fmt(p.gap, 3)} s` : "réf."}</td></tr>`).join("");

  const duelRows = R.duels.map((d) => d.valid
    ? `<tr><td ${td}>${esc(d.team)}</td><td ${td}><b>${esc(R.name(d.fast))}</b> › ${esc(R.name(d.slow))}</td><td ${tdn}>+${fmt(d.gap, 3)} s</td><td ${tdn}>${signed(d.same, 3, " s")}</td></tr>`
    : `<tr><td ${td}>${esc(d.team)}</td><td ${td} colspan="3"><span style="color:${C.muted};font-style:italic">Pas comparable : ${esc(d.out.join(", "))} sans assez de tours propres</span></td></tr>`).join("");

  const stratRows = R.strategy.map((x) => `<tr><td ${tdn.replace("text-align:right", "text-align:left")}>${x.pos ? `P${x.pos}` : "—"}</td><td ${td}><b>${esc(R.name(x.dn))}</b></td><td ${tdn}>${x.stops}</td><td ${td}>${x.tyres.map(chip).join("")}</td></tr>`).join("");
  const stopsTxt = Object.entries(R.stopsCount).sort((a, b) => a[0] - b[0]).map(([n, c]) => `${c} pilote${c > 1 ? "s" : ""} à ${n} arrêt${n > 1 ? "s" : ""}`).join(" · ");

  const dash = process.env.DASHBOARD_URL;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compte rendu ${esc(s.country_name)} ${s.year}</title></head>
<body style="margin:0;background:${C.bg};color:${C.ink}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px">
<tr><td style="padding:0 4px 16px">
  <div style="font:600 11px Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:${C.accent}">Compte rendu · Course</div>
  <h1 style="margin:4px 0 2px;font:800 30px Arial Narrow,Arial,sans-serif;text-transform:uppercase;color:${C.ink}">${esc(s.country_name)} ${s.year}</h1>
  <div style="font:14px Arial,sans-serif;color:${C.ink2}">${esc(s.location || s.circuit_short_name)} · ${date} · ${R.A.totalLaps} tours</div>
</td></tr>
${ai
  ? card(`${h2("Le résumé", "Rédigé par Claude à partir des chiffres ci-dessous")}<div style="font:15px/1.6 Arial,sans-serif;color:${C.ink}">${AI_PLACEHOLDER}</div>`)
  : card(`${h2("Les points clés")}<ul style="margin:0;padding-left:18px;font:15px/1.55 Arial,sans-serif;color:${C.ink}">${R.key.map((k) => `<li style="margin:0 0 4px">${k}</li>`).join("")}</ul>`)}
${card(`${h2("Classement", "Top 10")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${podium}</table>${outs.length ? `<p style="margin:10px 0 0;font:13px Arial,sans-serif;color:${C.ink2}">Non classés : ${outs.join(", ")}</p>` : ""}`)}
${R.movers.length ? card(`${h2("Grille → arrivée", "Plus fortes remontées et chutes parmi les pilotes classés")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${gains.map(moverRow).join("")}${losses.map(moverRow).join("")}</table>`) : ""}
${card(`${h2("Rythme de course", "Temps médian sur tours propres (hors départ, stands et neutralisations)")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><th ${th}>#</th><th ${th}>Pilote</th><th ${thr}>Médian</th><th ${thr}>Écart</th></tr>${paceRows}</table>`)}
${card(`${h2("Duels entre coéquipiers", "Écart de rythme médian par tour · « À pneus égaux » : écart recalculé sur les gommes communes (négatif : l'écart venait de la stratégie)")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><th ${th}>Écurie</th><th ${th}>Duel</th><th ${thr}>Écart</th><th ${thr}>Pneus égaux</th></tr>${duelRows}</table>`)}
${card(`${h2("Stratégies", stopsTxt)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><th ${th}>Pos.</th><th ${th}>Pilote</th><th ${thr}>Arrêts</th><th ${th}>Pneus</th></tr>${stratRows}</table>`)}
${dash ? `<tr><td align="center" style="padding:4px 0 16px"><a href="${esc(dash)}" style="display:inline-block;background:${C.accent};color:#ffffff;text-decoration:none;font:600 14px Arial,sans-serif;padding:10px 20px;border-radius:6px">Ouvrir le dashboard</a></td></tr>` : ""}
<tr><td style="padding:4px;font:12px Arial,sans-serif;color:${C.muted}">Données <a href="https://openf1.org" style="color:${C.muted}">OpenF1</a> · généré automatiquement le ${new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.${dash ? `<br>Tu reçois ce mail suite à ton inscription aux comptes rendus. <a href="${esc(dash.replace(/\/$/, ""))}/#desinscription" style="color:${C.muted}">Se désinscrire</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

function renderText(R) {
  const s = R.session;
  const strip = (h) => h.replace(/<[^>]+>/g, "");
  return [
    `COMPTE RENDU · ${s.country_name} ${s.year}`.toUpperCase(), "",
    ...R.key.map((k) => `• ${strip(k)}`), "",
    "RYTHME DE COURSE (médian)", ...R.pace.slice(0, 5).map((p, i) => `${i + 1}. ${R.name(p.dn)}  ${lapTime(p.median)}${i ? `  +${fmt(p.gap, 3)} s` : ""}`), "",
    "DUELS ENTRE COÉQUIPIERS", ...R.duels.map((d) => d.valid ? `${d.team} : ${R.name(d.fast)} devant ${R.name(d.slow)} de ${fmt(d.gap, 3)} s/tour` : `${d.team} : pas comparable`),
    "", process.env.DASHBOARD_URL ? `Dashboard : ${process.env.DASHBOARD_URL}` : "", "Données OpenF1",
    process.env.DASHBOARD_URL ? `Se désinscrire : ${process.env.DASHBOARD_URL.replace(/\/$/, "")}/#desinscription` : "",
  ].join("\n");
}

/* ---------- Destinataires choisis au lancement ---------- */
// DESTINATAIRES = "a@x.fr, b@y.com" (champ du formulaire « Run workflow »). Ils reçoivent le mail en copie cachée.
const MANUAL_RECIPIENTS = [...new Set((process.env.DESTINATAIRES || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase())
  .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
const ignored = (process.env.DESTINATAIRES || "").split(/[,;\s]+/).filter((x) => x.trim() && !MANUAL_RECIPIENTS.includes(x.trim().toLowerCase()));
if (ignored.length) console.log(`⚠ Adresses ignorées (format invalide) : ${ignored.join(", ")}`);

// Inscrits via le formulaire du dashboard (Netlify Forms). La dernière action de chaque adresse fait foi :
// une inscription puis une désinscription = désinscrit.
async function fetchSubscribers() {
  const token = process.env.NETLIFY_TOKEN, site = process.env.NETLIFY_SITE;
  if (process.env.ABONNES === "false") { console.log("Inscrits du site : non inclus (option décochée)."); return []; }
  if (!token || !site) { console.log("Inscrits du site : NETLIFY_TOKEN / NETLIFY_SITE non configurés, ignorés."); return []; }
  const base = process.env.NETLIFY_API_URL || "https://api.netlify.com/api/v1";
  try {
    const all = [];
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${base}/sites/${encodeURIComponent(site)}/submissions?per_page=100&page=${page}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = await res.json();
      all.push(...batch);
      if (batch.length < 100) break;
    }
    const state = new Map();
    for (const sub of all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))) {
      const email = String(sub.data?.email || sub.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
      if (sub.form_name === "abonnement" && (sub.data?.consentement === "oui")) state.set(email, true);
      else if (sub.form_name === "desabonnement") state.set(email, false);
    }
    const list = [...state].filter(([, on]) => on).map(([e]) => e);
    console.log(`Inscrits du site : ${list.length}`);
    return list;
  } catch (e) {
    console.log(`⚠ Impossible de lire les inscrits Netlify (${e.message}) : envoi sans eux.`);
    return [];
  }
}
let RECIPIENTS = MANUAL_RECIPIENTS;

/* ---------- 5. Données pour Make (webhook) ---------- */
const AI_PLACEHOLDER = "[[RESUME_IA]]";
const strip = (h) => h.replace(/<[^>]+>/g, "");
const fr = (x, d) => (x == null ? "" : x.toFixed(d).replace(".", ",")); // nombre lisible par un Google Sheet en français

// Faits bruts, en texte, donnés à Claude : il rédige à partir de ça et de rien d'autre
function renderFacts(R) {
  const s = R.session;
  const kinds = { SC: "Safety car", VSC: "Virtual safety car", Rouge: "Drapeau rouge", Ralenti: "Peloton ralenti sans message officiel (drapeaux jaunes probables)" };
  const L = [];
  L.push(`GRAND PRIX : ${s.country_name} ${s.year}, circuit de ${s.location || s.circuit_short_name}, ${R.A.totalLaps} tours.`);
  L.push("", "PILOTES (code = nom complet, écurie) :");
  R.roster.forEach((d) => L.push(`${d.code} = ${d.nom}, ${d.ecurie}`));
  L.push("", "CLASSEMENT (top 10) :");
  R.res.filter((r) => !R.out(r)).slice(0, 10).forEach((r) => L.push(`P${r.position} ${R.name(r.driver_number)} (${R.team(r.driver_number)})`));
  const outs = R.res.filter(R.out);
  if (outs.length) L.push(`Non classés : ${outs.map((r) => `${R.name(r.driver_number)} (${r.dsq ? "disqualifié" : r.dns ? "non partant" : `abandon au tour ${r.number_of_laps ?? "?"}`})`).join(", ")}`);
  const mv = [...R.movers].sort((a, b) => b.delta - a.delta);
  if (mv.length) {
    L.push("", "GRILLE → ARRIVÉE :");
    mv.filter((m) => m.delta > 0).slice(0, 3).forEach((m) => L.push(`${R.name(m.dn)} : P${m.from} → P${m.to} (gagne ${m.delta} places)`));
    mv.filter((m) => m.delta < 0).slice(-3).reverse().forEach((m) => L.push(`${R.name(m.dn)} : P${m.from} → P${m.to} (perd ${-m.delta} places)`));
  }
  L.push("", "NEUTRALISATIONS :");
  L.push(R.A.neutral.ranges.length ? R.A.neutral.ranges.map((r) => `${kinds[r.kind]} tours ${r.start} à ${r.end}`).join(" ; ") : "aucune");
  L.push("", "RYTHME DE COURSE (temps médian sur tours représentatifs, top 5) :");
  R.pace.slice(0, 5).forEach((p, i) => L.push(`${i + 1}. ${R.name(p.dn)} (${R.team(p.dn)}) ${lapTime(p.median)}${i ? ` (+${fmt(p.gap, 3)} s/tour)` : ""}`));
  L.push("", "DUELS ENTRE COÉQUIPIERS (écart de rythme médian ; « à pneus égaux » positif = l'avantage tient sur le même pneu, négatif = il venait de la stratégie) :");
  R.duels.forEach((d) => L.push(d.valid
    ? `${d.team} : ${R.name(d.fast)} devant ${R.name(d.slow)} de ${fmt(d.gap, 3)} s/tour, à pneus égaux ${d.same == null ? "non calculable" : `${d.same > 0 ? "+" : d.same < 0 ? "−" : ""}${fmt(Math.abs(d.same), 3)} s/tour`}`
    : `${d.team} : non comparable (${d.out.join(", ")} sans assez de tours représentatifs)`));
  L.push("", "STRATÉGIES :");
  L.push(Object.entries(R.stopsCount).map(([n, c]) => `${c} pilote(s) à ${n} arrêt(s)`).join(", "));
  R.strategy.slice(0, 10).forEach((x) => L.push(`${x.pos ? `P${x.pos}` : "—"} ${R.name(x.dn)} : ${x.stops} arrêt(s), pneus ${x.tyres.join(" → ")}`));
  return L.join("\n");
}

function buildPayload(R) {
  const s = R.session;
  const date = s.date_start.slice(0, 10);
  const gp = `${s.country_name} ${s.year}`;
  return {
    version: 2,
    gp: { nom: gp, pays: s.country_name, circuit: s.location || s.circuit_short_name, date, annee: s.year, tours: R.A.totalLaps, session_key: s.session_key },
    claude_input: renderFacts(R),
    points_cles: R.key.map(strip),
    mail: {
      objet: `F1 · Compte rendu ${gp}`,
      html_template: renderHtml(R, { ai: true }),      // contient [[RESUME_IA]] à remplacer par le texte de Claude
      html_sans_ia: renderHtml(R),                     // version complète sans IA (en cas d'échec du module Claude)
      marqueur: AI_PLACEHOLDER,
    },
    // Une ligne par duel, prête pour Google Sheets (colonnes *_fr : nombres au format français)
    duels: R.duels.map((d) => ({
      gp, date, ecurie: d.team, valide: d.valid ? "oui" : "non",
      pilote_rapide: d.valid ? R.name(d.fast) : "", pilote_lent: d.valid ? R.name(d.slow) : "",
      ecart_s_fr: d.valid ? fr(d.gap, 3) : "", pneus_egaux_s_fr: d.valid ? fr(d.same, 3) : "",
      ecart_s: d.valid ? +d.gap.toFixed(3) : null, pneus_egaux_s: d.valid && d.same != null ? +d.same.toFixed(3) : null,
      commentaire: d.valid ? "" : `${d.out.join(", ")} sans assez de tours représentatifs`,
    })),
    dashboard_url: process.env.DASHBOARD_URL || "",
    destinataires: RECIPIENTS,                      // à mapper dans le champ Bcc (Cci) du module Gmail
    destinataires_texte: RECIPIENTS.join(", "),
  };
}

async function postToMake(payload) {
  const url = process.env.MAKE_WEBHOOK_URL;
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.trim());
    return true;
  } catch (e) {
    console.log(`⚠ Webhook Make injoignable (${e.message}). Repli : envoi direct du mail.`);
    return false;
  }
}

/* ---------- 6. Envoi direct (repli, ou si Make n'est pas configuré) ---------- */
async function send(subject, html, text) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error("GMAIL_USER et GMAIL_APP_PASSWORD doivent être définis (secrets GitHub).");
  const nodemailer = (await import("nodemailer")).default;
  const transport = process.env.MAIL_TRANSPORT === "json"
    ? nodemailer.createTransport({ jsonTransport: true }) // test : construit le mail sans l'envoyer
    : nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  const info = await transport.sendMail({ from: `"F1 · Compte rendu" <${GMAIL_USER}>`, to: process.env.MAIL_TO || GMAIL_USER, bcc: RECIPIENTS.length ? RECIPIENTS : undefined, subject, html, text });
  return info;
}

/* ---------- Main ---------- */
const session = await pickRace();
if (!session) process.exit(0);
console.log(`→ ${session.country_name} ${session.year} (session ${session.session_key})`);
const R = buildReport(session, await fetchAll(session.session_key));
const subject = `F1 · Compte rendu ${session.country_name} ${session.year}`;
RECIPIENTS = [...new Set([...MANUAL_RECIPIENTS, ...(await fetchSubscribers())])];
const html = renderHtml(R), text = renderText(R), payload = buildPayload(R);
fs.mkdirSync(path.join(ROOT, "out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "out", "report.html"), html);
fs.writeFileSync(path.join(ROOT, "out", "payload.json"), JSON.stringify(payload, null, 2));
console.log(text);
if (flag("--dry-run")) { console.log("\n(dry-run) Aperçu : out/report.html et out/payload.json — rien n'est envoyé."); process.exit(0); }
if (process.env.MAKE_WEBHOOK_URL && await postToMake(payload)) {
  console.log(`\n✓ Données envoyées au scénario Make (rédaction Claude + mail + Google Sheets)${RECIPIENTS.length ? ` · ${RECIPIENTS.length} destinataire(s) en copie cachée` : ""}.`);
  process.exit(0);
}
const info = await send(subject, html, text);
console.log(`\n✓ Mail envoyé à ${process.env.MAIL_TO || process.env.GMAIL_USER}${RECIPIENTS.length ? ` + ${RECIPIENTS.length} en copie cachée` : ""}${info.messageId ? ` (${info.messageId})` : ""}`);
