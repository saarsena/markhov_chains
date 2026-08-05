# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Max/MSP scripts implementing constrained non-homogeneous Markov generation (Pachet, Roy & Barbieri, "Finite-Length Markov Processes with Constraints", IJCAI 2011), split across three files:

- `mchains.js` — bang-driven, single-note-per-tick melody generator over a chord/scale progression (the original object; formerly `building_scale.js`).
- `mchain_core.js` — the alphabet-agnostic matrix math, loaded by both objects via CommonJS `require()`. It must contain zero pitch/chord/drum knowledge; if something domain-specific seems to belong there, it belongs in the calling file instead.
- `drum_chain.js` — drum voice over an 8-state alphabet (3-bit kick/snare/hihat combinations), reusing the same core.

There is no build system, package manager, or checked-in test suite — files are loaded into a Max patcher via a `v8` object (Max 9 / Max 8.6+; the code uses `class`, `??`, `const`, so the legacy ES5 `js` object won't work). Max resolves `require("mchain_core.js")` relative to the loading script, so all three files stay in one folder.

Max-specific globals in use: `outlets`, `outlet()`, `post()`, `messagename`/`anything()`, plus the specially-dispatched function names `bang()`, `reset()`, and `notifydeleted()`. These are undefined outside Max; the files can be tested offline in a Node `vm` context with those globals stubbed and a `require` shim that loads `mchain_core.js` (note: `reset` dispatches to the global `reset()` function, not through `anything()`).

## Core module API (`mchain_core.js`)

- `buildModel(alphabet, totalSteps, allowed, weight)` → `{P0, MT}` or `null` (unsatisfiable — the *caller* posts the rejection). `allowed(p)` returns the alphabet **indices** permitted at position p (caller pre-validates non-emptiness). `weight(a, b, p)` is the unnormalized transition weight into index b at position p; **`a === null` means the entry draw at position 0 with no predecessor** (used for P0 and the wrap matrix). The signature carries `p` because mchains' chord-tone boost is position-dependent — a pure `weight(a, b)` cannot express it.
- `drawFrom(row)` — weighted sample, returns index or -1 on a massless row.
- `dejaVu(history, chance, lookback)` — rolls against `chance` (0-100); on a hit returns a uniform random pick from the last `lookback` entries of `history` (random-within-window by design, so repeats form motifs, not stutters); on a miss or empty history returns `null` = "caller does a fresh draw". Deliberately knows nothing about the play/rest probability gate.

## Architecture (`mchains.js`)

Data flow: `bang` (derived from phasor~ edge detection in the patcher) → `bang()` advances the walk exactly one step → deja vu roll; on a miss, draw an alphabet index from `P0` (first draw after load/reset) or row `MT[posIndex][currentNote]` → push the candidate pitch onto `history` (every tick, played or rested) → roll the probability gate → emit `outlet(0, note, velocity)` or a rest. Note-off is a note-on with velocity 0 (the same convention `makenote` uses internally). `soundingNote` tracks what is audible; any state change (new note, rest, rebuild, `reset`, object deletion via `notifydeleted()`) sends the matching note-off first — a note can never hang or double.

- **Specs and segments**: `activeSpec` is `{kind: "scales", segs}` (from the `progression` message) or `{kind: "roman", key, items}` (from `roman`). `buildSegmentsFromSpec()` turns either into unified segments `{steps, scalePcs, chordPcs, windowNotes}`; `computeModel()` builds the alphabet/allowed/boost structures and delegates the matrix math to `core.buildModel`, returning `{alphabet, totalSteps, P0, MT}`. With no spec active, `bang()` falls back to a plain proximity-weighted walk over `noteList` (the single-scale context from `scale`/`root`/`baseoctave`/`octaverange`).
- **allowed(p)** = (`chordTonesOnly` ? `chordPcs` : `scalePcs`) intersected with any anchor at p. Transition weight into note b at position p = `1/(|a−b|+1)` × `chordWeight` if b's pitch class is a chord tone of p's segment (the `a === null` entry weight is the boost alone). The renormalization is weight-agnostic, so the boost needs no special math.
- **Renormalization**: matrices are built once per parameter change (never inside `bang()`), using the paper's right-to-left recurrence (`alpha` back-propagation). `MT[0]` is a *wrap matrix* not found in the paper (which is finite-length): it handles cycle re-entry into position 0 from the previous cycle's last note, weighted by each entry note's continuation mass `alpha[1]`. Zero rows in mid-cycle matrices mark structurally unreachable states and are expected; a zero row actually being *drawn from* indicates a construction bug and is logged loudly.
- **Deja vu**: `history` stores **pitches** (MIDI numbers, not alphabet indices) so it survives model/fallback mode switches; a hit is mapped back via `alphabet.indexOf` (or `noteList.indexOf`), and a pitch orphaned by a rebuild maps to -1 and falls through to a fresh draw. `reset()` clears history (a rebuild may have changed the alphabet). History is trimmed to `dejaVuLookback` on every push and on lookback shrink.
- **Roman parsing** (`parseRomanToken`): optional `b`/`#` accidental prefix, numeral I–VII (longest match, case-insensitive lookup), then suffix. Bare diatonic numerals get stacked-thirds qualities from the key scale (`diatonicChordIntervals`), so `I V vi IV` in major yields major/major/minor/major automatically regardless of case; the `sevenths` flag stacks a fourth third. Accidental-prefixed bare numerals (e.g. `bVII`) can't be derived diatonically, so quality comes from the numeral's case. Explicit suffixes (`7`, `maj7`, `m7b5`, `ø`, `dim`, `sus4`, …) always win via `ROMAN_SUFFIXES`/`CHORD_QUALITIES`. Secondary dominants (`V/V`) are not supported.
- **Alphabet window**: scales-kind segments generate notes anchored at each segment root (`segmentNotes()`); roman-kind segments use one window anchored at the key root, `[12*(baseOctave+1)+keyRoot, +octaveRange*12)`, admitting every pitch class in key scale ∪ chord tones (so borrowed-chord tones exist in the alphabet).

## Architecture (`drum_chain.js`)

Same skeleton as mchains (build once, cheap `bang()`), radically simpler semantics: alphabet = integers 0-7 as 3-bit hit states — bit 2 (4) = kick, bit 1 (2) = snare, bit 0 (1) = hihat; `weight(a, b) = 1/(popcount(a XOR b)+1)` (Hamming distance, the drum analogue of pitch proximity); `allowed(p)` returns the full alphabet at every position — no positional constraint types exist yet, deliberately. Alphabet values coincide with indices, but the code still maps through `alphabet[idx]`/`indexOf` for symmetry with mchains. The probability gate applies to the whole state as a unit: a failed roll fires nothing; a pass sends `bang` on outlet 0/1/2 for each set bit. Triggers, not notes — no note-off bookkeeping, no `notifydeleted`. Same deja vu mechanics as mchains with history holding states 0-7.

## Message API

`mchains.js` (single inlet/outlet):

- `bang` — advance one step; emit note-on or (gate-failed) rest
- `roman <key> <scale> <numeral> [steps] ...` — e.g. `roman eb major I V vi IV`; integer tokens override the preceding numeral's step count
- `progression <root> <scale> <steps> ...` — flat triples; per-segment scales instead of numerals
- `stepsperchord <n>` — default steps per bare numeral (default 16)
- `sevenths <0|1>` — bare numerals become diatonic 7th chords (default 0)
- `chordweight <x>` — chord-tone transition boost, 1 = off (default 3)
- `chordtonesonly <0|1>` — restrict allowed notes to chord tones (default 0)
- `anchor <step 1-based> <note>` / `clearanchors` — force a pitch class at a position
- `probability <0-100>` — gate; failures are true rests (default 100)
- `velocity <1-127>` — note-on velocity (default 100)
- `dejavuchance <0-100>` — chance a tick repeats a recent pitch instead of a fresh draw (default 0 = off)
- `dejavulookback <n>` — history window size, min 1 (default 4)
- `reset` — flush sounding note, clear walk state + history, posIndex → 0
- `scale <root> <pattern>` / `root <note>` / `scaleidx <0-12>` — fallback single-scale context
- `baseoctave <n>` / `octaverange <n>` — pitch window (defaults 3 / 3); trigger a model rebuild when a progression is active

`drum_chain.js` (single inlet, 3 outlets: 0 = kick, 1 = snare, 2 = hihat):

- `bang` — advance one step; fire the drawn state's bits or rest
- `totalsteps <n>` — loop length / posIndex wrap point, min 1 (default 16)
- `probability <0-100>`, `dejavuchance <0-100>`, `dejavulookback <n>`, `reset` — as in mchains

## Gotchas

- Rebuilds are commit-on-success in both objects: if the build rejects (empty allowed set, unsatisfiable chain), the old model stays active AND the mutated parameter is reverted (see the `prev` pattern in `anything()`). A bad live message can never leave a stuck note or a stale-size matrix.
- Anchors *intersect* the segment's allowed set — anchoring a pitch class outside the segment's scale/chord tones empties allowed(p) and rejects the whole build (logged, state reverted).
- Adding a scale still requires updating both `SCALE_PATTERNS` and the `SCALE_NAMES` array inside `anything()` (the `scaleidx` order differs from key order).
- `chordweight 0` legally zeroes chord-tone columns; combined with `chordtonesonly 1` this makes the build unsatisfiable — it is rejected, not clamped.
- `parseInt(arguments[0]) || 0` patterns treat `0` and non-numeric input identically in the older handlers (`scaleidx`, `baseoctave`).
- In the `roman` message, any token that parses as a pure integer is consumed as a step count for the *preceding* numeral — a numeral can never look like an integer, so the grammar is unambiguous.
- The core extraction changed float multiplication grouping (`alpha·(w·boost)` vs the old `(alpha·w)·boost`), so matrices match the pre-refactor build to ~1e-12 relative, not bit-exactly — compare with tolerance, never with string equality, when regression-testing against old output.
- Deja vu history updates on *every* tick, including rests and repeats — the gate sits after history maintenance in `bang()`, and that ordering is intentional.
