outlets = 3;

const core = require("mchain_core.js");

// Alphabet: 3-bit hit states. bit 2 (4) = kick, bit 1 (2) = snare,
// bit 0 (1) = hihat; 0 = silence, 7 = all three. Values coincide with
// alphabet indices but everything still maps through the alphabet.
const ALPHABET = [0, 1, 2, 3, 4, 5, 6, 7];

let totalSteps = 16;
let probability = 100;
let dejaVuChance = 0;
let dejaVuLookback = 4;
let history = [];

let model = null;
let currentState = undefined;
let posIndex = 0;

function popcount(x) {
    let c = 0;
    while (x) { c += x & 1; x >>= 1; }
    return c;
}

function buildModel() {
    // Hamming distance between hit states plays the role pitch proximity
    // plays in mchains: nearby states (few drums toggled) are favored.
    const weight = (a, b) => a === null ? 1 : 1 / (popcount(a ^ b) + 1);
    const m = core.buildModel(ALPHABET, totalSteps, () => ALPHABET, weight);
    if (!m) { post("drum_chain: model unsatisfiable -- rejected\n"); return false; }
    model = { alphabet: ALPHABET, totalSteps: totalSteps, P0: m.P0, MT: m.MT };
    reset();
    return true;
}

function reset() {
    currentState = undefined;
    posIndex = 0;
    history = [];
}

function bang() {
    if (!model) return;
    const p = posIndex;
    posIndex = (posIndex + 1) % model.totalSteps;

    const dv = core.dejaVu(history, dejaVuChance, dejaVuLookback);
    let idx = (dv !== null) ? model.alphabet.indexOf(dv) : -1;
    if (idx < 0)
        idx = (currentState === undefined)
            ? core.drawFrom(model.P0)
            : core.drawFrom(model.MT[p][currentState]);
    if (idx < 0) {
        post("drum_chain: zero transition row at step " + (p + 1) +
            " -- construction bug, no trigger emitted\n");
        return;
    }
    currentState = idx;
    const state = model.alphabet[idx];

    history.push(state);
    if (history.length > dejaVuLookback)
        history.splice(0, history.length - dejaVuLookback);

    // Gate applies to the whole state: a failed roll is a rest, nothing fires.
    if (Math.random() * 100 < probability) {
        if (state & 4) outlet(0, "bang");
        if (state & 2) outlet(1, "bang");
        if (state & 1) outlet(2, "bang");
    }
}

buildModel();

function anything() {
    if (messagename === "totalsteps") {
        const prev = totalSteps;
        let v = parseInt(arguments[0]);
        if (isNaN(v)) v = 16;
        totalSteps = Math.max(1, v);
        if (!buildModel()) totalSteps = prev;
        else post("drum_chain: totalsteps", totalSteps, "\n");
        return;
    }
    if (messagename === "probability") {
        let v = parseFloat(arguments[0]);
        if (isNaN(v)) v = 100;
        probability = Math.max(0, Math.min(100, v));
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
}
