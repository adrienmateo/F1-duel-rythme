// Course simulée de 50 tours, avec des écarts connus d'avance :
//  - Équipe A : VER base 90.000 s, TSU base 90.500 s → écart attendu ≈ 0.5 s (0.556 %)
//  - Équipe B : LEC base 90.200 s, HAM abandonne au tour 6 → duel invalide
// Pièges injectés : tour 1 lent, SC tours 20-22, arrêts aux stands, un tour dans le trafic.
import fs from "node:fs";
const dir = new URL("./fixture/", import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
const w = (n, d) => fs.writeFileSync(dir + n + ".json", JSON.stringify(d));

const S = { session_key: 9999, meeting_key: 1, year: 2026, session_type: "Race", session_name: "Race",
  country_name: "Testland", circuit_short_name: "Test", date_start: "2026-09-27T13:00:00Z",
  date_end: "2026-09-27T15:00:00Z", is_cancelled: false };
w("sessions", [S]);
w("drivers", [
  { driver_number: 1, name_acronym: "VER", full_name: "Driver One", team_name: "Team A", team_colour: "3671C6" },
  { driver_number: 22, name_acronym: "TSU", full_name: "Driver Two", team_name: "Team A", team_colour: "3671C6" },
  { driver_number: 16, name_acronym: "LEC", full_name: "Driver Three", team_name: "Team B", team_colour: "E8002D" },
  { driver_number: 44, name_acronym: "HAM", full_name: "Driver Four", team_name: "Team B", team_colour: "E8002D" },
]);

const base = { 1: 90.0, 22: 90.5, 16: 90.2, 44: 90.3 };
const pitLap = { 1: 25, 22: 27, 16: 26, 44: null };
const laps = [];
let rnd = 42; const noise = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
for (const dn of [1, 22, 16, 44]) {
  const last = dn === 44 ? 6 : 50;
  for (let lap = 1; lap <= last; lap++) {
    let t = base[dn] + noise() + (lap > (pitLap[dn] ?? 99) ? -0.6 : 0); // pneus neufs plus rapides
    if (lap === 1) t += 8;
    if (lap >= 20 && lap <= 22) t += 30;           // safety car
    if (lap === pitLap[dn]) t += 20;               // tour d'entrée aux stands
    if (lap === pitLap[dn] + 1) t += 18;           // tour de sortie
    if (dn === 1 && lap === 40) t += 3;            // trafic
    laps.push({ driver_number: dn, lap_number: lap, lap_duration: +t.toFixed(3),
      is_pit_out_lap: lap === pitLap[dn] + 1 });
  }
}
w("laps", laps);
w("stints", [1, 22, 16].flatMap((dn) => [
  { driver_number: dn, stint_number: 1, compound: "MEDIUM", lap_start: 1, lap_end: pitLap[dn] },
  { driver_number: dn, stint_number: 2, compound: "HARD", lap_start: pitLap[dn] + 1, lap_end: 50 },
]).concat([{ driver_number: 44, stint_number: 1, compound: "MEDIUM", lap_start: 1, lap_end: 6 }]));
w("pit", [1, 22, 16].map((dn) => ({ driver_number: dn, lap_number: pitLap[dn], stop_duration: 2.4 })));
w("race_control", [
  { date: "2026-09-27T13:30:00Z", lap_number: 20, category: "SafetyCar", message: "SAFETY CAR DEPLOYED" },
  { date: "2026-09-27T13:36:00Z", lap_number: 22, category: "SafetyCar", message: "SAFETY CAR IN THIS LAP" },
  { date: "2026-09-27T13:37:00Z", lap_number: 23, category: "Flag", flag: "GREEN", message: "TRACK CLEAR" },
]);
console.log("fixture écrite :", dir);
