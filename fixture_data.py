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
      {"date":"2026-03-15T18:00:00Z","lap_number":None,"flag":"RED","message":"PIT EXIT CLOSED"}]
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

def dump(directory):
    os.makedirs(directory, exist_ok=True)
    for k, v in DATA.items():
        with open(os.path.join(directory, k + ".json"), "w") as f: json.dump(v, f)

if __name__ == "__main__":
    import sys
    dump(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "fixture"))
    print("fixture écrite")
