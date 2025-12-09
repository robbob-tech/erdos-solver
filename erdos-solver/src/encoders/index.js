import { USADetector } from './usad.js';
import { kkScore, anomalyOverlapFrac } from './kk-kernel.js';
import { anomaly_trace_from_rh } from './rh-sparse.js';
import { DataSupernovaEncoder } from './data-supernova.js';

export class MathObjectEncoder {
  constructor() {
    this.usad = new USADetector({ dim: 4096, k: 16, alpha: 0.1, kNN: 25 });
    this.dataSupernova = new DataSupernovaEncoder();
    this.rhEncoder = null; // lazy init
  }

  /**
   * Encode integer sequence to sparse signature
   * @param {number[]} sequence - e.g., [1, 2, 4, 8, 13, 21, 31, 45, 66...]
   * @param {string} type - 'gaps' | 'values' | 'ratios'
   */
  async encodeSequence(sequence, type = 'gaps') {
    if (type === 'gaps') {
      // Compute normalized gaps like RH zeros
      const gaps = [];
      for (let i = 1; i < sequence.length; i++) {
        gaps.push(sequence[i] - sequence[i-1]);
      }
      
      // Normalize by local density
      const normalized = gaps.map((g, i) => 
        g / Math.sqrt(sequence[i] || 1)
      );
      
      return await this.encodeRHStyle(normalized);
    }
    
    if (type === 'values') {
      // Use Data Supernova for numerical features
      return await this.encodeNumerical(sequence);
    }
    
    if (type === 'ratios') {
      // Compute ratios between consecutive values
      const ratios = [];
      for (let i = 1; i < sequence.length; i++) {
        if (sequence[i-1] !== 0) {
          ratios.push(sequence[i] / sequence[i-1]);
        }
      }
      return await this.encodeNumerical(ratios);
    }
    
    throw new Error(`Unknown encoding type: ${type}`);
  }

  /**
   * RH-style encoding for gap distributions
   */
  async encodeRHStyle(normalizedGaps) {
    const trace = await anomaly_trace_from_rh({
      gaps: normalizedGaps,
      window: 256,
      scales: [64, 256, 1024],
      dim: 4096,
      topk: 128,
      knn_k: 5
    });
    
    return {
      type: 'rh_trace',
      anomalyScores: trace.map(t => t.score),
      signatures: trace.map(t => t.signature),
      metadata: { scales: [64, 256, 1024] }
    };
  }

  /**
   * Numerical feature encoding
   */
  async encodeNumerical(values) {
    const stats = this._computeRollingStats(values, 100);
    const signatures = [];
    
    for (let i = 100; i < values.length; i++) {
      const sig = await this.dataSupernova.encode(
        [values[i]],
        {
          mean: [stats.mean[i]],
          std: [stats.std[i]],
          median: [stats.median[i]],
          mad: [stats.mad[i]],
          prev: [values[i-1]]
        },
        {
          magnitude_regime: Math.floor(Math.log10(values[i] || 1)),
          position_regime: Math.floor(i / 1000)
        }
      );
      signatures.push(sig);
    }
    
    return { type: 'numerical', signatures, stats };
  }

  /**
   * Compare two encoded objects using KK kernel
   */
  compareKK(sig1, sig2, beta = 0.5, gamma = 0.5, M = 8) {
    return kkScore(sig1, sig2, beta, gamma, M);
  }

  /**
   * USAD anomaly detection
   */
  calibrateAnomaly(normalSequences) {
    this.usad.calibrate(normalSequences);
  }

  detectAnomaly(sequence) {
    return this.usad.predict(sequence);
  }

  _computeRollingStats(values, window) {
    const mean = [], std = [], median = [], mad = [];
    
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - window);
      const slice = values.slice(start, i + 1);
      
      mean[i] = slice.reduce((a,b) => a+b, 0) / slice.length;
      std[i] = Math.sqrt(
        slice.reduce((a,b) => a + (b - mean[i])**2, 0) / slice.length
      );
      
      const sorted = [...slice].sort((a,b) => a-b);
      median[i] = sorted[Math.floor(sorted.length/2)];
      mad[i] = sorted.reduce((a,b) => a + Math.abs(b - median[i]), 0) / sorted.length;
    }
    
    return { mean, std, median, mad };
  }
}

