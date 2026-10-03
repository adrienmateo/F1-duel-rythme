"""Course simulée partagée par les tests (dashboard + compte rendu).
20 pilotes, 57 tours, ralentissement T11-12 sans message, SC T18-20, VSC T40-41 (message sans n° de tour),
drapeau rouge APRÈS l'arrivée (doit être ignoré), PIA 0,18 s/tour plus lent que NOR, BEA abandonne au tour 8."""
import json, os, random
random.seed(7)
TEAMS = [("McLaren","FF8000",[(4,"NOR"),(81,"PIA")]),("Ferrari","E8002D",[(16,"LEC"),(44,"HAM")]),
         ("Red Bull Racing","3671C6",[(1,"VER"),(22,"TSU")]),("Mercedes","27F4D2",[(63,"RUS"),(12,"ANT")]),
         ("Aston Martin","229971",[(14,"ALO"),(18,"STR")]),("Alpine","0093CC",[(10,"GAS"),(43,"COL")]),
         ("Williams","64C4FF",[(23,"ALB"),(55,"SAI")]),("Racing Bulls","6692FF",[(6,"HAD"),(30,"LAW")]),
         ("Kick Sauber","52E252",[(27,"HUL"),(5,"BOR")]),("Haas F1 Team","B6BABD",[(31,"OCO"),(87,"BEA")])]
BASE = {}
for i,(_,_,ds) in enumerate(TEAMS):
    for j,(dn,_) in enumerate(ds): BASE[dn] = 92.0 + i*0.12 + j*0.25
BASE[81] = BASE[4] + 0.18    # PIA 0.18 s plus lent que NOR
BASE[87] = None              # BEA abandonne tour 8
TOTAL = 57
sessions = [
  {"session_key": 9001+k, "meeting_key": 1200+k, "year": 2026, "session_type": "Race", "session_name": "Race",
   "country_name": c, "location": loc, "circuit_short_name": loc, "is_cancelled": False,
   "date_start": f"2026-0{k+3}-15T13:00:00Z", "date_end": f"2026-0{k+3}-15T15:00:00Z"}
  for k,(c,loc) in enumerate([("Australia","Melbourne"),("China","Shanghai"),("Japan","Suzuka")])
] + [{"session_key": 9100, "year": 2026, "session_type":"Race","session_name":"Sprint","country_name":"China","location":"Shanghai","is_cancelled":False,"date_start":"2026-04-14T07:00:00Z","date_end":"2026-04-14T08:00:00Z"},
     {"session_key": 9200, "year": 2026, "session_type":"Race","session_name":"Race","country_name":"Future","location":"Nowhere","is_cancelled":False,"date_start":"2099-01-01T13:00:00Z","date_end":"2099-01-01T15:00:00Z"}]
drivers = [{"driver_number": dn, "name_acronym": code, "full_name": code, "team_name": t, "team_colour": col}
           for t,col,ds in TEAMS for dn,code in ds]
laps, stints, pits = [], [], []
import datetime as dt
T0 = dt.datetime(2026,3,15,13,0,0)
for t,_,ds in TEAMS:
    for dn,_ in ds:
        pit = random.randint(20, 30)
        last = 8 if BASE[dn] is None else TOTAL
        base = BASE[dn] or 93.5
        clock = T0 + dt.timedelta(seconds=list(BASE).index(dn)*0.8)
        for lap in range(1, last+1):
            tt = base - lap*0.04 + random.uniform(-0.15,0.15) + (0.5 if lap <= pit else 0)
            if lap == 1: tt += 9
            if 11 <= lap <= 12: tt += 9          # ralentissement sans message (drapeaux jaunes)
            if 18 <= lap <= 20: tt += 28         # SC
            if 40 <= lap <= 41: tt += 12         # VSC (message sans numéro de tour)
            if lap == pit: tt += 19
            if lap == pit+1: tt += 17
            laps.append({"driver_number":dn,"lap_number":lap,"lap_duration":None if lap==1 else round(tt,3),
                         "is_pit_out_lap":lap==pit+1,"date_start":clock.isoformat()+"Z"})
            clock += dt.timedelta(seconds=tt)
        stints += [{"driver_number":dn,"stint_number":1,"compound":"MEDIUM","lap_start":1,"lap_end":min(pit,last)}]
        if last > pit:
            stints.append({"driver_number":dn,"stint_number":2,"compound":"HARD","lap_start":pit+1,"lap_end":TOTAL})
            pits.append({"driver_number":dn,"lap_number":pit})
def at(lap):  # heure de début du tour pour le leader
    return min(l["date_start"] for l in laps if l["lap_number"]==lap)
rc = [{"date":at(1),"lap_number":1,"flag":"GREEN","message":"GREEN LIGHT - PIT EXIT OPEN"},
      {"date":at(18),"lap_number":18,"category":"SafetyCar","message":"SAFETY CAR DEPLOYED"},
      {"date":at(20),"lap_number":20,"category":"SafetyCar","message":"SAFETY CAR IN THIS LAP"},
      {"date":at(40),"lap_number":None,"category":"SafetyCar","message":"VIRTUAL SAFETY CAR DEPLOYED"},
      {"date":at(41),"lap_number":None,"category":"SafetyCar","message":"VIRTUAL SAFETY CAR ENDING"},
      {"date":"2026-03-15T18:00:00Z","lap_number":None,"flag":"RED","message":"PIT EXIT CLOSED"},
      {"date":at(TOTAL),"lap_number":TOTAL,"flag":"RED","message":"RED FLAG"}]   # faux rouge au dernier tour (cas de Bakou 2026)
DATA = {"sessions": sessions, "drivers": drivers, "laps": laps, "stints": stints, "pit": pits, "race_control": rc}

# Classement final : temps total (abandon en dernier), grille de départ légèrement mélangée
finish = {}
for l in laps:
    if l["lap_duration"] is not None:
        finish.setdefault(l["driver_number"], [0, 0])
        finish[l["driver_number"]][0] += l["lap_duration"]; finish[l["driver_number"]][1] = max(finish[l["driver_number"]][1], l["lap_number"])
order = sorted(finish, key=lambda dn: (-finish[dn][1], finish[dn][0]))
session_result = [{"position": i+1, "driver_number": dn, "number_of_laps": finish[dn][1],
                   "dnf": finish[dn][1] < TOTAL, "dns": False, "dsq": False, "points": [25,18,15,12,10,8,6,4,2,1][i] if i < 10 else 0}
                  for i, dn in enumerate(order)]
grid_order = sorted(BASE, key=lambda dn: (BASE[dn] or 93.5) + random.uniform(-0.6, 0.6))
starting_grid = [{"position": i+1, "driver_number": dn} for i, dn in enumerate(grid_order)]
DATA["session_result"] = session_result
DATA["starting_grid"] = starting_grid

# --- Enrichissements (site v2) : noms, secteurs, durées d'arrêt, écarts officiels, positions GPS ---
import math
NAMES = {"NOR":("Lando","NORRIS"),"PIA":("Oscar","PIASTRI"),"LEC":("Charles","LECLERC"),"HAM":("Lewis","HAMILTON"),"VER":("Max","VERSTAPPEN"),
         "TSU":("Yuki","TSUNODA"),"RUS":("George","RUSSELL"),"ANT":("Andrea Kimi","ANTONELLI"),"ALO":("Fernando","ALONSO"),"STR":("Lance","STROLL"),
         "GAS":("Pierre","GASLY"),"COL":("Franco","COLAPINTO"),"ALB":("Alexander","ALBON"),"SAI":("Carlos","SAINZ"),"HAD":("Isack","HADJAR"),
         "LAW":("Liam","LAWSON"),"HUL":("Nico","HULKENBERG"),"BOR":("Gabriel","BORTOLETO"),"OCO":("Esteban","OCON"),"BEA":("Oliver","BEARMAN")}
for d in drivers:
    f, l = NAMES[d["name_acronym"]]; d["first_name"], d["last_name"] = f, l; d["full_name"] = f"{f} {l}"
SPLIT = {}
for d in drivers:
    r = random.Random(d["driver_number"])
    SPLIT[d["driver_number"]] = (0.31 + r.uniform(-0.004, 0.004), 0.38 + r.uniform(-0.004, 0.004))
for l in laps:
    t = l["lap_duration"]
    if t is None: l["duration_sector_1"] = l["duration_sector_2"] = l["duration_sector_3"] = None; continue
    a, b = SPLIT[l["driver_number"]]
    l["duration_sector_1"] = round(t * a, 3); l["duration_sector_2"] = round(t * b, 3); l["duration_sector_3"] = round(t - round(t*a,3) - round(t*b,3), 3)
for p in pits:
    r = random.Random(p["driver_number"] * 7)
    p["stop_duration"] = round(2.1 + r.uniform(0, 1.6), 2); p["lane_duration"] = round(19.5 + r.uniform(-0.8, 1.2), 1); p["pit_duration"] = p["lane_duration"]
lead_t = finish[order[0]][0]
for r in session_result:
    if not r["dnf"]: r["gap_to_leader"] = 0 if r["position"] == 1 else round(finish[r["driver_number"]][0] - lead_t, 3); r["duration"] = round(finish[r["driver_number"]][0], 3)
    else: r["gap_to_leader"] = "DNF"

def _track(f):  # circuit fictif : courbe fermée, f ∈ [0,1)
    a = 2 * math.pi * f
    return (3000 * math.cos(a) + 900 * math.cos(3 * a), 1800 * math.sin(a) + 500 * math.sin(2 * a))
import datetime as _dt
def _parse(s): return _dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
LAPS_BY = {}
for l in laps:
    if l["lap_duration"]: LAPS_BY.setdefault(l["driver_number"], []).append((_parse(l["date_start"]), l["lap_duration"]))
def location(driver_number, t_from, t_to):
    out = []
    for ds, dur in LAPS_BY.get(driver_number, []):
        n = int(dur * 3.7)
        for k in range(n):
            ts = ds + _dt.timedelta(seconds=dur * k / n)
            if t_from <= ts <= t_to:
                x, y = _track(k / n); out.append({"date": ts.isoformat().replace("+00:00", "Z"), "driver_number": driver_number, "x": round(x), "y": round(y), "z": 0})
    return out

def dump(directory):
    os.makedirs(directory, exist_ok=True)
    for k, v in DATA.items():
        with open(os.path.join(directory, k + ".json"), "w") as f: json.dump(v, f)

if __name__ == "__main__":
    import sys
    dump(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "fixture"))
    print("fixture écrite")
