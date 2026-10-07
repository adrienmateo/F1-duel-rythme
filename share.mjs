// Aperçus de partage : une petite page par GP (gp/<lieu>-<année>.html) avec titre et image,
// lue par LinkedIn, WhatsApp, etc., qui renvoie aussitôt vers le GP sur le site.
// Appelé par archive.mjs après chaque archivage. Seul : `node share.mjs --site` refait l'image générale (og.png).
// L'image PNG demande @resvg/resvg-js (installé par le workflow) ; sans lui, les pages utilisent og.png.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const SITE = (process.env.SITE_URL || process.env.DASHBOARD_URL || "https://adrienmateo.github.io/F1-duel-rythme/").replace(/\/?$/, "/");

// Noms français : mêmes tables que le site (lues dans index.html)
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const grab = (name) => html.match(new RegExp(`const ${name} = [^\\n]*;`))?.[0] || `const ${name} = {};`;
const T = new Function(`${grab("PAYS")}\n${grab("LIEU_PAYS")}\n${grab("VILLES")}\n${grab("villeFr")}\n${grab("paysFr")}\n${grab("slugify")}\n${grab("slugOf")}\nreturn { paysFr, villeFr, slugOf };`)();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => String(s || "").toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
const dateFr = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

let Resvg = null;
async function renderer() {
  if (Resvg !== null) return Resvg;
  try { ({ Resvg } = await import("@resvg/resvg-js")); } catch { Resvg = false; }
  return Resvg;
}

// Image 1200 × 630 : nom du GP, vainqueur, tracé du circuit
function cardSvg({ eyebrow, title, line, color, trace }) {
  let track = "";
  if (trace && trace.length > 20) {
    const xs = trace.map((p) => p[0]), ys = trace.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const box = 420, sc = Math.min(box / (x1 - x0 || 1), box / (y1 - y0 || 1)), ox = 720 + (box - (x1 - x0) * sc) / 2, oy = 105 + (box - (y1 - y0) * sc) / 2;
    const d = "M" + trace.map(([x, y]) => `${(ox + (x - x0) * sc).toFixed(1)},${(oy + (y1 - y) * sc).toFixed(1)}`).join("L") + "Z";
    track = `<path d="${d}" fill="none" stroke="#2c3038" stroke-width="26" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f2f3f5" stroke-width="5" stroke-linejoin="round"/>`;
  }
  const size = title.length > 16 ? 64 : 84;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#14161a"/>
  <rect x="0" y="0" width="1200" height="8" fill="#e10600"/>
  ${track}
  <text x="70" y="140" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="3" fill="#ff4d47">${esc(eyebrow)}</text>
  <text x="70" y="${140 + size + 30}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="800" fill="#ffffff">${esc(title)}</text>
  ${line ? `<rect x="70" y="${size + 230}" width="10" height="48" rx="5" fill="${esc(color || "#e10600")}"/><text x="98" y="${size + 266}" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" font-weight="600" fill="#e8e9ec">${esc(line)}</text>` : ""}
  <text x="70" y="560" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700" fill="#ffffff">Duel de rythme F1</text>
  <text x="70" y="596" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" fill="#9aa0aa">Le Grand Prix raconté par les données</text>
</svg>`;
}
async function writePng(svg, file) {
  const R = await renderer(); if (!R) return false;
  const png = new R(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" } }).render().asPng();
  fs.writeFileSync(file, png); return true;
}

// Une page de partage par GP archivé
export async function sharePages(races, dataDir) {
  const out = path.join(ROOT, "gp"); fs.mkdirSync(out, { recursive: true });
  let n = 0;
  for (const [i, s] of races.entries()) {
    let pack, trace;
    try { ({ pack, trace } = JSON.parse(fs.readFileSync(path.join(dataDir, `${s.session_key}.json`), "utf8"))); } catch { continue; }
    const pays = T.paysFr(s), twin = races.some((x) => x !== s && T.paysFr(x) === pays);
    const name = twin && s.location ? `${pays} · ${T.villeFr(s)}` : pays;
    const fin = pack.results.filter((r) => r.position && !r.dnf && !r.dns && !r.dsq).sort((a, b) => a.position - b.position);
    const who = (r) => r && pack.drivers.find((d) => d.driver_number === r.driver_number);
    const w = who(fin[0]), p2 = who(fin[1]);
    const line = w ? `${cap(w.last_name || w.name_acronym)} gagne${p2 ? ` devant ${cap(p2.last_name || p2.name_acronym)}` : ""}` : "";
    const slug = T.slugOf(s), title = `${name} ${s.year}`;
    const hasPng = await writePng(cardSvg({ eyebrow: `GRAND PRIX · R${String(i + 1).padStart(2, "0")} · ${dateFr(s.date_start).toUpperCase()}`, title: title.toUpperCase(), line, color: w ? "#" + (w.team_colour || "e10600") : null, trace }), path.join(out, `${slug}.png`));
    const img = hasPng ? `${SITE}gp/${slug}.png` : `${SITE}og.png`;
    const desc = `${line ? line + ". " : ""}Moments clés, duels entre coéquipiers et stratégies, racontés par les données.`;
    fs.writeFileSync(path.join(out, `${slug}.html`), `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${esc(title)} · ${esc(line)} · Duel de rythme F1</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:site_name" content="Duel de rythme F1">
<meta property="og:title" content="${esc(title)} : ${esc(line)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${SITE}gp/${slug}.html"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=../#${slug}">
<script>location.replace("../#${slug}")</script>
</head><body><p><a href="../#${slug}">Voir ${esc(title)} sur Duel de rythme F1</a></p></body></html>
`);
    n++;
  }
  return n;
}

// Image générale du site (og.png), utilisée hors pages de GP
if (process.argv.includes("--site")) {
  const ok = await writePng(cardSvg({ eyebrow: "FORMULE 1 · CHAQUE GRAND PRIX", title: "DUEL DE RYTHME", line: "Qui était vraiment le plus rapide ?", color: "#e10600", trace: null }), path.join(ROOT, "og.png"));
  console.log(ok ? "og.png créé." : "Installe @resvg/resvg-js pour créer og.png.");
}
