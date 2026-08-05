inlets = 2;
outlets = 1;

const core = require("mchain_core.js");

const SCALE_PATTERNS = {
    "major": [2, 2, 1, 2, 2, 2, 1],
    "natural_minor": [2, 1, 2, 2, 1, 2, 2],
    "harmonic_minor": [2, 1, 2, 2, 1, 3, 1],
    "melodic_minor": [2, 1, 2, 2, 2, 2, 1],
    "dorian": [2, 1, 2, 2, 2, 1, 2],
    "phrygian": [1, 2, 2, 2, 1, 2, 2],
    "lydian": [2, 2, 2, 1, 2, 2, 1],
    "mixolydian": [2, 2, 1, 2, 2, 1, 2],
    "locrian": [1, 2, 2, 1, 2, 2, 2],
    "pentatonic_major": [2, 2, 3, 2, 3],
    "pentatonic_minor": [3, 2, 2, 3, 2],
    "blues": [3, 2, 1, 1, 3, 2],
    "chromatic": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
};

const NOTE_NAMES = {
    "c": 0, "c#": 1, "db": 1, "d": 2, "d#": 3, "eb": 3,
    "e": 4, "f": 5, "f#": 6, "gb": 6, "g": 7, "g#": 8, "ab": 8,
    "a": 9, "a#": 10, "bb": 10, "b": 11
};

function mod12(n) { return ((n % 12) + 12) % 12; }

function parseRoot(val) {
    if (typeof val === "string") {
        let lower = val.toLowerCase();
        if (NOTE_NAMES[lower] !== undefined) {
            return NOTE_NAMES[lower];
        }
    }
    let parsed = parseInt(val);
    return isNaN(parsed) ? 0 : parsed;
}

class Scale {
    constructor(root, patternName) {
        this.root = mod12(root);
        this.patternName = patternName;
        const pattern = SCALE_PATTERNS[patternName];
        if (!pattern) throw new Error("Unknown scale: " + patternName);
        const notes = [this.root];
        for (const step of pattern)
            notes.push(mod12((notes[notes.length - 1] ?? 0) + step));
        this._notes = notes[notes.length - 1] === this.root ? notes.slice(0, -1) : notes;
    }
    get degreeCount() { return this._notes.length; }
    noteAtDegree(d) {
        const n = this.degreeCount;
        return this._notes[(((d - 1) % n) + n) % n] ?? this.root;
    }
}

const CHORD_QUALITIES = {
    "major": [0, 4, 7],
    "minor": [0, 3, 7],
    "diminished": [0, 3, 6],
    "augmented": [0, 4, 8],
    "major7": [0, 4, 7, 11],
    "minor7": [0, 3, 7, 10],
    "dominant7": [0, 4, 7, 10],
    "dim7": [0, 3, 6, 9],
    "half-dim7": [0, 3, 6, 10],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
};

const ROMAN_DEGREES = { "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7 };

const ROMAN_SUFFIXES = {
    "maj7": "major7", "M7": "major7",
    "m7": "minor7", "min7": "minor7", "-7": "minor7",
    "dom7": "dominant7",
    "m": "minor", "min": "minor",
    "maj": "major", "M": "major",
    "dim": "diminished", "o": "diminished",
    "dim7": "dim7", "o7": "dim7",
    "m7b5": "half-dim7", "ø": "half-dim7", "ø7": "half-dim7",
    "aug": "augmented", "+": "augmented",
    "sus2": "sus2", "sus4": "sus4",
};

let currentScale = new Scale(0, "dorian");
let baseOctave = 3;
let octaveRange = 3;
let noteList = [];

let noteVelocity = 100;
let probability = 100;
let chordTonesOnly = false;
let chordWeight = 3;
let stepsPerChord = 16;
let sevenths = false;
let anchors = {};
let activeSpec = null;
let model = null;

let soundingNote = null;
let currentNote = undefined;
let posIndex = 0;

let dejaVuChance = 0;
let dejaVuLookback = 4;
let history = [];

let otherNote = -1;
let clashIntervals = new Set([1]);
let clashFallbackWarned = false;

function buildNoteList() {
    noteList = [];
    const n = currentScale.degreeCount;
    const baseNote = 12 * (baseOctave + 1) + currentScale.root;
    for (let ov = 0; ov < octaveRange; ov++) {
        for (let deg = 1; deg <= n; deg++) {
            const pc = currentScale.noteAtDegree(deg);
            noteList.push(baseNote + ov * 12 + mod12(pc - currentScale.root));
        }
    }
    noteList.sort((a, b) => a - b);
    post("scale:", currentScale.patternName, "root:", currentScale.root,
        noteList.length, "notes  MIDI", noteList[0], "-", noteList[noteList.length - 1], "\n");
}

function segmentNotes(scale) {
    const notes = [];
    const baseNote = 12 * (baseOctave + 1) + scale.root;
    for (let ov = 0; ov < octaveRange; ov++)
        for (let deg = 1; deg <= scale.degreeCount; deg++)
            notes.push(baseNote + ov * 12 + mod12(scale.noteAtDegree(deg) - scale.root));
    return notes;
}

function diatonicChordIntervals(keyScale, degree, withSeventh) {
    const root = keyScale.noteAtDegree(degree);
    const intervals = [0,
        mod12(keyScale.noteAtDegree(degree + 2) - root),
        mod12(keyScale.noteAtDegree(degree + 4) - root)];
    if (withSeventh) intervals.push(mod12(keyScale.noteAtDegree(degree + 6) - root));
    return intervals;
}

function parseRomanToken(token, keyScale) {
    let s = String(token);
    let accidental = 0;
    while (s.length && (s[0] === "b" || s[0] === "♭")) { accidental--; s = s.substring(1); }
    while (s.length && (s[0] === "#" || s[0] === "♯")) { accidental++; s = s.substring(1); }
    let numeral = "";
    for (const len of [3, 2, 1]) {
        const cand = s.substring(0, len);
        if (ROMAN_DEGREES[cand.toUpperCase()] !== undefined) {
            numeral = cand;
            s = s.substring(len);
            break;
        }
    }
    if (!numeral) {
        post("markov: can't parse roman numeral '" + token + "'\n");
        return null;
    }
    const degree = ROMAN_DEGREES[numeral.toUpperCase()];
    const isUpper = numeral === numeral.toUpperCase();
    const rootPc = mod12(keyScale.noteAtDegree(degree) + accidental);

    let intervals;
    if (s === "") {
        // Bare numeral: diatonic stacked thirds; accidental-shifted roots
        // have no diatonic stack, so quality comes from the numeral's case.
        if (accidental === 0) intervals = diatonicChordIntervals(keyScale, degree, sevenths);
        else if (sevenths) intervals = CHORD_QUALITIES[isUpper ? "major7" : "minor7"];
        else intervals = CHORD_QUALITIES[isUpper ? "major" : "minor"];
    } else if (s === "7") {
        intervals = CHORD_QUALITIES[isUpper ? "dominant7" : "minor7"];
    } else if (ROMAN_SUFFIXES[s] !== undefined) {
        intervals = CHORD_QUALITIES[ROMAN_SUFFIXES[s]];
    } else {
        post("markov: unknown chord suffix '" + s + "' in '" + token + "'\n");
        return null;
    }
    return { rootPc: rootPc, intervals: intervals };
}

function buildSegmentsFromSpec(spec) {
    if (spec.kind === "scales") {
        return spec.segs.map(sg => {
            const scalePcs = new Set();
            for (let d = 1; d <= sg.scale.degreeCount; d++) scalePcs.add(sg.scale.noteAtDegree(d));
            const chordPcs = new Set([1, 3, 5, 7].map(d => sg.scale.noteAtDegree(d)));
            return { steps: sg.steps, scalePcs, chordPcs, windowNotes: segmentNotes(sg.scale) };
        });
    }
    const keyScale = spec.key;
    const keyPcs = new Set();
    for (let d = 1; d <= keyScale.degreeCount; d++) keyPcs.add(keyScale.noteAtDegree(d));
    const base = 12 * (baseOctave + 1) + keyScale.root;
    const lim = base + octaveRange * 12;
    const out = [];
    for (const item of spec.items) {
        const chord = parseRomanToken(item.token, keyScale);
        if (!chord) return null;
        const chordPcs = new Set(chord.intervals.map(iv => mod12(chord.rootPc + iv)));
        const scalePcs = new Set(keyPcs);
        for (const pc of chordPcs) scalePcs.add(pc);
        const windowNotes = [];
        for (let note = base; note < lim; note++)
            if (scalePcs.has(mod12(note))) windowNotes.push(note);
        out.push({ steps: item.steps ?? stepsPerChord, scalePcs, chordPcs, windowNotes });
    }
    return out;
}

function computeModel(segments) {
    let totalSteps = 0;
    for (const seg of segments) totalSteps += seg.steps;
    if (totalSteps < 1) { post("markov: progression has no steps\n"); return null; }

    const posSeg = [];
    for (const seg of segments)
        for (let i = 0; i < seg.steps; i++) posSeg.push(seg);

    const noteSet = new Set();
    for (const seg of segments)
        for (const note of seg.windowNotes) noteSet.add(note);
    const alphabet = Array.from(noteSet).sort((a, b) => a - b);
    const n = alphabet.length;
    const pcOf = alphabet.map(mod12);

    const segData = new Map();
    for (const seg of segments) {
        if (segData.has(seg)) continue;
        const pcs = chordTonesOnly ? seg.chordPcs : seg.scalePcs;
        const boost = new Float64Array(n);
        for (let b = 0; b < n; b++) boost[b] = seg.chordPcs.has(pcOf[b]) ? chordWeight : 1;
        segData.set(seg, { pcs, boost });
    }

    const allowed = [];
    for (let p = 0; p < totalSteps; p++) {
        const sd = segData.get(posSeg[p]);
        const anchorPc = anchors[p];
        const idx = [];
        for (let a = 0; a < n; a++) {
            if (!sd.pcs.has(pcOf[a])) continue;
            if (anchorPc !== undefined && pcOf[a] !== anchorPc) continue;
            idx.push(a);
        }
        if (!idx.length) {
            post("markov: allowed set at step " + (p + 1) + " is empty" +
                (anchorPc !== undefined ? " (anchor conflicts with segment tones)" : "") +
                " -- progression rejected\n");
            return null;
        }
        allowed.push(idx);
    }
    for (const k in anchors) {
        if (parseInt(k) >= totalSteps)
            post("markov: anchor at step " + (parseInt(k) + 1) +
                " is beyond progression length " + totalSteps + ", ignored\n");
    }

    const boostAt = p => segData.get(posSeg[p]).boost;
    const weight = (a, b, p) =>
        (a === null ? 1 : 1 / (Math.abs(alphabet[a] - alphabet[b]) + 1)) * boostAt(p)[b];
    const m = core.buildModel(alphabet, totalSteps, p => allowed[p], weight);
    if (!m) { post("markov: progression unsatisfiable -- rejected\n"); return null; }
    return { alphabet, totalSteps, P0: m.P0, MT: m.MT };
}

function tryActivateSpec(spec) {
    const segs = buildSegmentsFromSpec(spec);
    if (!segs) return false;
    const m = computeModel(segs);
    if (!m) return false;
    activeSpec = spec;
    model = m;
    clashFallbackWarned = false;
    reset();
    return true;
}

function rebuildModel() {
    if (!activeSpec) return true;
    const segs = buildSegmentsFromSpec(activeSpec);
    if (!segs) return false;
    const m = computeModel(segs);
    if (!m) return false;
    model = m;
    clashFallbackWarned = false;
    reset();
    return true;
}

// Live clash avoidance against the paired voice. Depends on external state
// (otherNote), so it filters at draw time rather than living in the
// precomputed matrices; drawFrom samples proportionally, so no explicit
// renormalization of the filtered row is needed.
function drawClashFiltered(row) {
    if (otherNote < 0) return core.drawFrom(row);
    const n = row.length;
    const filtered = new Float64Array(n);
    let s = 0;
    for (let b = 0; b < n; b++) {
        if (row[b] <= 0) continue;
        const d = mod12(model.alphabet[b] - otherNote);
        if (clashIntervals.has(Math.min(d, 12 - d))) continue;
        filtered[b] = row[b];
        s += row[b];
    }
    if (s <= 0) {
        if (!clashFallbackWarned) {
            clashFallbackWarned = true;
            post("markov: every candidate clashes with otherNote " + otherNote +
                " -- falling back to unfiltered draw (warning once per build)\n");
        }
        return core.drawFrom(row);
    }
    return core.drawFrom(filtered);
}

function allNotesOff() {
    if (soundingNote !== null) {
        outlet(0, soundingNote, 0);
        soundingNote = null;
    }
}

function reset() {
    allNotesOff();
    currentNote = undefined;
    posIndex = 0;
    history = [];
}

function bang() {
    // History stores pitches, not alphabet indices, so a deja vu hit must be
    // mapped back through the current alphabet; a pitch orphaned by a rebuild
    // maps to -1 and falls through to a fresh draw.
    const dv = core.dejaVu(history, dejaVuChance, dejaVuLookback);
    let note;
    if (model) {
        const p = posIndex;
        posIndex = (posIndex + 1) % model.totalSteps;
        let idx = (dv !== null) ? model.alphabet.indexOf(dv) : -1;
        if (idx < 0)
            idx = (currentNote === undefined)
                ? drawClashFiltered(model.P0)
                : drawClashFiltered(model.MT[p][currentNote]);
        if (idx < 0) {
            post("markov: zero transition row at step " + (p + 1) +
                " -- construction bug, no note emitted\n");
            allNotesOff();
            return;
        }
        currentNote = idx;
        note = model.alphabet[idx];
    } else {
        const n = noteList.length;
        if (!n) { post("markov: noteList empty\n"); allNotesOff(); return; }
        let idx = (dv !== null) ? noteList.indexOf(dv) : -1;
        if (idx < 0) {
            if (currentNote === undefined || currentNote >= n) {
                idx = Math.floor(Math.random() * n);
            } else {
                const row = new Float64Array(n);
                for (let j = 0; j < n; j++)
                    row[j] = 1 / (Math.abs(noteList[j] - noteList[currentNote]) + 1);
                idx = core.drawFrom(row);
            }
        }
        currentNote = idx;
        note = noteList[idx];
    }

    history.push(note);
    if (history.length > dejaVuLookback)
        history.splice(0, history.length - dejaVuLookback);

    if (Math.random() * 100 < probability) {
        if (soundingNote !== null) outlet(0, soundingNote, 0);
        outlet(0, note, noteVelocity);
        soundingNote = note;
    } else {
        allNotesOff();
    }
}

function notifydeleted() {
    allNotesOff();
}

buildNoteList();

function anything() {
    if (messagename === "scaleidx") {
        const SCALE_NAMES = [
            "major", "natural_minor", "harmonic_minor", "melodic_minor",
            "dorian", "phrygian", "lydian", "mixolydian", "locrian",
            "pentatonic_major", "pentatonic_minor", "blues", "chromatic"
        ];
        const name = SCALE_NAMES[parseInt(arguments[0]) || 0] || "major";
        try { currentScale = new Scale(currentScale.root, name); buildNoteList(); }
        catch (e) { post("scale error:", e.message, "\n"); }
        return;
    }
    if (messagename === "root") {
        currentScale = new Scale(parseRoot(arguments[0]), currentScale.patternName);
        buildNoteList();
        return;
    }
    if (messagename === "scale") {
        const root = parseRoot(arguments[0]);
        const pattern = String(arguments[1] || "major");
        try {
            currentScale = new Scale(root, pattern);
            buildNoteList();
        } catch (e) { post("scale error:", e.message, "\n"); }
        return;
    }
    if (messagename === "baseoctave") {
        const prev = baseOctave;
        baseOctave = parseInt(arguments[0]) || 3;
        buildNoteList();
        if (!rebuildModel()) { baseOctave = prev; buildNoteList(); }
        return;
    }
    if (messagename === "octaverange") {
        const prev = octaveRange;
        octaveRange = Math.max(1, parseInt(arguments[0]) || 3);
        buildNoteList();
        if (!rebuildModel()) { octaveRange = prev; buildNoteList(); }
        return;
    }
    if (messagename === "progression") {
        const args = Array.prototype.slice.call(arguments);
        if (!args.length || args.length % 3 !== 0) {
            post("markov: usage: progression <root> <scale> <steps> [<root> <scale> <steps> ...]\n");
            return;
        }
        const segs = [];
        for (let i = 0; i < args.length; i += 3) {
            const pattern = String(args[i + 1]);
            const steps = parseInt(args[i + 2]);
            if (isNaN(steps) || steps < 1) {
                post("markov: bad step count '" + args[i + 2] + "'\n");
                return;
            }
            try { segs.push({ scale: new Scale(parseRoot(args[i]), pattern), steps: steps }); }
            catch (e) { post("markov:", e.message, "\n"); return; }
        }
        if (tryActivateSpec({ kind: "scales", segs: segs }))
            post("markov: progression active --", segs.length, "segments,",
                model.totalSteps, "steps, alphabet", model.alphabet.length, "notes\n");
        return;
    }
    if (messagename === "roman") {
        const args = Array.prototype.slice.call(arguments);
        if (args.length < 3) {
            post("markov: usage: roman <key> <scale> <numeral> [steps] [<numeral> [steps] ...]\n");
            return;
        }
        let key;
        try { key = new Scale(parseRoot(args[0]), String(args[1])); }
        catch (e) { post("markov:", e.message, "\n"); return; }
        const items = [];
        for (let i = 2; i < args.length; i++) {
            const tok = args[i];
            if (typeof tok === "number" || String(parseInt(tok)) === String(tok)) {
                const steps = parseInt(tok);
                if (!items.length) { post("markov: step count '" + tok + "' before any numeral\n"); return; }
                if (isNaN(steps) || steps < 1) { post("markov: bad step count '" + tok + "'\n"); return; }
                items[items.length - 1].steps = steps;
            } else {
                items.push({ token: String(tok), steps: null });
            }
        }
        if (!items.length) { post("markov: no numerals in roman message\n"); return; }
        if (tryActivateSpec({ kind: "roman", key: key, items: items }))
            post("markov: roman progression active --",
                items.map(it => it.token).join(" "), "in key", key.root,
                key.patternName, "--", model.totalSteps, "steps, alphabet",
                model.alphabet.length, "notes\n");
        return;
    }
    if (messagename === "stepsperchord") {
        const prev = stepsPerChord;
        stepsPerChord = Math.max(1, parseInt(arguments[0]) || 16);
        if (!rebuildModel()) stepsPerChord = prev;
        return;
    }
    if (messagename === "sevenths") {
        const prev = sevenths;
        sevenths = !!parseInt(arguments[0]);
        if (sevenths !== prev && !rebuildModel()) sevenths = prev;
        return;
    }
    if (messagename === "chordweight") {
        const prev = chordWeight;
        let v = parseFloat(arguments[0]);
        if (isNaN(v)) v = 3;
        chordWeight = Math.max(0, v);
        if (!rebuildModel()) chordWeight = prev;
        return;
    }
    if (messagename === "anchor") {
        const step = parseInt(arguments[0]);
        if (isNaN(step) || step < 1) {
            post("markov: usage: anchor <step 1-based> <root>\n");
            return;
        }
        const prev = anchors[step - 1];
        anchors[step - 1] = mod12(parseRoot(arguments[1]));
        if (!rebuildModel()) {
            if (prev === undefined) delete anchors[step - 1];
            else anchors[step - 1] = prev;
        }
        return;
    }
    if (messagename === "clearanchors") {
        anchors = {};
        rebuildModel();
        return;
    }
    if (messagename === "chordtonesonly") {
        const prev = chordTonesOnly;
        chordTonesOnly = !!parseInt(arguments[0]);
        if (chordTonesOnly !== prev && !rebuildModel()) chordTonesOnly = prev;
        return;
    }
    if (messagename === "probability") {
        let v = parseFloat(arguments[0]);
        if (isNaN(v)) v = 100;
        probability = Math.max(0, Math.min(100, v));
        return;
    }
    if (messagename === "velocity") {
        let v = parseInt(arguments[0]);
        if (isNaN(v)) v = 100;
        noteVelocity = Math.max(1, Math.min(127, v));
        return;
    }
    if (messagename === "dejavuchance") {
        let v = parseFloat(arguments[0]);
        if (isNaN(v)) v = 0;
        dejaVuChance = Math.max(0, Math.min(100, v));
        return;
    }
    if (messagename === "dejavulookback") {
        let v = parseInt(arguments[0]);
        if (isNaN(v)) v = 4;
        dejaVuLookback = Math.max(1, v);
        if (history.length > dejaVuLookback)
            history.splice(0, history.length - dejaVuLookback);
        return;
    }
    if (messagename === "otherNote") {
        let v = parseInt(arguments[0]);
        if (isNaN(v) || v < 0) v = -1;
        otherNote = v;
        return;
    }
    if (messagename === "clashintervals") {
        const vals = [];
        for (let i = 0; i < arguments.length; i++) {
            const v = parseInt(arguments[i]);
            if (!isNaN(v) && v >= 0 && v <= 6) vals.push(v);
            else post("markov: clashintervals: ignoring '" + arguments[i] +
                "' (want semitones 0-6)\n");
        }
        if (!vals.length) {
            post("markov: usage: clashintervals <semitones 0-6> ...\n");
            return;
        }
        clashIntervals = new Set(vals);
        return;
    }
    post("markov: unknown message '" + messagename + "'\n");
}
