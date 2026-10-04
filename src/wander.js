
/* ======================= La F1 qui se balade ======================= */
// Ordinateur : de temps en temps (au plus une fois par minute et quart, après un défilement), une F1 remonte la marge vide
// à côté du contenu, avec un coup de glisse au milieu. Mobile : elle traverse le bouton « Chapitre suivant » quand on l'atteint.
// Jamais par-dessus le texte, jamais pendant l'accueil, rien pour les personnes qui limitent les animations.
const WANDER = { last: 0, t0: performance.now(), busy: false, chapSeen: null, layer: null };
function wanderLayer() {
  if (WANDER.layer) return WANDER.layer;
  const svg = document.createElementNS(NS, "svg"); svg.id = "wander-fx"; svg.setAttribute("aria-hidden", "true");
  document.body.appendChild(svg); WANDER.layer = svg; return svg;
}
function wanderCar() {
  const pool = finishers.length ? finishers.slice(0, 10) : drivers;
  const d = pool[Math.floor(Math.random() * pool.length)];
  return d ? [d.color, String(d.dn)] : ["#e10600", "1"];
}
function wanderPuff(layer, x, y, r) {
  const c = hcEl("circle", { cx: x, cy: y, r, class: "hc-smoke" }, layer);
  c.style.transformBox = "fill-box"; c.style.transformOrigin = "center";
  c.animate([{ opacity: .8, transform: "scale(1)" }, { opacity: 0, transform: "scale(3)" }], { duration: 800, easing: "ease-out" }).onfinish = () => c.remove();
}
// Trajet générique : pos(u) → [x, y], cap (rad) calculé sur la trajectoire, glisse(u) → angle ajouté
function wanderDrive(pos, dur, slide, scale) {
  if (WANDER.busy) return; WANDER.busy = true; WANDER.last = performance.now();
  const layer = wanderLayer(), [col, num] = wanderCar(), car = drawTopCar(layer, col, num), t0 = performance.now();
  let lastMark = null;
  const frame = (now) => {
    const u = Math.min(1, (now - t0) / dur), [x, y] = pos(u), [x2, y2] = pos(Math.min(1, u + 0.01)), a = Math.atan2(y2 - y, x2 - x) + slide(u);
    car.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${(a * 180 / Math.PI).toFixed(1)}) scale(${scale})`);
    if (Math.abs(slide(u)) > 0.25) {
      const back = [x - Math.cos(a) * 16 * scale, y - Math.sin(a) * 16 * scale];
      if (lastMark) { const l = hcEl("line", { x1: lastMark[0], y1: lastMark[1], x2: back[0], y2: back[1], class: "hc-skid", "stroke-width": 2.2 * scale }, layer); l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1800 }).onfinish = () => l.remove(); }
      lastMark = back; if (Math.random() < 0.35) wanderPuff(layer, back[0], back[1], 4 * scale);
    } else lastMark = null;
    if (u < 1) requestAnimationFrame(frame); else { car.remove(); WANDER.busy = false; }
  };
  requestAnimationFrame(frame);
}
const wanderOk = () => !reduce && !NAV.home && document.visibilityState === "visible" && !["in", "grid", "lap"].includes(HC.phase);

// Ordinateur : la marge à côté du contenu
function wanderMargin() {
  const r = $("main").getBoundingClientRect(), left = r.left, right = innerWidth - r.right;
  const m = Math.max(left, right); if (m < 72) return null;
  return left >= right ? { x: left / 2, w: left } : { x: innerWidth - right / 2, w: right };
}
let wanderScrollT = 0;
addEventListener("scroll", () => {
  clearTimeout(wanderScrollT);
  wanderScrollT = setTimeout(() => {
    const now = performance.now();
    if (MOB() || !wanderOk() || now - WANDER.t0 < 20000 || now - WANDER.last < 75000 || Math.random() < 0.35) return;
    const m = wanderMargin(); if (!m) return;
    const H = innerHeight, amp = Math.min(m.w * 0.22, 26);
    // Remonte la marge en S, avec un coup de glisse au milieu
    wanderDrive((u) => { const e = u * u * (3 - 2 * u); return [m.x + Math.sin(e * Math.PI * 2) * amp, H + 40 - e * (H + 80)]; }, 3400,
      (u) => (u > 0.4 && u < 0.62 ? Math.sin(((u - 0.4) / 0.22) * Math.PI) * 0.6 : 0), 1);
  }, 700);
}, { passive: true });

// Mobile : la traversée du bouton « Chapitre suivant »
const wanderIO = new IntersectionObserver((es) => es.forEach((e) => {
  if (!e.isIntersecting || e.intersectionRatio < 0.9 || !MOB() || !wanderOk() || WANDER.chapSeen === NAV.chap) return;
  WANDER.chapSeen = NAV.chap;
  setTimeout(() => {
    const r = $("#mchap-next").getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
    const y = r.top + r.height / 2, W = innerWidth;
    wanderDrive((u) => { const e = 1 - Math.pow(1 - u, 1.6); return [-50 + e * (W + 100), y + Math.sin(u * Math.PI) * -6]; }, 1500,
      (u) => (u > 0.55 && u < 0.85 ? Math.sin(((u - 0.55) / 0.3) * Math.PI) * -0.45 : 0), 0.85);
  }, 250);
}), { threshold: [0.9] });
wanderIO.observe($("#mchap-next"));
