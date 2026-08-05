// Alphabet-agnostic constrained non-homogeneous Markov machinery.
// The alphabet's meaning is opaque here: callers work in alphabet *indices*
// and supply the semantics through allowed() and weight().

// Build {P0, MT} for a cyclic constrained chain of length totalSteps.
//   alphabet   - array of symbols; only its length is used here
//   totalSteps - number of positions in the cycle (>= 1)
//   allowed(p) - array of alphabet indices permitted at position p; the
//                caller guarantees it is non-empty for every p
//   weight(a, b, p) - unnormalized weight of moving from index a to index b
//                at position p; a === null means the entry draw at position
//                0 with no predecessor (used for P0 and the wrap matrix)
// Returns null when no constraint-satisfying path exists; the caller
// reports the rejection.
exports.buildModel = function (alphabet, totalSteps, allowed, weight) {
    const n = alphabet.length;
    const L = totalSteps;
    const MT = new Array(L);
    const P0 = new Float64Array(n);

    if (L === 1) {
        const allowed0 = allowed(0);
        let z0sum = 0;
        for (const a of allowed0) z0sum += weight(null, a, 0);
        if (z0sum <= 0) return null;
        for (const a of allowed0) P0[a] = weight(null, a, 0) / z0sum;
        MT[0] = new Array(n);
        for (let a = 0; a < n; a++) {
            const row = new Float64Array(n);
            let s = 0;
            for (const b of allowed0) { row[b] = weight(a, b, 0); s += row[b]; }
            if (s > 0) for (const b of allowed0) row[b] /= s;
            MT[0][a] = row;
        }
        return { P0: P0, MT: MT };
    }

    // Right-to-left renormalization: alpha[p][a] is the total probability mass
    // of all constraint-satisfying continuations from index a at position p-1.
    let alphaNext = null;
    for (let p = L - 1; p >= 1; p--) {
        const allowedP = allowed(p);
        const rows = new Array(n);
        const alphaCur = new Float64Array(n);
        for (let a = 0; a < n; a++) {
            const row = new Float64Array(n);
            let s = 0;
            for (const b of allowedP) {
                const z = (p === L - 1)
                    ? weight(a, b, p)
                    : alphaNext[b] * weight(a, b, p);
                row[b] = z;
                s += z;
            }
            if (s > 0) for (const b of allowedP) row[b] /= s;
            alphaCur[a] = s;
            rows[a] = row;
        }
        MT[p] = rows;
        alphaNext = alphaCur;
    }

    const allowed0 = allowed(0);
    let alpha0 = 0;
    for (const a of allowed0) alpha0 += alphaNext[a] * weight(null, a, 0);
    if (alpha0 <= 0) return null;
    for (const a of allowed0) P0[a] = alphaNext[a] * weight(null, a, 0) / alpha0;

    // Wrap matrix for cycle re-entry: transitions from the index at position
    // L-1 back into allowed(0), weighted by each entry's continuation mass.
    MT[0] = new Array(n);
    for (let a = 0; a < n; a++) {
        const row = new Float64Array(n);
        let s = 0;
        for (const b of allowed0) {
            const z = alphaNext[b] * weight(a, b, 0);
            row[b] = z;
            s += z;
        }
        for (const b of allowed0) row[b] /= s;
        MT[0][a] = row;
    }

    return { P0: P0, MT: MT };
};

// Weighted sample from an unnormalized row; returns the drawn index or -1
// if the row has no mass.
exports.drawFrom = function (row) {
    let total = 0;
    for (let i = 0; i < row.length; i++) total += row[i];
    if (total <= 0) return -1;
    const r = Math.random() * total;
    let acc = 0, last = -1;
    for (let i = 0; i < row.length; i++) {
        if (row[i] <= 0) continue;
        last = i;
        acc += row[i];
        if (r <= acc) return i;
    }
    return last;
};

// Roll against chance (0-100). On a hit, return a uniform random pick from
// the most recent `lookback` entries of history (random-within-window, not
// always the newest, so repeats can form short motifs rather than stutters).
// On a miss, or with an empty history, return null: the caller should do a
// fresh draw.
exports.dejaVu = function (history, chance, lookback) {
    if (!history.length || !(chance > 0)) return null;
    if (Math.random() * 100 >= chance) return null;
    const win = history.slice(-Math.max(1, lookback));
    return win[Math.floor(Math.random() * win.length)];
};
