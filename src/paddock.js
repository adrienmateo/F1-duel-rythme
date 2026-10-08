
/* ======================= Le paddock : des pilotes à attraper (easter egg) ======================= */
// De temps en temps (toutes les 2 minutes environ), un pilote agrippe le bas de l'écran, passe la tête,
// regarde à gauche puis à droite et redescend (3 s). Attrapé (clic ou toucher) : il grossit au centre
// avec « Bravo ! » et rejoint la collection, gardée dans ce navigateur. Sur 20 apparitions : 16 pilotes
// de la grille (ceux qu'on n'a pas encore sortent plus souvent), 2 vainqueurs dorés du GP affiché,
// 1 pilote de la safety car (seulement sur un GP avec safety car), 1 commissaire ou mécanicien.
// Mode test : ouvrir le site avec ?pilote à la fin de l'adresse fait passer un pilote toutes les 8 s environ
const PK_TEST = new URLSearchParams(location.search).has("pilote");
const PK = { key: "f1duel:paddock", timer: 0, busy: false, uid: 0, cur: null, steps: 0, hold: false };
const PK_RARES = {
  sc: { code: "SC", name: "Le pilote de la safety car", color: "#F5C400", number: "SC", how: "Seulement sur un GP avec safety car." },
  marshal: { code: "CDP", name: "Le commissaire de piste", color: "#F28C28", number: "", how: "Drapeau à la main, au bord de la piste." },
  mech: { code: "MEC", name: "Le mécanicien", color: "#3a3f48", number: "", how: "Toujours prêt pour l'arrêt aux stands." },
};
function pkLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(PK.key));
    if (v && v.drivers) {
      // Nettoyage : entrées fantômes créées par d'anciens tests (pilote sans nom, spécial inconnu)
      const drivers = Object.fromEntries(Object.entries(v.drivers).filter(([k, e]) => k && k !== "undefined" && e && e.name));
      const rares = Object.fromEntries(Object.entries(v.rares || {}).filter(([k]) => PK_RARES[k]));
      const gold = Object.fromEntries(Object.entries(v.gold || {}).filter(([k, e]) => k && k !== "undefined" && e && e.name));
      return { drivers, gold, rares };
    }
  } catch {}
  return { drivers: {}, gold: {}, rares: {} };
}
function pkSave(c) { try { localStorage.setItem(PK.key, JSON.stringify(c)); } catch {} }
const pkShade = (hex, k) => { const h = String(hex || "#888888").replace("#", ""), n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16) || 0; const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return "#" + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join(""); };

/* --- La figurine (même dessin que la maquette) --- */
function figSvg({ color = "#888", number = "", pose = "stand", gold = false, ghost = false, label = "" } = {}) {
  const id = "pkv" + ++PK.uid;
  const c = ghost ? "#cfd3d9" : color, dk = ghost ? "#b8bdc4" : pkShade(color, 0.45), hel = ghost ? "#dfe2e6" : gold ? "#E3B341" : "#f6f7f9";
  const num = ghost ? "" : esc(String(number)), ink = "#14161a", o = 'stroke="#1b1e24" stroke-linejoin="round"';
  const wave = pose === "wave" && !ghost;
  const right = wave
    ? `<path d="M83 88 Q93 84 98 72 L102 60 L95 57 L90 70 Q87 78 82 82 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M92 66 L95 67 L91 77 L88 76 Z" fill="#fff"/><path d="M94 56 L103 59 L102 63 L93 60 Z" fill="${c}" ${o} stroke-width="1.4"/><path d="M95 56 L94 46 Q94 43 96.5 43.5 Q98 44 98 47 L98.5 52 L100 44 Q100.5 41 103 42 Q105 43 104 46 L102.5 55 Q103 59 99 59 Z" fill="#2a2d33" ${o} stroke-width="1.3"/>`
    : `<path d="M83 88 Q91 92 92 104 L93 118 L85 119 L83 104 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M87 96 L90 96 L92 116 L89 116 Z" fill="#fff"/><path d="M84 118 L94 117 L94 121 L84 122 Z" fill="${c}" ${o} stroke-width="1.4"/><path d="M84 122 Q84 131 90 131 Q96 130 94 121 Z" fill="#2a2d33" ${o} stroke-width="1.4"/>`;
  const sparks = gold && !ghost ? `<path d="M12 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#E3B341"/><path d="M104 18 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" fill="#E3B341"/><path d="M108 92 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" fill="#E3B341"/>` : "";
  return `<svg class="pk-fig" viewBox="0 0 120 172" role="img" aria-label="${esc(label || "Figurine de pilote")}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a5d86"/><stop offset=".5" stop-color="#0f1218"/><stop offset="1" stop-color="#5a3870"/></linearGradient></defs>
<ellipse cx="60" cy="166" rx="30" ry="4.5" fill="#000" opacity=".16"/>
<path d="M41 150 L58 150 L59 160 Q49 163 39 160 Q38 154 41 150 Z" fill="#fff" ${o} stroke-width="1.6"/><path d="M62 150 L79 150 Q82 154 81 160 Q71 163 61 160 Z" fill="#fff" ${o} stroke-width="1.6"/><path d="M39.5 158 Q49 161 58.8 158 M61.2 158 Q71 161 80.5 158" fill="none" stroke="${c}" stroke-width="2"/>
<path d="M42 116 L59 116 L58 151 L42 151 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M61 116 L78 116 L78 151 L62 151 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M44 117 L47 117 L47 150 L44 150 Z M73 117 L76 117 L76 150 L73 150 Z" fill="#fff"/><path d="M50 132 L57 132 L57 136 L50 136 Z M63 132 L70 132 L70 136 L63 136 Z" fill="#fff" opacity=".9"/><path d="M42 141 L58 141 M62 141 L78 141" stroke="${dk}" stroke-width="1.2"/>
<path d="M37 88 Q29 92 28 104 L27 118 L35 119 L37 104 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M30 96 L33 96 L31 116 L28 116 Z" fill="#fff"/><path d="M26 117 L36 118 L36 122 L26 121 Z" fill="${c}" ${o} stroke-width="1.4"/><path d="M26 121 Q24 130 30 131 Q36 131 36 122 Z" fill="#2a2d33" ${o} stroke-width="1.4"/>
${right}
<path d="M38 86 Q48 80 60 80 Q72 80 82 86 Q86 89 85 96 L82 118 L38 118 L35 96 Q34 89 38 86 Z" fill="${c}" ${o} stroke-width="1.6"/><path d="M37 92 L42 90 L42 117 L38 117 Z M83 92 L78 90 L78 117 L82 117 Z" fill="#fff"/><path d="M38 112 L82 112 L82 118 L38 118 Z" fill="${dk}"/><rect x="56" y="113.2" width="8" height="3.6" rx="1" fill="#c9ccd2"/><path d="M60 86 L60 112" stroke="${dk}" stroke-width="1" opacity=".8"/>
<rect x="40" y="105" width="9" height="3.4" rx="1" fill="#fff" opacity=".85"/><rect x="71" y="105" width="9" height="3.4" rx="1" fill="#fff" opacity=".85"/><rect x="47" y="88" width="26" height="16" rx="3.5" fill="#fff" stroke="#1b1e24" stroke-width="1.2"/><text x="60" y="100.6" text-anchor="middle" font-size="${String(num).length > 2 ? 10 : 13}" font-weight="800" fill="${ink}" font-family="Archivo, Arial Narrow, sans-serif">${num}</text>
<path d="M46 80 Q60 76 74 80 L73 86 Q60 83 47 86 Z" fill="${dk}" stroke="#1b1e24" stroke-width="1.2"/><path d="M40 82 Q60 72 80 82 L77 88 Q73 85 70 85 L68 92 L64 92 L65 84 L55 84 L56 92 L52 92 L50 85 Q47 85 43 88 Z" fill="#2b2e35" ${o} stroke-width="1.2"/>
<path d="M28 46 Q27 12 60 10 Q93 12 92 46 Q92 64 84 73 Q73 79 60 79 Q47 79 36 73 Q28 64 28 46 Z" fill="${hel}" ${o} stroke-width="1.8"/><path d="M33 30 Q45 13 60 12 Q75 13 87 30 Q74 22 60 23 Q46 22 33 30 Z" fill="${c}"/><path d="M30 52 Q36 62 44 60 L40 72 Q31 66 30 52 Z M90 52 Q84 62 76 60 L80 72 Q89 66 90 52 Z" fill="${c}"/><path d="M54 9 L66 9 L65 4 Q60 1.5 55 4 Z" fill="${dk}" ${o} stroke-width="1.2"/>
<path d="M32 38 Q60 29 88 38 L87 53 Q60 60 33 53 Z" fill="url(#${id})" ${o} stroke-width="1.6"/><path d="M38 41 Q50 36 64 36" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" opacity=".6"/><path d="M70 37.5 Q76 38 80 39.5" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".4"/><rect x="86" y="42" width="6" height="5" rx="1.5" fill="#e9eaee" stroke="#1b1e24" stroke-width="1"/>
<path d="M44 64 Q60 70 76 64 L74 72 Q60 76 46 72 Z" fill="${dk}" ${o} stroke-width="1.2"/><path d="M50 67 L54 70 M58 68.5 L58 72 M66 67 L62 70" stroke="#5a5e66" stroke-width="1.1" stroke-linecap="round"/><path d="M40 24 Q44 20 50 18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>
${sparks}${ghost ? `<text x="60" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="#fff" font-family="Archivo, sans-serif">?</text>` : ""}</svg>`;
}
/* --- Le pilote qui passe la tête : les mains, puis le casque --- */
function peekSvg({ color, number, gold }) {
  const id = "pkv" + ++PK.uid, cid = "pkc" + PK.uid, dk = pkShade(color, 0.45), hel = gold ? "#E3B341" : "#f6f7f9", o = 'stroke="#1b1e24"';
  const f = (x, y, h) => `<rect x="${x}" y="${y}" width="6.4" height="${h}" rx="3.2" fill="#2a2d33" ${o} stroke-width="1"/>`;
  return `<svg viewBox="0 0 140 84" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4a6b"/><stop offset=".45" stop-color="#11141b"/><stop offset="1" stop-color="#4b2f5e"/></linearGradient><clipPath id="${cid}"><rect x="-30" y="-200" width="200" height="284"/></clipPath></defs>
<g clip-path="url(#${cid})"><g class="pk-head">
<path d="M48 74 Q60 70 70 70 Q80 70 92 74 L94 90 L46 90 Z" fill="${color}" ${o} stroke-width="1.5"/><path d="M50 74 Q70 66 90 74 L88 80 Q70 75 52 80 Z" fill="#2b2e35" ${o} stroke-width="1.2"/>
<path d="M42 50 Q41 20 70 18 Q99 20 98 50 Q98 64 91 71 Q81 76 70 76 Q59 76 49 71 Q42 64 42 50 Z" fill="${hel}" ${o} stroke-width="1.7"/><path d="M46 35 Q57 21 70 20 Q83 21 94 35 Q83 28 70 29 Q57 28 46 35 Z" fill="${color}"/><path d="M44 56 Q49 64 56 62 L53 71 Q45 66 44 56 Z M96 56 Q91 64 84 62 L87 71 Q95 66 96 56 Z" fill="${color}"/><path d="M65 17.5 L75 17.5 L74 13 Q70 11 66 13 Z" fill="${dk}" ${o} stroke-width="1.1"/>
${number ? `<rect x="61" y="23" width="18" height="10" rx="2.6" fill="#fff" ${o} stroke-width=".9"/><text x="70" y="31" text-anchor="middle" font-size="${String(number).length > 2 ? 7 : 8.5}" font-weight="800" fill="#14161a" font-family="Archivo, Arial Narrow, sans-serif">${esc(String(number))}</text>` : ""}
<path d="M45 42 Q70 34 95 42 L94 56 Q70 62 46 56 Z" fill="url(#${id})" ${o} stroke-width="1.5"/><path d="M51 45 Q61 41 74 41" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".6"/><rect x="93" y="46" width="5" height="4.5" rx="1.2" fill="#e9eaee" ${o} stroke-width=".9"/><path d="M55 66 Q70 71 85 66 L83 73 Q70 77 57 73 Z" fill="${dk}" ${o} stroke-width="1.1"/>
</g><g class="pk-hands">
<rect x="11" y="76" width="28" height="14" rx="3" fill="${color}" ${o} stroke-width="1.4"/><rect x="101" y="76" width="28" height="14" rx="3" fill="${color}" ${o} stroke-width="1.4"/><path d="M12 82 L38 82 M102 82 L128 82" stroke="#fff" stroke-width="2"/>
${f(12, 68, 14)}${f(18.8, 66.5, 15.5)}${f(25.6, 67, 15)}${f(32.4, 69, 13)}${f(101.6, 69, 13)}${f(108, 67, 15)}${f(114.8, 66.5, 15.5)}${f(121.6, 68, 14)}
</g></g></svg>`;
}

/* --- Qui passe ? --- */
function pkPick() {
  const col = pkLoad(), grid = drivers.filter((d) => d.code && !String(d.code).match(/^\d+$/));
  if (!grid.length) return null;
  const r = Math.random() * 20, w = finishers[0];
  const hasSc = NEUTRAL.some((n) => n.kind === "SC" || n.kind === "VSC");
  if (r < 2 && w && RACE) return { kind: "gold", key: String(RACE.session_key), code: w.code, name: w.last, team: w.team, color: w.color, number: String(w.dn), gold: true, gp: `${gpName(RACE)} ${RACE.year}` };
  if (r < 3 && hasSc) return { kind: "rare", key: "sc", ...PK_RARES.sc };
  if (r < 4) { const k = Math.random() < 0.5 ? "marshal" : "mech"; return { kind: "rare", key: k, ...PK_RARES[k] }; }
  // Pilote de la grille : ceux qu'on n'a pas encore ont trois fois plus de chances
  const ws = grid.map((d) => (col.drivers[d.code] ? 1 : 3)), tot = ws.reduce((a, b) => a + b, 0);
  let x = Math.random() * tot, d = grid[0];
  for (let i = 0; i < grid.length; i++) { x -= ws[i]; if (x <= 0) { d = grid[i]; break; } }
  return { kind: "driver", key: d.code, code: d.code, name: d.last, team: d.team, color: d.color, number: String(d.dn) };
}
const pkOk = () => (!reduce || PK_TEST) && !NAV.home && !NAV.champ && document.visibilityState === "visible" && !PK.busy && drivers.length && $("#overlay")?.hidden !== false && !document.querySelector(".pk-modal");
function pkSchedule(ms) { clearTimeout(PK.timer); PK.timer = setTimeout(() => { if (pkOk()) pkShow(); else pkSchedule(PK_TEST ? 2000 : 20000); }, ms ?? (PK_TEST ? 8000 : 90000 + Math.random() * 90000)); }

/* --- L'apparition --- */
// Test en console : pkShow() = au hasard ; pkShow("VER") = ce pilote du GP affiché ; pkShow("or" | "sc" | "commissaire" | "mecano")
function pkResolve(q) {
  const k = String(q).trim().toLowerCase(), w = finishers[0];
  if (["or", "gold", "dore", "doré"].includes(k) && w && RACE) return { kind: "gold", key: String(RACE.session_key), code: w.code, name: w.last, team: w.team, color: w.color, number: String(w.dn), gold: true, gp: `${gpName(RACE)} ${RACE.year}` };
  const rare = { sc: "sc", "safety car": "sc", commissaire: "marshal", marshal: "marshal", mecano: "mech", "mécano": "mech", mecanicien: "mech", "mécanicien": "mech", mech: "mech" }[k];
  if (rare) return { kind: "rare", key: rare, ...PK_RARES[rare] };
  const d = drivers.find((x) => String(x.code).toLowerCase() === k || String(x.last).toLowerCase() === k || String(x.dn) === k);
  if (d) return { kind: "driver", key: d.code, code: d.code, name: d.last, team: d.team, color: d.color, number: String(d.dn) };
  console.info(`pkShow : « ${q} » inconnu. Codes possibles : ${drivers.map((x) => x.code).join(", ")}, or, sc, commissaire, mecano.`);
  return null;
}
function pkShow(q) {
  if (PK.busy) return;
  const who = q != null && q !== "" ? pkResolve(q) : pkPick(); if (!who) return q != null ? undefined : pkSchedule();
  // Jamais pendant une saisie, jamais devant un bouton, un lien ou un champ : on cherche une place libre en bas de l'écran
  const ae = document.activeElement; if (ae && (ae.tagName === "TEXTAREA" || (ae.tagName === "INPUT" && /^(text|email|search|number|tel|url|password)$/.test(ae.type)))) return q != null ? undefined : pkSchedule(PK_TEST ? 2000 : 20000);
  const w = MOB() ? 112 : 140, h = Math.round(w * 0.6), min = 16, max = innerWidth - w - 16;
  const busyAt = (x, y) => { const el = document.elementFromPoint(x, y); return !!el?.closest("input, select, textarea, label, .pk-modal, .btn, .hf-cta, .hp-go, .share-btn, .mtabs, nav, header"); };
  const free = (left) => { for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.15, 0.6, 0.95]) if (busyAt(left + fx * w, innerHeight - h + fy * h)) return false; return true; };
  let left = null;
  for (let t = 0; t < 14 && left == null; t++) { const c = Math.round(min + Math.random() * Math.max(0, max - min)); if (free(c)) left = c; }
  // Pas de place libre : on retente vite ; au 3e essai (ou en mode test), il apparaît quand même, juste 3 s
  if (left == null) { PK.miss = (PK.miss || 0) + 1; if (q != null || PK_TEST || PK.miss >= 3) left = Math.round(min + Math.random() * Math.max(0, max - min)); else { pkSchedule(6000); return; } }
  PK.miss = 0;
  PK.busy = true; PK.cur = who; PK.hold = false;
  const b = document.createElement("button"); b.className = "pk-peek"; b.setAttribute("aria-label", `Attraper ${who.name}`);
  b.style.left = left + "px"; b.style.width = w + "px"; b.style.height = h + "px";
  b.innerHTML = peekSvg(who); document.body.appendChild(b);
  // La première fois, une bulle explique le jeu
  let tip = null;
  try { if (!localStorage.getItem("f1duel:pkhint")) { localStorage.setItem("f1duel:pkhint", "1"); tip = document.createElement("div"); tip.className = "pk-tip"; tip.textContent = "Un pilote se cache ! Attrape-le pour ta collection."; tip.style.left = Math.max(12, Math.min(innerWidth - 232, left + w / 2 - 110)) + "px"; tip.style.bottom = h + 10 + "px"; document.body.appendChild(tip); requestAnimationFrame(() => tip.classList.add("on")); } } catch {}
  const dropTip = () => { if (tip) { tip.remove(); tip = null; } };
  const head = b.querySelector(".pk-head"), hands = b.querySelector(".pk-hands");
  const set = (h, hd) => { head.style.transform = h; hands.style.transform = hd; };
  set("translateY(76px)", "translateY(26px)");
  const steps = [["translateY(76px)", "translateY(0)", 380], ["translateY(0)", "translateY(0)", 700], ["translateY(0) rotate(-9deg)", "translateY(0)", 620], ["translateY(0) rotate(8deg)", "translateY(0)", 620], ["translateY(0)", "translateY(0)", 420], ["translateY(76px)", "translateY(26px)", 450]];
  let i = 0;
  const run = () => {
    if (!b.isConnected) return;
    if (i >= steps.length) { b.remove(); dropTip(); PK.busy = false; pkSchedule(); return; }
    if (PK.hold && i >= 2 && i < 5) { PK.t = setTimeout(run, 200); return; } // figé tant que la souris est dessus
    const [h, hd, ms] = steps[i++]; set(h, hd); PK.t = setTimeout(run, ms);
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  b.addEventListener("pointerenter", () => (PK.hold = true)); b.addEventListener("pointerleave", () => (PK.hold = false));
  b.addEventListener("click", () => { clearTimeout(PK.t); const r = b.getBoundingClientRect(); b.remove(); dropTip(); pkCatch(who, r); });
}

/* --- Attrapé : il grossit vers le centre, « Bravo ! », et rejoint la collection --- */
function pkCatch(who, from) {
  const col = pkLoad(); let isNew = false, times = 1;
  if (who.kind === "driver") { const e = col.drivers[who.code]; isNew = !e; times = (e?.n || 0) + 1; col.drivers[who.code] = { n: times, name: who.name, team: who.team, color: who.color, number: who.number }; }
  else if (who.kind === "gold") { isNew = !col.gold[who.key]; col.gold[who.key] = { code: who.code, name: who.name, color: who.color, number: who.number, gp: who.gp }; }
  else { const n = (col.rares[who.key] || 0) + 1; isNew = n === 1; times = n; col.rares[who.key] = n; }
  pkSave(col);
  const st = pkStats(col);
  const kicker = who.kind === "driver" ? "Bravo !" : "Rare !";
  const title = who.kind === "gold" ? `${esc(who.name)} doré` : who.kind === "driver" ? `Tu as attrapé ${esc(who.name)}` : esc(who.name);
  const sub = who.kind === "gold" ? `Le vainqueur de ${esc(who.gp)}, version dorée.` : who.kind === "driver" ? `${esc(who.code)} · ${esc(who.team)} · ${isNew ? "nouveau dans ta collection" : `déjà dans ta collection (${times} fois)`}` : esc(who.how);
  const prog = who.kind === "driver" ? [`Ta collection`, `${st.got} pilote${st.got > 1 ? "s" : ""} sur ${st.tot}`, st.got / Math.max(1, st.tot), "var(--accent)"] : who.kind === "gold" ? ["Tes vainqueurs dorés", `${st.gold} GP`, Math.min(1, st.gold / Math.max(1, RACES.length)), "#E3B341"] : ["Les rares", `${st.rares} sur 3`, st.rares / 3, "#E3B341"];
  const m = document.createElement("div"); m.className = "pk-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", kicker);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  m.innerHTML = `<div class="pk-card ${who.kind !== "driver" ? "rare" : ""}" style="--fx:${Math.round(from.left + from.width / 2 - cx)}px;--fy:${Math.round(from.top + from.height / 2 - cy)}px;--glow:${who.gold ? "#E3B341" : who.color}">
      <div class="pk-stage"><i class="pk-glow"></i>${figSvg({ color: who.color, number: who.number, pose: "wave", gold: who.gold, label: who.name })}</div>
      <div class="pk-k">${kicker}</div><div class="pk-t">${title}</div><div class="pk-s">${sub}</div>
      <div class="pk-prog"><div><span>${prog[0]}</span><b>${prog[1]}</b></div><i><b style="width:${Math.round(prog[2] * 100)}%;background:${prog[3]}"></b></i></div>
      <div class="pk-btns"><button class="pk-go">Voir ma collection</button><button class="pk-close">Continuer</button></div></div>`;
  document.body.appendChild(m); requestAnimationFrame(() => m.classList.add("on"));
  const close = () => { m.classList.remove("on"); setTimeout(() => m.remove(), 250); PK.busy = false; pkSchedule(); pkFooter(); };
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  m.querySelector(".pk-close").addEventListener("click", close);
  m.querySelector(".pk-go").addEventListener("click", () => { m.remove(); PK.busy = false; pkCollection(); });
  m.querySelector(".pk-close").focus();
  pkFooter();
}
function pkStats(col = pkLoad()) {
  const grid = new Set(drivers.map((d) => d.code));
  Object.keys(col.drivers).forEach((c) => grid.add(c));
  return { got: Object.keys(col.drivers).length, tot: Math.max(grid.size, Object.keys(col.drivers).length), gold: Object.keys(col.gold).length, rares: Object.keys(col.rares).length };
}

/* --- La collection --- */
function pkCollection() {
  const col = pkLoad(), st = pkStats(col);
  const teams = new Map(); drivers.forEach((d) => { if (!teams.has(d.team)) teams.set(d.team, { color: d.color, ds: [] }); teams.get(d.team).ds.push(d); });
  // Un pilote attrapé mais absent du GP affiché (forfait, remplacé ce week-end-là) reste rangé dans son écurie s'il en fait partie
  const others = [];
  Object.entries(col.drivers).filter(([c]) => !drivers.some((d) => d.code === c)).forEach(([c, e]) => { const t = teams.get(e.team); if (t) t.ds.push({ code: c, color: e.color || t.color, dn: e.number, extra: true }); else others.push([c, e]); });
  const cell = (code, e, color, number) => `<div class="pk-cell ${e ? "" : "off"}">${figSvg({ color, number, ghost: !e, label: e ? code : "Pilote pas encore attrapé" })}<b>${e ? esc(code) : "???"}</b><small>${e ? (e.n > 1 ? `attrapé ${e.n} fois` : "attrapé") : "pas encore vu"}</small></div>`;
  const golds = Object.values(col.gold);
  const m = document.createElement("div"); m.className = "pk-modal pk-coll-wrap"; m.setAttribute("role", "dialog"); m.setAttribute("aria-modal", "true"); m.setAttribute("aria-label", "Ta collection");
  m.innerHTML = `<div class="pk-coll">
    <div class="pk-coll-top"><div><div class="eyebrow">Ton paddock</div><h2>Ta collection</h2><p>Pendant que tu lis un GP, un pilote passe de temps en temps la tête en bas de l'écran (toutes les 2 à 3 minutes environ). Clique ou touche-le avant qu'il reparte : il rejoint ta collection. Les vainqueurs dorés n'apparaissent que sur le GP qu'ils ont gagné.</p></div>
      <button class="icon-btn pk-x" aria-label="Fermer la collection"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="pk-stats"><div><span>Pilotes</span><b>${st.got} <small>/ ${st.tot}</small></b><i><b style="width:${Math.round((st.got / Math.max(1, st.tot)) * 100)}%"></b></i></div>
      <div class="gold"><span>Vainqueurs dorés</span><b>${st.gold} <small>GP</small></b></div><div class="gold"><span>Rares</span><b>${st.rares} <small>/ 3</small></b></div></div>
    <div class="pk-teams">${[...teams].map(([t, v]) => `<div class="pk-team"><div class="pk-tn"><i style="background:${v.color}"></i>${esc(t)}</div><div class="pk-cells">${v.ds.map((d) => cell(d.code, col.drivers[d.code], d.color, d.dn)).join("")}</div></div>`).join("")}</div>
    ${others.length ? `<h3>${drivers.length ? "Autres pilotes" : "Tes pilotes"}</h3><div class="pk-cells wide">${others.map(([c, e]) => cell(c, e, e.color, e.number)).join("")}</div>` : ""}
    <h3>Les vainqueurs dorés <small>un par GP, sur le GP que tu regardes</small></h3>
    <div class="pk-cells wide">${golds.length ? golds.map((g) => `<div class="pk-cell gold">${figSvg({ color: g.color, number: g.number, gold: true, label: g.name + " doré" })}<b>${esc(g.code)}</b><small>${esc(g.gp)}</small></div>`).join("") : `<p class="pk-empty">Aucun pour l'instant : le vainqueur du GP affiché passe parfois, en or.</p>`}</div>
    <h3>Les rares</h3>
    <div class="pk-cells wide">${Object.entries(PK_RARES).map(([k, r]) => { const n = col.rares[k]; return `<div class="pk-cell ${n ? "gold" : "off"}">${figSvg({ color: r.color, number: r.number, ghost: !n, label: n ? r.name : "Rare pas encore attrapé" })}<b>${n ? esc(r.name) : "???"}</b><small>${esc(r.how)}</small></div>`; }).join("")}</div>
    <div class="pk-save"><div><b>Garder ta collection sur un autre navigateur ou téléphone</b><span>La collection est enregistrée dans ce navigateur. Copie ton lien de sauvegarde et ouvre-le ailleurs : elle s'y ajoute.</span></div>
      <button class="btn pk-copy">Copier mon lien de sauvegarde</button><input class="pk-linkbox" readonly hidden aria-label="Lien de sauvegarde"></div>
  </div>`;
  document.body.appendChild(m); requestAnimationFrame(() => m.classList.add("on"));
  const close = () => { m.classList.remove("on"); setTimeout(() => m.remove(), 250); pkSchedule(); };
  m.addEventListener("click", (e) => { if (e.target === m) close(); });
  m.querySelector(".pk-x").addEventListener("click", close); m.querySelector(".pk-x").focus();
  m.querySelector(".pk-copy").addEventListener("click", async () => {
    const link = pkLink(), box = m.querySelector(".pk-linkbox"), btn = m.querySelector(".pk-copy");
    try { await navigator.clipboard.writeText(link); btn.textContent = "Lien copié !"; setTimeout(() => (btn.textContent = "Copier mon lien de sauvegarde"), 2500); }
    catch { box.hidden = false; box.value = link; box.select(); btn.textContent = "Copie le lien ci-dessous"; }
  });
}
// Un lien discret en bas de page, seulement une fois le premier pilote attrapé (l'easter egg reste une surprise)
function pkFooter() {
  const st = pkStats(), f = document.querySelector("footer"); if (!f) return;
  let a = $("#pk-link");
  if (!st.got && !st.gold && !st.rares) { a?.remove(); return; }
  if (!a) { a = document.createElement("button"); a.id = "pk-link"; a.className = "linklike pk-link"; f.appendChild(a); a.addEventListener("click", pkCollection); }
  a.textContent = `Ta collection : ${st.got} pilote${st.got > 1 ? "s" : ""} attrapé${st.got > 1 ? "s" : ""} sur ${st.tot}`; a.title = "Des pilotes passent la tête en bas de l'écran pendant ta lecture : attrape-les pour compléter ta collection.";
}
addEventListener("keydown", (e) => { if (e.key === "Escape") { const m = document.querySelector(".pk-modal"); if (m) { m.querySelector(".pk-close, .pk-x")?.click(); e.stopPropagation(); } } }, true);
setTimeout(pkFooter, 1500);
pkSchedule(PK_TEST ? 4000 : 60000 + Math.random() * 60000);
if (PK_TEST) setTimeout(() => toast("Mode test : un pilote passe toutes les 8 s environ (ouvre un GP)."), 1200);

/* --- Sauvegarde : un lien qui contient la collection, à ouvrir sur un autre navigateur --- */
function pkLink() {
  const c = pkLoad(), z = { d: c.drivers, g: c.gold, r: c.rares };
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(z)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return location.origin + location.pathname + "#paddock=" + b64;
}
function pkImport(code) {
  try {
    const z = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/")))));
    const c = pkLoad(); let added = 0;
    Object.entries(z.d || {}).forEach(([k, v]) => { if (!v || typeof v !== "object") return; const cur = c.drivers[k]; if (!cur) added++; c.drivers[k] = { ...v, n: Math.max(+v.n || 1, cur?.n || 0) }; });
    Object.entries(z.g || {}).forEach(([k, v]) => { if (v && typeof v === "object" && !c.gold[k]) { c.gold[k] = v; added++; } });
    Object.entries(z.r || {}).forEach(([k, v]) => { if (PK_RARES[k]) { if (!c.rares[k]) added++; c.rares[k] = Math.max(+v || 0, c.rares[k] || 0); } });
    pkSave(c); pkFooter();
    setTimeout(() => toast(added ? `Collection récupérée : ${added} nouveau${added > 1 ? "x" : ""} personnage${added > 1 ? "s" : ""} ajouté${added > 1 ? "s" : ""}.` : "Collection déjà à jour."), 600);
  } catch { setTimeout(() => toast("Ce lien de sauvegarde n'est pas valide."), 600); }
}
// « Ma collection » : dans le menu du haut, l'accueil et le menu mobile
document.addEventListener("click", (e) => { const b = e.target.closest(".pk-open"); if (!b) return; e.preventDefault(); if (typeof closeSheets === "function") closeSheets(); pkCollection(); });
