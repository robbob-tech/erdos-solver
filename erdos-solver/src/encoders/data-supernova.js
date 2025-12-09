/**
 * Data Supernova Encoder for numerical features
 * JavaScript port of Sparse Supernova encoder
 * Compatible with Cloudflare Workers
 */

// Hash function using Web Crypto API
async function hashBlake2b64(keyBytes, ...parts) {
  const encoder = new TextEncoder();
  const combined = new Uint8Array(keyBytes.length + parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  combined.set(keyBytes, offset);
  offset += keyBytes.length;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.length;
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashArray = new Uint8Array(hashBuffer);
  let value = 0n;
  for (let i = 0; i < 8 && i < hashArray.length; i++) {
    value = (value << 8n) | BigInt(hashArray[i]);
  }
  return value;
}

function hashFloatsToPos(vals, seed, purpose, dim) {
  const encoder = new TextEncoder();
  const key = encoder.encode(seed);
  const purposeBytes = encoder.encode(purpose);
  const arrBytes = new Float64Array(vals).buffer;
  return hashBlake2b64(key, purposeBytes, new Uint8Array(arrBytes))
    .then(v => Number(v % BigInt(dim)));
}

function sanitize(arr, fill = 0.0) {
  return arr.map(x => isFinite(x) ? x : fill);
}

export class DataSupernovaConfig {
  constructor(options = {}) {
    this.dimension = options.dimension || 2048;
    this.max_positions = options.max_positions || 64;
    this.density_window = options.density_window || [0.01, 0.08];
    this.seed = options.seed || "supernova_data_v1";
    this.w_z = options.w_z || 1.0;
    this.w_rel_delta = options.w_rel_delta || 0.8;
    this.w_quantile = options.w_quantile || 0.6;
    this.w_anom_flag = options.w_anom_flag || 0.7;
    this.anom_z_threshold = options.anom_z_threshold || 2.2;
    this.epsilon = options.epsilon || 1e-9;
    this.clip_before_tanh = options.clip_before_tanh || 6.0;
    this.scale_after_tanh = options.scale_after_tanh || 4.0;
    this.version = options.version || "data-supernova-v2.0";
  }
}

export class DataSupernovaEncoder {
  constructor(config = null) {
    this.config = config || new DataSupernovaConfig();
  }

  async encode(vector, stats = {}, regime_tags = null) {
    const cfg = this.config;
    const arr = sanitize(vector);

    // Feature Engineering
    const mean = sanitize(stats.mean || new Array(arr.length).fill(0));
    const std = sanitize(stats.std || new Array(arr.length).fill(1)).map(v => Math.max(v, cfg.epsilon));
    const median = sanitize(stats.median || new Array(arr.length).fill(0));
    const mad = sanitize(stats.mad || new Array(arr.length).fill(1)).map(v => Math.max(v, cfg.epsilon));
    const prev = sanitize(stats.prev || arr);

    const z_scores = arr.map((v, i) => (v - mean[i]) / std[i]);
    const rel_delta = arr.map((v, i) => (v - prev[i]) / std[i]);
    const quantiles = arr.map((v, i) => (v - median[i]) / mad[i]);
    const anom_flags = z_scores.map(z => Math.abs(z) > cfg.anom_z_threshold ? 1.0 : 0.0);

    // Calculate Weighted Elevations
    const elevations_raw = arr.map((_, i) =>
      cfg.w_z * Math.abs(z_scores[i]) +
      cfg.w_rel_delta * Math.abs(rel_delta[i]) +
      cfg.w_quantile * Math.abs(quantiles[i]) +
      cfg.w_anom_flag * anom_flags[i]
    );

    // Calculate k
    const d_min = cfg.density_window[0];
    const d_max = cfg.density_window[1];
    const k_min = Math.floor(cfg.dimension * Math.max(d_min, 1.0 / cfg.dimension));
    const k_max = Math.ceil(cfg.dimension * Math.min(d_max, cfg.max_positions / cfg.dimension));
    const k = Math.max(1, Math.min(k_max, cfg.max_positions, elevations_raw.length));

    // Generate positions and elevations
    const candidates = [];
    const taken_pos = new Set();

    // Process base features
    for (let i = 0; i < elevations_raw.length; i++) {
      const base_hash_vals = [i, arr[i]];
      const pos = await hashFloatsToPos(base_hash_vals, cfg.seed, `feat_${i}`, cfg.dimension);
      
      // Resolve collision
      let final_pos = pos;
      if (taken_pos.has(final_pos)) {
        for (let j = 1; j < 16; j++) {
          const new_vals = [...base_hash_vals, j];
          const new_pos = await hashFloatsToPos(new_vals, cfg.seed, "collision_rehash", cfg.dimension);
          if (!taken_pos.has(new_pos)) {
            final_pos = new_pos;
            break;
          }
        }
      }
      taken_pos.add(final_pos);

      // Shape elevation
      const raw_elev = elevations_raw[i];
      const clipped = Math.max(-cfg.clip_before_tanh, Math.min(cfg.clip_before_tanh, raw_elev));
      const shaped = Math.tanh(clipped);
      const final_elev = Math.abs(shaped) * cfg.scale_after_tanh;

      candidates.push({
        pos: final_pos,
        elev: final_elev,
        tie: i // Simplified tie-breaker
      });
    }

    // Process regime features
    if (regime_tags) {
      const keys = Object.keys(regime_tags).sort();
      for (const key of keys) {
        const val = regime_tags[key];
        const base_hash_vals = [val];
        const pos = await hashFloatsToPos(base_hash_vals, cfg.seed, `regime_${key}`, cfg.dimension);
        
        let final_pos = pos;
        if (taken_pos.has(final_pos)) {
          for (let j = 1; j < 16; j++) {
            const new_vals = [...base_hash_vals, j];
            const new_pos = await hashFloatsToPos(new_vals, cfg.seed, "collision_rehash", cfg.dimension);
            if (!taken_pos.has(new_pos)) {
              final_pos = new_pos;
              break;
            }
          }
        }
        taken_pos.add(final_pos);

        const final_elev = Math.abs(Math.tanh(val)) * cfg.scale_after_tanh;
        candidates.push({
          pos: final_pos,
          elev: final_elev,
          tie: 0
        });
      }
    }

    // Top-K selection
    candidates.sort((a, b) => {
      if (b.elev !== a.elev) return b.elev - a.elev;
      return b.tie - a.tie;
    });

    const top_k = candidates.slice(0, k);
    const final_positions = top_k.map(c => c.pos);
    const final_elevations = top_k.map(c => Math.round(c.elev * 1e6) / 1e6);

    return {
      positions: final_positions,
      elevations: final_elevations,
      dimension: cfg.dimension,
      sparsity: final_positions.length / cfg.dimension,
      version: cfg.version,
      salt_id: cfg.seed,
      modality: "data"
    };
  }
}
