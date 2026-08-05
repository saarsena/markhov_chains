# mchains

Generative Markov voices for Max/MSP:

- **`mchains.js`** — a melody engine. Each `bang` produces exactly one event — a note-on or a rest — drawn from a constrained Markov walk that follows a chord progression you describe in Roman numerals.
- **`drum_chain.js`** — a drum engine on the same math. Each `bang` draws one kick/snare/hihat combination from a Markov walk over the eight possible hit states.
- **`mchain_core.js`** — the shared matrix machinery both objects `require()`. Not an object itself; just keep it in the same folder.

```
roman eb major I V vi IV
```

Melodies favor small steps (proximity-weighted transitions), land on chord tones (weighted, or exclusively), and stay locked to the progression's harmonic rhythm even through rests, because the chain's internal state advances on every tick whether or not a note sounds. The math is the finite-length constrained Markov construction from Pachet, Roy & Barbieri, *"Finite-Length Markov Processes with Constraints"* (IJCAI 2011): constraints are compiled into a non-homogeneous transition matrix per step, renormalized right-to-left so the constrained walk preserves the original model's relative probabilities and can never paint itself into a corner.

## Requirements

Max 9 (or Max 8.6+) — the scripts use modern JavaScript and must be loaded in **`v8`** objects, not the legacy `js` object:

```
[v8 mchains.js]        [v8 drum_chain.js]
```

All three files must live in the same folder (each object does `require("mchain_core.js")`, resolved next to the loading script).

## Patcher wiring

**Clock** — derive bangs from your transport. From `phasor~`, detect the phase wraparound (e.g. `[phasor~ 2] → [delta~] → [<~ 0] → [edge~]` → bang), or use `[metro]` for testing. Every bang = one step of the walk.

**Melody output** — `mchains.js` has a single outlet emitting plain `note velocity` pairs, ready for a MIDI chain:

```
[v8 mchains.js] → [pack 0 0] → [midiformat] → [midiout]
```

Note-offs are note-ons with velocity 0 — the same convention `makenote` uses internally, understood by any receiving instrument. Don't insert `makenote` in this chain; the object manages its own note durations by holding each note until the next tick replaces or rests it.

**Drum output** — `drum_chain.js` has three outlets, each sending a `bang` when its instrument fires on a tick: outlet 0 = kick, outlet 1 = snare, outlet 2 = hihat. Wire them straight into your gen~ trigger inputs (or `[t b]` → whatever fires your samples). A tick can fire any combination, including all three or none.

## Quick start

1. Load `[v8 mchains.js]`; it immediately works in fallback mode (a proximity-weighted walk over C dorian).
2. Send `roman eb major I V vi IV` — a 64-step loop (16 steps per chord by default).
3. Bang it from your clock. Done.
4. For drums, load `[v8 drum_chain.js]` off the same clock — it works immediately with a 16-step loop; adjust with `totalsteps`, `probability`, and the deja vu messages.

## Two-instance recipe (bass + lead)

Run two copies of `mchains.js` off the same clock (or rhythmically divided clocks) and send both the same `roman` message:

**Bass** — plays only chord tones, low register:
```
chordtonesonly 1, baseoctave 1, octaverange 2, roman eb major I V vi IV
```

**Lead** — full key scale, gravitating toward chord tones:
```
chordtonesonly 0, chordweight 3, baseoctave 4, octaverange 2, probability 70, roman eb major I V vi IV
```

The bass outlines the harmony; the lead implies it. Raise `chordweight` (try 5–8) for a lead that spells the changes more explicitly, lower `probability` for sparser phrasing. Add `drum_chain.js` on the same clock for a kit; `dejavuchance 40` on the drums makes patterns settle into grooves instead of wandering.

## Clash avoidance (pairing two voices)

Each `mchains` instance has a second inlet that accepts `otherNote <pitch>` — tell it what the *other* voice is currently sounding, and its fresh draws will avoid landing at dissonant intervals against that pitch, on a pitch-class basis (a lead note a semitone above the bass's pitch class is avoided even two octaves up). `otherNote -1` means "the other voice is silent" and disables the filter (the default).

Wire each instance's note output back into its partner's right inlet, translating on the way — the outlet emits raw `note velocity` lists, so convert: `[unpack 0 0]` → if velocity is 0 send `otherNote -1`, otherwise `[prepend otherNote]` the pitch.

The avoided intervals are settable: `clashintervals 1` (the default) avoids semitone clashes; `clashintervals 1 6` also avoids tritones; `clashintervals 0 1` additionally forbids doubling the other voice's pitch class. Values are pitch-class distances 0–6. Notes on the filter's behavior:

- It reshapes the draw *within* the chain's allowed set — harmony, anchors, and proximity weighting all still apply. If a step's every legal note would clash, the filter steps aside (with a one-time console warning) rather than silencing the walk.
- Deja vu repeats are exempt — an echoed motif note is repeated verbatim, only fresh draws dodge.
- It's live state, not a rebuild: `otherNote` updates cost nothing per tick.

## Per-instrument drum probability

`drum_chain.js` layers two probability gates over the drawn pattern. `probability` rests entire ticks, as in the melody object; `kickprob` / `snareprob` / `hihatprob` (each 0–100, default 100) then thin individual instruments, so a hit's effective chance is `probability × instrumentprob / 100`. Neither layer touches the Markov walk — the full pattern keeps evolving (and deja vu keeps echoing it) underneath; the gates only decide what you hear. `hihatprob 60` drops hats stochastically out of a groove that stays coherent.

## Deja vu

Both objects support a repeat-chance: each tick rolls against `dejavuchance`, and on a hit the tick replays a random pick from the last `dejavulookback` events instead of doing a fresh Markov draw. Every tick's choice — fresh or repeated, played or rested — enters the history, so repeats can themselves be repeated: small motifs emerge and dissolve. `0` (the default) is off; high values loop hard; something like `30`–`60` with a lookback of 3–8 gives phrases a memory without freezing them.

## Message reference

### `mchains.js`

| Message | Default | Description |
|---|---|---|
| `bang` | — | Advance one step; emit a note-on or a rest. |
| `roman <key> <scale> <numeral> [steps] ...` | — | Set a Roman-numeral progression, e.g. `roman eb major I V vi IV` or `roman c natural_minor i 8 bVII 8 bVI 8 V7 8`. An integer after a numeral overrides its step count; bare numerals get `stepsperchord`. |
| `progression <root> <scale> <steps> ...` | — | Alternative: per-segment scales instead of numerals, e.g. `progression c major 8 f lydian 8`. Chord tones are degrees 1/3/5/7 of each segment scale. |
| `stepsperchord <n>` | 16 | Steps per bare numeral. Total loop length = sum over numerals. |
| `sevenths <0/1>` | 0 | Bare numerals become diatonic 7th chords (Imaj7, iim7, V7, viiø7…). Explicit suffixes always win. |
| `chordweight <x>` | 3 | Multiplier on transitions into chord tones. 1 = off; higher = melody spells the chords harder. |
| `chordtonesonly <0/1>` | 0 | Restrict the walk to chord tones only (bass mode). Per-instance. |
| `anchor <step> <note>` | — | Force a pitch class at a 1-based step of the loop, e.g. `anchor 1 eb`. Multiple anchors OK; must be compatible with that step's chord/scale. |
| `clearanchors` | — | Remove all anchors. |
| `probability <0-100>` | 100 | Chance each tick sounds. Failures are true rests; the walk advances regardless, staying in phase. |
| `velocity <1-127>` | 100 | Note-on velocity. |
| `dejavuchance <0-100>` | 0 | Chance a tick repeats a recent pitch instead of drawing fresh. |
| `dejavulookback <n>` | 4 | How many recent events the repeat can pull from (min 1). |
| `otherNote <pitch/-1>` | -1 | The paired voice's sounding MIDI pitch; -1 = silent, filter off. Camel case, unlike the other messages. |
| `clashintervals <0-6> ...` | 1 | Pitch-class distances to avoid against `otherNote`, e.g. `clashintervals 1 6`. |
| `reset` | — | Note-off anything sounding, clear the walk and deja vu history, restart the loop at step 1. Also happens automatically on every rebuild. |
| `scale <root> <pattern>`, `root <note>`, `scaleidx <0-12>` | c dorian | Fallback single-scale context (used only before any progression is set). |
| `baseoctave <n>`, `octaverange <n>` | 3, 3 | Pitch window for the note pool / progression alphabet. |

**Roman numeral syntax**: numerals `I`–`VII`, optional `b`/`#` prefix (`bVII`, `#IV`), optional quality suffix: `7`, `maj7`, `m7`, `m`, `dim`, `dim7`, `m7b5`/`ø`, `aug`/`+`, `sus2`, `sus4`. Bare diatonic numerals take their natural stacked-thirds quality from the key scale (so case is cosmetic: `vi` and `VI` in Eb major both give C minor); accidental-prefixed bare numerals use case for quality (`bVII` major, `bvii` minor). Secondary dominants (`V/V`) aren't supported yet — spell them out (`II7`).

**Scale names**: `major`, `natural_minor`, `harmonic_minor`, `melodic_minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian`, `pentatonic_major`, `pentatonic_minor`, `blues`, `chromatic`.

Bad messages (unknown numeral, anchor conflicting with a chord, unsatisfiable constraints) are rejected loudly in the Max console and leave the previous state fully intact — safe to experiment live.

### `drum_chain.js`

| Message | Default | Description |
|---|---|---|
| `bang` | — | Advance one step; fire the drawn hit combination, or rest. |
| `totalsteps <n>` | 16 | Loop length (walk position wraps here; min 1). |
| `probability <0-100>` | 100 | Chance each tick fires at all. A failed roll silences the whole tick — the walk still advances. |
| `kickprob <0-100>` | 100 | Per-instrument gate on kick hits, under the global gate. |
| `snareprob <0-100>` | 100 | Per-instrument gate on snare hits. |
| `hihatprob <0-100>` | 100 | Per-instrument gate on hihat hits. |
| `dejavuchance <0-100>` | 0 | Chance a tick repeats a recent hit state instead of drawing fresh. |
| `dejavulookback <n>` | 4 | Repeat window (min 1). |
| `reset` | — | Clear the walk and history, restart at step 1. |

## How it works

For a loop of L steps over an alphabet of n symbols, each position p gets an allowed set (for melody: that step's scale or chord tones ∩ anchors; for drums: everything) and a transition weight (for melody: `1/(interval+1) × chordweight-boost`; for drums: `1/(bits-changed+1)` — Hamming distance between hit states, so patterns evolve by toggling one drum at a time more often than flipping everything at once). The matrices are renormalized right-to-left (the paper's α recurrence) so that constraints anywhere in the loop correctly reshape probabilities everywhere earlier — simple per-row normalization would get these wrong. Building happens once per parameter change; each bang is just one O(n) weighted draw. A wrap matrix handles the loop seam, re-entering step 1 from the previous cycle's last state with the same proximity + constraint logic. All of that lives in `mchain_core.js`, which is deliberately alphabet-agnostic — it never knows whether it's moving pitches or drum hits.
