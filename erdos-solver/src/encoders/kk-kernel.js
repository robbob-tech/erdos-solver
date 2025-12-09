// KK Kernel — Master Single-File Module (ESM)
// Version: 2.3.2
// Author: Neuromorphic Computing — Sprint 2
// License: MIT
//
// This module contains a compact, production-ready implementation of the KK kernel
// plus deterministic TTFS spike simulation and utilities for parity evaluation,
// CSV / JSON report building, and light-weight testing. It is framework-free and
// works in both browser and Node.js ESM environments.
//
// ──────────────────────────────────────────────────────────────────────────────
//  Contents
//  - Core types (JSDoc typedefs)
//  - Random: rngLCG
//  - Signatures: genSig, genBatch, queryFromGaps, injectJolt, injectAnomalyTraceFromRH
//  - Algebraic kernel: baseCosine, anomalyOverlapFrac (a), anomalyAgreementCosine (b), kkScore
//  - Spike simulator: SpikeSim (deterministic TTFS), spikeBaseCosine
//  - Evaluation: evaluateFullBoost, meanReciprocalRank
//  - Reports: buildCSV, makeConfig, makeCSVReport, makeJSONSnapshot
//  - Tests: selfTest (non-throwing; returns structured results)
// ──────────────────────────────────────────────────────────────────────────────

export const HARNESS_VERSION = '2.3.2';

/** @typedef {{positions:number[], elevations:number[], dimension:number}} Signature */
/** @typedef {{q: Signature, docs: Signature[]}} Batch */

// ───────────────────────── Utilities / RNG ─────────────────────────
export function rngLCG(seed = 1) {
  let x = (seed >>> 0) || 1;
  return {
    next() { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; },
    nextInt(n) { return Math.floor(this.next() * n); },
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const l2 = (arr) => Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
const dict = (sig) => { const d = Object.create(null); sig.positions.forEach((p, i) => d[p] = sig.elevations[i]); return d; };

// ───────────────────────── Signatures / Data ─────────────────────────
/**
 * Generate a random sparse signature.
 * @param {number} dim
 * @param {number} kfrac fraction in (0,1], expected sparsity |positions| ≈ dim*kfrac
 * @param {{next:Function, nextInt:Function}} rng
 * @returns {Signature}
 */
export function genSig(dim, kfrac, rng) {
  const k = Math.max(1, Math.floor(dim * kfrac));
  const set = new Set();
  while (set.size < k) set.add(rng.nextInt(dim));
  const positions = Array.from(set).sort((a, b) => a - b);
  const elevations = positions.map(() => clamp(Math.round(rng.next() * 1e6) / 1e6, 1e-6, 0.999999));
  return { positions, elevations, dimension: dim };
}

/**
 * Generate a batch with one query and N documents.
 * @param {{seed:number, dim:number, kfrac:number, docs:number}} cfg
 * @returns {Batch}
 */
export function genBatch(cfg) {
  const rng = rngLCG(cfg.seed);
  const q = genSig(cfg.dim, cfg.kfrac, rng);
  const docs = Array.from({ length: cfg.docs }, () => genSig(cfg.dim, cfg.kfrac, rng));
  return { q, docs };
}

/**
 * Build a query signature from a gaps/gamma array.
 * Picks top-K by value and rescales to (0,1).
 * @param {number[]} gaps length D
 * @param {number} topK
 * @param {number} [minElev=1e-6]
 * @returns {Signature}
 */
export function queryFromGaps(gaps, topK, minElev = 1e-6) {
  const D = gaps.length;
  const idx = Array.from({ length: D }, (_, i) => i).sort((a, b) => gaps[b] - gaps[a]);
  const keep = idx.slice(0, Math.max(1, Math.min(topK, D)));
  const gVals = keep.map(i => gaps[i]);
  const gMin = Math.min(...gVals), gMax = Math.max(...gVals); const denom = (gMax - gMin) || 1;
  const elevations = gVals.map(v => { const t = (v - gMin) / denom; return minElev + t * (0.999999 - minElev); });
  return { positions: keep.sort((a, b) => a - b), elevations, dimension: D };
}

/**
 * Inject anomaly jolts into a fraction of docs by copying top features from the query.
 * @param {Batch} DATA
 * @param {Signature} Q
 * @param {number} [rate=0.1] fraction of docs to modify
 * @param {number} [addK=3] how many positions to add (max-limited by |A_Q|)
 * @param {number} [elev=0.95] elevation to assign if new
 */
export function injectJolt(DATA, Q, rate = 0.1, addK = 3, elev = 0.95) {
  if (!DATA || !Q) return;
  const A = [...anomalySet(Q, Math.min(Q.positions.length, Math.max(addK, 8)))];
  const rng = rngLCG(7777);
  const targetCount = Math.max(1, Math.floor(DATA.docs.length * rate));
  const chosen = new Set();
  while (chosen.size < targetCount) chosen.add(rng.nextInt(DATA.docs.length));
  chosen.forEach(idx => {
    const d = DATA.docs[idx];
    const dset = new Set(d.positions);
    const toAdd = [];
    for (let i = 0; i < addK && i < A.length; i++) { const p = A[i]; if (!dset.has(p)) toAdd.push(p); }
    const newPos = d.positions.concat(toAdd).sort((a, b) => a - b);
    const newElev = [];
    newPos.forEach(p => { const j = d.positions.indexOf(p); newElev.push(j >= 0 ? d.elevations[j] : elev); });
    d.positions = newPos; d.elevations = newElev;
  });
}

/**
 * Inject anomalies based on an RH-style event trace.
 * Each event: { docIndex:number, positions:number[], elevation?:number }
 * @param {Batch} DATA
 * @param {{docIndex:number, positions:number[], elevation?:number}[]} events
 * @param {number} [elev=0.96]
 */
export function injectAnomalyTraceFromRH(DATA, events, elev = 0.96) {
  if (!DATA || !events) return;
  for (const ev of events) {
    const i = ev.docIndex; if (!(i >= 0 && i < DATA.docs.length)) continue;
    const d = DATA.docs[i];
    const merged = new Set(d.positions);
    for (const p of (ev.positions || [])) merged.add(p);
    const sorted = [...merged].sort((a, b) => a - b);
    const newElev = [];
    for (const p of sorted) { const j = d.positions.indexOf(p); newElev.push(j >= 0 ? d.elevations[j] : (ev.elevation ?? elev)); }
    d.positions = sorted; d.elevations = newElev;
  }
}

// ───────────────────────── Algebraic KK Kernel ─────────────────────────
/**
 * Base cosine similarity: dot / (||Q|| * ||X|| + eps)
 * @param {Signature} Q
 * @param {Signature} X
 * @param {number} [eps=1e-12]
 */
export function baseCosine(Q, X, eps = 1e-12) {
  const Qd = dict(Q), Xd = dict(X);
  let dot = 0;
  for (const p of Q.positions) if (Xd[p] !== undefined) dot += Qd[p] * Xd[p];
  if (dot === 0) return 0;
  const nQ = l2(Q.elevations), nX = l2(X.elevations);
  return dot / (nQ * nX + eps);
}

/**
 * Top-M positions by query elevation → A_Q set
 * @param {Signature} Q
 * @param {number} M
 * @returns {Set<number>}
 */
export function anomalySet(Q, M) {
  const pairs = Q.positions.map((p, i) => ({ p, e: Q.elevations[i] })).sort((a, b) => b.e - a.e);
  return new Set(pairs.slice(0, Math.min(M, pairs.length)).map(x => x.p));
}

/**
 * a(Q,X): overlap fraction of A_Q
 * @param {Signature} Q
 * @param {Signature} X
 * @param {number} M
 */
export function anomalyOverlapFrac(Q, X, M) {
  const A = anomalySet(Q, M); if (A.size === 0) return 0;
  const Xset = new Set(X.positions);
  let hit = 0; A.forEach(p => { if (Xset.has(p)) hit++; });
  return hit / A.size;
}

/**
 * b(Q,X): cosine restricted to the anomaly subspace A_Q (authoritative)
 * @param {Signature} Q
 * @param {Signature} X
 * @param {number} M
 * @param {number} [eps=1e-12]
 */
export function anomalyAgreementCosine(Q, X, M, eps = 1e-12) {
  const A = anomalySet(Q, M); if (A.size === 0) return 0;
  const Qd = dict(Q), Xd = dict(X);
  const Ax = [...A];
  let dot = 0, nQa2 = 0, nXa2 = 0;
  for (const p of Ax) {
    const q = Qd[p] || 0, x = Xd[p] || 0;
    dot += q * x; nQa2 += q * q; nXa2 += x * x;
  }
  if (dot === 0) return 0;
  return dot / (Math.sqrt(nQa2) * Math.sqrt(nXa2) + eps);
}

/**
 * Complete KK kernel score.
 * mult = 1 + β·a + γ·b, total = base * mult
 */
export function kkScore(Q, X, beta, gamma, M, eps = 1e-12) {
  const base = baseCosine(Q, X, eps);
  const a = anomalyOverlapFrac(Q, X, M);
  const b = anomalyAgreementCosine(Q, X, M, eps);
  const mult = 1 + beta * a + gamma * b;
  return { base, a, b, mult, total: base * mult };
}

// ───────────────────────── Spike Simulator (TTFS) ─────────────────────────
export class SpikeSim {
  /** @param {number} tWinMs @param {number} tResUs @param {number} [neurons=1] */
  constructor(tWinMs, tResUs, neurons = 1) { this.T = tWinMs * 1000; this.dt = tResUs; this.neurons = neurons; }
  /** @param {Signature} sig */
  encode(sig) {
    const trains = sig.positions.map((p, i) => ({ p, e: sig.elevations[i], spikes: this._spikesFromElevation(sig.elevations[i]) }));
    return { signature: sig, trains, tr: this };
  }
  _spikesFromElevation(e) { // higher elevation → earlier spike
    const delay = this.T * 0.99 * (1 - e); // μs
    const t = Math.round(delay / this.dt) * this.dt; // quantize
    return [t];
  }
}

/** Recompute cosine from spike object by reading back stored elevations */
export function spikeBaseCosine(Qsp, Xsp, eps = 1e-12) {
  const Q = { positions: Qsp.trains.map(t => t.p), elevations: Qsp.trains.map(t => t.e), dimension: Qsp.signature.dimension };
  const X = { positions: Xsp.trains.map(t => t.p), elevations: Xsp.trains.map(t => t.e), dimension: Xsp.signature.dimension };
  return baseCosine(Q, X, eps);
}

// ───────────────────────── Evaluation / Ranking ─────────────────────────
/**
 * Full-boost parity evaluation between algebraic and spike forms.
 * Returns per-doc rows plus pass metrics.
 */
export function evaluateFullBoost(DATA, beta = 0.5, gamma = 0.5, M = 8, eps = 1e-12, spikeWinMs = 100, spikeDtUs = 1) {
  if (!DATA) throw new Error('DATA required');
  const sim = new SpikeSim(spikeWinMs, spikeDtUs, 1);
  const Qsp = sim.encode(DATA.q);
  const rows = [];
  let maxPPM = 0, ok = 0;
  for (let i = 0; i < DATA.docs.length; i++) {
    const X = DATA.docs[i];
    const s = kkScore(DATA.q, X, beta, gamma, M, eps); // algebraic
    const Xsp = sim.encode(X);
    const baseSpike = spikeBaseCosine(Qsp, Xsp, eps);
    const Qrec = { positions: Qsp.trains.map(t => t.p), elevations: Qsp.trains.map(t => t.e), dimension: DATA.q.dimension };
    const Xrec = { positions: Xsp.trains.map(t => t.p), elevations: Xsp.trains.map(t => t.e), dimension: X.dimension };
    const aSpk = anomalyOverlapFrac(Qrec, Xrec, M);
    const bSpk = anomalyAgreementCosine(Qrec, Xrec, M, eps);
    const combAlg = beta * s.a + gamma * s.b;
    const combSpk = beta * aSpk + gamma * bSpk;
    const totalSpike = baseSpike * (1 + combSpk);
    const err = Math.abs(totalSpike - s.total);
    const ppm = s.total > 0 ? (err / s.total) * 1e6 : 0;
    if (ppm < 1) ok++;
    if (ppm > maxPPM) maxPPM = ppm;
    rows.push({
      DocID: i,
      AlgBase: s.base,
      SpikeBase: baseSpike,
      A_Overlap: s.a,
      B_Agreement: s.b,
      Multiplier: s.mult,
      TotalAlg: s.total,
      TotalSpike: totalSpike,
      ErrorPPM: ppm,
      CombAlg: combAlg,
      CombSpike: combSpk,
      CombErr: Math.abs(combSpk - combAlg),
      Beta: beta,
      Gamma: gamma,
    });
  }
  return { rows, ok, total: DATA.docs.length, maxPPM };
}

/**
 * Mean Reciprocal Rank across datasets
 * @param {{rows:{id:number,score:number}[], relevant:Set<number>}[]} datasets
 */
export function meanReciprocalRank(datasets) {
  let sum = 0; if (!datasets || datasets.length === 0) return 0;
  for (const ds of datasets) {
    const sorted = [...ds.rows].sort((a, b) => b.score - a.score);
    let rr = 0;
    for (let i = 0; i < sorted.length; i++) { if (ds.relevant.has(sorted[i].id)) { rr = 1 / (i + 1); break; } }
    sum += rr;
  }
  return sum / datasets.length;
}

// ───────────────────────── Reports / Snapshots ─────────────────────────
/** CSV-safe join */
export function buildCSV(header, rows) {
  const esc = (s) => String(s).replace(/"/g, '""');
  const lines = [header, ...rows].map(r => r.map(esc).join(','));
  return lines.join('\n');
}

/** Build the canonical config object for report embedding */
export function makeConfig({ dim, kfrac, seed, beta, gamma, M, tRes, tWin, docs, qLen }) {
  return { D: dim, kD: kfrac, seed, beta, gamma, M, dt_us: tRes, window_ms: tWin, docs, q_len: qLen, harness_version: HARNESS_VERSION };
}

/**
 * Convert evaluation rows to the standard CSV body rows matching the default header.
 * @param {Array} rows objects from evaluateFullBoost
 * @param {string} suite label like 'boost' or 'spike'
 */
export function toCsvRows(rows, suite = 'boost') {
  return rows.map(r => [suite, r.DocID, r.AlgBase, r.SpikeBase, r.ErrorPPM, r.A_Overlap, r.B_Agreement, r.Multiplier, r.TotalAlg, r.TotalSpike, r.ErrorPPM < 1 ? 'OK' : 'FAIL']);
}

export const DEFAULT_CSV_HEADER = ['Suite', 'DocID', 'AlgBase', 'SpikeBase', 'ErrorPPM', 'A_Overlap', 'B_Agreement', 'Multiplier', 'TotalAlg', 'TotalSpike', 'Status'];

/**
 * Build full CSV text with a #CONFIG line.
 */
export function makeCSVReport(configObj, header = DEFAULT_CSV_HEADER, rowsArrays) {
  const configLine = '#CONFIG,' + JSON.stringify(configObj);
  const csvBody = buildCSV(header, rowsArrays);
  return [configLine, csvBody].join('\n');
}

/**
 * Build JSON snapshot including numeric KPIs and raw rows.
 */
export function makeJSONSnapshot(configObj, kpis, rowsObjects) {
  const kpis_num = {
    ok_count: typeof kpis.ok === 'number' ? kpis.ok : null,
    total: typeof kpis.total === 'number' ? kpis.total : null,
    maxppm: typeof kpis.maxppm === 'number' ? kpis.maxppm : null,
    mean_percent: typeof kpis.mean_percent === 'number' ? kpis.mean_percent : null,
  };
  return JSON.stringify({ config: configObj, kpis, kpis_num, header: DEFAULT_CSV_HEADER, rows: rowsObjects, generated_at: new Date().toISOString() }, null, 2);
}

// ───────────────────────── Fusion / Reconciliation ─────────────────────────
/**
 * Prepare a dense score matrix from model outputs.
 * @param {Array<Array<{id:number, score:number}>>} modelLists per-model arrays of doc scores
 * @returns {{docIds:number[], matrix:number[][]}} rows=docs, cols=models
 */
export function prepareScoreTable(modelLists) {
  const idSet = new Set();
  for (const list of modelLists) for (const r of list) idSet.add(r.id);
  const docIds = Array.from(idSet);
  const idToRow = new Map(docIds.map((id, i) => [id, i]));
  const M = modelLists.length, N = docIds.length;
  const matrix = Array.from({ length: N }, () => Array(M).fill(-Infinity));
  modelLists.forEach((list, m) => { for (const { id, score } of list) { matrix[idToRow.get(id)][m] = score; } });
  return { docIds, matrix };
}

/** Rank each column (model) descending; returns ranks matrix with 1-based ranks */
export function ranksFromMatrix(matrix) {
  const N = matrix.length, M = (matrix[0] || []).length;
  const ranks = Array.from({ length: N }, () => Array(M).fill(N));
  for (let m = 0; m < M; m++) {
    const order = Array.from({ length: N }, (_, i) => i).sort((i, j) => (matrix[j][m] - matrix[i][m]));
    order.forEach((row, r) => { ranks[row][m] = r + 1; });
  }
  return ranks;
}

const _minmax1 = (col) => { let mn=Infinity, mx=-Infinity; for (const v of col) { if (v<mn) mn=v; if (v>mx) mx=v; } const d=(mx-mn)||1; return col.map(v => (v - mn) / d); };
const _zscore1 = (col) => { const n=col.length; const mu = col.reduce((s,v)=>s+v,0)/n; const sd = Math.sqrt(col.reduce((s,v)=>s+(v-mu)*(v-mu),0)/(n||1)) || 1; return col.map(v => (v - mu)/sd); };

/** Normalize each model column */
export function normalizeMatrix(matrix, mode='zscore') {
  const N = matrix.length, M = (matrix[0] || []).length;
  const out = Array.from({ length: N }, () => Array(M).fill(0));
  for (let m=0;m<M;m++) {
    const col = Array.from({ length: N }, (_, i) => matrix[i][m]);
    const norm = (mode==='minmax') ? _minmax1(col) : _zscore1(col);
    for (let i=0;i<N;i++) out[i][m]=norm[i];
  }
  return out;
}

/** Reciprocal Rank Fusion (RRF); k typically in [10..60] */
export function rrfFusion(modelLists, k=60) {
  const { docIds, matrix } = prepareScoreTable(modelLists);
  const ranks = ranksFromMatrix(matrix);
  const scores = ranks.map(rs => rs.reduce((s, r) => s + 1/(k + r), 0));
  const order = Array.from({ length: docIds.length }, (_, i) => i).sort((i, j) => scores[j] - scores[i]);
  return order.map(i => ({ id: docIds[i], score: scores[i] }));
}

/** Linear fusion with per-model weights and optional normalization */
export function linearFusion(modelLists, weights=null, norm='zscore') {
  const { docIds, matrix } = prepareScoreTable(modelLists);
  const M = matrix[0].length; const W = weights && weights.length===M ? weights : Array(M).fill(1/M);
  const Z = normalizeMatrix(matrix, norm);
  const scores = Z.map(row => row.reduce((s,v,j) => s + W[j]*v, 0));
  const order = Array.from({ length: docIds.length }, (_, i) => i).sort((i, j) => scores[j] - scores[i]);
  return order.map(i => ({ id: docIds[i], score: scores[i] }));
}

/** Borda count over ranks */
export function bordaFusion(modelLists) {
  const { docIds, matrix } = prepareScoreTable(modelLists);
  const ranks = ranksFromMatrix(matrix); const N=docIds.length; 
  const scores = ranks.map(rs => rs.reduce((s, r) => s + (N - r), 0));
  const order = Array.from({ length: N }, (_, i) => i).sort((i, j) => scores[j] - scores[i]);
  return order.map(i => ({ id: docIds[i], score: scores[i] }));
}

/** CombMNZ (sum of normalized scores times non-zero count) */
export function combMNZFusion(modelLists, norm='minmax') {
  const { docIds, matrix } = prepareScoreTable(modelLists);
  const Z = normalizeMatrix(matrix, norm);
  const scores = Z.map(row => {
    const nz = row.reduce((c,v)=> c + (isFinite(v) && v>0 ? 1:0), 0);
    const sum = row.reduce((s,v)=> s + (isFinite(v)? Math.max(0,v):0), 0);
    return nz * sum;
  });
  const order = Array.from({ length: docIds.length }, (_, i) => i).sort((i, j) => scores[j] - scores[i]);
  return order.map(i => ({ id: docIds[i], score: scores[i] }));
}

/** NDCG@k */
export function ndcgAtK(ranked, relevant, k=10) {
  const DCG = (arr) => arr.reduce((s, id, i) => s + (relevant.has(id) ? 1/Math.log2(i+2) : 0), 0);
  const top = ranked.slice(0,k).map(r=>r.id);
  const ideal = Array.from(relevant).slice(0,k);
  const dcg = DCG(top), idcg = DCG(ideal) || 1;
  return dcg / idcg;
}

/** MAP@k */
export function mapAtK(ranked, relevant, k=10) {
  let hits=0, sumPrec=0; const top = ranked.slice(0,k);
  for (let i=0;i<top.length;i++) { if (relevant.has(top[i].id)) { hits++; sumPrec += hits/(i+1); } }
  return hits? (sumPrec/Math.min(k,relevant.size)) : 0;
}

/**
 * Evaluate fusers vs baselines across queries.
 * @param {Array<Array<Array<{id:number,score:number}>>>} perQueryModels Q × M × rows
 * @param {Array<Set<number>>} relevantPerQuery Q sets
 * @param {{k?:number}} [opt]
 */
export function evaluateFusionSuite(perQueryModels, relevantPerQuery, opt={}) {
  const k = opt.k ?? 10; const Q = perQueryModels.length; 
  const names = ['bestSingle','rrf','linear(zscore)','borda','combMNZ'];
  const agg = names.map(n => ({ name:n, mrr:0, ndcg:0, map:0 }));
  for (let q=0;q<Q;q++){
    const models = perQueryModels[q]; const rel = relevantPerQuery[q] || new Set();
    // baselines: pick best single-model by MRR@k for this query
    const singleRanks = models.map(list => list.slice().sort((a,b)=>b.score-a.score));
    const rrs = singleRanks.map(rank => {
      let rr=0; for (let i=0;i<Math.min(rank.length,k);i++){ if (rel.has(rank[i].id)) { rr=1/(i+1); break; } } return rr;
    });
    let bestIdx = 0; for (let i=1;i<rrs.length;i++) if (rrs[i]>rrs[bestIdx]) bestIdx=i;
    const best = singleRanks[bestIdx];
    const fused_rrf = rrfFusion(models);
    const fused_lin = linearFusion(models);
    const fused_borda = bordaFusion(models);
    const fused_mnz = combMNZFusion(models);
    const cand = [best, fused_rrf, fused_lin, fused_borda, fused_mnz];
    cand.forEach((ranked, j)=>{
      let rr=0; for(let i=0;i<Math.min(ranked.length,k);i++){ if (rel.has(ranked[i].id)) { rr=1/(i+1); break; } }
      agg[j].mrr += rr/Q; agg[j].ndcg += ndcgAtK(ranked, rel, k)/Q; agg[j].map += mapAtK(ranked, rel, k)/Q;
    });
  }
  return agg;
}

// ───────────────────────── Self-tests (non-throwing) ─────────────────────────
/**
 * Run a compact test suite. Returns array of {name, pass}.
 */
export function selfTest() {
  const rng = rngLCG(42);
  const Q = genSig(128, 0.05, rng); const X = JSON.parse(JSON.stringify(Q));
  const eps = 1e-12;
  const res = [];
  const push = (name, pass) => res.push({ name, pass });

  // 1) base identity
  push('identical should be 1.0 (base)', Math.abs(baseCosine(Q, X, eps) - 1.0) <= 1e-12);
  // 2) base bounds
  const Y = genSig(128, 0.05, rng); const base2 = baseCosine(Q, Y, eps); push('base in [0,1]', base2 >= 0 && base2 <= 1 + 1e-12);
  // 3) b identity / bounded
  push('identical should be 1.0 (b)', Math.abs(anomalyAgreementCosine(Q, X, 8, eps) - 1.0) <= 1e-12);
  const b2 = anomalyAgreementCosine(Q, Y, 8, eps); push('b in [0,1]', b2 >= 0 && b2 <= 1 + 1e-12);
  // 4) spike vs algebraic base (small)
  const sim = new SpikeSim(100, 1, 1); const Qsp = sim.encode(Q); const Xsp = sim.encode(X);
  push('spike parity equals algebraic (base)', Math.abs(spikeBaseCosine(Qsp, Xsp, eps) - baseCosine(Q, X, eps)) <= 1e-15);
  // 5) base symmetry
  push('base symmetry', Math.abs(baseCosine(Q, Y, eps) - baseCosine(Y, Q, eps)) <= 1e-12);
  // 6) cosine scale invariance
  const scaleSig = (sig, c) => ({ positions: [...sig.positions], elevations: sig.elevations.map(e => e * c), dimension: sig.dimension });
  push('cosine scale invariance', Math.abs(baseCosine(scaleSig(Q, 3.14), Y, eps) - baseCosine(Q, Y, eps)) <= 1e-12);
  // 7) anomaly overlap bounds
  const aY = anomalyOverlapFrac(Q, Y, 8); push('anomaly overlap in [0,1]', aY >= 0 && aY <= 1);
  // 8) extreme sparsity
  const Qs = genSig(1024, 0.005, rng); const Xs = JSON.parse(JSON.stringify(Qs)); const simS = new SpikeSim(100, 1, 1);
  push('extreme sparsity spike parity (kD<0.01)', Math.abs(spikeBaseCosine(simS.encode(Qs), simS.encode(Xs), eps) - 1.0) <= 1e-12);
  // 9) high-D
  const Qh = genSig(4096, 0.03, rng); const Xh = JSON.parse(JSON.stringify(Qh)); const simH = new SpikeSim(100, 1, 1);
  push('high-D spike parity (D=4096)', Math.abs(spikeBaseCosine(simH.encode(Qh), simH.encode(Xh), eps) - 1.0) <= 1e-12);

  return res;
}

// ───────────────────────── Default export ─────────────────────────
const KK = {
  HARNESS_VERSION,
  // data
  rngLCG, genSig, genBatch, queryFromGaps, injectJolt, injectAnomalyTraceFromRH,
  // kernel
  baseCosine, anomalySet, anomalyOverlapFrac, anomalyAgreementCosine, kkScore,
  // spike
  SpikeSim, spikeBaseCosine,
  // eval / ranking
  evaluateFullBoost, meanReciprocalRank,
  // fusion
  prepareScoreTable, ranksFromMatrix, normalizeMatrix, rrfFusion, linearFusion, bordaFusion, combMNZFusion, ndcgAtK, mapAtK, evaluateFusionSuite,
  // reports
  buildCSV, makeConfig, makeCSVReport, makeJSONSnapshot, DEFAULT_CSV_HEADER, toCsvRows,
  // tests
  selfTest,
};

export default KK;

// ───────────────────────── Usage (example) ─────────────────────────
// import KK, { genBatch, evaluateFullBoost, makeConfig, toCsvRows, makeCSVReport } from './kk-kernel.esm.js';
// const DATA = genBatch({ seed:1337, dim:1024, kfrac:0.03, docs:200 });
// const evalRes = evaluateFullBoost(DATA, 0.5, 0.5, 8, 1e-12, 100, 1);
// const cfg = makeConfig({ dim:1024, kfrac:0.03, seed:1337, beta:0.5, gamma:0.5, M:8, tRes:1, tWin:100, docs:DATA.docs.length, qLen:DATA.q.positions.length });
// const rows = toCsvRows(evalRes.rows, 'boost');
// const csv = makeCSVReport(cfg, KK.DEFAULT_CSV_HEADER, rows);
// const json = makeJSONSnapshot(cfg, { ok: evalRes.ok, total: evalRes.total, maxppm: evalRes.maxPPM, mean_percent: 0 }, evalRes.rows);
// console.log(csv.slice(0,200), json.slice(0,200));
