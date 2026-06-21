// Expected-strokes-to-hole value function.
// Loaded as a plain (non-module) script before the main inline <script>,
// so everything here is a normal global function — no export/import.
//
// index.html calls this as:
//   const counts = buildTransitionCounts(holes);   // { from: { to: count } }
//   delete counts['Hole'];
//   const strokes = computeExpectedStrokes(counts);
// and then reads, per location: strokes[loc].expectedStrokes,
// .sampleSize, .trustworthy, and (optionally) .notes — an array of
// strings rendered verbatim if present.

const MIN_SAMPLES_TO_TRUST = 15;

// Wilson score interval — safer than a raw count/total ratio when n is
// small, since a 2-for-3 location shouldn't read as a confident 67%.
function wilsonInterval(successes, total, z = 1.96) {
  if (total === 0) return { estimate: null, n: 0 };
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    estimate: p,
    low: Math.max(0, (center - margin) / denom),
    high: Math.min(1, (center + margin) / denom),
    n: total
  };
}

function buildProbabilityMatrix(transitionCounts) {
  const matrix = {};
  for (const state of Object.keys(transitionCounts)) {
    const row = transitionCounts[state];
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    matrix[state] = { total, transitions: {} };
    for (const [next, n] of Object.entries(row)) {
      matrix[state].transitions[next] = wilsonInterval(n, total);
    }
  }
  return matrix;
}

// Value iteration rather than a single backward substitution, because the
// chain has self-loops (Rough->Rough, Green->Green from multi-putts) —
// a location's value depends on itself, so it has to converge, not just
// be computed once in hole-order.
function solveExpectedStrokes(probabilityMatrix) {
  const states = Object.keys(probabilityMatrix);
  let V = {};
  states.forEach(s => V[s] = 1);
  V['Hole'] = 0;
  for (let iter = 0; iter < 1000; iter++) {
    let maxDelta = 0;
    const VNext = { ...V };
    for (const state of states) {
      const row = probabilityMatrix[state];
      if (!row || row.total === 0) { VNext[state] = null; continue; }
      let expected = 1;
      for (const [next, info] of Object.entries(row.transitions)) {
        const nv = next === 'Hole' ? 0 : V[next];
        if (nv === null || nv === undefined) continue;
        expected += info.estimate * nv;
      }
      VNext[state] = expected;
      maxDelta = Math.max(maxDelta, Math.abs(expected - (V[state] ?? 0)));
    }
    V = VNext;
    if (maxDelta < 1e-6) break;
  }
  return V;
}

// transitionCounts: sparse object { fromLoc: { toLoc: count, ... }, ... }
// Returns: { [loc]: { expectedStrokes, sampleSize, trustworthy } }
function computeExpectedStrokes(transitionCounts) {
  const matrix = buildProbabilityMatrix(transitionCounts);
  const V = solveExpectedStrokes(matrix);
  const result = {};
  Object.keys(V).forEach(state => {
    if (state === 'Hole') return;
    const total = matrix[state]?.total ?? 0;
    result[state] = {
      expectedStrokes: V[state],
      sampleSize: total,
      trustworthy: total >= MIN_SAMPLES_TO_TRUST
    };
  });
  return result;
}
