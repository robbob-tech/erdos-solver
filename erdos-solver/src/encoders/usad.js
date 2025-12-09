// usad.esm.js
// Universal Sparse Anomaly Detector (USAD) — Single-File ESM
// Distribution-free anomaly detection with finite-sample conformal validity.

/** @typedef {Float64Array | number[]} FloatArray */
/** @typedef {{ idx: Int32Array; val: Float64Array; norm: number }} SparseSignature */

// Minimal BLAKE2b (128-bit keyed)
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
];
const SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
  [11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
  [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],
  [9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],
  [2,12,6,10,4,7,15,14,1,11,9,5,3,13,8,0],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],
  [13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],
  [6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
  [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
  [14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],
];

function rotr(x, n) {
  return ((x >> BigInt(n)) | (x << BigInt(64-n))) & 0xffffffffffffffffn;
}

function G(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & 0xffffffffffffffffn;
  v[d] = rotr(v[d] ^ v[a], 32);
  v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
  v[b] = rotr(v[b] ^ v[c], 24);
  v[a] = (v[a] + v[b] + y) & 0xffffffffffffffffn;
  v[d] = rotr(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
  v[b] = rotr(v[b] ^ v[c], 63);
}

function blockToWords(b) {
  const w = new Array(16).fill(0n);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < 16; i++) {
    const o = i * 8;
    if (o + 8 <= b.length) {
      const lo = dv.getUint32(o, true);
      const hi = dv.getUint32(o + 4, true);
      w[i] = (BigInt(hi) << 32n) | BigInt(lo);
    } else if (o < b.length) {
      let word = 0n;
      for (let j = 0; j < 8 && o + j < b.length; j++) {
        word |= BigInt(b[o + j]) << (8n * BigInt(j));
      }
      w[i] = word;
    }
  }
  return w;
}

function blake2b(input, outlen = 16, key) {
  if (outlen <= 0 || outlen > 64) throw new Error("blake2b outlen");
  const BLOCK = 128;
  const keylen = key?.length ?? 0;
  let h = IV.slice();
  const param = (0x01010000 | (keylen << 8) | outlen) >>> 0;
  h[0] = h[0] ^ BigInt(param);
  const blocks = [];
  if (keylen) {
    const kb = new Uint8Array(BLOCK);
    kb.set(key);
    blocks.push(kb);
  }
  for (let i = 0; i < input.length; i += BLOCK) {
    blocks.push(input.subarray(i, Math.min(i + BLOCK, input.length)));
  }
  let t0 = 0n, t1 = 0n;
  const f0 = 0xffffffffffffffffn;
  for (let bidx = 0; bidx < blocks.length; bidx++) {
    const isLast = bidx === blocks.length - 1;
    const block = new Uint8Array(BLOCK);
    block.set(blocks[bidx]);
    const inc = BigInt(blocks[bidx].length);
    t0 = (t0 + inc) & 0xffffffffffffffffn;
    if (t0 < inc) t1 = (t1 + 1n) & 0xffffffffffffffffn;
    const m = blockToWords(block);
    const v = new Array(16);
    for (let i = 0; i < 8; i++) v[i] = h[i];
    for (let i = 0; i < 8; i++) v[i + 8] = IV[i];
    v[12] = (v[12] ^ t0) & 0xffffffffffffffffn;
    v[13] = (v[13] ^ t1) & 0xffffffffffffffffn;
    if (isLast) v[14] = (v[14] ^ f0) & 0xffffffffffffffffn;
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r];
      G(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
      G(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
      G(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
      G(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
      G(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) {
      h[i] = (h[i] ^ v[i] ^ v[i + 8]) & 0xffffffffffffffffn;
    }
  }
  const out = new Uint8Array(outlen);
  const dv = new DataView(new ArrayBuffer(64));
  for (let i = 0; i < 8; i++) {
    dv.setUint32(i * 8, Number(h[i] & 0xffffffffn), true);
    dv.setUint32(i * 8 + 4, Number((h[i] >> 32n) & 0xffffffffn), true);
  }
  out.set(new Uint8Array(dv.buffer).subarray(0, outlen));
  return out;
}

function u64leFromDigest16(d) {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const lo = dv.getUint32(0, true);
  const hi = dv.getUint32(4, true);
  return (BigInt(hi) << 32n) | BigInt(lo);
}

const TE = new TextEncoder();
const DEFAULT_SALT1 = TE.encode("USAD_salt_1");
const DEFAULT_SALT2 = TE.encode("USAD_salt_2");

function to8LE(i) {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  const x = typeof i === "number" ? BigInt(i) : i;
  dv.setUint32(0, Number(x & 0xffffffffn), true);
  dv.setUint32(4, Number((x >> 32n) & 0xffffffffn), true);
  return b;
}

function blake2bIndex(i, dim, key) {
  const digest = blake2b(to8LE(i), 16, key);
  const v = u64leFromDigest16(digest);
  return Number(v % BigInt(dim));
}

// Robust stats (Median + MAD)
function median(arr) {
  const a = arr.slice().sort((x, y) => x - y);
  const n = a.length;
  return n & 1 ? a[(n - 1) >> 1] : 0.5 * (a[n >> 1] + a[(n >> 1) - 1]);
}

function robustZ(vec, eps = 1e-12) {
  const x = Float64Array.from(vec);
  const med = median(x);
  const dev = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    dev[i] = Math.abs(x[i] - med);
  }
  const mad = median(dev);
  const scale = 1.4826 * (mad + eps);
  const z = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    z[i] = (x[i] - med) / scale;
  }
  return z;
}

// Sparse Signature Encoding
export function encodeSparseSignature(
  vec,
  { k = 16, hashing = { dim: 4096, salt1: DEFAULT_SALT1, salt2: DEFAULT_SALT2, useDoubleHash: true }, clipQuantile = 0.95 } = {}
) {
  if (k <= 0) throw new Error("k must be positive");
  if (!hashing || hashing.dim <= 0) throw new Error("hashing.dim must be positive");

  const z = robustZ(vec);
  const abs = new Float64Array(z.length);
  for (let i = 0; i < z.length; i++) abs[i] = Math.abs(z[i]);

  let elev = new Float64Array(z.length);
  if (clipQuantile > 0 && clipQuantile < 1) {
    const sorted = Array.from(abs).sort((a, b) => a - b);
    const qpos = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * clipQuantile) - 1));
    const q = sorted[qpos];
    for (let i = 0; i < z.length; i++) {
      elev[i] = Math.sign(z[i]) * Math.max(abs[i] - q, 0);
    }
  } else {
    elev = z;
  }

  const n = elev.length;
  let idxs = [...Array(n)].map((_, i) => i);
  idxs.sort((i, j) => Math.abs(elev[j]) - Math.abs(elev[i]));
  if (k < n) idxs = idxs.slice(0, k);

  const dim = hashing.dim;
  const salt1 = hashing.salt1 ?? DEFAULT_SALT1;
  const salt2 = hashing.salt2 ?? DEFAULT_SALT2;
  const useDouble = hashing.useDoubleHash ?? true;

  const pos = [];
  const val = [];
  const taken = new Map();
  for (const orig of idxs) {
    const v = elev[orig];
    if (v === 0) continue;
    const p1 = blake2bIndex(orig, dim, salt1);
    let chosen = p1;

    if (taken.has(p1)) {
      if (useDouble) {
        const p2 = blake2bIndex(orig, dim, salt2);
        if (!taken.has(p2)) {
          chosen = p2;
        } else {
          const ie = taken.get(p1);
          if (Math.abs(v) > Math.abs(val[ie])) {
            chosen = p1;
          } else {
            continue;
          }
        }
      } else {
        const ie = taken.get(p1);
        if (Math.abs(v) > Math.abs(val[ie])) {
          chosen = p1;
        } else {
          continue;
        }
      }
    }

    if (taken.has(chosen)) {
      const i = taken.get(chosen);
      pos[i] = chosen;
      val[i] = v;
    } else {
      taken.set(chosen, pos.length);
      pos.push(chosen);
      val.push(v);
    }
  }

  if (pos.length === 0) {
    return { idx: new Int32Array(0), val: new Float64Array(0), norm: 0 };
  }

  const order = pos.map((_, i) => i).sort((a, b) => pos[a] - pos[b]);
  const idx = new Int32Array(order.map(i => pos[i]));
  const vv = new Float64Array(order.map(i => val[i]));
  let norm = 0;
  for (let i = 0; i < vv.length; i++) norm += vv[i] * vv[i];
  norm = Math.sqrt(norm);
  return { idx, val: vv, norm };
}

// Sparse Cosine & Distance
export function cosineSparse(a, b, eps = 1e-12) {
  const ai = a.idx, av = a.val, bi = b.idx, bv = b.val;
  let i = 0, j = 0, dot = 0;
  while (i < ai.length && j < bi.length) {
    const pa = ai[i], pb = bi[j];
    if (pa === pb) {
      dot += av[i] * bv[j];
      i++;
      j++;
    } else if (pa < pb) {
      i++;
    } else {
      j++;
    }
  }
  const denom = (a.norm + eps) * (b.norm + eps);
  return denom > 0 ? dot / denom : 0;
}

export const distanceSparse = (a, b) => 1 - cosineSparse(a, b);

// Conformal Quantile
export function conformalQuantile(scores, alpha) {
  if (!(alpha > 0 && alpha < 1)) throw new Error("alpha must be in (0,1)");
  const n = scores.length;
  if (n === 0) throw new Error("need calibration scores");
  const k = Math.max(0, Math.min(n - 1, Math.ceil((n + 1) * (1 - alpha)) - 1));
  const arr = scores.slice().sort((a, b) => a - b);
  return arr[k];
}

// Main Detector
export class USADetector {
  constructor({ dim = 4096, k = 16, alpha = 0.1, kNN = 25, hashing, clipQuantile = 0.95 } = {}) {
    this.hashing = hashing ?? { dim, salt1: DEFAULT_SALT1, salt2: DEFAULT_SALT2, useDoubleHash: true };
    this.k = k;
    this.alpha = alpha;
    this.kNN = kNN;
    this.clip = clipQuantile;
    this.calSigs = [];
    this.calScores = [];
    this.thr = undefined;
  }

  encode(x) {
    return encodeSparseSignature(x, { k: this.k, hashing: this.hashing, clipQuantile: this.clip });
  }

  calibrate(calibration) {
    this.calSigs = [];
    for (const v of calibration) {
      this.calSigs.push(this.encode(v));
    }
    const n = this.calSigs.length;
    if (n === 0) throw new Error("need calibration vectors");

    this.calScores = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const dists = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        dists.push(distanceSparse(this.calSigs[i], this.calSigs[j]));
      }
      if (dists.length === 0) {
        this.calScores[i] = 0;
        continue;
      }
      dists.sort((a, b) => a - b);
      const kEff = Math.min(this.kNN, dists.length);
      this.calScores[i] = dists.slice(0, kEff).reduce((s, v) => s + v, 0) / kEff;
    }
    this.thr = conformalQuantile(this.calScores, this.alpha);
    return this.thr;
  }

  nonconformity(x) {
    if (this.calSigs.length === 0) throw new Error("not calibrated");
    const sx = this.encode(x);
    const dists = this.calSigs.map(s => distanceSparse(sx, s)).sort((a, b) => a - b);
    const kEff = Math.min(this.kNN, dists.length);
    return dists.slice(0, kEff).reduce((s, v) => s + v, 0) / kEff;
  }

  threshold() {
    if (this.thr === undefined) throw new Error("threshold not set");
    return this.thr;
  }

  predict(x) {
    const s = this.nonconformity(x);
    const t = this.threshold();
    return { isAnomaly: s > t, score: s, threshold: t };
  }

  updateIfNormal(x) {
    const { isAnomaly } = this.predict(x);
    if (isAnomaly) return false;
    const sx = this.encode(x);
    this.calSigs.push(sx);
    const dists = this.calSigs.slice(0, -1).map(s => distanceSparse(sx, s)).sort((a, b) => a - b);
    const kEff = Math.min(this.kNN, dists.length);
    const newScore = dists.length ? dists.slice(0, kEff).reduce((s, v) => s + v, 0) / kEff : 0;
    this.calScores.push(newScore);
    this.thr = conformalQuantile(this.calScores, this.alpha);
    return true;
  }
}
