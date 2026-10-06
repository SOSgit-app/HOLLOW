# H O L L O W — Cyber Infiltration

```
PROJECT HOLLOW / BUILD 0.9.3 / RD-9 BLACKOUT LOADOUT
HOSTILE AI SITE — EMP RAID ARCHIVE
```

A first-person **cyber raid** prototype played in total darkness. The only
vision is a LiDAR scanner: every point is a return you fired. Security is
blind but hears emissions — scans, footsteps, voice, alarms.

No combat. Recover access keys, unlock blast doors, jack into the core
(press X, then hold X to download onto the drive), then board the chopper LZ
before it departs.

## Run it

No build step, no dependencies, no network. Either:

- **Open `game/index.html` directly in any modern browser**, or
- serve it (`python -m http.server` from the repo root, then visit
  `http://localhost:8000/game/`).

Headphones strongly recommended. Sound is not decoration here — it is the
primary threat-detection system.

## SOS Mission Command (3- or 4-person cyber raid)

HOLLOW is a Squadron Officer School-style exercise: one **Operator** in VR,
**Watch** (tripwires / safe spaces / patrol posts) and **Access** (keys / doors / LZ) with the same
floor and wall codes but different overlays, and (in a 4-person team) a
**Controller** with the clock — no maze. POW wall code is spoken by the Operator.

- Exercise guide: [`docs/SOS_Exercise.md`](docs/SOS_Exercise.md)
- 3-person maps: [`game/map-print.html?team=3`](game/map-print.html?team=3#easy-watch)
- 4-person packet: [`game/map-print.html?team=4`](game/map-print.html?team=4#easy-watch)
- Live game: https://sosgit-app.github.io/HOLLOW/game/

**Objective:** recover access keys → unlock blast doors → jack-in (press X, hold X to download) →
board the **LZ** before the chopper departs (10:00 blackout window).

**Green** = safe space · **Yellow** = tripwire · **LZ** = yellow pad on LiDAR. Walk onto it when the chopper is on station.
On **Hard**, headset mic speech contributes to signature (EMCON). Easy and Medium ignore operator noise.

## Quest 2 / WebXR

Open **https://smallerbytes.github.io/HOLLOW/game/** in Quest Browser (HTTPS required).

1. Continue past the boot screen and choose **ENTER VR (QUEST)**.
2. Approve immersive VR and microphone permissions.
3. Allow a teammate to download the Mission Map before you enter VR.

Quest controls:

| Input | Action |
|---|---|
| Head | Look |
| Left stick | Head-relative movement |
| Right stick left/right | 30-degree snap turn |
| Right trigger | Trickle scan aimed by the controller |
| Right grip | Burst sweep |
| A / X / stick-click | Interact |

The headset path renders native stereo views and intentionally bypasses the
desktop CRT barrel-distortion pass. It uses 80% headset framebuffer scale and
draws at most the newest 300,000 points per eye to target Quest 2 performance.
The desktop controls and presentation remain unchanged.

Current VR prototype limitation: the HTML HUD is visible only in the desktop
mirror, not in the headset. Objective status still works through colors,
interaction sounds, and world state.

## Controls

| Input | Action |
|---|---|
| Mouse | Aim |
| Hold LMB | Trickle scan (quiet, narrow) |
| RMB / Space | Burst sweep (paints the whole room — **very loud**) |
| W A S D | Move |
| Shift | Sprint (loud) |
| Ctrl | Crouch (near-silent) |
| E | Interact |

Return colors: phosphor green = surfaces · **safe-space green** ·
**yellow = laser alarm** · amber = objectives · cyan = documents ·
white = energized exit · **red = it**.

## Repository

| Path | Contents |
|---|---|
| `docs/GDD.md` | Complete game design document |
| `docs/SOS_Exercise.md` | Mission command exercise guide |
| `game/` | Playable WebGL / WebXR build |
| `game/assets/HOLLOW_Mission_Map.pdf` | Downloadable MD map |
| `game/map-print.html` | Printable color map |
| `tools/validate_map.js` | Map integrity check |
| `tools/smoke.js` | Headless AI/raycast smoke test |
| `tools/gen_mission_pdf.js` | Regenerate mission PDF from map data |

```
node tools/validate_map.js
node tools/smoke.js
node tools/gen_mission_pdf.js
```

## Design pillars (short form)

1. You are the light — nothing renders unless you scanned it.
2. Sound is truth — every audio cue is information, never mood-only.
3. Tension over terror — one earned jump scare: yours.
4. Diegetic everything — the whole game is a 1988 instrument panel.
5. No combat — the verbs are scan, move, listen, hold still.

See `docs/GDD.md` for the full specification.
