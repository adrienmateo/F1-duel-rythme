
/* ======================= Haut de page : feux de départ, tracé du GP et petite F1 ======================= */
// Ambiance seulement : pendant le chargement d'un GP, les feux s'allument au rythme des appels OpenF1.
// Quand tout est prêt, ils s'éteignent, le tracé réel du GP se dessine (positions du meilleur tour du vainqueur)
// et une F1 vue du dessus traverse la page, rejoint la ligne en dérapant, fait un tour et se gare sur la grille.
const HC = { tok: 0, lit: 0, t0: 0, T: null, car: null, phase: "off", raf: 0, last: 0, t: 0, s: 0, v: 0, yaw: 0, entry: null, mark: null, color: "#888", num: "" };
const HC_NP = 480, HC_VB = { w: 300, h: 180, pad: 14 }, HC_CAR = 0.6;
const hcSvg = () => $("#hc-svg"), hcFx = () => $("#hc-fx");
const hcEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

/* --- Feux de départ --- */
function hcBegin() {
  const tok = ++HC.tok;
  cancelAnimationFrame(HC.raf); HC.raf = 0; HC.phase = "off";
  $("#hc-car").innerHTML = ""; $("#hc-marks").innerHTML = ""; $("#hc-puffs").innerHTML = "";
  hcSvg().innerHTML = ""; $("#hc").classList.remove("parked", "ready", "none");
  HC.lit = 0; HC.t0 = performance.now();
  $$("#hc-lights i").forEach((l) => l.classList.remove("lit"));
  if (!reduce) $("#hc-lights").classList.add("on");
  return tok;
}
function hcProgress(frac) { // 0 → 1 : nombre de feux allumés
  const n = Math.max(HC.lit, Math.min(5, Math.ceil(frac * 5)));
  $$("#hc-lights i").forEach((l, i) => l.classList.toggle("lit", i < n)); HC.lit = n;
}
async function hcFinish(tok) {
  if (reduce) return;
  // Données en cache : on joue quand même une courte séquence, les feux s'allument un par un
  while (HC.lit < 5) { await sleep(110); if (tok !== HC.tok) return; hcProgress((HC.lit + 1) / 5); }
  await sleep(320); if (tok !== HC.tok) return;
  $$("#hc-lights i").forEach((l) => l.classList.remove("lit")); // extinction des feux
  await sleep(240); if (tok !== HC.tok) return;
  $("#hc-lights").classList.remove("on");
}
function hcFail() { $("#hc-lights").classList.remove("on"); $("#hc").classList.add("none"); }

/* --- Tracé : positions OpenF1 du meilleur tour du vainqueur, gardées dans le navigateur --- */
async function hcTrace(d) {
  const key = `f1duel:v4:trace:${RACE.session_key}`;
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v); } catch {}
  const lap = bestLapOf(d); if (!lap) return null;
  const tr = await fetchTrace(d, lap);
  if (tr.length < 40) return null;
  const pts = tr.map((p) => [Math.round(p.x), Math.round(p.y)]);
  try { localStorage.setItem(key, JSON.stringify(pts)); } catch {}
  return pts;
}
function hcBuild(raw) {
  // Rééchantillonnage à pas constant, mise à l'échelle dans la vignette (y inversé comme sur le circuit des secteurs)
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((HC_VB.w - 2 * HC_VB.pad) / (x1 - x0 || 1), (HC_VB.h - 2 * HC_VB.pad) / (y1 - y0 || 1)), ox = (HC_VB.w - (x1 - x0) * sc) / 2, oy = (HC_VB.h - (y1 - y0) * sc) / 2;
  const P = raw.map(([x, y]) => [ox + (x - x0) * sc, HC_VB.h - (oy + (y - y0) * sc)]);
  const acc = [0]; for (let i = 1; i <= P.length; i++) acc.push(acc[i - 1] + Math.hypot(P[i % P.length][0] - P[i - 1][0], P[i % P.length][1] - P[i - 1][1]));
  const L = acc.at(-1), pts = []; let j = 0;
  for (let k = 0; k < HC_NP; k++) { const dd = (k / HC_NP) * L; while (acc[j + 1] < dd) j++; const u = (dd - acc[j]) / ((acc[j + 1] - acc[j]) || 1), a = P[j], b = P[(j + 1) % P.length]; pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  const N = HC_NP, seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % N][0] - p[0], pts[(i + 1) % N][1] - p[1]) || 0.01);
  const ang = pts.map((p, i) => { const a = pts[(i - 2 + N) % N], b = pts[(i + 2) % N]; return Math.atan2(b[1] - a[1], b[0] - a[0]); });
  let turn = ang.map((a, i) => { let dd = ang[(i + 4) % N] - ang[(i - 4 + N) % N]; while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI; return dd; });
  turn = turn.map((_, i) => { let s = 0; for (let k = -6; k <= 6; k++) s += turn[(i + k + N) % N]; return s / 13; });
  // Vitesse « pour l'œil » : lente en virage, rapide en ligne droite, freinages et relances lissés
  const v = turn.map((dd) => Math.max(0.42, 1 - Math.abs(dd) * 1.3));
  for (let pass = 0; pass < 2; pass++) { for (let i = 2 * N; i >= 0; i--) { const k = i % N; v[k] = Math.min(v[k], v[(k + 1) % N] + 0.04); } for (let i = 0; i <= 2 * N; i++) { const k = i % N; v[k] = Math.min(v[k], v[(k - 1 + N) % N] + 0.022); } }
  HC.T = { pts, ang, turn, v, seg, L: seg.reduce((a, b) => a + b, 0), vmax: seg.reduce((a, dd, i) => a + dd / v[i], 0) / 5.2 }; // un tour ≈ 6 s
  const svg = hcSvg(); svg.innerHTML = "";
  const d = "M" + pts.map((p) => p.map((x) => x.toFixed(1)).join(",")).join("L") + "Z";
  const edge = hcEl("path", { d, class: "hc-edge" }, svg), road = hcEl("path", { d, class: "hc-road" }, svg); hcEl("path", { d, class: "hc-mid" }, svg);
  const g = hcEl("g", { transform: `translate(${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}) rotate(${(ang[0] * 180 / Math.PI).toFixed(1)})` }, svg);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) hcEl("rect", { x: -1 + r, y: -3.2 + c * 1.6, width: 1, height: 1.6, fill: (r + c) % 2 ? "#111" : "#fff" }, g);
  const len = road.getTotalLength();
  [edge, road].forEach((p) => { p.style.strokeDasharray = len; p.style.strokeDashoffset = reduce ? 0 : len; });
  requestAnimationFrame(() => requestAnimationFrame(() => [edge, road].forEach((p) => (p.style.strokeDashoffset = 0))));
  $("#hc").classList.add("ready");
}

/* --- La voiture, vue du dessus (avant = +x, 40 unités de long) --- */
function hcDrawCar(color, num) { const g = $("#hc-car"); g.innerHTML = ""; HC.car = drawTopCar(g, color, num); }
// F1 vue du dessus (avant = +x, 40 unités de long), réutilisée par la voiture qui se balade
function drawTopCar(g, color, num) {
  const car = hcEl("g", {}, g);
  hcEl("ellipse", { cx: 1.5, cy: 2, rx: 21, ry: 9, fill: "rgba(0,0,0,.22)" }, car);
  const tyre = (x, y, w, h) => hcEl("rect", { x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 1.6, fill: "#14161a" }, car);
  tyre(11, -8.2, 6, 3.6); tyre(11, 8.2, 6, 3.6); tyre(-10, -8.4, 7, 4.4); tyre(-10, 8.4, 7, 4.4);
  hcEl("rect", { x: 17, y: -9.5, width: 3, height: 19, rx: 1, fill: "#1b1e24" }, car);
  hcEl("rect", { x: 17.6, y: -9.5, width: 1.4, height: 19, rx: .6, fill: color }, car);
  hcEl("rect", { x: -20, y: -6.5, width: 4.2, height: 13, rx: 1, fill: color }, car);
  hcEl("rect", { x: -20, y: -6.5, width: 1.4, height: 13, rx: .6, fill: "#1b1e24" }, car);
  hcEl("path", { d: "M18,0 C15,-1.6 9,-2.4 4,-3 L-2,-6.2 C-8,-6.6 -13,-5 -16,-2.6 L-16,2.6 C-13,5 -8,6.6 -2,6.2 L4,3 C9,2.4 15,1.6 18,0Z", fill: color }, car);
  hcEl("path", { d: "M-2,-6.2 C-8,-6.6 -13,-5 -16,-2.6 L-16,-1.2 C-12,-3 -8,-4 -3,-4Z M-2,6.2 C-8,6.6 -13,5 -16,2.6 L-16,1.2 C-12,3 -8,4 -3,4Z", fill: "rgba(0,0,0,.18)" }, car);
  hcEl("ellipse", { cx: 1, cy: 0, rx: 4.2, ry: 2.1, fill: "#0d0f12" }, car);
  hcEl("circle", { cx: 0.2, cy: 0, r: 1.6, fill: "#f4f5f7" }, car);
  hcEl("path", { d: "M5.2,-2.4 C6.8,-1 6.8,1 5.2,2.4 M5.6,0 L2,0", stroke: "#2a2d33", "stroke-width": .9, fill: "none", "stroke-linecap": "round" }, car);
  hcEl("text", { x: 11, y: 1.25, "font-size": 3.4, "font-family": "Archivo, Arial Narrow, sans-serif", "font-weight": 800, fill: "#fff", "text-anchor": "middle", transform: "rotate(90 11 0)" }, car).textContent = num;
  return car;
}

/* --- Mise en scène --- */
const hcCtm = () => hcSvg().getScreenCTM();
// Coordonnées dans la page (et non dans l'écran) : la voiture défile avec le haut de page au lieu de rester collée à l'écran
const hcScr = (x, y) => { const m = hcCtm(); return [m.a * x + m.c * y + m.e + scrollX, m.b * x + m.d * y + m.f + scrollY]; };
function hcAt(dist) {
  const T = HC.T; let dd = ((dist % T.L) + T.L) % T.L, i = 0;
  while (dd > T.seg[i]) { dd -= T.seg[i]; i = (i + 1) % HC_NP; }
  const u = dd / T.seg[i], a = T.pts[i], b = T.pts[(i + 1) % HC_NP];
  return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, ang: T.ang[i], turn: T.turn[i], v: T.v[i] };
}
const hcPlace = (x, y, a, s) => HC.car.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(a * 180 / Math.PI).toFixed(1)}) scale(${s.toFixed(3)})`);
function hcPuff(x, y, r) {
  const c = hcEl("circle", { cx: x, cy: y, r, class: "hc-smoke" }, $("#hc-puffs"));
  c.style.transformBox = "fill-box"; c.style.transformOrigin = "center";
  c.animate([{ opacity: .9, transform: "scale(1)" }, { opacity: 0, transform: "scale(3)" }], { duration: 900, easing: "ease-out" }).onfinish = () => c.remove();
}
function hcSkid(x, y, a, half) {
  const pts = [-1, 1].map((sd) => [x - Math.cos(a) * half * 0.5 + Math.sin(a) * sd * half * 0.42, y - Math.sin(a) * half * 0.5 - Math.cos(a) * sd * half * 0.42]);
  if (HC.mark) pts.forEach((p, k) => { const l = hcEl("line", { x1: HC.mark[k][0], y1: HC.mark[k][1], x2: p[0], y2: p[1], class: "hc-skid", "stroke-width": Math.max(1.2, half * 0.1) }, $("#hc-marks")); l.animate([{ opacity: 1 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: 2600 }).onfinish = () => l.remove(); });
  HC.mark = pts;
}
function hcArrive() {
  hcDrawCar(HC.color, HC.num); HC.mark = null; HC.yaw = 0;
  if (reduce) { const p = hcAt(0), [x, y] = hcScr(p.x, p.y); hcPlace(x, y, p.ang, HC_CAR * hcCtm().a); hcPark(); return; }
  const vw = innerWidth, vh = innerHeight, m = vw < 720;
  HC.entry = { p0: [-70 + scrollX, scrollY + Math.min(vh * 0.8, vh - 80)], c1: [scrollX + vw * (m ? 0.5 : 0.45), scrollY + vh * (m ? 1.05 : 1.1)], dur: m ? 2.0 : 2.4 };
  HC.phase = "in"; HC.t = 0; HC.last = performance.now(); cancelAnimationFrame(HC.raf); HC.raf = requestAnimationFrame(hcLoop);
}
function hcPark() { HC.phase = "parked"; HC.raf = 0; $("#hc").classList.add("parked"); }
function hcLap() {
  if (!HC.car || HC.phase === "in" || HC.phase === "lap" || HC.phase === "grid") return;
  HC.phase = "lap"; HC.t = 0; HC.s = 0; HC.v = 0; HC.mark = null; $("#hc").classList.remove("parked");
  HC.last = performance.now(); HC.raf = requestAnimationFrame(hcLoop);
}
const hcBez = (p0, p1, p2, p3, u) => { const a = 1 - u; return [0, 1].map((j) => a * a * a * p0[j] + 3 * a * a * u * p1[j] + 3 * a * u * u * p2[j] + u * u * u * p3[j]); };
function hcLoop(now) {
  const dt = Math.min(0.04, (now - HC.last) / 1000); HC.last = now; HC.t += dt;
  const k = hcCtm().a, half = 20 * HC_CAR * k, T = HC.T;
  if (HC.phase === "in") {
    // Le point d'arrivée suit le tracé, même si la page défile pendant l'arrivée
    const p = hcAt(0), [ex, ey] = hcScr(p.x, p.y), tx = Math.cos(p.ang), ty = Math.sin(p.ang);
    const p2 = [ex - tx * 120 + ty * 140, ey - ty * 120 - tx * 140];
    const u = Math.min(1, HC.t / HC.entry.dur), e = 1 - Math.pow(1 - u, 2.2);
    const [x, y] = hcBez(HC.entry.p0, HC.entry.c1, p2, [ex, ey], e), [x2, y2] = hcBez(HC.entry.p0, HC.entry.c1, p2, [ex, ey], Math.min(1, e + 0.01));
    const w = (u - 0.5) / 0.46, drift = w > 0 && w < 1 ? Math.sin(w * Math.PI) ** 0.7 : 0; // le coup de volant arrive à l'approche
    HC.yaw += (drift - HC.yaw) * Math.min(1, dt * 10);
    const a = Math.atan2(y2 - y, x2 - x) + HC.yaw, size = (1 - e) + e * HC_CAR * k;
    hcPlace(x, y, a, size);
    if (HC.yaw > 0.35 && u < 0.95) { hcSkid(x, y, a, 20 * size); if (Math.random() < dt * 30) hcPuff(x - Math.cos(a) * 16 * size, y - Math.sin(a) * 16 * size, 3 + 6 * size); } else HC.mark = null;
    if (u >= 1) { for (let i = 0; i < 5; i++) hcPuff(ex - tx * half, ey - ty * half, 3); HC.phase = "grid"; HC.t = 0; }
  } else if (HC.phase === "grid") { // un temps d'arrêt sur la ligne, puis le tour
    const p = hcAt(0), [x, y] = hcScr(p.x, p.y); hcPlace(x, y, p.ang, HC_CAR * k);
    if (HC.t > 0.35) { HC.phase = "lap"; HC.t = 0; HC.s = 0; HC.v = 0; }
  } else if (HC.phase === "lap") {
    const p = hcAt(HC.s), rem = T.L - HC.s;
    const target = Math.min(p.v * T.vmax, Math.sqrt(4 * 0.25 * T.vmax * T.vmax / T.L * Math.max(0, rem)) + 2);
    HC.v += (target - HC.v) * Math.min(1, dt * (target > HC.v ? 4 : 9)); HC.s += HC.v * dt;
    // Glisse dans les virages : l'avant plonge vers l'intérieur, proportionnellement au virage et à la vitesse
    const want = -Math.max(-0.55, Math.min(0.55, p.turn * 2.24 * (HC.v / T.vmax)));
    HC.yaw += (want - HC.yaw) * Math.min(1, dt * 8);
    const [x, y] = hcScr(p.x, p.y), a = p.ang - HC.yaw;
    hcPlace(x, y, a, HC_CAR * k);
    if (Math.abs(HC.yaw) > 0.26) { hcSkid(x, y, a, half); if (Math.random() < dt * 10) hcPuff(x - Math.cos(a) * half, y - Math.sin(a) * half, 2.5); } else HC.mark = null;
    if (rem <= 0.3 || (HC.v < 0.5 && rem < 3)) { const q = hcAt(0), [gx, gy] = hcScr(q.x, q.y); hcPlace(gx, gy, q.ang, HC_CAR * k); hcPark(); return; }
  }
  HC.raf = requestAnimationFrame(hcLoop);
}
function hcFollow() { if (HC.phase !== "parked" || !HC.car || !HC.T) return; const q = hcAt(0), [x, y] = hcScr(q.x, q.y); hcPlace(x, y, q.ang, HC_CAR * hcCtm().a); }
addEventListener("resize", hcFollow);
// Si le contenu au-dessus change de hauteur (cartes, polices), la voiture garée se recale sur la grille
if ("ResizeObserver" in window) new ResizeObserver(hcFollow).observe(document.body);
hcSvg().addEventListener("click", hcLap);
hcSvg().addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hcLap(); } });

// Appelé à la fin du chargement d'un GP : tracé du vainqueur, puis extinction des feux et arrivée de la voiture
async function hcRun(tok) {
  const w = finishers[0];
  if (!w) return hcFail();
  HC.color = w.color; HC.num = String(w.dn);
  let raw = null;
  try { raw = await hcTrace(w); } catch { raw = null; }
  if (tok !== HC.tok) return;
  if (!raw) return hcFail();
  if (NAV.home) renderHome(); // le tracé apparaît aussi sur l'accueil
  await homeClosed(); if (tok !== HC.tok) return;
  await hcFinish(tok); if (tok !== HC.tok) return;
  hcBuild(raw);
  setTimeout(() => { if (tok === HC.tok) hcArrive(); }, reduce ? 0 : 650);
}
