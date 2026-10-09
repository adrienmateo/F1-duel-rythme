
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
function arcLoadSet() { const d = { sens: 1, mode: "boutons", inv: false }; try { const v = JSON.parse(localStorage.getItem(ARC.setKey)); if (v) return { sens: +v.sens || 1, mode: v.mode === "inclinaison" ? "inclinaison" : "boutons", inv: !!v.inv }; } catch {} return d; }
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

/* --- Le jeu --- */
async function arcOpen(cfg) {
  if (ARC.open) return;
  let THREE;
  try { THREE = await arcThree(); } catch { (window.toast || console.warn)("Le jeu n'a pas pu se charger. Vérifie ta connexion."); return; }
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
    <div class="a-tiles"><div class="a-tile"><small>CIRCUIT</small><b>${esc2(cfg.circuit.toUpperCase())}</b><span>vrai tracé, ${(cfg.len / 1000).toFixed(1).replace(".", ",")} km</span></div>
      <div class="a-tile"><small>FANTÔME</small><b style="color:${cfg.ghostColor}">${esc2(cfg.ghostName.toUpperCase())}</b><span>meilleur tour ${fmt(cfg.ghostLap)}</span></div>
      <div class="a-tile"><small>TON RECORD</small><b data-k="rec">${best ? fmt(best) : "—"}</b><span>gardé dans ce navigateur</span></div></div>
    <p class="a-sub" data-k="help"></p>
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
    <p class="a-note">Clavier : clique sur « + » puis appuie sur la touche voulue. Clique sur une touche pour la retirer.</p>
    <div class="a-row"><button class="a-btn" data-a="setok">OK</button><button class="a-btn ghost" data-a="setreset">Touches par défaut</button></div>
  </div></div>
  <div class="a-screen" data-s="pause" hidden><div class="a-card"><h2 class="a-logo">PAUSE</h2><div class="a-row"><button class="a-btn" data-a="resume">REPRENDRE</button><button class="a-btn ghost" data-a="restart">Recommencer</button><button class="a-btn ghost" data-a="set">Commandes</button><button class="a-btn ghost" data-a="quit">Retour au GP</button></div></div></div>
  <div class="a-screen" data-s="end" hidden><div class="a-card">
    <h2 class="a-big" data-k="etitle"></h2>
    <div class="a-tiles"><div class="a-tile"><small>TON TOUR</small><b data-k="eyou"></b></div><div class="a-tile"><small>${esc2(cfg.ghostName.toUpperCase())} (FANTÔME)</small><b data-k="eghost"></b></div></div>
    <div class="a-diff" data-k="ediff"></div>
    <div class="a-unlock" data-k="unlock" hidden></div>
    <div class="a-row"><button class="a-btn" data-a="restart">REJOUER</button><button class="a-btn ghost" data-a="quit">Retour au GP</button></div>
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
  const S = P.map((_, i) => i * LEN / N);

  /* Rendu */
  const canvas = root.querySelector(".arc-gl");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xb9cde6, 350, 1700);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x46603a, 0.8));
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.0); sun.position.set(-120, 220, 80); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 10, far: 500 }); scene.add(sun, sun.target);
  { const g = new THREE.SphereGeometry(3000, 24, 12), col = [], c1 = new THREE.Color(0x2f6fd1), c2 = new THREE.Color(0xcfe0f2);
    for (let i = 0; i < g.attributes.position.count; i++) { const y = g.attributes.position.getY(i) / 3000; const c = c2.clone().lerp(c1, Math.max(0, Math.min(1, y * 2.2))); col.push(c.r, c.g, c.b); }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }))); }
  const canvasTex = (w, h, draw, rep) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); t.anisotropy = 8; t.encoding = THREE.sRGBEncoding; return t; };
  const noise = (c, w, h, base, amp, n) => { c.fillStyle = base; c.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (Math.random() - .5) * amp; c.fillStyle = `rgba(${v > 0 ? "255,255,255" : "0,0,0"},${Math.abs(v)})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
  const asphalt = canvasTex(256, 256, (c, w, h) => { noise(c, w, h, "#45484e", .22, 9000); c.fillStyle = "rgba(20,20,22,.25)"; c.fillRect(w * .42, 0, w * .16, h); });
  const grass = canvasTex(256, 256, (c, w, h) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? "#4f8f3a" : "#5a9c42"; c.fillRect(0, i * h / 8, w, h / 8); } for (let i = 0; i < 7000; i++) { c.fillStyle = `rgba(${Math.random() > .5 ? "30,70,20" : "140,190,90"},${Math.random() * .25})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 2); } }, [120, 120]);
  const gravel = canvasTex(128, 128, (c, w, h) => noise(c, w, h, "#cdb98f", .35, 5000));
  const crowd = canvasTex(128, 64, (c, w, h) => { c.fillStyle = "#3a3f4a"; c.fillRect(0, 0, w, h); const cols = ["#8a3b3b", "#c9ccd2", "#3d5f94", "#a8902e", "#2f8a7c", "#9a5a2a"]; for (let i = 0; i < 500; i++) { c.fillStyle = cols[i % cols.length]; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } });
  { const g = new THREE.PlaneGeometry(6000, 6000); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: grass })); m.position.y = -0.05; m.receiveShadow = true; scene.add(m); }
  function strip(o1, o2, y, mat, filter, vScale = 8) {
    const pos = [], uv = [], idx = []; let open = false;
    for (let k = 0; k <= N; k++) {
      const i = k % N, ok = filter ? filter(i) : true;
      const a = P[i].clone().addScaledVector(L[i], typeof o1 === "function" ? o1(i) : o1), b = P[i].clone().addScaledVector(L[i], typeof o2 === "function" ? o2(i) : o2);
      if (ok) { const n = pos.length / 3; pos.push(a.x, y, a.z, b.x, y, b.z); uv.push(0, S[i] / vScale, 1, S[i] / vScale); if (open) idx.push(n - 2, n, n - 1, n - 1, n, n + 1); open = true; } else open = false;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    mat.side = THREE.DoubleSide; const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m);
  }
  const sideOf = (i) => Math.sign(K[i]) || 1, hard = (i) => Math.abs(K[i]) > 0.012;
  strip(-W / 2 - 3.5, W / 2 + 3.5, 0.0, new THREE.MeshLambertMaterial({ color: 0x5d6168 }));
  strip(-W / 2, W / 2, 0.02, new THREE.MeshLambertMaterial({ map: asphalt }));
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
  function wall(off, h, mat) {
    const pos = [], idx = []; let open = false;
    for (let k = 0; k <= N; k++) { const i = k % N, ok = clear(i, off[i]), a = P[i].clone().addScaledVector(L[i], off[i]);
      if (ok) { const n = pos.length / 3; if (open && Math.hypot(a.x - pos[n * 3 - 6], a.z - pos[n * 3 - 4]) > 6) open = false; pos.push(a.x, 0, a.z, a.x, h, a.z); if (open) idx.push(n - 2, n, n - 1, n - 1, n, n + 1); open = true; } else open = false; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = true; scene.add(m);
  }
  const armco = new THREE.MeshLambertMaterial({ color: 0xb9bec7, side: THREE.DoubleSide });
  wall(RO, 1.0, armco); wall(LO, 1.0, armco);
  { const chk = canvasTex(64, 8, (c) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { c.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4"; c.fillRect(x * 4, y * 4, 4, 4); } });
    const g = new THREE.PlaneGeometry(W, 1.6); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: chk })); m.position.copy(P[0]).y = 0.05; m.rotation.y = Math.atan2(T[0].x, T[0].z); scene.add(m);
    const gantry = new THREE.Group(), steel = new THREE.MeshLambertMaterial({ color: 0x30343c }), post = new THREE.BoxGeometry(0.5, 7, 0.5);
    [-1, 1].forEach((s) => { const p = new THREE.Mesh(post, steel); p.position.set(s * (W / 2 + 2), 3.5, 0); p.castShadow = true; gantry.add(p); });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4.5, 1.2, 0.8), steel); beam.position.y = 6.8; gantry.add(beam);
    gantry.position.copy(P[3]); gantry.rotation.y = Math.atan2(T[3].x, T[3].z); scene.add(gantry); }
  { const mat = new THREE.MeshLambertMaterial({ map: crowd }), roof = new THREE.MeshLambertMaterial({ color: 0xe9ecf1 }), struct = new THREE.MeshLambertMaterial({ color: 0x8a9099 });
    for (let k = -60; k <= 60; k += 20) {
      const i = (k + N) % N, base = P[i].clone().addScaledVector(L[i], -(W / 2 + 26));
      if (!clear(i, -(W / 2 + 26)) || !clear(i, -(W / 2 + 40))) continue;
      const gs = new THREE.Group();
      for (let r = 0; r < 6; r++) { const st = new THREE.Mesh(new THREE.BoxGeometry(56, 1.2, 2.2), mat); st.position.set(0, 0.6 + r * 1.2, -r * 2.2); gs.add(st); }
      const back = new THREE.Mesh(new THREE.BoxGeometry(56, 9, 0.6), struct); back.position.set(0, 4.5, -13.5); gs.add(back);
      const rf = new THREE.Mesh(new THREE.BoxGeometry(58, 0.4, 16), roof); rf.position.set(0, 10.5, -6.5); rf.rotation.x = 0.08; gs.add(rf);
      gs.position.copy(base); gs.lookAt(P[i].x, 0, P[i].z); gs.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); scene.add(gs);
    } }
  { const cell = 40, grid = new Set(); P.forEach((p) => grid.add(`${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`));
    const near = (x, z) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (grid.has(`${Math.floor(x / cell) + a},${Math.floor(z / cell) + b}`)) return true; return false; };
    const box = new THREE.Box3().setFromPoints(P), n = 700;
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 11, 6), new THREE.MeshLambertMaterial({ color: 0x2f6b34, flatShading: true }), n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.5, 3, 5), new THREE.MeshLambertMaterial({ color: 0x5b4330 }), n);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = new THREE.Vector3(); let c = 0, tries = 0;
    while (c < n && tries < 20000) { tries++;
      const x = box.min.x - 250 + Math.random() * (box.max.x - box.min.x + 500), z = box.min.z - 250 + Math.random() * (box.max.z - box.min.z + 500);
      if (near(x, z)) continue; const k = 0.7 + Math.random() * 0.8; s.set(k, k * (0.8 + Math.random() * 0.5), k);
      m.compose(new THREE.Vector3(x, 5.5 * s.y + 2, z), qq, s); crowns.setMatrixAt(c, m); m.compose(new THREE.Vector3(x, 1.5, z), qq, new THREE.Vector3(k, 1, k)); trunks.setMatrixAt(c, m); c++; }
    crowns.count = trunks.count = c; crowns.castShadow = true; scene.add(crowns, trunks);
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x5e7f63, flatShading: true });
    for (let k = 0; k < 26; k++) { const a = k / 26 * Math.PI * 2, r = 1500 + Math.random() * 400, h = 120 + Math.random() * 200; const hill = new THREE.Mesh(new THREE.ConeGeometry(240 + Math.random() * 200, h, 7), hillMat); hill.position.set(Math.cos(a) * r, h / 2 - 5, Math.sin(a) * r); scene.add(hill); } }

  const player = arcCar(THREE, 0xd8231f, 0xf4f4f4, false, 1); scene.add(player);
  const ghost = arcCar(THREE, cfg.ghostColor, cfg.ghostColor, true); scene.add(ghost);

  /* Fantôme : profil de vitesse tiré du tracé, calé sur le vrai meilleur tour ; départ arrêté */
  const START = N - 6, FIN = N + 6;          // la grille est 18 m avant la ligne ; un tour = de la grille à la ligne, +1 tour
  const gV = new Float32Array(N), gT = new Float32Array(FIN + 1);
  { const A_LAT = 26, A_ACC = 9, A_BRK = 30, VMAX = 92, ds = LEN / N;
    for (let i = 0; i < N; i++) gV[i] = Math.min(VMAX, Math.sqrt(A_LAT / Math.max(1e-4, Math.abs(K[i]) / 3)));
    for (let r = 0; r < 2; r++) { for (let i = 1; i < N * 2; i++) { const a = i % N, b = (i - 1) % N; gV[a] = Math.min(gV[a], Math.sqrt(gV[b] ** 2 + 2 * A_ACC * ds)); }
      for (let i = N * 2; i > 0; i--) { const a = i % N, b = (i + 1) % N; gV[a] = Math.min(gV[a], Math.sqrt(gV[b] ** 2 + 2 * A_BRK * ds)); } }
    let t = 0; for (let i = 0; i < N; i++) t += ds / gV[i];
    const k = t / cfg.ghostLap; for (let i = 0; i < N; i++) gV[i] *= k;
    let v = 0; gT[0] = 0; for (let j = 0; j < FIN; j++) { const v1 = Math.min(gV[(START + j) % N], Math.sqrt(v * v + 2 * A_ACC * k * k * ds)); gT[j + 1] = gT[j] + 2 * ds / (v + v1 || 1); v = v1; } }
  const GHOST_TOTAL = gT[FIN];
  // Position continue du fantôme à l'instant t (distance interpolée, pas de saut d'un point à l'autre)
  const ghostAt = (t) => { let lo = 0, hi = FIN; while (lo < hi) { const m = (lo + hi) >> 1; if (gT[m] < t) lo = m + 1; else hi = m; } const i = Math.max(0, Math.min(FIN - 1, lo - 1)), f = Math.max(0, Math.min(1, (t - gT[i]) / ((gT[i + 1] - gT[i]) || 1))); return (i + f) * LEN / N; };

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
    root.querySelector(set.mode === "inclinaison" ? "#arc-m-i" : "#arc-m-b").checked = true; root.querySelector("#arc-inv").checked = set.inv;
  }
  let setFrom = "start";
  const openSet = () => { setFrom = state === "pause" ? "pause" : "start"; renderSet(); show("set"); };
  const closeSet = () => { capture = null; show(setFrom); };
  root.querySelector("#arc-sens").addEventListener("input", (e) => { set.sens = +e.target.value; q("sensv").textContent = `×${set.sens.toFixed(2).replace(".", ",")}`; saveSet(); });
  root.querySelectorAll('input[name="arc-mode"]').forEach((r) => r.addEventListener("change", () => { set.mode = r.value; saveSet(); renderPads(); keyHelp(); }));
  root.querySelector("#arc-inv").addEventListener("change", (e) => { set.inv = e.target.checked; saveSet(); });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.add) { capture = b.dataset.add; renderSet(); return; }
    if (b.dataset.rm) { const [a, i] = b.dataset.rm.split(":"); if (keys[a].length > 1) { keys[a].splice(+i, 1); saveKeys(); } renderSet(); return; }
    if (b.dataset.a === "go" || b.dataset.a === "restart") tiltOn();
    ({ go: start, restart: start, set: openSet, setok: closeSet, setreset: () => { keys = JSON.parse(JSON.stringify(ARC_DEFAULT_KEYS)); saveKeys(); renderSet(); }, pause, resume, quit })[b.dataset.a]?.();
  });

  /* Partie */
  let state = "menu", view = 0, idx = START, progress = 0, halfway = false, t0 = 0, pausedAt = 0, steerS = 0, timers = [];
  const car = { x: 0, z: 0, h: 0, v: 0 };
  const reset = () => { const p = P[START]; car.x = p.x + L[START].x * -2; car.z = p.z + L[START].z * -2; car.h = Math.atan2(T[START].x, T[START].z); car.v = 0; idx = START; progress = 0; halfway = false; steerS = 0; };
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
    q("etitle").textContent = win ? `TU BATS ${cfg.ghostName.toUpperCase()} !` : "PRESQUE !";
    q("eyou").textContent = fmt(t); q("eghost").textContent = fmt(GHOST_TOTAL);
    q("ediff").textContent = win ? `${fmtD(d)} sur ${cfg.ghostName}` : `Raté de ${Math.abs(d).toFixed(2).replace(".", ",")} s`; q("ediff").style.color = win ? "var(--arc-good)" : "var(--arc-bad)";
    if (!best || t < best) { best = t; try { localStorage.setItem(cfg.recKey, String(t)); } catch {} q("rec").textContent = fmt(t); }
    const u = q("unlock"); u.hidden = true;
    if (win && cfg.onWin) { const r = cfg.onWin(t); if (r) { u.innerHTML = r; u.hidden = false; } }
    show("end"); root.querySelector('[data-s="end"] [data-a="restart"]').focus();
  }
  function quit() {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout);
    removeEventListener("deviceorientation", onTilt); removeEventListener("keydown", onKey, true); removeEventListener("keyup", onKeyUp, true); removeEventListener("resize", resize);
    renderer.dispose(); scene.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    root.remove(); ARC.open = false; window.ARC_ON = false; cfg.onClose?.();
  }

  /* Boucle */
  const VMAX = 95, A_LAT = 32, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmp = new THREE.Vector3();
  let last = performance.now(), raf = 0, ghostS = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === "pause") { renderer.render(scene, camera); return; }
    const inp = input();
    if (state === "race") {
      const [i, off] = nearest(car.x, car.z), onTrack = Math.abs(off) < W / 2 + 1.2, inGravel = Math.abs(off) > W / 2 + 3.5;
      const vmax = onTrack ? VMAX : inGravel ? 24 : 45;
      const a = inp.thr * 13 * (1 - car.v / vmax) - inp.brk * 38 - 0.0009 * car.v * car.v - (onTrack ? 0 : 0.6 * Math.max(0, car.v - vmax));
      car.v = Math.max(0, car.v + a * dt);
      steerS += (Math.max(-1.5, Math.min(1.5, inp.steer)) - steerS) * Math.min(1, dt * 7);
      car.h += steerS * Math.min(1.6, A_LAT / Math.max(car.v, 8)) * Math.min(1, car.v / 6) * dt;
      car.x += Math.sin(car.h) * car.v * dt; car.z += Math.cos(car.h) * car.v * dt;
      const lim = off > 0 ? RO[i] - 0.6 : -LO[i] - 0.6;
      if (Math.abs(off) > lim) { car.x -= L[i].x * Math.sign(off) * 1.2; car.z -= L[i].z * Math.sign(off) * 1.2; car.v *= 0.55; }
      let d = i - idx; if (d < -N / 2) d += N; if (d > N / 2) d -= N; progress += d; idx = i;
      if (progress > N / 2) halfway = true;
      const t = (now - t0) / 1000; q("lap").textContent = fmt(t);
      if (halfway && progress >= FIN) { finish(t); }
      else if (progress > 30) { const pi = Math.max(0, Math.min(FIN, progress)), delta = t - gT[Math.floor(pi)]; q("delta").textContent = fmtD(delta); dEl.className = "a-hud a-delta " + (delta < 0 ? "ahead" : "behind"); }
    }
    // Fantôme : sur la case voisine de la grille, il rejoint la trajectoire en douceur
    const tg = state === "race" ? (now - t0) / 1000 : state === "end" ? Infinity : 0;
    const sG = Math.min(FIN * LEN / N, ghostS = tg === Infinity ? ghostS : ghostAt(tg)), uG = (((START * LEN / N) + sG) % LEN) / LEN;
    const gp = curve.getPointAt(uG), gtan = curve.getTangentAt(uG), side = 2 * Math.max(0, 1 - sG / 150);
    ghost.position.set(gp.x - gtan.z * side, 0, gp.z + gtan.x * side); ghost.rotation.y = Math.atan2(gtan.x, gtan.z);
    ghost.visible = state !== "menu";
    // Voiture du joueur
    player.position.set(car.x, 0, car.z); player.rotation.y = car.h;
    const spin = car.v * dt / 0.36; player.userData.wheels.forEach((w) => { w.spin.rotation.x += spin; if (w.front) w.g.rotation.y = steerS * 0.3; });
    // Caméra
    const fwd = tmp.set(Math.sin(car.h), 0, Math.cos(car.h));
    if (state === "menu") { const a = now / 6000; camPos.set(car.x + Math.sin(a) * 8, 2.6, car.z + Math.cos(a) * 8); camLook.set(car.x, 0.5, car.z); }
    else if (view === 0) { camPos.lerp(new THREE.Vector3(car.x, 2.3, car.z).addScaledVector(fwd, -6.6), Math.min(1, dt * 6)); camLook.set(car.x, 0.9, car.z).addScaledVector(fwd, 6); }
    else { camPos.set(car.x, 1.12, car.z).addScaledVector(fwd, -0.55); camLook.copy(camPos).addScaledVector(fwd, 30).setY(1.0); }
    camera.position.copy(camPos); camera.lookAt(camLook);
    camera.fov = 62 + Math.min(14, car.v / 7); camera.updateProjectionMatrix();
    sun.position.set(car.x - 60, 120, car.z + 40); sun.target.position.set(car.x, 0, car.z);
    const kmh = Math.round(car.v * 3.6); q("spd").textContent = kmh; q("gear").textContent = car.v < 0.5 ? "N" : String(Math.min(8, 1 + Math.floor(kmh / 42)));
    drawMap(player.position, ghost.position);
    renderer.render(scene, camera);
  }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
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
  let lap = null; w.laps.forEach((l) => { if (l && l.t && l.lap > 1 && (!lap || l.t < lap)) lap = l.t; });
  if (!trace || trace.length < 40 || !lap) { toast("Ce circuit n'est pas encore prêt pour le jeu."); return; }
  let len = 0; for (let i = 1; i < trace.length; i++) len += Math.hypot(trace[i][0] - trace[i - 1][0], trace[i][1] - trace[i - 1][1]) / 10;
  arcOpen({ trace, ghostLap: lap, ghostName: w.last, ghostColor: w.color, circuit: RACE.circuit_short_name || gpName(RACE), len, recKey: `f1duel:arcade:${RACE.session_key}`,
    onWin: () => typeof pkArcadeWin === "function" ? pkArcadeWin(gpName(RACE) + " " + RACE.year) : "" });
}
if (typeof hcSvg === "function" && hcSvg()) hcSvg().addEventListener("click", arcTap);
// Code Konami (ordinateur), seulement sur une page de GP
{ const seq = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"]; let p = 0;
  addEventListener("keydown", (e) => { if (ARC.open || /input|textarea|select/i.test(e.target.tagName)) return; const k = e.key.toLowerCase(); p = k === seq[p] ? p + 1 : k === seq[0] ? 1 : 0; if (p === seq.length) { p = 0; if (typeof NAV === "undefined" || !NAV.home) arcFromGP(); } }); }
