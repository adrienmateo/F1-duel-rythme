
/* ======================= Jeu caché « Bats le vainqueur » ======================= */
// Un tour du vrai circuit du GP affiché, en 3D, contre le fantôme du vainqueur (son meilleur tour en course).
// Déclencheur : 5 clics rapides sur la petite F1 du haut de page (un feu de départ par clic), ou le code Konami.
// Three.js n'est chargé qu'au lancement. Gagner débloque la figurine secrète « Pilote Arcade » (paddock.js).
// Le même fichier sert au prototype autonome : arcOpen({ trace, ghostLap, ghostName, ghostColor, circuit, recKey }).
const ARC = { open: false, three: null, keysKey: "f1duel:arcade:keys", setKey: "f1duel:arcade:set" };
const ARC_ACTIONS = [["up", "Accélérer"], ["down", "Freiner"], ["left", "Tourner à gauche"], ["right", "Tourner à droite"], ["view", "Changer de vue"]];
const ARC_DEFAULT_KEYS = { up: ["ArrowUp", "z", "w"], down: ["ArrowDown", "s"], left: ["ArrowLeft", "q", "a"], right: ["ArrowRight", "d"], view: ["c"] };
const arcKeyName = (k) => ({ ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Espace" })[k] || (k.length === 1 ? k.toUpperCase() : k);
function arcLoadKeys() { try { const v = JSON.parse(localStorage.getItem(ARC.keysKey)); if (v && ARC_ACTIONS.every(([a]) => Array.isArray(v[a]))) return v; } catch {} return JSON.parse(JSON.stringify(ARC_DEFAULT_KEYS)); }
function arcLoadSet() { const d = { sens: 1, mode: "boutons", inv: false, lvl: 1, gfx: null }; try { const v = JSON.parse(localStorage.getItem(ARC.setKey)); if (v) return { sens: +v.sens || 1, mode: v.mode === "inclinaison" ? "inclinaison" : "boutons", inv: !!v.inv, lvl: [0, 1, 2].includes(+v.lvl) ? +v.lvl : 1, gfx: ["standard", "ultra"].includes(v.gfx) ? v.gfx : null }; } catch {} return d; }
// Niveaux : le fantôme roule au rythme du vainqueur, un peu ralenti en Rookie et Pilote (environ 6 s et 3 s sur un tour de 1:45)
const ARC_LVLS = [["Rookie", 1.06], ["Pilote", 1.03], ["Champion", 1]];
function arcThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (ARC.three) return ARC.three;
  ARC.three = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"; s.onload = () => ok(window.THREE); s.onerror = () => { ARC.three = null; ko(new Error("three")); }; document.head.appendChild(s); });
  return ARC.three;
}

/* --- La F1 : corps lissé par sections, ailerons profilés, pneus arrondis --- */
function arcCar(THREE, main, accent, ghost, number) {
  const car = new THREE.Group();
  const ph = (color, shin = 70, spec = 0x555555) => ghost ? new THREE.MeshBasicMaterial({ color: main, transparent: true, opacity: .33, depthWrite: false }) : new THREE.MeshPhongMaterial({ color, shininess: shin, specular: spec });
  const M = { body: ph(main, 90, 0x777777), acc: ph(accent, 80), carbon: ph(0x17191e, 30, 0x333333), dark: ph(0x0c0d10, 10, 0x111111), tyre: ph(0x1a1b1e, 6, 0x111111), rim: ph(0x3a3d44, 90, 0x888888), wall: ph(0xf2c200, 20), helm: ph(0xf4f4f4, 100, 0x999999), visor: ph(0x0e1320, 120, 0xaaaaaa) };
  const put = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = car) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = !ghost; parent.add(m); return m; };
  // Section arrondie (super-ellipse) : z, largeur, hauteur, bas
  function loft(secs, seg = 20, ex = 3.2, cx = 0) {
    const pos = [], idx = [];
    secs.forEach(([z, w, h, y]) => { for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); pos.push(cx + (w / 2) * Math.sign(c) * Math.abs(c) ** (2 / ex), y + h / 2 + (h / 2) * Math.sign(s) * Math.abs(s) ** (2 / ex), z); } });
    for (let r = 0; r < secs.length - 1; r++) for (let k = 0; k < seg; k++) { const a = r * seg + k, b = r * seg + (k + 1) % seg, c = a + seg, d = b + seg; idx.push(a, c, b, b, c, d); }
    const cap = (r, flip) => { const ci = pos.length / 3, [z, , h, y] = secs[r]; pos.push(cx, y + h / 2, z); for (let k = 0; k < seg; k++) { const a = r * seg + k, b = r * seg + (k + 1) % seg; flip ? idx.push(ci, b, a) : idx.push(ci, a, b); } };
    cap(0, false); cap(secs.length - 1, true);
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  // Profil d'aile extrudé sur la largeur
  function wing(chord, thick, span) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.bezierCurveTo(chord * .15, thick, chord * .6, thick * .9, chord, thick * .15); s.lineTo(chord, 0); s.bezierCurveTo(chord * .6, thick * .25, chord * .15, -thick * .15, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: span, bevelEnabled: false, steps: 1 }); g.translate(0, 0, -span / 2); g.rotateY(Math.PI / 2); return g; // corde vers -z, envergure sur x
  }
  function plate(pts, t) { const s = new THREE.Shape(); pts.forEach(([a, b], i) => (i ? s.lineTo(a, b) : s.moveTo(a, b))); const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false }); g.translate(0, 0, -t / 2); g.rotateY(-Math.PI / 2); return g; } // points (z, y) : z reste z
  const rod = (a, b, r, mat) => { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 5), mat); m.position.copy(A).add(B).multiplyScalar(.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()); car.add(m); return m; };

  // Monocoque, nez et capot moteur en un seul corps lissé
  put(loft([[2.62, .1, .07, .2], [2.45, .18, .12, .19], [2.1, .27, .19, .18], [1.6, .38, .27, .16], [1.1, .5, .36, .13], [.55, .66, .46, .1], [.05, .76, .52, .08], [-.45, .8, .56, .08], [-.95, .76, .6, .08], [-1.45, .58, .5, .1], [-1.95, .36, .36, .13], [-2.35, .2, .22, .17], [-2.5, .1, .12, .2]], 22, 3), M.body);
  // Prise d'air au-dessus du pilote, puis l'aileron de requin
  put(loft([[-.3, .3, .26, .56], [-.6, .3, .3, .58], [-1.1, .16, .22, .6], [-1.6, .06, .1, .58]], 16, 3), M.body);
  put(loft([[-.29, .2, .16, .6], [-.31, .2, .16, .6]], 16, 3), M.dark);
  put(plate([[-1.2, .78], [-2.3, .72], [-2.3, .5], [-1.2, .62]], .02), M.acc);
  put(new THREE.BoxGeometry(.12, .05, .14), M.acc, 0, .9, -.48);                                    // caméra de bord
  // Pontons, avec entrée d'air noire et filet de couleur
  [-1, 1].forEach((s) => {
    put(loft([[.55, .3, .34, .13], [.2, .4, .42, .1], [-.4, .42, .4, .1], [-1.0, .32, .3, .1], [-1.5, .18, .18, .11], [-1.8, .08, .1, .12]], 16, 3.5, s * .5), M.body);
    put(loft([[.56, .24, .26, .17], [.54, .24, .26, .17]], 12, 3.5, s * .5), M.dark);
    put(new THREE.BoxGeometry(.02, .07, 1.3), M.acc, s * .715, .36, -.35);
  });
  // Fond plat et diffuseur
  { const s = new THREE.Shape([[-.55, 1.15], [.55, 1.15], [.78, .6], [.8, -1.6], [.55, -2.35], [-.55, -2.35], [-.8, -1.6], [-.78, .6]].map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(s, { depth: .035, bevelEnabled: false }); g.rotateX(Math.PI / 2); put(g, M.carbon, 0, .085, 0); }
  put(plate([[-2.2, .06], [-2.7, .26], [-2.7, .3], [-2.2, .1]], 1.0), M.carbon);
  // Cockpit, pilote et halo
  put(loft([[.35, .44, .08, .6], [-.5, .5, .08, .6]], 16, 4), M.dark);
  put(new THREE.SphereGeometry(.15, 18, 14), M.helm, 0, .77, -.28);
  put(new THREE.SphereGeometry(.151, 18, 8, 0, Math.PI * 2, Math.PI * .38, Math.PI * .2), M.visor, 0, .77, -.28, -.25);
  put(new THREE.TorusGeometry(.152, .012, 6, 20), M.acc, 0, .79, -.28, Math.PI / 2);
  { const c = new THREE.CatmullRomCurve3([[-.33, .62, -.62], [-.31, .8, -.3], [-.18, .87, .05], [0, .88, .14], [.18, .87, .05], [.31, .8, -.3], [.33, .62, -.62]].map((p) => new THREE.Vector3(...p)));
    put(new THREE.TubeGeometry(c, 30, .028, 7, false), M.carbon); rod([0, .87, .14], [0, .62, .36], .022, M.carbon); }
  // Rétroviseurs sur bras
  [-1, 1].forEach((s) => { put(loft([[.06, .16, .07, .66], [-.04, .16, .07, .66]], 12, 3, s * .5), M.body); rod([s * .3, .62, .02], [s * .44, .69, .01], .01, M.carbon); });
  // Aileron avant : 3 éléments profilés, dérives, plaque du numéro sur le nez
  [[.11, 2.78, .34, .05], [.16, 2.6, .26, .2], [.22, 2.46, .2, .38]].forEach(([y, z, ch, tilt], k) => put(wing(ch, .045, 1.9 - k * .1), k === 2 ? M.acc : M.carbon, 0, y, z, tilt));
  [-1, 1].forEach((s) => put(plate([[2.85, .05], [2.35, .05], [2.3, .34], [2.5, .4], [2.85, .3]], .025), M.carbon, s * .97));
  rod([.12, .22, 2.3], [.16, .14, 2.45], .02, M.carbon); rod([-.12, .22, 2.3], [-.16, .14, 2.45], .02, M.carbon);
  if (number && !ghost) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 64; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.font = "bold 46px Archivo, Arial, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(String(number), 64, 34);
    const t = new THREE.CanvasTexture(c), m = new THREE.Mesh(new THREE.PlaneGeometry(.22, .11), new THREE.MeshBasicMaterial({ map: t, transparent: true }));
    m.position.set(0, .375, 1.75); m.rotation.x = -Math.PI / 2 + .2; car.add(m);
  }
  // Aileron arrière : plan principal, volet, dérives, aileron de poutre, mât central
  put(wing(.36, .05, 1.0), M.carbon, 0, .9, -2.42, .1); put(wing(.24, .04, 1.0), M.acc, 0, 1.03, -2.72, .45);
  [-1, 1].forEach((s) => put(plate([[-2.35, .55], [-2.95, .55], [-3.0, 1.08], [-2.85, 1.16], [-2.35, 1.1]], .025), M.body, s * .51));
  put(wing(.2, .03, .9), M.carbon, 0, .44, -2.45, .05); rod([0, .5, -2.45], [0, .95, -2.55], .03, M.carbon);
  // Roues : pneu arrondi, flanc jaune (medium), cache-jante de 18 pouces, triangles de suspension
  const wheels = [];
  const tyreGeo = (r, w) => { const pts = []; const h = w / 2; [[r * .66, -h], [r * .9, -h], [r * .97, -h * .9], [r, -h * .6], [r, h * .6], [r * .97, h * .9], [r * .9, h], [r * .66, h]].forEach(([a, b]) => pts.push(new THREE.Vector2(a, b))); const g = new THREE.LatheGeometry(pts, 28); g.rotateZ(Math.PI / 2); return g; };
  [[.82, 1.62, .36, .32], [.8, -1.92, .36, .42]].forEach(([x, z, r, w], fi) => [-1, 1].forEach((s) => {
    const wg = new THREE.Group(); wg.position.set(s * x, r, z); car.add(wg);
    const spin = new THREE.Group(); wg.add(spin);
    put(tyreGeo(r, w), M.tyre, 0, 0, 0, 0, 0, 0, spin);
    put(new THREE.CylinderGeometry(r * .66, r * .66, w * .92, 20), M.rim, 0, 0, 0, 0, 0, Math.PI / 2, spin);
    put(new THREE.TorusGeometry(r * .8, .014, 4, 28), M.wall, s * (w / 2 + .003), 0, 0, 0, Math.PI / 2, 0, spin);
    put(new THREE.CylinderGeometry(r * .62, r * .62, .02, 20), M.carbon, s * (w / 2 - .02), 0, 0, 0, 0, Math.PI / 2, spin);
    put(new THREE.BoxGeometry(.02, r * 1.1, .05), M.rim, s * (w / 2 - .005), 0, 0, 0, 0, 0, spin);
    wheels.push({ g: wg, spin, front: fi === 0 });
    const inX = .28, hubX = s * (x - w / 2);
    rod([s * inX, .2, z + .2], [hubX, .24, z], .014, M.carbon); rod([s * inX, .2, z - .2], [hubX, .24, z], .014, M.carbon);
    rod([s * inX, .42, z + .15], [hubX, .46, z], .014, M.carbon); rod([s * inX, .42, z - .15], [hubX, .46, z], .014, M.carbon);
  }));
  car.userData.wheels = wheels;
  return car;
}

function arcTrimLoop(t) {
  const tr = t.slice(), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // Fin du tracé qui repasse sur ses premiers points : on la coupe juste avant le point le plus proche du départ
  let cut = -1, bd = Infinity;
  for (let j = Math.floor(tr.length * 0.75); j < tr.length; j++) { for (let k = 0; k < 6; k++) { const dd = d(tr[j], tr[k]); if (dd < bd) { bd = dd; cut = j - k; } } }
  if (cut > tr.length * 0.75 && bd < 400) tr.length = cut;
  // Doublons et points trop serrés (moins de 1 m) qui font hoqueter la spline
  return tr.filter((p, i) => i === 0 || d(p, tr[i - 1]) > 10);
}

/* --- Graphismes réalistes : modules Three.js chargés à la demande (même version r128) --- */
const ARC_EX_BASE = "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/";
const ARC_EX_STD = ["objects/Sky.js", "shaders/CopyShader.js", "shaders/LuminosityHighPassShader.js", "postprocessing/EffectComposer.js", "postprocessing/RenderPass.js", "postprocessing/ShaderPass.js", "postprocessing/UnrealBloomPass.js"];
const ARC_EX_ULTRA = ["math/SimplexNoise.js", "shaders/SSAOShader.js", "postprocessing/SSAOPass.js", "libs/fflate.min.js", "loaders/EXRLoader.js", "objects/Lensflare.js"];
ARC.ex = {};
function arcScript(src) {
  if (ARC.ex[src]) return ARC.ex[src];
  return (ARC.ex[src] = new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => { delete ARC.ex[src]; ko(new Error(src)); }; document.head.appendChild(s); }));
}
// Dans l'ordre (les passes dépendent des shaders) ; un échec n'empêche pas de jouer, le rendu reste simple
async function arcExtras(ultra) {
  try { for (const f of ARC_EX_STD) await arcScript(ARC_EX_BASE + f); } catch { return 0; }
  if (!ultra) return 1;
  try { for (const f of ARC_EX_ULTRA) await arcScript(ARC_EX_BASE + f); return 2; } catch { return 1; }
}
// Bruit de gradient 2D (déterministe) pour le relief des montagnes
function arcNoise(seed) {
  const p = new Uint8Array(512); let s = seed >>> 0 || 1; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const b = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } for (let i = 0; i < 512; i++) p[i] = b[i & 255];
  const g = (h, x, y) => { const a = (h & 7) * Math.PI / 4; return Math.cos(a) * x + Math.sin(a) * y; }, f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => { const X = Math.floor(x) & 255, Y = Math.floor(y) & 255; x -= Math.floor(x); y -= Math.floor(y); const u = f(x), v = f(y);
    const a = p[X] + Y, b2 = p[X + 1] + Y; const l1 = g(p[a], x, y) + u * (g(p[b2], x - 1, y) - g(p[a], x, y)), l2 = g(p[a + 1], x, y - 1) + u * (g(p[b2 + 1], x - 1, y - 1) - g(p[a + 1], x, y - 1)); return l1 + v * (l2 - l1); };
}
// Montagnes autour du circuit : crêtes (bruit « ridged »), vallées, couleurs selon l'altitude et la pente (prairie, forêt, roche, neige)
function arcMountains(THREE, { cx, cz, R0, base, seed, seg = 200, size = 11000 }) {
  const n = arcNoise(seed), ridge = (x, z) => { let a = 0, amp = 1, fr = 1 / 900, w = 0; for (let o = 0; o < 6; o++) { const v = 1 - Math.abs(n(x * fr, z * fr)); a += v * v * amp * (o ? a * .9 + .3 : 1); w += amp; amp *= .5; fr *= 2.05; } return a / w; };
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
  const pa = g.attributes.position, col = new Float32Array(pa.count * 3), hs = new Float32Array(pa.count);
  let top = 0;
  for (let k = 0; k < pa.count; k++) { const x = pa.getX(k), z = pa.getZ(k), d = Math.hypot(x - cx, z - cz), m = Math.max(0, Math.min(1, (d - R0) / 1100)), mm = m * m * (3 - 2 * m);
    const h = mm * (60 + 520 * ridge(x, z) * (0.55 + 0.45 * Math.min(1, (d - R0) / 2600))) + 18 * mm * n(x / 260, z / 260); hs[k] = h; top = Math.max(top, h); pa.setY(k, d < R0 - 20 ? base - 8 : base - 3 + h); }
  g.computeVertexNormals();
  const nr = g.attributes.normal, C = (h) => new THREE.Color(h).convertSRGBToLinear(), meadow = C(0x6f8f4a), forest = C(0x34502c), rock = C(0x7d766c), dark = C(0x5a564f), snow = C(0xeef1f4), c = new THREE.Color();
  for (let k = 0; k < pa.count; k++) { const h = hs[k], slope = 1 - nr.getY(k), t = h / (top || 1);
    c.copy(meadow).lerp(forest, Math.min(1, t * 3)); if (slope > .28 || t > .45) c.lerp(slope > .45 ? dark : rock, Math.min(1, Math.max((slope - .22) * 3, (t - .4) * 3)));
    if (t > .72 && slope < .5) c.lerp(snow, Math.min(1, (t - .72) * 5)); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}

/* --- Le jeu --- */
async function arcOpen(cfg) {
  if (ARC.open) return;
  let THREE;
  try { THREE = await arcThree(); } catch { (window.toast || console.warn)("Le jeu n'a pas pu se charger. Vérifie ta connexion."); return; }
  // Graphismes : Ultra par défaut sur ordinateur, Standard sur téléphone (réglable dans « Commandes », au prochain lancement)
  const GFX = arcLoadSet().gfx || (matchMedia("(pointer: coarse)").matches ? "standard" : "ultra"), EXL = await arcExtras(GFX === "ultra");
  ARC.open = true; window.ARC_ON = true;
  if (!document.querySelector("link[data-arc-font]")) { const f = document.createElement("link"); f.rel = "stylesheet"; f.href = "https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap"; f.dataset.arcFont = "1"; document.head.appendChild(f); }
  const touch = matchMedia("(pointer: coarse)").matches;
  const root = document.createElement("div"); root.id = "arc"; if (touch) root.classList.add("touch");
  root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "Jeu : bats le vainqueur");
  const fmt = (s) => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(3).padStart(6, "0").replace(".", ",")}`; };
  const fmtD = (d) => `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2).replace(".", ",")} s`;
  const esc2 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let best = null; try { best = +localStorage.getItem(cfg.recKey) || null; } catch {}
  root.innerHTML = `<canvas class="arc-gl" aria-label="Circuit en 3D"></canvas>
  <div class="a-pads" data-k="pads"></div>
  <div class="a-hud a-time"><small>TOUR</small><b data-k="lap">0:00,000</b></div>
  <div class="a-hud a-delta" hidden><small>ÉCART AU FANTÔME</small><b data-k="delta">+0,00 s</b></div>
  <div class="a-hud a-speed"><div><small>KM/H</small><b class="spd" data-k="spd">0</b></div><div><small>RAPPORT</small><b data-k="gear">N</b></div></div>
  <button class="a-pause" data-a="pause" aria-label="Pause"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg></button>
  <canvas class="a-map" width="340" height="240" aria-hidden="true"></canvas>
  <div class="a-hud a-keys" data-k="keys"></div>
  <div class="a-lights" hidden><i></i><i></i><i></i><i></i><i></i></div>
  <div class="a-screen" data-s="start"><div class="a-card">
    <p class="a-sub">DUEL DE RYTHME · ARCADE</p><h2 class="a-logo">BATS LE<br>VAINQUEUR</h2>
    <div class="a-tiles"><div class="a-tile"><small>CIRCUIT</small><b>${esc2(cfg.circuit.toUpperCase())}</b><span>vrai tracé, ${(cfg.len / 1000).toFixed(1).replace(".", ",")} km<em data-k="elev"></em></span></div>
      <div class="a-tile"><small>FANTÔME</small><b style="color:${cfg.ghostColor}">${esc2(cfg.ghostName.toUpperCase())}</b><span>son meilleur tour : ${fmt(cfg.ghostLap)}</span></div>
      <div class="a-tile"><small>TON RECORD</small><b data-k="rec">${best ? fmt(best) : "—"}</b><span>gardé dans ce navigateur</span></div></div>
    <div class="a-lvls" data-k="lvls" role="radiogroup" aria-label="Niveau"></div>
    <p class="a-sub" data-k="help"></p>
    <p class="a-tip" data-k="tip" hidden>Astuce : les panneaux 3, 2, 1 au bord de la piste annoncent les gros freinages. Freine avant le virage, réaccélère à la sortie.</p>
    <div class="a-row"><button class="a-btn" data-a="go">DÉPART</button><button class="a-btn ghost" data-a="set">Commandes</button><button class="a-btn ghost" data-a="quit">Retour au GP</button></div>
  </div></div>
  <div class="a-screen" data-s="set" hidden><div class="a-set">
    <h3>COMMANDES</h3>
    <div data-k="acts"></div>
    <div class="a-sens"><label for="arc-sens">Direction</label><input id="arc-sens" type="range" min="0.6" max="1.5" step="0.05"><span data-k="sensv"></span></div>
    <div class="a-mode" data-k="modes">
      <h3>SUR TÉLÉPHONE</h3>
      <label class="a-opt"><input type="radio" name="arc-mode" value="boutons" id="arc-m-b"><span><b>Boutons</b> Flèches à gauche pour tourner, gaz et frein à droite.</span></label>
      <label class="a-opt"><input type="radio" name="arc-mode" value="inclinaison" id="arc-m-i"><span><b>Inclinaison</b> Tourne le téléphone comme un volant. Frein à gauche, gaz à droite.</span></label>
      <label class="a-opt small"><input type="checkbox" id="arc-inv"><span>Inverser le sens de l'inclinaison</span></label>
    </div>
    <div class="a-gfx"><h3>GRAPHISMES</h3>
      <label class="a-opt"><input type="radio" name="arc-gfx" value="ultra" id="arc-g-u"><span><b>Ultra</b> Ombrage d'ambiance, herbe en brins, reflets d'un vrai panorama sur la voiture. Pour ordinateur.</span></label>
      <label class="a-opt"><input type="radio" name="arc-gfx" value="standard" id="arc-g-s"><span><b>Standard</b> Plus fluide, conseillé sur téléphone.</span></label>
      <p class="a-hint">S'applique au prochain lancement du jeu.</p></div>
    <p class="a-note">Clavier : clique sur « + » puis appuie sur la touche voulue. Clique sur une touche pour la retirer.</p>
    <div class="a-row"><button class="a-btn" data-a="setok">OK</button><button class="a-btn ghost" data-a="setreset">Touches par défaut</button></div>
  </div></div>
  <div class="a-screen" data-s="pause" hidden><div class="a-card"><h2 class="a-logo">PAUSE</h2><div class="a-row"><button class="a-btn" data-a="resume">REPRENDRE</button><button class="a-btn ghost" data-a="restart">Recommencer</button><button class="a-btn ghost" data-a="set">Commandes</button><button class="a-btn ghost" data-a="quit">Retour au GP</button></div></div></div>
  <div class="a-screen" data-s="end" hidden><div class="a-card">
    <h2 class="a-big" data-k="etitle"></h2>
    <div class="a-tiles"><div class="a-tile"><small>TON TOUR</small><b data-k="eyou"></b></div><div class="a-tile"><small data-k="eglab">${esc2(cfg.ghostName.toUpperCase())} (FANTÔME)</small><b data-k="eghost"></b></div></div>
    <div class="a-diff" data-k="ediff"></div>
    <div class="a-unlock" data-k="unlock" hidden></div>
    <div class="a-row"><button class="a-btn" data-a="restart">REJOUER</button><button class="a-btn ghost" data-a="menu">Changer de niveau</button><button class="a-btn ghost" data-a="quit">Retour au GP</button></div>
  </div></div>
  <div class="a-rotate"><div><p>TOURNE TON<br>TÉLÉPHONE</p><span>Le jeu se joue à l'horizontale.</span></div></div>`;
  document.body.appendChild(root);
  const q = (k) => root.querySelector(`[data-k="${k}"]`), scr = (s) => root.querySelector(`[data-s="${s}"]`);
  const show = (s) => root.querySelectorAll(".a-screen").forEach((e) => (e.hidden = e.dataset.s !== s));
  let keys = arcLoadKeys(), set = arcLoadSet();
  const keyHelp = () => { q("keys").innerHTML = `<span>${keys.up.map(arcKeyName).join(" ")} ACCÉLÉRER · ${keys.down.map(arcKeyName).join(" ")} FREINER</span><span>${keys.left.map(arcKeyName).join(" ")} / ${keys.right.map(arcKeyName).join(" ")} TOURNER · ${keys.view.map(arcKeyName).join(" ")} VUE</span>`;
    q("help").textContent = touch ? (set.mode === "inclinaison" ? "TOURNE LE TÉLÉPHONE POUR TOURNER · FREIN À GAUCHE, GAZ À DROITE" : "FLÈCHES À GAUCHE POUR TOURNER · GAZ ET FREIN À DROITE") : `${keys.up.map(arcKeyName).join(" ")} ACCÉLÉRER · ${keys.down.map(arcKeyName).join(" ")} FREINER · ${keys.left.map(arcKeyName).join(" ")} ${keys.right.map(arcKeyName).join(" ")} TOURNER · ${keys.view.map(arcKeyName).join(" ")} VUE`; };
  keyHelp();

  /* Piste : spline fermée rééchantillonnée tous les 3 m */
  // Le tour enregistré dépasse souvent un peu la ligne : on coupe ce qui revient sur le début du tracé,
  // sinon la courbe refermée fait un aller-retour au départ (voiture et fantôme dans le mauvais sens)
  const tr = arcTrimLoop(cfg.trace);
  const W = 12.5, raw = tr.map(([x, y]) => [x / 10, -y / 10]);
  const cx = raw.reduce((s, p) => s + p[0], 0) / raw.length, cz = raw.reduce((s, p) => s + p[1], 0) / raw.length;
  const curve = new THREE.CatmullRomCurve3(raw.map(([x, z]) => new THREE.Vector3(x - cx, 0, z - cz)), true, "centripetal");
  // Abscisse curviligne fine : sinon la conversion distance → point est grossière et le fantôme avance par à-coups
  curve.arcLengthDivisions = 8000; curve.updateArcLengths();
  const LEN = curve.getLength(), N = Math.round(LEN / 3);
  const P = curve.getSpacedPoints(N).slice(0, N);
  const T = P.map((p, i) => P[(i + 1) % N].clone().sub(P[(i - 1 + N) % N]).normalize());
  const L = T.map((t) => new THREE.Vector3(-t.z, 0, t.x));
  let K = T.map((t, i) => { const a = T[(i - 2 + N) % N], b = T[(i + 2) % N]; return (a.x * b.z - a.z * b.x) / 12; });
  for (let pass = 0; pass < 3; pass++) K = K.map((_, i) => (K[(i - 2 + N) % N] + K[(i - 1 + N) % N] + K[i] + K[(i + 1) % N] + K[(i + 2) % N]) / 5);
  const S = P.map((_, i) => i * LEN / N), DS = LEN / N;
  // Relief : altitude OpenF1 (z) quand le tracé la contient, lissée (le GPS est bruité) ; sinon piste plate
  const H = new Float32Array(N);
  if (tr.length && tr.every((p) => p.length >= 3 && Number.isFinite(p[2]))) {
    const cum = [0]; for (let j = 1; j <= raw.length; j++) cum.push(cum[j - 1] + Math.hypot(raw[j % raw.length][0] - raw[j - 1][0], raw[j % raw.length][1] - raw[j - 1][1]));
    const tot = cum[raw.length]; let j = 0;
    for (let i = 0; i < N; i++) { const d = (i / N) * tot; while (j < raw.length - 1 && cum[j + 1] < d) j++; const u = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1); H[i] = (tr[j][2] + (tr[(j + 1) % tr.length][2] - tr[j][2]) * u) / 10; }
    for (let pass = 0; pass < 4; pass++) { const c = H.slice(); for (let i = 0; i < N; i++) { let a = 0; for (let k = -8; k <= 8; k++) a += c[(i + k + N) % N]; H[i] = a / 17; } }
    const lo = Math.min(...H); for (let i = 0; i < N; i++) H[i] -= lo;
    const hi = Math.max(...H); if (hi > 250 || hi < 0.5) H.fill(0);   // valeur aberrante : on reste à plat
  }
  const ELEV = Math.max(...H);
  const hS = (s) => { const f = (((s / DS) % N) + N) % N, i = Math.floor(f) % N, u = f - Math.floor(f); return H[i] + (H[(i + 1) % N] - H[i]) * u; };
  const grade = (i) => (H[(i + 1) % N] - H[(i - 1 + N) % N]) / (2 * DS);

  /* Rendu */
  const canvas = root.querySelector(".arc-gl");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xb9cde6, 350, 1700);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
  const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x46603a, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.0); sun.position.set(-120, 220, 80); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 500 }); scene.add(sun, sun.target);
  let skyOld = null;
  { const g = new THREE.SphereGeometry(3000, 24, 12), col = [], c1 = new THREE.Color(0x2f6fd1), c2 = new THREE.Color(0xcfe0f2);
    for (let i = 0; i < g.attributes.position.count; i++) { const y = g.attributes.position.getY(i) / 3000; const c = c2.clone().lerp(c1, Math.max(0, Math.min(1, y * 2.2))); col.push(c.r, c.g, c.b); }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); skyOld = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })); scene.add(skyOld); }
  const canvasTex = (w, h, draw, rep) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; t.encoding = THREE.sRGBEncoding; return t; };
  const noise = (c, w, h, base, amp, n) => { c.fillStyle = base; c.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (Math.random() - .5) * amp; c.fillStyle = `rgba(${v > 0 ? "255,255,255" : "0,0,0"},${Math.abs(v)})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
  const asphalt = canvasTex(256, 256, (c, w, h) => { noise(c, w, h, "#45484e", .22, 9000); c.fillStyle = "rgba(20,20,22,.25)"; c.fillRect(w * .42, 0, w * .16, h); });
  const grass = canvasTex(256, 256, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#4f8f3a" : "#5a9c42"; c.fillRect(0, i * h / 8, w, h / 8); } for (let i = 0; i < 7000; i++) { c.fillStyle = `rgba(${Math.random() > .5 ? "30,70,20" : "140,190,90"},${Math.random() * .25})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 2); } }, [120, 120]);
  const gravel = canvasTex(128, 128, (c, w, h) => noise(c, w, h, "#cdb98f", .35, 5000));
  const crowd = canvasTex(128, 64, (c, w, h) => { c.fillStyle = "#3a3f4a"; c.fillRect(0, 0, w, h); const cols = ["#8a3b3b", "#c9ccd2", "#3d5f94", "#a8902e", "#2f8a7c", "#9a5a2a"]; for (let i = 0; i < 500; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  // Terrain : collé sous la piste (un peu plus bas), puis il rejoint en douceur une moyenne des hauteurs, avec de légères ondulations au loin
  const SMP = []; for (let i = 0; i < N; i += 6) SMP.push([P[i].x, P[i].z, H[i]]);
  const FAR = SMP.filter((_, k) => k % 3 === 0), SG = new Map(), sgk = (x, z) => `${Math.floor(x / 60)},${Math.floor(z / 60)}`;
  SMP.forEach((p) => { const k = sgk(p[0], p[1]); if (!SG.has(k)) SG.set(k, []); SG.get(k).push(p); });
  const H0 = H.reduce((a, b) => a + b, 0) / N;
  function groundH(x, z) {
    let dmin = Infinity, hn = 0, hmin = Infinity; const x0 = Math.floor(x / 60), z0 = Math.floor(z / 60);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of SG.get(`${x0 + a},${z0 + b}`) || []) { const d = Math.hypot(p[0] - x, p[1] - z); if (d < dmin) { dmin = d; hn = p[2]; } if (d < 45 && p[2] < hmin) hmin = p[2]; }
    if (dmin < 45) return hmin - 0.3;
    let sw = 0, sh = 0; for (const p of FAR) { const w = 1 / ((p[0] - x) ** 2 + (p[1] - z) ** 2 + 400); sw += w; sh += w * p[2]; }
    const t = dmin === Infinity ? 1 : Math.min(1, (dmin - 45) / 150), far = sh / sw;
    const wave = (Math.sin(x * 0.004) + Math.sin(z * 0.0053 + 1.3) + Math.sin((x + z) * 0.0031 + 2)) * (5 + ELEV * 0.08) * (dmin === Infinity ? 1 : Math.max(0, Math.min(1, (dmin - 120) / 300)));
    return (dmin === Infinity ? far : (hn - 0.3) * (1 - t) + far * t) + wave;
  }
  { const bx = new THREE.Box3().setFromPoints(P), M0 = 600, cell = touch ? 26 : 20;
    const wx = bx.max.x - bx.min.x + 2 * M0, wz = bx.max.z - bx.min.z + 2 * M0, nx = Math.ceil(wx / cell), nz = Math.ceil(wz / cell);
    const g = new THREE.PlaneGeometry(wx, wz, nx, nz); g.rotateX(-Math.PI / 2); g.translate((bx.min.x + bx.max.x) / 2, 0, (bx.min.z + bx.max.z) / 2);
    const pa = g.attributes.position, ua = g.attributes.uv;
    for (let k = 0; k < pa.count; k++) { const x = pa.getX(k), z = pa.getZ(k), e = Math.min(x - (bx.min.x - M0), (bx.max.x + M0) - x, z - (bx.min.z - M0), (bx.max.z + M0) - z), te = Math.max(0, Math.min(1, e / 150));
      pa.setY(k, groundH(x, z) * te + (H0 - 1) * (1 - te)); ua.setXY(k, x / 50, z / 50); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: grass })); m.receiveShadow = true; scene.add(m);
    grass.repeat.set(1, 1);
    const og = new THREE.PlaneGeometry(12000, 12000); og.rotateX(-Math.PI / 2); const om = new THREE.Mesh(og, new THREE.MeshLambertMaterial({ color: 0x4f8a3c })); om.position.y = H0 - 1.2; scene.add(om); }
  function strip(o1, o2, y, mat, filter, vScale = 8) {
    const pos = [], uv = [], idx = []; let open = false;
    for (let k = 0; k <= N; k++) {
      const i = k % N, ok = filter ? filter(i) : true;
      const a = P[i].clone().addScaledVector(L[i], typeof o1 === "function" ? o1(i) : o1), b = P[i].clone().addScaledVector(L[i], typeof o2 === "function" ? o2(i) : o2);
      if (ok) { const n = pos.length / 3, yy = y + H[i]; pos.push(a.x, yy, a.z, b.x, yy, b.z); uv.push(0, S[i] / vScale, 1, S[i] / vScale); if (open) idx.push(n - 2, n, n - 1, n - 1, n, n + 1); open = true; } else open = false;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    mat.side = THREE.DoubleSide; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
  }
  const sideOf = (i) => Math.sign(K[i]) || 1, hard = (i) => Math.abs(K[i]) > 0.012;
  strip(-W / 2 - 3.5, W / 2 + 3.5, 0.0, new THREE.MeshLambertMaterial({ color: 0x5d6168 }));
  const asphaltMat = strip(-W / 2, W / 2, 0.02, new THREE.MeshLambertMaterial({ map: asphalt }));
  strip(W / 2 - 0.55, W / 2 - 0.3, 0.04, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  strip(-W / 2 + 0.3, -W / 2 + 0.55, 0.04, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  const kerbMat = new THREE.MeshLambertMaterial({ map: canvasTex(4, 64, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#f4f4f4" : "#d81f1f"; c.fillRect(0, i * h / 8, w, h / 8); } }) });
  strip((i) => sideOf(i) * (W / 2), (i) => sideOf(i) * (W / 2 + 1.4), 0.06, kerbMat, hard, 12);
  strip((i) => -sideOf(i) * (W / 2), (i) => -sideOf(i) * (W / 2 + 1.4), 0.06, kerbMat.clone(), (i) => Math.abs(K[i]) > 0.02, 12);
  strip((i) => -sideOf(i) * (W / 2 + 3.5), (i) => -sideOf(i) * (W / 2 + 26), 0.01, new THREE.MeshLambertMaterial({ map: gravel }), (i) => Math.abs(K[i]) > 0.008, 6);
  // Rails : décalage lissé, jamais sur la piste (épingles, croisements)
  const G = new Map(), gk = (x, z) => `${Math.floor(x / 25)},${Math.floor(z / 25)}`;
  P.forEach((p, i) => { const k = gk(p.x, p.z); if (!G.has(k)) G.set(k, []); G.get(k).push(i); });
  const clear = (i, off) => { const qv = P[i].clone().addScaledVector(L[i], off), x0 = Math.floor(qv.x / 25), z0 = Math.floor(qv.z / 25);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of G.get(`${x0 + a},${z0 + b}`) || []) if (P[j].distanceTo(qv) < W / 2 + 4) return false; return true; };
  const smooth = (f) => { const a = P.map((_, i) => f(i)), r = 10; return a.map((_, i) => { let s = 0; for (let k = -r; k <= r; k++) s += a[(i + k + N) % N]; return s / (2 * r + 1); }); };
  const RO = smooth((i) => W / 2 + (Math.abs(K[i]) > 0.008 && sideOf(i) < 0 ? 28 : 9)), LO = smooth((i) => -W / 2 - (Math.abs(K[i]) > 0.008 && sideOf(i) > 0 ? 28 : 9));
  function wall(off, h, mat, o = {}) {
    const y0 = o.y0 ?? -0.4, rep = o.rep || 4, pos = [], uv = [], idx = []; let open = false;
    for (let k = 0; k <= N; k++) { const i = k % N, ok = (!o.filter || o.filter(i)) && clear(i, off[i]), a = P[i].clone().addScaledVector(L[i], off[i]);
      if (ok) { const n = pos.length / 3; if (open && Math.hypot(a.x - pos[n * 3 - 6], a.z - pos[n * 3 - 4]) > 6) open = false; pos.push(a.x, H[i] + y0, a.z, a.x, H[i] + h, a.z); uv.push(k * DS / rep, 0, k * DS / rep, 1); if (open) idx.push(n - 2, n, n - 1, n - 1, n, n + 1); open = true; } else open = false; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = !o.noShadow; scene.add(m);
  }
  // Ligne des stands : sur la ligne droite de départ, côté opposé aux tribunes (si elle est bien droite)
  const PIT = []; for (let k = -36; k <= 24; k++) PIT.push((k + N) % N);
  const inPit = new Set(PIT.every((i) => Math.abs(K[i]) < 0.004 && clear(i, W / 2 + 24)) ? PIT : []);
  const notPit = (i) => !inPit.has(i);
  const armco = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: canvasTex(64, 32, (c, w, h) => { c.fillStyle = "#c3c8d0"; c.fillRect(0, 0, w, h); c.fillStyle = "#9097a2"; c.fillRect(0, h * .2, w, 3); c.fillRect(0, h * .55, w, 3); c.fillStyle = "#5b616b"; c.fillRect(0, 0, 4, h); }) });
  wall(RO, 1.0, armco, { filter: notPit }); wall(LO, 1.0, armco);
  // Grillage de protection au-dessus des rails
  const fence = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.35, map: canvasTex(64, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.strokeStyle = "rgba(205,210,220,.95)"; c.lineWidth = 2; for (let k = -w; k < w * 2; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + h, h); c.stroke(); c.beginPath(); c.moveTo(k + h, 0); c.lineTo(k, h); c.stroke(); } c.fillStyle = "#6b717c"; c.fillRect(0, 0, 3, h); c.fillRect(0, 0, w, 3); }) });
  wall(RO, 4.2, fence, { y0: 1.0, rep: 2.5, filter: notPit, noShadow: true }); wall(LO, 4.2, fence, { y0: 1.0, rep: 2.5, noShadow: true });
  { const chk = canvasTex(64, 8, (c) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { c.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; c.fillRect(x * 4, y * 4, 4, 4); } });
    const g = new THREE.PlaneGeometry(W, 1.6); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: chk })); m.position.copy(P[0]).y = H[0] + 0.08; m.rotation.y = Math.atan2(T[0].x, T[0].z); scene.add(m);
    const gantry = new THREE.Group(), steel = new THREE.MeshLambertMaterial({ color: 0x30343c }), post = new THREE.BoxGeometry(0.5, 7, 0.5);
    [-1, 1].forEach((s) => { const p = new THREE.Mesh(post, steel); p.position.set(s * (W / 2 + 2), 3.5, 0); p.castShadow = true; gantry.add(p); });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4.5, 1.2, 0.8), steel); beam.position.y = 6.8; gantry.add(beam);
    gantry.position.copy(P[3]).y = H[3]; gantry.rotation.y = Math.atan2(T[3].x, T[3].z); scene.add(gantry); }
  { const mat = new THREE.MeshLambertMaterial({ map: crowd }), roof = new THREE.MeshLambertMaterial({ color: 0xe9ecf1 }), struct = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
    for (let k = -60; k <= 60; k += 20) {
      const i = (k + N) % N, base = P[i].clone().addScaledVector(L[i], -(W / 2 + 26));
      if (!clear(i, -(W / 2 + 26)) || !clear(i, -(W / 2 + 40))) continue;
      const gs = new THREE.Group();
      for (let r = 0; r < 6; r++) { const st = new THREE.Mesh(new THREE.BoxGeometry(56, 1.2, 2.2), mat); st.position.set(0, 0.6 + r * 1.2, -r * 2.2); gs.add(st); }
      const back = new THREE.Mesh(new THREE.BoxGeometry(56, 9, 0.6), struct); back.position.set(0, 4.5, -13.5); gs.add(back);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(58, 0.4, 16), roof); rf.position.set(0, 10.5, -6.5); rf.rotation.x = 0.08; gs.add(rf);
      gs.position.copy(base).y = H[i] - 0.3; gs.lookAt(P[i].x, H[i] - 0.3, P[i].z); gs.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(gs);
    } }
  let cloudsGrp = null;
  { const cell = 40, grid = new Set(); P.forEach((p) => grid.add(`${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`));
    const near = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (grid.has(`${Math.floor(x / cell) + a},${Math.floor(z / cell) + b}`)) return true; return false; };
    const box = new THREE.Box3().setFromPoints(P), n = 700;
    // Arbres : sapins (deux étages) et feuillus (boule irrégulière), teintes variées
    const pine1 = new THREE.InstancedMesh(new THREE.ConeGeometry(3.6, 7, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), n), pine2 = new THREE.InstancedMesh(new THREE.ConeGeometry(2.5, 6, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    const leafy = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.3, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 3.4, 6), new THREE.MeshLambertMaterial({ color: 0x5b4330 }), n);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(), cc = new THREE.Color(); let c = 0, np = 0, nl = 0, tries = 0;
    while (c < n && tries < 20000) { tries++;
      const x = box.min.x - 250 + Math.random() * (box.max.x - box.min.x + 500), z = box.min.z - 250 + Math.random() * (box.max.z - box.min.z + 500);
      if (near(x, z)) continue; const k = 0.7 + Math.random() * 0.8, gy = groundH(x, z); qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
      m.compose(new THREE.Vector3(x, gy + 1.6, z), qq, new THREE.Vector3(k, k, k)); trunks.setMatrixAt(c, m);
      if (Math.random() < .55) { s.set(k, k * (0.9 + Math.random() * .4), k); m.compose(new THREE.Vector3(x, gy + 3 + 3.5 * s.y, z), qq, s); pine1.setMatrixAt(np, m); m.compose(new THREE.Vector3(x, gy + 3 + 7.6 * s.y, z), qq, s); pine2.setMatrixAt(np, m);
        cc.setHSL(.33 + Math.random() * .05, .45, .16 + Math.random() * .08); pine1.setColorAt(np, cc); pine2.setColorAt(np, cc); np++; }
      else { s.set(k * (0.9 + Math.random() * .4), k * (0.8 + Math.random() * .4), k * (0.9 + Math.random() * .4)); m.compose(new THREE.Vector3(x, gy + 3.4 + 3 * s.y, z), qq, s); leafy.setMatrixAt(nl, m); cc.setHSL(.22 + Math.random() * .1, .45 + Math.random() * .15, .2 + Math.random() * .1); leafy.setColorAt(nl, cc); nl++; }
      c++; }
    trunks.count = c; pine1.count = pine2.count = np; leafy.count = nl; [pine1, pine2, leafy].forEach((t) => (t.castShadow = true)); scene.add(trunks, pine1, pine2, leafy);
    // Montagnes : vrai relief bruité autour du circuit (fini les pyramides), même relief à chaque partie sur un circuit donné
    { const bx = new THREE.Box3().setFromPoints(P), R0 = Math.hypot(bx.max.x - bx.min.x, bx.max.z - bx.min.z) / 2 + 750;
      scene.add(arcMountains(THREE, { cx: (bx.min.x + bx.max.x) / 2, cz: (bx.min.z + bx.max.z) / 2, R0, base: H0, seed: Math.round(LEN * 7) % 100000 + 1, seg: touch ? 140 : 220 })); }
    // Nuages
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9aa6b8, fog: false, flatShading: true }); cloudsGrp = new THREE.Group(); scene.add(cloudsGrp);
    for (let k = 0; k < 16; k++) { const cg = new THREE.Group(), a = Math.random() * Math.PI * 2, r = 500 + Math.random() * 1700;
      for (let b = 0; b < 4; b++) { const sp = new THREE.Mesh(new THREE.IcosahedronGeometry(40 + Math.random() * 40, 1), cloudMat); sp.position.set((b - 1.5) * 50 + Math.random() * 20, Math.random() * 15, Math.random() * 30); cg.add(sp); }
      cg.scale.set(1, 0.38, 0.7); cg.position.set(Math.cos(a) * r, H0 + 320 + Math.random() * 220, Math.sin(a) * r); cg.rotation.y = Math.random() * 3; cloudsGrp.add(cg); } }
  // Stands : voie, muret et garages
  if (inPit.size) {
    const pf = PIT.filter((i) => inPit.has(i)), pitSet = (i) => inPit.has(i);
    strip(W / 2 + 3.5, W / 2 + 15, 0.015, new THREE.MeshLambertMaterial({ color: 0x55585e }), pitSet);
    strip(W / 2 + 14.6, W / 2 + 14.9, 0.03, new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), pitSet);
    const conc = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: canvasTex(64, 16, (c, w, h) => { c.fillStyle = "#d9dbe0"; c.fillRect(0, 0, w, h); c.fillStyle = "#c8102e"; c.fillRect(0, h - 4, w / 2, 4); c.fillStyle = "#f4f4f4"; c.fillRect(w / 2, h - 4, w / 2, 4); }) });
    const pw = P.map(() => W / 2 + 3.7); wall(pw, 1.1, conc, { filter: pitSet, y0: -0.2, rep: 6 }); wall(pw, 3.6, fence, { filter: pitSet, y0: 1.1, rep: 2.5, noShadow: true });
    const front = canvasTex(256, 96, (c, w, h) => { c.fillStyle = "#e3e6eb"; c.fillRect(0, 0, w, h); c.fillStyle = "#2b3442"; c.fillRect(0, 6, w, 22); c.fillStyle = "rgba(160,200,235,.35)"; for (let x = 4; x < w; x += 16) c.fillRect(x, 8, 12, 18);
      const tc = ["#c8102e", "#1f4fa3", "#ff8000", "#0b7a5c", "#14161b", "#7a1fa3"]; for (let k = 0; k < 3; k++) { const x = 8 + k * 84; c.fillStyle = "#15171c"; c.fillRect(x, 40, 72, 56); c.fillStyle = tc[Math.floor(Math.random() * tc.length)]; c.fillRect(x, 36, 72, 6); c.fillStyle = "#3a3f4a"; c.fillRect(x + 4, 48, 64, 2); } });
    const side = new THREE.MeshLambertMaterial({ color: 0xc9ccd2 }), roofM = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
    for (let k = 0; k < pf.length; k += 10) { const i = pf[k], gg = new THREE.Group(), base = P[i].clone().addScaledVector(L[i], W / 2 + 24);
      const box = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 14), [side, side, roofM, roofM, new THREE.MeshLambertMaterial({ map: front }), side]); box.position.y = 4.5; gg.add(box);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(30.4, 0.5, 3), roofM); lip.position.set(0, 9.2, 8); gg.add(lip);
      gg.position.copy(base).y = H[i] - 0.3; gg.lookAt(P[i].x, H[i] - 0.3, P[i].z); gg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(gg); }
  }
  // Panneaux publicitaires le long des lignes droites, d'un côté puis de l'autre
  { const straight = smooth((i) => (Math.abs(K[i]) < 0.003 ? 1 : 0)), offH = P.map((_, i) => (Math.floor(i / 70) % 2 ? 1 : -1) * (W / 2 + 7.2));
    const ads = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: canvasTex(512, 64, (c, w, h) => { const t = [["#c8102e", "DUEL DE RYTHME"], ["#14161b", "BATS LE VAINQUEUR"], ["#1f4fa3", "ARCADE GP"]];
      t.forEach(([bg, tx], k) => { c.fillStyle = bg; c.fillRect(k * w / 3, 0, w / 3, h); c.fillStyle = "#fff"; c.font = "bold 22px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(tx, k * w / 3 + w / 6, h / 2 + 1); }); }) });
    wall(offH, 1.1, ads, { y0: 0, rep: 24, filter: (i) => straight[i] > 0.97 && i % 70 < 45 && notPit(i) && i > 8 && i < N - 14 }); }
  // Murs de pneus à l'extérieur des gros virages, devant le rail
  { const pos = []; for (let i = 0; i < N; i++) { if (Math.abs(K[i]) <= 0.008) continue; const s = -sideOf(i), off = s > 0 ? RO[i] - 1 : LO[i] + 1; if (!clear(i, off)) continue;
      for (let a = 0; a < 2; a++) for (let r = 0; r < 2; r++) { const p = P[i].clone().lerp(P[(i + 1) % N], a / 2).addScaledVector(L[i], off - s * r * 0.7); pos.push([p.x, H[i] + 0.45, p.z]); } }
    const tyres = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.36, 0.36, 0.9, 10), new THREE.MeshLambertMaterial({ color: 0x1b1c20 }), Math.max(1, pos.length)), mm = new THREE.Matrix4();
    pos.forEach((p, k) => { mm.makeTranslation(p[0], p[1], p[2]); tyres.setMatrixAt(k, mm); }); tyres.count = pos.length; tyres.castShadow = true; scene.add(tyres); }

  const player = arcCar(THREE, 0xd8231f, 0xf4f4f4, false, 1); scene.add(player);
  const ghost = arcCar(THREE, cfg.ghostColor, cfg.ghostColor, true); scene.add(ghost);

  /* Fantôme : profil de vitesse tiré du tracé, calé sur le vrai meilleur tour ; départ arrêté */
  const START = N - 6, FIN = N + 6;          // la grille est 18 m avant la ligne ; un tour = de la grille à la ligne, +1 tour
  const gV0 = new Float32Array(N), G_ACC = 9;
  // Virages à environ 3,5 g une fois calé sur le vrai temps (avant : plus de 4,5 g en virage et des lignes droites trop lentes, d'où un fantôme imbattable)
  { const A_LAT = 40, A_BRK = 30, VMAX = 92, ds = DS;
    for (let i = 0; i < N; i++) gV0[i] = Math.min(VMAX, Math.sqrt(A_LAT / Math.max(1e-4, Math.abs(K[i]))));
    for (let r = 0; r < 2; r++) { for (let i = 1; i < N * 2; i++) { const a = i % N, b = (i - 1) % N; gV0[a] = Math.min(gV0[a], Math.sqrt(gV0[b] ** 2 + 2 * G_ACC * ds)); }
      for (let i = N * 2; i > 0; i--) { const a = i % N, b = (i + 1) % N; gV0[a] = Math.min(gV0[a], Math.sqrt(gV0[b] ** 2 + 2 * A_BRK * ds)); } } }
  let gT = new Float32Array(FIN + 1), GHOST_TOTAL = 0;
  const lvlLap = (l) => cfg.ghostLap * ARC_LVLS[l][1];
  function buildGhost(lap) {
    let t = 0; for (let i = 0; i < N; i++) t += DS / gV0[i];
    const k = t / lap, gV = gV0.map((v) => v * k);
    let v = 0; gT = new Float32Array(FIN + 1); for (let j = 0; j < FIN; j++) { const v1 = Math.min(gV[(START + j) % N], Math.sqrt(v * v + 2 * G_ACC * k * k * DS)); gT[j + 1] = gT[j] + 2 * DS / (v + v1 || 1); v = v1; }
    GHOST_TOTAL = gT[FIN];
  }
  // Panneaux de freinage 3, 2, 1 (150, 100 et 50 m avant l'entrée des virages qui demandent un vrai freinage)
  { const board = (n) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: canvasTex(64, 64, (c, w, h) => { c.fillStyle = "#f4f4f4"; c.fillRect(0, 0, w, h); c.strokeStyle = "#14161b"; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = "#14161b"; c.font = "bold 44px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(n), w / 2, h / 2 + 3); }) });
    const mats = [null, board(1), board(2), board(3)], postM = new THREE.MeshLambertMaterial({ color: 0x30343c }), panelG = new THREE.PlaneGeometry(1.3, 1.3), postG = new THREE.BoxGeometry(0.12, 1.6, 0.12);
    let lastApex = -999, nb = 0;
    for (let i = 0; i < N; i++) {
      const v = gV0[i]; let isMin = v < 70; for (let k = -30; k <= 30 && isMin; k++) if (gV0[(i + k + N) % N] < v) isMin = false;
      if (!isMin || i - lastApex < 40) continue; lastApex = i;
      let t = i; while (gV0[(t - 1 + N) % N] < v * 1.08 && i - t < 80) t--;
      let b = t; while (gV0[(b - 1 + N) % N] > gV0[(b + N) % N] && t - b < 200) b--;
      if ((t - b) * DS < 45) continue;
      const s = -sideOf(i);
      [3, 2, 1].forEach((n) => { const j = (((t - Math.round((n * 50) / DS)) % N) + N) % N; if ((t - j + N) % N > (t - b) + 25 || !clear(j, s * (W / 2 + 4.5))) return;
        const g = new THREE.Group(), p = P[j].clone().addScaledVector(L[j], s * (W / 2 + 4.5));
        const post = new THREE.Mesh(postG, postM); post.position.y = 0.8; g.add(post);
        const pan = new THREE.Mesh(panelG, mats[n]); pan.position.y = 1.9; g.add(pan);
        g.position.set(p.x, H[j] - 0.1, p.z); g.rotation.y = Math.atan2(T[j].x, T[j].z) + Math.PI; g.traverse((o) => (o.castShadow = !!o.isMesh)); scene.add(g); nb++; }); }
    q("tip").hidden = !nb; }
  // Position continue du fantôme à l'instant t (distance interpolée, pas de saut d'un point à l'autre)
  const ghostAt = (t) => { let lo = 0, hi = FIN; while (lo < hi) { const m = (lo + hi) >> 1; if (gT[m] < t) lo = m + 1; else hi = m; } const i = Math.max(0, Math.min(FIN - 1, lo - 1)), f = Math.max(0, Math.min(1, (t - gT[i]) / ((gT[i + 1] - gT[i]) || 1))); return (i + f) * LEN / N; };

  /* Réalisme : matières physiques, ciel calculé, météo du vrai GP, effets (Ultra sur ordinateur) */
  const WET = !!cfg.wet, ULTRA = GFX === "ultra" && EXL >= 2, lin = (c) => new THREE.Color(c).convertSRGBToLinear();
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = WET ? .56 : .5;
  { // Toutes les matières simples deviennent physiques ; couleurs converties en linéaire, sinon tout paraît pastel
    const conv = new Map(), keep = new Set();
    player.traverse((o) => o.isMesh && keep.add(o)); ghost.traverse((o) => o.isMesh && keep.add(o));
    const special = new Map([[armco, { metalness: .55, roughness: .42 }], [fence, { metalness: .6, roughness: .4 }], [kerbMat, { roughness: WET ? .25 : .55 }]]);
    const toStd = (m) => { if (!m || !(m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return m; if (conv.has(m)) return conv.get(m);
      const n = new THREE.MeshStandardMaterial({ map: m.map, color: m.map ? m.color.clone() : lin(m.color), transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: m.side, flatShading: m.flatShading, vertexColors: m.vertexColors, fog: m.fog, emissive: lin(m.emissive || 0), roughness: .9, metalness: 0, depthWrite: m.depthWrite, envMapIntensity: .3 });
      Object.assign(n, special.get(m) || {}); if (WET && !m.map && m.color.getHex() === 0x5d6168) n.roughness = .3; conv.set(m, n); m.dispose(); return n; };
    scene.traverse((o) => { if (!o.isMesh || keep.has(o)) return; o.material = Array.isArray(o.material) ? o.material.map(toStd) : toStd(o.material); });
    // Asphalte : grain en relief, trace de gomme plus lisse ; sous la pluie, sombre et brillant
    const a2 = canvasTex(512, 512, (c, w, h) => { noise(c, w, h, "#3d4046", .32, 50000); const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(.3, "rgba(0,0,0,0)"); g.addColorStop(.42, "rgba(10,10,12,.35)"); g.addColorStop(.55, "rgba(0,0,0,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    const bump = canvasTex(256, 256, (c, w, h) => noise(c, w, h, "#808080", .9, 30000)); bump.encoding = THREE.LinearEncoding;
    const rough = canvasTex(64, 64, (c, w, h) => { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, "#e6e6e6"); g.addColorStop(.42, "#8a8a8a"); g.addColorStop(.55, "#e6e6e6"); g.addColorStop(1, "#e6e6e6"); c.fillStyle = g; c.fillRect(0, 0, w, h); }); rough.encoding = THREE.LinearEncoding;
    asphaltMat.material = new THREE.MeshStandardMaterial({ map: a2, bumpMap: bump, bumpScale: WET ? .01 : .03, roughnessMap: WET ? null : rough, roughness: WET ? .24 : 1, color: WET ? new THREE.Color(.42, .44, .47) : new THREE.Color(1, 1, 1), envMapIntensity: WET ? .38 : .3, side: THREE.DoubleSide });
    a2.repeat.set(1, 1); bump.repeat.set(2, 2);
    // La voiture du joueur : carrosserie vernie, carbone tissé, pneus mats, jantes métal
    const carbon = canvasTex(64, 64, (c, w, h) => { c.fillStyle = "#16181c"; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { const g = c.createLinearGradient(x, y, x + 8, y + 8), o = ((x + y) / 8) % 2; g.addColorStop(0, o ? "#2b2f36" : "#121418"); g.addColorStop(1, o ? "#121418" : "#2b2f36"); c.fillStyle = g; c.fillRect(x, y, 8, 8); } }, [6, 6]);
    const R = { 0xd8231f: { roughness: .4, clearcoat: 1, clearcoatRoughness: .06 }, 0xf4f4f4: { roughness: .4, clearcoat: .8, clearcoatRoughness: .1 }, 0x17191e: { map: carbon, roughness: .42, metalness: .25, clearcoat: .7, clearcoatRoughness: .15 }, 0x0c0d10: { roughness: .6 }, 0x1a1b1e: { roughness: .92 }, 0x3a3d44: { metalness: .9, roughness: .28 }, 0xf2c200: { roughness: .7 }, 0x0e1320: { metalness: .9, roughness: .06 } };
    const pc = new Map();
    player.traverse((o) => { if (!o.isMesh || !o.material.isMeshPhongMaterial) return; const m = o.material, hex = m.color.getHex();
      if (!pc.has(m)) pc.set(m, new THREE.MeshPhysicalMaterial({ color: R[hex]?.map ? new THREE.Color(1, 1, 1) : lin(m.color), envMapIntensity: .45, ...(R[hex] || { roughness: .6 }) })); o.material = pc.get(m); o.receiveShadow = true; });
    player.userData.paint = [...pc.values()];
  }
  // Nom et numéro sur la voiture (aucune marque réelle), ombre de contact sous la voiture
  { const txt = (s, w, h, fs, col) => { const t = canvasTex(w, h, (c) => { c.clearRect(0, 0, w, h); c.fillStyle = col; c.font = `800 ${fs}px "Arial Narrow", Arial, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(s, w / 2, h / 2 + 2); }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
    const dm = (t) => new THREE.MeshPhysicalMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: .35, clearcoat: 1, clearcoatRoughness: .06, side: THREE.DoubleSide });
    const name = dm(txt("DUEL DE RYTHME", 512, 64, 50, "#ffffff")), num = dm(txt("1", 128, 128, 110, "#14161a")), band = new THREE.MeshPhysicalMaterial({ color: lin(0x14161a), roughness: .3, clearcoat: 1 });
    [-1, 1].forEach((s) => { const b = new THREE.Mesh(new THREE.PlaneGeometry(1.25, .13), band); b.position.set(s * .728, .33, -.35); b.rotation.y = s * Math.PI / 2; player.add(b);
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.2, .15), name); t.position.set(s * .732, .33, -.35); t.rotation.y = s * Math.PI / 2; player.add(t);
      const n = new THREE.Mesh(new THREE.PlaneGeometry(.3, .3), num); n.position.set(s * .015, .68, -1.72); n.rotation.y = s * Math.PI / 2; player.add(n); });
    const sh = canvasTex(64, 128, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); g.addColorStop(0, "rgba(0,0,0,.7)"); g.addColorStop(.6, "rgba(0,0,0,.3)"); g.addColorStop(1, "rgba(0,0,0,0)"); c.save(); c.scale(1, h / w); c.fillStyle = g; c.fillRect(0, 0, w, w); c.restore(); }); sh.wrapS = sh.wrapT = THREE.ClampToEdgeWrapping;
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 5.8), new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false })); cs.rotation.x = -Math.PI / 2; cs.position.set(0, .04, -.1); cs.renderOrder = 2; player.add(cs); }
  // Ciel calculé (atmosphère) : il sert aussi de reflet à toutes les matières ; couvert et gris s'il a plu pendant le GP
  const SUN = new THREE.Vector3(-60, 120, 40).normalize();
  sun.intensity = WET ? .7 : 1.9; sun.color.copy(lin(WET ? 0xdfe5ec : 0xffe2b8)); hemi.intensity = WET ? .9 : .45; hemi.color.copy(lin(WET ? 0xb8c0ca : 0xbcd2ff));
  scene.fog = new THREE.Fog(lin(WET ? 0x8e979f : 0xb4c6db), WET ? 220 : 600, WET ? 2400 : 5200); camera.far = 7000; camera.updateProjectionMatrix();
  if (EXL >= 1 && THREE.Sky) {
    const mk = (sc) => { const s = new THREE.Sky(); s.scale.setScalar(sc); const u = s.material.uniforms; u.turbidity.value = WET ? 14 : 3; u.rayleigh.value = WET ? 3.8 : 1.1; u.mieCoefficient.value = WET ? .02 : .005; u.mieDirectionalG.value = WET ? .6 : .8; u.sunPosition.value.copy(SUN).multiplyScalar(WET ? .25 : 1); return s; };
    skyOld.visible = false; scene.add(mk(6000));
    const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(mk(50)); scene.environment = pm.fromScene(es).texture; pm.dispose();
  } else skyOld.material.toneMapped = false;
  { const cm = cloudsGrp.children[0]?.children[0]?.material; if (cm) { cm.color = lin(WET ? 0x9aa1a9 : 0xffffff); cm.emissive = lin(WET ? 0x5d636b : 0xc9d3df); } }
  // Pluie : traits qui tombent autour de la caméra
  let rain = null;
  if (WET) { const n = touch ? 700 : 1600, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 6), drop = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { drop[i * 3] = (Math.random() - .5) * 50; drop[i * 3 + 1] = Math.random() * 24; drop[i * 3 + 2] = (Math.random() - .5) * 50; }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: lin(0xc4ccd6), transparent: true, opacity: .35, fog: false })); rain.frustumCulled = false; rain.userData.drop = drop; scene.add(rain); }
  // Ultra : reflets d'un vrai panorama HDR sur la voiture, ombrage d'ambiance, herbe en brins, reflet du soleil
  let grassF = null;
  if (ULTRA) {
    sun.shadow.mapSize.set(2048, 2048);
    try { new THREE.EXRLoader().load(cfg.hdri || "assets/park.exr", (tex) => { const pm = new THREE.PMREMGenerator(renderer), env = pm.fromEquirectangular(tex).texture; pm.dispose(); tex.dispose(); player.userData.paint.forEach((m) => { m.envMap = env; m.envMapIntensity = .8; m.needsUpdate = true; }); }, undefined, () => {}); } catch {}
    if (!WET && THREE.Lensflare) { const fl = (r, a) => { const t = canvasTex(128, 128, (c, w, h) => { const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); g.addColorStop(0, `rgba(255,244,220,${a})`); g.addColorStop(r, `rgba(255,214,160,${a * .35})`); g.addColorStop(1, "rgba(255,200,140,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h); }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
      const lf = new THREE.Lensflare(); lf.addElement(new THREE.LensflareElement(fl(.2, 1), 380, 0)); [[.4, .22, 60, .5], [.5, .16, 90, .7], [.3, .12, 140, 1]].forEach(([r, a, s, d]) => lf.addElement(new THREE.LensflareElement(fl(r, a), s, d))); lf.userData.sun = true; scene.add(lf); lf.position.copy(SUN).multiplyScalar(4500); }
    // Herbe : tronçons de 60 m autour de la voiture, remplis de nouveau quand elle avance
    const CH = 20, nCh = Math.ceil(N / CH), PER = 2400, SHOW = 7;
    const bg = new THREE.PlaneGeometry(.05, .38, 1, 3); bg.translate(0, .19, 0); { const p = bg.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - p.getY(i) / .42)); }
    const gm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, side: THREE.DoubleSide }), gTime = { value: 0 };
    gm.onBeforeCompile = (s) => { s.uniforms.uTime = gTime; s.vertexShader = "uniform float uTime;\n" + s.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n float hh = position.y; vec4 ip = instanceMatrix[3]; transformed.x += sin(uTime * 1.7 + ip.x * .35 + ip.z * .25) * .9 * hh * hh; transformed.z += cos(uTime * 1.3 + ip.z * .3) * .4 * hh * hh;"); };
    const im = new THREE.InstancedMesh(bg, gm, PER * SHOW); im.frustumCulled = false; im.receiveShadow = true; scene.add(im);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cl = new THREE.Color(), v = new THREE.Vector3(), sc = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const fill = (slot, ch) => { let s = ch * 9973 + 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let j = 0; j < PER; j++) { const k = slot * PER + j, i = (ch * CH + Math.floor(r() * CH)) % N, side = j % 2 ? 1 : -1, off = side * (W / 2 + 3.6 + r() * 5.2);
        const bad = (Math.abs(K[i]) > .008 && side === -sideOf(i)) || (side > 0 && inPit.has(i)) || !clear(i, off);
        if (bad) { im.setMatrixAt(k, zero); continue; }
        v.copy(P[i]).addScaledVector(L[i], off).addScaledVector(T[i], (r() - .5) * 3); v.y = H[i] - .25; const hk = .6 + r() * .9;
        e.set((r() - .5) * .5, r() * Math.PI, (r() - .5) * .5); q.setFromEuler(e); sc.set(1, hk, 1); m4.compose(v, q, sc); im.setMatrixAt(k, m4);
        cl.setHSL(.24 + r() * .06, .5 + r() * .2, .2 + r() * .14); im.setColorAt(k, cl); } };
    let cur = -1;
    grassF = { t: gTime, update(i) { const c = Math.floor(i / CH); if (c === cur) return; cur = c; for (let k = -3; k <= 3; k++) fill(k + 3, (c + k + nCh) % nCh); im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } };
    grassF.update(START);
  }
  // Post-traitement sur ordinateur : (ombrage d'ambiance en Ultra), halo lumineux, puis conversion pour l'écran
  let composer = null;
  if (EXL >= 1 && !touch && renderer.capabilities.isWebGL2 && THREE.EffectComposer) {
    const rt = new THREE.WebGLMultisampleRenderTarget(16, 16, { format: THREE.RGBAFormat }); rt.samples = 4;
    composer = new THREE.EffectComposer(renderer, rt);
    if (ULTRA && THREE.SSAOPass) { const ao = new THREE.SSAOPass(scene, camera, 16, 16); ao.kernelRadius = .5; ao.minDistance = .0000015; ao.maxDistance = .0002; composer.addPass(ao); }
    else composer.addPass(new THREE.RenderPass(scene, camera));
    composer.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(16, 16), .18, .4, .93));
    composer.addPass(new THREE.ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = vec4(pow(texture2D(tDiffuse, vUv).rgb * 1.05, vec3(1.0 / 2.2)), 1.0); }" }));
  }
  const draw = () => (composer ? composer.render() : renderer.render(scene, camera));

  /* Mini-carte */
  const map = root.querySelector(".a-map"), mctx = map.getContext("2d"), bb = new THREE.Box3().setFromPoints(P);
  const msc = Math.min((map.width - 30) / (bb.max.x - bb.min.x), (map.height - 30) / (bb.max.z - bb.min.z));
  const mp = (p) => [15 + (p.x - bb.min.x) * msc + ((map.width - 30) - (bb.max.x - bb.min.x) * msc) / 2, 15 + (p.z - bb.min.z) * msc + ((map.height - 30) - (bb.max.z - bb.min.z) * msc) / 2];
  const drawMap = (pp, gp) => { mctx.clearRect(0, 0, map.width, map.height); mctx.lineWidth = 6; mctx.strokeStyle = "#c9ccd2"; mctx.lineJoin = "round"; mctx.beginPath(); P.forEach((p, i) => { const [x, y] = mp(p); i ? mctx.lineTo(x, y) : mctx.moveTo(x, y); }); mctx.closePath(); mctx.stroke();
    const dot = (p, c) => { const [x, y] = mp(p); mctx.fillStyle = c; mctx.beginPath(); mctx.arc(x, y, 7, 0, 7); mctx.fill(); }; dot(gp, cfg.ghostColor); dot(pp, "#e10600"); const [x, y] = mp(pp); mctx.lineWidth = 2; mctx.strokeStyle = "#fff"; mctx.beginPath(); mctx.arc(x, y, 7, 0, 7); mctx.stroke(); };

  /* Commandes */
  const down = new Set(); let capture = null;
  const actOf = (k) => ARC_ACTIONS.map(([a]) => a).filter((a) => keys[a].some((x) => x.toLowerCase() === k.toLowerCase()));
  const onKey = (e) => {
    if (capture) { e.preventDefault(); e.stopPropagation(); if (e.key !== "Escape") { ARC_ACTIONS.forEach(([a]) => (keys[a] = keys[a].filter((x) => x.toLowerCase() !== e.key.toLowerCase()))); keys[capture].push(e.key.length === 1 ? e.key.toLowerCase() : e.key); saveKeys(); } capture = null; renderSet(); return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (state === "race" || state === "lights") pause(); else if (!scr("set").hidden) closeSet(); else if (state !== "pause") quit(); return; }
    const acts = actOf(e.key); if (!acts.length && e.key !== " ") return;
    e.preventDefault(); e.stopPropagation();
    acts.forEach((a) => down.add(a)); if (acts.includes("view")) view = (view + 1) % 2;
    if (e.key === " " && state === "menu" && scr("set").hidden) start();
  };
  const onKeyUp = (e) => { actOf(e.key).forEach((a) => down.delete(a)); };
  addEventListener("keydown", onKey, true); addEventListener("keyup", onKeyUp, true);
  // Commandes tactiles : boutons (flèches à gauche, gaz et frein à droite) ou inclinaison (frein à gauche, gaz à droite)
  const pressed = new Map(); // pointerId → action
  const ICO = { left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>' };
  const pb = (a, cls, label, inner) => `<button class="a-pb ${cls}" data-p="${a}" aria-label="${label}">${inner}</button>`;
  function renderPads() {
    const brk = pb("down", "brk", "Freiner", "<span>FREIN</span>"), gas = pb("up", "gas", "Accélérer", "<span>GAZ</span>");
    const arrow = (a, l) => pb(a, "dir", l, `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICO[a]}</svg>`);
    q("pads").innerHTML = set.mode === "inclinaison" ? `<div class="a-side l">${brk}</div><div class="a-side r">${gas}</div>` : `<div class="a-side l">${arrow("left", "Tourner à gauche")}${arrow("right", "Tourner à droite")}</div><div class="a-side r">${brk}${gas}</div>`;
    q("pads").querySelectorAll(".a-pb").forEach((b) => {
      const on = (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} pressed.set(e.pointerId, b.dataset.p); b.classList.add("on"); };
      const off = (e) => { pressed.delete(e.pointerId); if (![...pressed.values()].includes(b.dataset.p)) b.classList.remove("on"); };
      b.addEventListener("pointerdown", on); ["pointerup", "pointercancel", "lostpointercapture"].forEach((ev) => b.addEventListener(ev, off));
      b.addEventListener("contextmenu", (e) => e.preventDefault());
    });
  }
  renderPads();
  let tilt = 0, tiltZero = null;
  const onTilt = (e) => {
    const ang = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    const raw = ang === 90 ? e.beta : ang === 270 || ang === -90 ? -e.beta : e.gamma;
    if (raw == null) return; if (tiltZero == null) tiltZero = raw;
    tilt = Math.max(-1.5, Math.min(1.5, -(raw - tiltZero) / 18)) * (set.inv ? -1 : 1);
  };
  async function tiltOn() {
    if (!touch || set.mode !== "inclinaison") return;
    try { if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== "granted") throw 0; } }
    catch { set.mode = "boutons"; saveSet(); renderPads(); keyHelp(); (window.toast || console.warn)("Inclinaison refusée : les boutons sont activés."); return; }
    tiltZero = null; addEventListener("deviceorientation", onTilt);
  }
  function saveSet() { try { localStorage.setItem(ARC.setKey, JSON.stringify(set)); } catch {} }
  const input = () => {
    let steer = 0, thr = 0, brk = 0;
    if (down.has("left")) steer += 1; if (down.has("right")) steer -= 1; if (down.has("up")) thr = 1; if (down.has("down")) brk = 1;
    if (touch) { const acts = new Set(pressed.values()); if (acts.has("up")) thr = 1; if (acts.has("down")) brk = 1; if (acts.has("left")) steer += 1; if (acts.has("right")) steer -= 1; if (set.mode === "inclinaison") steer += tilt; }
    return { steer: steer * set.sens, thr, brk };
  };
  function saveKeys() { try { localStorage.setItem(ARC.keysKey, JSON.stringify(keys)); } catch {} keyHelp(); }
  function renderSet() {
    q("acts").innerHTML = ARC_ACTIONS.map(([a, label]) => `<div class="a-act"><span>${label}</span><div class="a-chips">${keys[a].map((k, i) => `<button class="a-chip" data-rm="${a}:${i}" aria-label="Retirer ${esc2(arcKeyName(k))}">${esc2(arcKeyName(k))} <i>×</i></button>`).join("")}<button class="a-chip add ${capture === a ? "wait" : ""}" data-add="${a}">${capture === a ? "Appuie sur une touche…" : "+"}</button></div></div>`).join("");
    const r = root.querySelector("#arc-sens"); r.value = set.sens; q("sensv").textContent = `×${(+set.sens).toFixed(2).replace(".", ",")}`;
    root.querySelector(set.mode === "inclinaison" ? "#arc-m-i" : "#arc-m-b").checked = true; root.querySelector("#arc-inv").checked = set.inv; root.querySelector(GFXS() === "ultra" ? "#arc-g-u" : "#arc-g-s").checked = true;
  }
  function renderLvls() {
    q("lvls").innerHTML = ARC_LVLS.map(([n], l) => `<button class="a-lvl ${set.lvl === l ? "on" : ""}" role="radio" aria-checked="${set.lvl === l}" data-lvl="${l}"><b>${n.toUpperCase()}</b><span>fantôme en ${fmt(lvlLap(l))}</span></button>`).join("");
    buildGhost(lvlLap(set.lvl));
  }
  renderLvls();
  q("elev").textContent = (ELEV >= 5 ? ` · ${Math.round(ELEV)} m de dénivelé` : "") + (cfg.wet ? " · piste mouillée" : "");
  let setFrom = "start";
  const openSet = () => { setFrom = state === "pause" ? "pause" : "start"; renderSet(); show("set"); };
  const closeSet = () => { capture = null; show(setFrom); };
  root.querySelector("#arc-sens").addEventListener("input", (e) => { set.sens = +e.target.value; q("sensv").textContent = `×${set.sens.toFixed(2).replace(".", ",")}`; saveSet(); });
  root.querySelectorAll('input[name="arc-mode"]').forEach((r) => r.addEventListener("change", () => { set.mode = r.value; saveSet(); renderPads(); keyHelp(); }));
  root.querySelector("#arc-inv").addEventListener("change", (e) => { set.inv = e.target.checked; saveSet(); });
  const GFXS = () => set.gfx || GFX;
  root.querySelectorAll('input[name="arc-gfx"]').forEach((r) => r.addEventListener("change", () => { set.gfx = r.value; saveSet(); }));
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.add) { capture = b.dataset.add; renderSet(); return; }
    if (b.dataset.lvl) { set.lvl = +b.dataset.lvl; saveSet(); renderLvls(); return; }
    if (b.dataset.rm) { const [a, i] = b.dataset.rm.split(":"); if (keys[a].length > 1) { keys[a].splice(+i, 1); saveKeys(); } renderSet(); return; }
    if (b.dataset.a === "go" || b.dataset.a === "restart") tiltOn();
    ({ menu: () => { timers.forEach(clearTimeout); reset(); state = "menu"; dEl.hidden = true; show("start"); }, go: start, restart: start, set: openSet, setok: closeSet, setreset: () => { keys = JSON.parse(JSON.stringify(ARC_DEFAULT_KEYS)); saveKeys(); renderSet(); }, pause, resume, quit })[b.dataset.a]?.();
  });

  /* Partie */
  let state = "menu", view = 0, idx = START, progress = 0, halfway = false, t0 = 0, pausedAt = 0, steerS = 0, timers = [];
  const car = { x: 0, z: 0, h: 0, v: 0, y: 0, i: START, gr: 0, dir: 1 };
  const reset = () => { const p = P[START]; car.x = p.x + L[START].x * -2; car.z = p.z + L[START].z * -2; car.h = Math.atan2(T[START].x, T[START].z); car.v = 0; car.y = H[START]; car.i = START; car.gr = 0; car.dir = 1; idx = START; progress = 0; halfway = false; steerS = 0; };
  const nearest = (x, z) => { let bi = idx, bd = Infinity; for (let k = -25; k <= 60; k++) { const i = (idx + k + N) % N, dx = P[i].x - x, dz = P[i].z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } } return [bi, (x - P[bi].x) * L[bi].x + (z - P[bi].z) * L[bi].z]; };
  const lights = root.querySelector(".a-lights"), dEl = root.querySelector(".a-delta");
  function start() {
    timers.forEach(clearTimeout); timers = []; reset(); state = "lights"; show(null); lights.hidden = false; dEl.hidden = true; q("lap").textContent = fmt(0);
    const ls = [...lights.children]; ls.forEach((l) => l.classList.remove("on"));
    ls.forEach((l, k) => timers.push(setTimeout(() => l.classList.add("on"), 700 * (k + 1))));
    timers.push(setTimeout(() => { ls.forEach((l) => l.classList.remove("on")); lights.hidden = true; state = "race"; t0 = performance.now(); dEl.hidden = false; tiltZero = null; }, 700 * 5 + 500 + Math.random() * 900));
  }
  function pause() { if (state === "lights") { timers.forEach(clearTimeout); lights.hidden = true; state = "menu"; show("start"); return; } if (state !== "race") return; state = "pause"; pausedAt = performance.now(); show("pause"); }
  function resume() { if (state !== "pause") return; t0 += performance.now() - pausedAt; state = "race"; show(null); }
  function finish(t) {
    state = "end"; const d = t - GHOST_TOTAL, win = d < 0;
    const lvlN = ARC_LVLS[set.lvl][0];
    q("etitle").textContent = win ? `TU BATS ${cfg.ghostName.toUpperCase()} !` : "PRESQUE !";
    q("eyou").textContent = fmt(t); q("eghost").textContent = fmt(GHOST_TOTAL); q("eglab").textContent = `${cfg.ghostName.toUpperCase()} · ${lvlN.toUpperCase()}`;
    q("ediff").textContent = win ? `${fmtD(d)} sur ${cfg.ghostName}, niveau ${lvlN}` : `Raté de ${Math.abs(d).toFixed(2).replace(".", ",")} s en ${lvlN}${set.lvl ? " · essaie le niveau en dessous" : ""}`; q("ediff").style.color = win ? "var(--arc-good)" : "var(--arc-bad)";
    if (!best || t < best) { best = t; try { localStorage.setItem(cfg.recKey, String(t)); } catch {} q("rec").textContent = fmt(t); }
    const u = q("unlock"); u.hidden = true;
    if (win && cfg.onWin) { const r = cfg.onWin(t, { lvl: set.lvl }); if (r) { u.innerHTML = r; u.hidden = false; } }
    show("end"); root.querySelector('[data-s="end"] [data-a="restart"]').focus();
  }
  function quit() {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout);
    removeEventListener("deviceorientation", onTilt); removeEventListener("keydown", onKey, true); removeEventListener("keyup", onKeyUp, true); removeEventListener("resize", resize);
    renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    root.remove(); ARC.open = false; window.ARC_ON = false; cfg.onClose?.();
  }

  /* Boucle : physique à pas fixe (1/60 s), pour que la voiture avance au même rythme que le chrono même si l'appareil affiche peu d'images */
  const VMAX = 95, A_LAT = 32, GRAV = 9.81, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let last = performance.now(), raf = 0, ghostS = 0, camYaw = 0, camY = 0; const tmp2 = new THREE.Vector3();
  player.rotation.order = ghost.rotation.order = "YXZ";
  function step(h, inp) {
    const [i, off] = nearest(car.x, car.z), onTrack = Math.abs(off) < W / 2 + 1.2, inGravel = Math.abs(off) > W / 2 + 3.5;
    const dir = Math.sin(car.h) * T[i].x + Math.cos(car.h) * T[i].z >= 0 ? 1 : -1, gr = grade(i) * dir;
    const vmax = onTrack ? VMAX : inGravel ? 24 : 45;
    // En montée la voiture perd de la vitesse, en descente elle en prend
    // Moteur : forte poussée à basse vitesse, qui s'annule à la vitesse de pointe ; sans gaz, frein moteur et air
    const a = (inp.thr ? 14 * (1 - (car.v / vmax) ** 2) : -(1.5 + 0.0009 * car.v * car.v)) - inp.brk * 38 - (onTrack ? 0 : 0.6 * Math.max(0, car.v - vmax)) - GRAV * gr;
    car.v = Math.max(0, car.v + a * h);
    steerS += (Math.max(-1.5, Math.min(1.5, inp.steer)) - steerS) * Math.min(1, h * 7);
    car.h += steerS * Math.min(1.6, A_LAT / Math.max(car.v, 8)) * Math.min(1, car.v / 6) * h;
    car.x += Math.sin(car.h) * car.v * h; car.z += Math.cos(car.h) * car.v * h;
    const lim = off > 0 ? RO[i] - 0.6 : -LO[i] - 0.6;
    if (Math.abs(off) > lim) { car.x -= L[i].x * Math.sign(off) * 1.2; car.z -= L[i].z * Math.sign(off) * 1.2; car.v *= 0.55; }
    let d = i - idx; if (d < -N / 2) d += N; if (d > N / 2) d -= N; progress += d; idx = i;
    if (progress > N / 2) halfway = true;
    car.i = i; car.gr = gr; car.dir = dir;
  }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const el = Math.min(0.5, Math.max(0, (now - last) / 1000)), dt = el; last = now;
    if (state === "pause") { draw(); return; }
    const inp = input();
    if (state === "race") {
      const n = Math.max(1, Math.ceil(el * 60)); for (let k = 0; k < n; k++) step(el / n, inp);
      const t = (now - t0) / 1000; q("lap").textContent = fmt(t);
      if (halfway && progress >= FIN) { finish(t); }
      else if (progress > 30) { const pi = Math.max(0, Math.min(FIN, progress)), delta = t - gT[Math.floor(pi)]; q("delta").textContent = fmtD(delta); dEl.className = "a-hud a-delta " + (delta < 0 ? "ahead" : "behind"); }
    }
    // Hauteur de la voiture : le relief de la piste à sa position
    car.y = hS(S[car.i] + (car.x - P[car.i].x) * T[car.i].x + (car.z - P[car.i].z) * T[car.i].z);
    // Fantôme : sur la case voisine de la grille, il rejoint la trajectoire en douceur
    const tg = state === "race" ? (now - t0) / 1000 : state === "end" ? Infinity : 0;
    const sG = Math.min(FIN * DS, ghostS = tg === Infinity ? ghostS : ghostAt(tg)), sAbs = START * DS + sG, uG = (sAbs % LEN) / LEN;
    const gp = curve.getPointAt(uG), gtan = curve.getTangentAt(uG), side = 2 * Math.max(0, 1 - sG / 150);
    ghost.position.set(gp.x - gtan.z * side, hS(sAbs), gp.z + gtan.x * side); ghost.rotation.set(-Math.atan(grade(Math.floor(sAbs / DS) % N)), Math.atan2(gtan.x, gtan.z), 0);
    ghost.visible = state !== "menu";
    // Voiture du joueur, inclinée dans les montées et descentes
    player.position.set(car.x, car.y, car.z); player.rotation.set(-Math.atan(car.gr || 0), car.h, 0);
    const spin = car.v * dt / 0.36; player.userData.wheels.forEach((w) => { w.spin.rotation.x += spin; if (w.front) w.g.rotation.y = steerS * 0.3; });
    // Caméra
    const fwd = tmp.set(Math.sin(car.h), 0, Math.cos(car.h));
    if (state !== "race" && state !== "pause") { camYaw = car.h; camY = car.y + 2.3; }
    if (state === "menu") { const a = now / 6000; camPos.set(car.x + Math.sin(a) * 8, car.y + 2.6, car.z + Math.cos(a) * 8); camLook.set(car.x, car.y + 0.5, car.z); }
    else if (view === 0) {
      // Caméra arrière à distance fixe : seul son angle suit la voiture avec un léger retard (avant, sa position traînait derrière et elle s'éloignait avec la vitesse)
      let dy = car.h - camYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; camYaw += dy * Math.min(1, dt * 8);
      const back = tmp2.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      camY += (car.y + 2.3 - camY) * Math.min(1, dt * 10);
      camPos.set(car.x, camY, car.z).addScaledVector(back, -6.6); camLook.set(car.x, car.y + 0.9 + (car.gr || 0) * 6, car.z).addScaledVector(back, 6); }
    else { camPos.set(car.x, car.y + 1.12, car.z).addScaledVector(fwd, -0.55); camLook.copy(camPos).addScaledVector(fwd, 30).setY(H[(car.i + car.dir * 10 + N) % N] + 1.0); }
    camera.position.copy(camPos); camera.lookAt(camLook);
    // Sensation de vitesse discrète : champ de vision +4° au plus, lissé
    const fovT = 62 + Math.min(4, car.v / 24); if (Math.abs(camera.fov - fovT) > 0.01) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
    sun.position.set(car.x - 60, car.y + 120, car.z + 40); sun.target.position.set(car.x, car.y, car.z);
    const kmh = Math.round(car.v * 3.6); q("spd").textContent = kmh; q("gear").textContent = car.v < 0.5 ? "N" : String(Math.min(8, 1 + Math.floor(kmh / 42)));
    drawMap(player.position, ghost.position);
    if (grassF) { grassF.t.value = now / 1000; grassF.update(car.i); }
    if (rain) { const pa = rain.geometry.attributes.position.array, d = rain.userData.drop, n = d.length / 3, fall = 26 * dt;
      for (let k = 0; k < n; k++) { d[k * 3 + 1] -= fall; if (d[k * 3 + 1] < -3) d[k * 3 + 1] += 26; const x = camPos.x + d[k * 3], y = camPos.y + d[k * 3 + 1] - 4, z = camPos.z + d[k * 3 + 2]; pa[k * 6] = x; pa[k * 6 + 1] = y; pa[k * 6 + 2] = z; pa[k * 6 + 3] = x - fwd.x * car.v * .012; pa[k * 6 + 4] = y + .9; pa[k * 6 + 5] = z - fwd.z * car.v * .012; }
      rain.geometry.attributes.position.needsUpdate = true; }
    draw();
  }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (composer) { const pr = renderer.getPixelRatio(); composer.setSize(innerWidth * pr, innerHeight * pr); } }
  addEventListener("resize", resize); resize(); reset();
  raf = requestAnimationFrame(tick);
  root.querySelector('[data-a="go"]').focus();
}

/* --- Sur le site : déclencheur caché et données du GP affiché --- */
const ARC_TAP = { n: 0, t: 0, timer: 0 };
function arcTap() {
  if (typeof NAV !== "undefined" && NAV.home) return;
  const now = performance.now(); if (now - ARC_TAP.t > 1600) ARC_TAP.n = 0; ARC_TAP.t = now; ARC_TAP.n++;
  const lights = document.querySelector("#hc-lights"); if (!lights) return;
  // Un feu par clic, au-dessus du tracé ; au 5e, extinction et départ
  lights.classList.add("on"); lights.querySelectorAll("i").forEach((l, i) => l.classList.toggle("lit", i < ARC_TAP.n));
  clearTimeout(ARC_TAP.timer);
  if (ARC_TAP.n >= 5) { ARC_TAP.n = 0; ARC_TAP.timer = setTimeout(() => { lights.querySelectorAll("i").forEach((l) => l.classList.remove("lit")); setTimeout(() => lights.classList.remove("on"), 200); arcFromGP(); }, 450); }
  else ARC_TAP.timer = setTimeout(() => { ARC_TAP.n = 0; lights.querySelectorAll("i").forEach((l) => l.classList.remove("lit")); lights.classList.remove("on"); }, 1600);
}
async function arcFromGP() {
  if (typeof RACE === "undefined" || !RACE || !finishers?.[0]) return;
  const w = finishers[0];
  let trace = null; try { trace = await hcTrace(w); } catch {}
  // Tracé sans altitude (ancien cache ou archive) : on tente de le reprendre avec le relief, sinon on joue à plat
  if (trace && !(trace[0]?.length >= 3)) try {
    const bl = bestLapOf(w), fr = bl && (await Promise.race([fetchTrace(w, bl), new Promise((ok) => setTimeout(() => ok(null), 4000))]));
    if (fr && fr.length >= 40 && fr.every((p) => p.z != null)) { trace = fr.map((p) => [Math.round(p.x), Math.round(p.y), Math.round(p.z)]); try { localStorage.setItem(`f1duel:v4:trace:${RACE.session_key}`, JSON.stringify(trace)); } catch {} }
  } catch {}
  let lap = null; w.laps.forEach((l) => { if (l && l.t && l.lap > 1 && (!lap || l.t < lap)) lap = l.t; });
  if (!trace || trace.length < 40 || !lap) { toast("Ce circuit n'est pas encore prêt pour le jeu."); return; }
  let len = 0; for (let i = 1; i < trace.length; i++) len += Math.hypot(trace[i][0] - trace[i - 1][0], trace[i][1] - trace[i - 1][1]) / 10;
  // Météo du vrai GP : piste mouillée si la pluie a été relevée sur une part notable de la course
  const wx = typeof PACK !== "undefined" && PACK?.data?.wx, wet = !!(wx && wx.n && wx.rain / wx.n >= .1);
  arcOpen({ trace, wet, ghostLap: lap, ghostName: w.last, ghostColor: w.color, circuit: RACE.circuit_short_name || gpName(RACE), len, recKey: `f1duel:arcade:${RACE.session_key}`,
    onWin: (t, o) => typeof pkArcadeWin === "function" ? pkArcadeWin(gpName(RACE) + " " + RACE.year, { sk: RACE.session_key, lvl: o.lvl, t, trace }) : "" });
}
if (typeof hcSvg === "function" && hcSvg()) hcSvg().addEventListener("click", arcTap);
// Code Konami (ordinateur), seulement sur une page de GP
{ const seq = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"]; let p = 0;
  addEventListener("keydown", (e) => { if (ARC.open || /input|textarea|select/i.test(e.target.tagName)) return; const k = e.key.toLowerCase(); p = k === seq[p] ? p + 1 : k === seq[0] ? 1 : 0; if (p === seq.length) { p = 0; if (typeof NAV === "undefined" || !NAV.home) arcFromGP(); } }); }
