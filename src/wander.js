
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
// Easter egg (ordinateur) : on peut attraper la voiture. Elle grossit en roulant sur place sous la souris,
// puis repart en dérapant et rapetisse jusqu'à disparaître quand on la lâche.
function wanderDrive(pos, dur, slide, scale) {
  if (WANDER.busy) return; WANDER.busy = true; WANDER.last = performance.now();
  const layer = wanderLayer(), [col, num] = wanderCar(), car = drawTopCar(layer, col, num), t0 = performance.now();
  const st = { x: -99, y: -99, a: 0, s: scale, mode: "drive", lastMark: null };
  const place = () => car.setAttribute("transform", `translate(${st.x.toFixed(1)},${st.y.toFixed(1)}) rotate(${(st.a * 180 / Math.PI).toFixed(1)}) scale(${st.s.toFixed(3)})`);
  const skid = (on, sl) => {
    if (!on) { st.lastMark = null; return; }
    const back = [st.x - Math.cos(st.a) * 16 * st.s, st.y - Math.sin(st.a) * 16 * st.s];
    if (st.lastMark) { const l = hcEl("line", { x1: st.lastMark[0], y1: st.lastMark[1], x2: back[0], y2: back[1], class: "hc-skid", "stroke-width": 2.2 * st.s }, layer); l.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1800 }).onfinish = () => l.remove(); }
    st.lastMark = back; if (Math.random() < (sl || 0.35)) wanderPuff(layer, back[0], back[1], 4 * st.s);
  };
  const end = () => { car.remove(); WANDER.busy = false; WANDER.last = performance.now(); };
  const frame = (now) => {
    if (st.mode !== "drive") return;
    const u = Math.min(1, (now - t0) / dur), [x, y] = pos(u), [x2, y2] = pos(Math.min(1, u + 0.01));
    st.x = x; st.y = y; st.a = Math.atan2(y2 - y, x2 - x) + slide(u); place();
    skid(Math.abs(slide(u)) > 0.25);
    if (u < 1) requestAnimationFrame(frame); else end();
  };
  requestAnimationFrame(frame);
  if (MOB()) return;
  // --- Attraper la voiture ---
  car.style.pointerEvents = "auto"; car.style.cursor = "grab";
  car.addEventListener("pointerdown", (e) => {
    if (st.mode !== "drive") return;
    e.preventDefault(); st.mode = "held"; car.style.cursor = "grabbing"; car.setPointerCapture(e.pointerId);
    let px = e.clientX, py = e.clientY, last = performance.now(), vx = 0, vy = 0, spin = 0;
    const move = (ev) => { const now = performance.now(), dt = Math.max(16, now - last); vx = vx * 0.6 + ((ev.clientX - px) / dt) * 0.4; vy = vy * 0.6 + ((ev.clientY - py) / dt) * 0.4; px = ev.clientX; py = ev.clientY; last = now; };
    const held = (now) => {
      if (st.mode !== "held") return;
      st.s += (2.6 - st.s) * 0.18; st.x += (px - st.x) * 0.35; st.y += (py - st.y) * 0.35;
      const sp = Math.hypot(vx, vy); if (sp > 0.15) { const want = Math.atan2(vy, vx); let d = want - st.a; d = Math.atan2(Math.sin(d), Math.cos(d)); st.a += d * 0.2; }
      spin += 1; const shake = Math.sin(spin * 1.7) * 0.6; // les roues tournent dans le vide : la voiture vibre
      car.setAttribute("transform", `translate(${(st.x + shake).toFixed(1)},${st.y.toFixed(1)}) rotate(${(st.a * 180 / Math.PI).toFixed(1)}) scale(${st.s.toFixed(3)})`);
      if (spin % 5 === 0) wanderPuff(layer, st.x - Math.cos(st.a) * 18 * st.s, st.y - Math.sin(st.a) * 18 * st.s, 3 * st.s);
      requestAnimationFrame(held);
    };
    const release = () => {
      car.removeEventListener("pointermove", move); car.removeEventListener("pointerup", release); car.removeEventListener("pointercancel", release);
      st.mode = "flee"; car.style.pointerEvents = "none";
      const sp = Math.hypot(vx, vy), dir = sp > 0.3 ? Math.atan2(vy, vx) : st.a, s0 = st.s, f0 = performance.now();
      let v = Math.max(700, Math.min(1500, sp * 900)), sl = (Math.random() < 0.5 ? -1 : 1) * 0.9, head = dir;
      const flee = (now) => {
        const t = (now - f0) / 1000; if (st.mode !== "flee") return;
        const dt = 1 / 60; st.x += Math.cos(head) * v * dt; st.y += Math.sin(head) * v * dt;
        head += sl * 0.9 * dt; sl *= 0.94; v *= 0.995; // coup de volant qui s'amortit
        st.a = head + sl; st.s = Math.max(0.05, s0 * Math.max(0, 1 - t / 1.1)); place();
        skid(Math.abs(sl) > 0.2, 0.5);
        const off = st.x < -80 || st.y < -80 || st.x > innerWidth + 80 || st.y > innerHeight + 80;
        if (t < 1.1 && !off) requestAnimationFrame(flee); else end();
      };
      requestAnimationFrame(flee);
    };
    car.addEventListener("pointermove", move); car.addEventListener("pointerup", release); car.addEventListener("pointercancel", release);
    requestAnimationFrame(held);
  });
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
    if (MOB() || NAV.chap || !wanderOk() || now - WANDER.t0 < 20000 || now - WANDER.last < 75000 || Math.random() < 0.35) return;
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
