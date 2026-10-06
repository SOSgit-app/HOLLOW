# HOLLOW — SOS Cyber Raid Exercise

## Purpose

Three-to-four-person experiential for **Squadron Officer School**-style mission command:

- Incomplete information (fog of war)
- Shared understanding built over voice
- Parallel work on a clock (map vs core-access dossier)
- Signature / EMCON management (scans, movement, speech)
- Time-sensitive extract after objective complete

Fictional enemy C2 node raid. No real unit OPSEC.

## Roles

| Role | Position | Sees | Does |
|---|---|---|---|
| **Operator** | Quest 2 VR (or desktop) | LiDAR only | Recover keys, unlock doors, jack-in, board LZ |
| **Mission Director** (1–2) | Laptop / printout | [Mission Map](../game/assets/HOLLOW_Mission_Map.pdf) / [map-print.html](../game/map-print.html) | Routes Operator by voice; no live threat picture; **does not** open the dossier |
| **Solver** | Printout | [Core Access Dossier](../game/circuit-print.html) (2 pages, front and back) | Starts at briefing. Finishes **before** the Operator reaches the core. At jack-in, listens for the serial and reads the pad order |

## Commander's intent (read aloud)

> Infiltrate the blackout node, recover three access keys, open the **console-room door (D3)**, jack into the core, and extract via the LZ when the chopper is on station. Other blast doors are optional shortcuts. Minimize emissions. If compromised, break to Faraday harbors and reorient. Success is uplink **and** extract.

## Mission flow

1. Recover **3 access keys** (amber)
2. Open **console door D3** (requires all 3 keys). D1/D2 optional (1 key each)
3. **Jack-in** at the console (core handshake). Operator reads the **CORE SERIAL**. Solver already has the pad order from the dossier. 60s lockout per stage.
4. Clone the model, then rescue the POW **or** plant the virus
5. **Chopper inbound** — LZ pulses slowly
6. **On station** — board the pad or **left behind**

## Setup

1. Print the Mission Map for the Director (single-sided is fine).
2. Print the [Core Access Dossier](../game/circuit-print.html) for the Solver — **one sheet, duplex (front and back)**.
3. Operator opens the game in Quest Browser.
4. Allow microphone (speech raises signature).
5. Director states intent; Operator backbriefs first route. Solver starts the dossier immediately — do not wait for the console.

## Jack-in (what each person sees)

- **Operator:** a 3×3 of colored pads plus a three-character serial. They can name pads (`B1` or `blue square`). They cannot see which order is correct. Tutorial shows the order so they can learn the buttons alone.
- **Solver:** the only copy of the intercepts. First character of the serial picks the band: **1–3 WEST**, **4–6 EAST**, **7–9 / A–F CORE**.
- **Director:** stays on the map. Wall codes, keys, doors, LZ.

Wrong sequence can be retried until the 60s lockout. Lockout alerts security. Serial does not change on retry.

## Systems

- **Harbor green** — Faraday shelters (security will not kill/chase inside)
- **Yellow tripwires** — alarm + force investigate
- **Headset mic** — EMCON
- **Flashing white LZ** — chopper pad (no 3D model)

## Debrief

1. Intent vs outcome?
2. Where shared understanding broke (map vs dossier vs headset)?
3. Was the Solver done before jack-in, or was the Operator waiting?
4. Initiative under compromise — aligned?
5. Reversible (harbor) vs irreversible (uplink alarm / missed LZ)?
6. Signature vs speed tradeoffs?

## Safety

Stop word ends the exercise. Reduced Flash available. Limit VR sessions ~20–30 minutes.

## Facilitator answer key (do not print for the Solver)

Lawful log line is **02:14Z GREEN**. Discard RED-stamped traffic, any strip with a RED pad (A1 or C2), strips that are not exactly three pads, and invalid IDs. WEST stage 1 must start with GREEN (harbor).

| Serial starts | Stage 1 | Stage 2 | Stage 3 |
|---|---|---|---|
| 1–3 WEST | C1 · B3 · B2 | A3 · B1 · C3 | B2 · A2 · A3 |
| 4–6 EAST | B1 · A3 · C1 | C3 · B2 · B3 | A2 · C1 · B1 |
| 7–9 / A–F CORE | B3 · C1 · A2 | B2 · C3 · A3 | A3 · B3 · C1 |
