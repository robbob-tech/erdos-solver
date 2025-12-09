/**
 * RH (Riemann Hypothesis) style sparse encoding for gap distributions
 * JavaScript port of rh_sparse_anomaly.py
 * Compatible with Cloudflare Workers (uses Web Crypto API)
 */

const TAU = 2.0 * Math.PI;

// Simple hash function for Cloudflare Workers (using Web Crypto API)
async function blake2bHash(key, data) {
  // For Cloudflare Workers, use a simpler hash approach
  // In production, you'd use a proper BLAKE2b implementation
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  const dataBytes = encoder.encode(data);
  
  // Use Web Crypto API's subtle.digest as a fallback
  // Note: This is a simplified version - for production use a proper BLAKE2b
  const combined = new Uint8Array(keyData.length + dataBytes.length);
  combined.set(keyData, 0);
  combined.set(dataBytes, keyData.length);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = new Uint8Array(hashBuffer);
  // Convert to bigint for modulo
  let value = 0n;
  for (let i = 0; i < 8 && i < hashArray.length; i++) {
    value = (value << 8n) | BigInt(hashArray[i]);
  }
  return value;
}

// RH zeros: N(T) and inversion
function N_riemann(T) {
  if (T <= 0.0) return 0.0;
  const x = T / TAU;
  return x * Math.log(x) - x + 0.875;
}

function invert_N_for_k(k, iters = 12) {
  if (k < 1) return 0.0;
  let x0 = Math.max(2.5, k / Math.max(1.0, Math.log(Math.max(k, 3.0))));
  let T = TAU * x0;
  for (let _ = 0; _ < iters; _++) {
    const x = Math.max(1e-9, T / TAU);
    const f = x * Math.log(x) - x + 0.875 - k;
    const df = (1.0 / TAU) * Math.max(1e-12, Math.log(x));
    T -= f / df;
    if (T <= 0) T = 1.0;
  }
  return T;
}

function generate_gammas(K) {
  const gammas = [];
  for (let k = 1; k <= K; k++) {
    gammas.push(invert_N_for_k(k));
  }
  return gammas;
}

function normalized_gaps(gammas) {
  const gaps = [];
  for (let i = 1; i < gammas.length; i++) {
    const gap = gammas[i] - gammas[i - 1];
    const scale = Math.log(gammas[i - 1] / TAU) / TAU;
    const s = gap * scale;
    if (s > 0 && isFinite(s)) {
      gaps.push(s);
    }
  }
  return gaps;
}

// Sparse Encoder
class RH_SparseEncoder {
  constructor(dimension = 4096, max_positions = 128, seed = "rh_sparse") {
    this.D = dimension;
    this.K = max_positions;
    this.seed = seed;
  }

  async _hpos(i, tag, val) {
    const key = `${this.seed}|${tag}|${i}|${val.toFixed(6)}`;
    const hashValue = await blake2bHash(this.seed, key);
    return Number(hashValue % BigInt(this.D));
  }

  _safe(arr) {
    return arr.map(x => isFinite(x) ? x : 0.0);
  }

  async encode(x) {
    const arr = this._safe(x);
    const n = arr.length;
    if (n === 0) {
      return {
        positions: [],
        elevations: [],
        dimension: this.D,
        sparsity: 0.0,
        version: "sparse-minimal-0.1",
        salt_id: this.seed
      };
    }

    const mean = arr.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n) + 1e-9;
    const sorted = [...arr].sort((a, b) => a - b);
    const med = sorted[Math.floor(n / 2)];
    const mad = arr.reduce((a, b) => a + Math.abs(b - med), 0) / n + 1e-9;

    const z = arr.map(v => (v - mean) / std);
    const q = arr.map(v => (v - med) / mad);
    const dz = [arr[0], ...arr.slice(1).map((v, i) => v - arr[i])];
    const dzs = dz.map(v => v / std);

    const chans = {
      z: z.map(v => Math.tanh(Math.abs(v))),
      q: q.map(v => Math.tanh(Math.abs(v))),
      dz: dzs.map(v => Math.tanh(Math.abs(v)) * 0.8)
    };

    const buckets = new Map();
    for (const [tag, values] of Object.entries(chans)) {
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v <= 0.0) continue;
        const pos = await this._hpos(i, tag, v);
        buckets.set(pos, Math.max(buckets.get(pos) || 0.0, v));
      }
    }

    if (buckets.size === 0) {
      return {
        positions: [],
        elevations: [],
        dimension: this.D,
        sparsity: 0.0,
        salt_id: this.seed
      };
    }

    const items = Array.from(buckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.K);
    const positions = items.map(([p]) => p);
    const elevations = items.map(([, e]) => e);
    const sparsity = positions.length / this.D;

    return {
      positions,
      elevations,
      dimension: this.D,
      sparsity,
      version: "sparse-minimal-0.1",
      salt_id: this.seed
    };
  }
}

// Multi-scale anomaly detector
class MultiScaleAnomaly {
  constructor(scales = [64, 256, 1024], knn_k = 5) {
    this.scales = scales;
    this.knn_k = knn_k;
    this.hist = {};
    for (const s of scales) {
      this.hist[s] = { buf: [], cap: s };
    }
  }

  static to_dict(sig) {
    const d = {};
    for (let i = 0; i < sig.positions.length; i++) {
      d[sig.positions[i]] = sig.elevations[i];
    }
    return d;
  }

  _sparse_cosine(a, b) {
    if (!a || !b || Object.keys(a).length === 0 || Object.keys(b).length === 0) {
      return 0.0;
    }
    const keys = new Set([...Object.keys(a).map(Number), ...Object.keys(b).map(Number)]);
    let dot = 0;
    for (const k of keys) {
      dot += (a[k] || 0) * (b[k] || 0);
    }
    let na = 0, nb = 0;
    for (const v of Object.values(a)) na += v * v;
    for (const v of Object.values(b)) nb += v * v;
    na = Math.sqrt(na);
    nb = Math.sqrt(nb);
    if (na === 0.0 || nb === 0.0) return 0.0;
    return dot / (na * nb);
  }

  _topk_avg(ring, q, k) {
    if (ring.buf.length === 0) return 0.0;
    const sims = ring.buf.map(s => this._sparse_cosine(q, s))
      .sort((a, b) => b - a);
    const kEff = Math.max(1, Math.min(k, sims.length));
    return sims.slice(0, kEff).reduce((a, b) => a + b, 0) / kEff;
  }

  update_and_score(sig) {
    const q = MultiScaleAnomaly.to_dict(sig);
    const per = {};
    for (const [s, ring] of Object.entries(this.hist)) {
      const avg_topk = this._topk_avg(ring, q, this.knn_k);
      per[Number(s)] = 1.0 - avg_topk;
    }
    for (const ring of Object.values(this.hist)) {
      ring.buf.push(q);
      if (ring.buf.length > ring.cap) {
        ring.buf.shift();
      }
    }
    const combined = Object.values(per).length > 0
      ? Object.values(per).reduce((a, b) => a + b, 0) / Object.values(per).length
      : 0.0;
    return { combined, per };
  }
}

// Main export function
export async function anomaly_trace_from_rh({
  gaps,
  window = 256,
  scales = [64, 256, 1024],
  dim = 4096,
  topk = 128,
  knn_k = 5,
  seed = "rh_sparse_demo"
}) {
  if (!gaps || gaps.length < window + 2) {
    throw new Error("Insufficient gaps. Need at least window + 2 elements.");
  }

  const enc = new RH_SparseEncoder(dim, topk, seed);
  const det = new MultiScaleAnomaly(scales, knn_k);

  const trace = [];
  for (let i = window; i < gaps.length; i++) {
    const win = gaps.slice(i - window, i);
    const sig = await enc.encode(win);
    const { combined, per } = det.update_and_score(sig);
    trace.push({
      window: i,
      score: combined,
      per_scale: per,
      signature: sig
    });
  }
  return trace;
}

export class SparseEncoder {
  constructor(dimension = 4096, max_positions = 128, seed = "rh_sparse") {
    this.encoder = new RH_SparseEncoder(dimension, max_positions, seed);
  }

  async encode(sequence) {
    return await this.encoder.encode(sequence);
  }
}
