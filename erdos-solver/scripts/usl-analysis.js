// USL (Universal Saturation Law) Analysis
// Run USAD/USL algorithm over all computational results and proofs
// to identify patterns for convergence proofs and error bounds

import { USADetector, encodeSparseSignature, cosineSparse } from '../src/encoders/usad.js';
import { MathObjectEncoder } from '../src/encoders/index.js';
import { kkScore } from '../src/encoders/kk-kernel.js';

// Generate Mian-Chowla sequence
function generateMianChowla(n) {
  const sequence = [1];
  const sums = new Set([2]);
  
  for (let i = 1; i < n; i++) {
    let candidate = sequence[i - 1] + 1;
    
    while (true) {
      let valid = true;
      const newSums = new Set();
      
      for (const existing of sequence) {
        const sum = existing + candidate;
        if (sums.has(sum)) {
          valid = false;
          break;
        }
        newSums.add(sum);
      }
      
      const doubleSum = candidate * 2;
      if (sums.has(doubleSum)) {
        valid = false;
      } else {
        newSums.add(doubleSum);
      }
      
      if (valid) {
        sequence.push(candidate);
        for (const s of newSums) {
          sums.add(s);
        }
        break;
      }
      
      candidate++;
    }
  }
  
  return sequence;
}

// Extract features from computational results
function extractComputationalFeatures(sequence) {
  const features = [];
  
  // Growth rate features
  for (let i = 10; i < sequence.length; i += 10) {
    const n = i + 1;
    const a_n = sequence[i];
    const ratio = a_n / Math.pow(n, 3);
    features.push({
      type: 'growth_rate',
      n,
      a_n,
      ratio,
      log_ratio: Math.log(a_n) / Math.log(n)
    });
  }
  
  // Density features
  for (let i = 10; i < sequence.length; i += 10) {
    const N = sequence[i];
    const size = i + 1;
    const optimal = Math.sqrt(N);
    const ratio = size / optimal;
    const density = size / N;
    
    features.push({
      type: 'density',
      N,
      size,
      optimal,
      ratio,
      density,
      log_density: Math.log(density)
    });
  }
  
  // Gap features
  const gaps = [];
  for (let i = 1; i < sequence.length; i++) {
    gaps.push(sequence[i] - sequence[i - 1]);
  }
  
  for (let i = 10; i < gaps.length; i += 10) {
    const window = gaps.slice(Math.max(0, i - 10), i + 10);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / window.length;
    const expected = 3 * Math.pow(i, 2);
    
    features.push({
      type: 'gap',
      index: i,
      mean,
      variance,
      expected,
      deviation: Math.abs(mean - expected) / expected,
      cv: Math.sqrt(variance) / mean
    });
  }
  
  return features;
}

// Extract proof structure features
function extractProofFeatures() {
  // Analyze the structure of our proofs
  const proofFeatures = [];
  
  // Theorem dependencies
  const theorems = [
    { id: 1, name: 'Growth Rate', dependsOn: [], constants: ['C ≈ 0.014'] },
    { id: 2, name: 'Lower Bound', dependsOn: [1], constants: ['C₁ ≥ 0.31'] },
    { id: 3, name: 'Upper Bound', dependsOn: [], constants: ['C₂ ≤ 0.40'] },
    { id: 4, name: 'Combined Bounds', dependsOn: [2, 3], constants: ['C₁', 'C₂'] },
    { id: 5, name: 'Gap Distribution', dependsOn: [1], constants: ['E[gₙ] ~ 3n²'] }
  ];
  
  // Analyze convergence patterns
  const convergencePoints = [
    { n: 100, ratio: null },
    { n: 500, ratio: null },
    { n: 1000, ratio: null },
    { n: 2000, ratio: null }
  ];
  
  // Error bound patterns
  const errorPatterns = [
    { type: 'growth_rate', error: 'o(1) terms' },
    { type: 'density', error: 'ε in exponent' },
    { type: 'gap', error: 'O(n⁴) variance' }
  ];
  
  return {
    theorems,
    convergencePoints,
    errorPatterns,
    structure: {
      totalTheorems: theorems.length,
      dependencies: theorems.filter(t => t.dependsOn.length > 0).length,
      constants: theorems.reduce((acc, t) => acc + t.constants.length, 0)
    }
  };
}

// USL/USAD analysis
async function uslAnalysis() {
  console.log('🔬 USL (Universal Saturation Law) Analysis\n');
  console.log('Analyzing all computational results and proof structure...\n');
  
  // 1. Generate multiple sequences of different sizes (optimized)
  console.log('1️⃣ Generating sequences for multi-scale analysis...');
  console.log('   (Using optimized sizes for faster analysis)');
  
  const sequences = {};
  try {
    console.log('   Generating small (100)...');
    sequences.small = generateMianChowla(100);
    console.log(`   ✅ Small (100): a(100) = ${sequences.small[99]}`);
  } catch (e) {
    console.log(`   ⚠️ Small failed: ${e.message}`);
  }
  
  try {
    console.log('   Generating medium (300)...');
    sequences.medium = generateMianChowla(300);
    console.log(`   ✅ Medium (300): a(300) = ${sequences.medium[299]}`);
  } catch (e) {
    console.log(`   ⚠️ Medium failed: ${e.message}`);
  }
  
  try {
    console.log('   Generating large (600)...');
    sequences.large = generateMianChowla(600);
    console.log(`   ✅ Large (600): a(600) = ${sequences.large[599]}`);
  } catch (e) {
    console.log(`   ⚠️ Large failed: ${e.message}`);
  }
  
  console.log();
  
  // 2. Extract features from all sequences
  console.log('2️⃣ Extracting features from all sequences...');
  const allFeatures = {};
  for (const [size, seq] of Object.entries(sequences)) {
    allFeatures[size] = extractComputationalFeatures(seq);
    console.log(`   ${size}: ${allFeatures[size].length} features extracted`);
  }
  console.log();
  
  // 3. Encode features using USAD
  console.log('3️⃣ Encoding features with USAD sparse encoder...');
  const encoder = new MathObjectEncoder();
  const usad = encoder.usad;
  
  // Prepare calibration data (normal/expected patterns)
  const calibrationData = [];
  for (const features of Object.values(allFeatures)) {
    for (const feat of features) {
      if (feat.type === 'growth_rate') {
        // Expected: ratio should converge to ~0.014
        const expected = 0.014;
        const deviation = Math.abs(feat.ratio - expected) / expected;
        calibrationData.push([feat.n, feat.ratio, deviation]);
      }
    }
  }
  
  console.log(`   Calibration data: ${calibrationData.length} vectors`);
  
  // Calibrate USAD
  try {
    usad.calibrate(calibrationData);
    console.log(`   ✅ USAD calibrated\n`);
  } catch (error) {
    console.log(`   ⚠️ Calibration issue: ${error.message}\n`);
  }
  
  // 4. Analyze convergence patterns
  console.log('4️⃣ Convergence Pattern Analysis\n');
  
  const convergenceAnalysis = {};
  for (const [size, seq] of Object.entries(sequences)) {
    const ratios = [];
    for (let i = 50; i < seq.length; i += 10) {
      const n = i + 1;
      const ratio = seq[i] / Math.pow(n, 3);
      ratios.push({ n, ratio });
    }
    
    // Analyze convergence
    const recent = ratios.slice(-10);
    const early = ratios.slice(0, 10);
    const recentAvg = recent.reduce((a, b) => a + b.ratio, 0) / recent.length;
    const earlyAvg = early.reduce((a, b) => a + b.ratio, 0) / early.length;
    const convergence = Math.abs(recentAvg - earlyAvg) / earlyAvg;
    
    convergenceAnalysis[size] = {
      earlyAvg,
      recentAvg,
      convergence,
      converged: convergence < 0.1,
      ratios: ratios.length
    };
    
    console.log(`   ${size} (n=${seq.length}):`);
    console.log(`     Early avg: ${earlyAvg.toFixed(6)}`);
    console.log(`     Recent avg: ${recentAvg.toFixed(6)}`);
    console.log(`     Convergence: ${(convergence * 100).toFixed(2)}%`);
    console.log(`     Status: ${convergence < 0.1 ? '✅ Converged' : '⚠️ Still converging'}\n`);
  }
  
  // 5. Error bound analysis using sparse signatures
  console.log('5️⃣ Error Bound Analysis via Sparse Encoding\n');
  
  const errorAnalysis = {};
  for (const [size, seq] of Object.entries(sequences)) {
    // Encode sequence gaps
    const gaps = [];
    for (let i = 1; i < seq.length; i++) {
      gaps.push(seq[i] - seq[i - 1]);
    }
    
    // Normalize gaps
    const normalized = gaps.map((g, i) => g / Math.sqrt(seq[i] || 1));
    
    // Encode with sparse signature
    try {
      const sig = encodeSparseSignature(normalized, { k: 64, hashing: { dim: 4096 } });
      
      // Analyze signature for error patterns
      const signatureVariance = sig.val.reduce((a, b) => a + b * b, 0) / sig.val.length;
      const sparsity = sig.idx.length / 4096;
      
      errorAnalysis[size] = {
        signatureNorm: sig.norm,
        signatureVariance,
        sparsity,
        activeFeatures: sig.idx.length
      };
      
      console.log(`   ${size}:`);
      console.log(`     Signature norm: ${sig.norm.toFixed(4)}`);
      console.log(`     Variance: ${signatureVariance.toFixed(6)}`);
      console.log(`     Sparsity: ${sparsity.toFixed(6)}`);
      console.log(`     Active features: ${sig.idx.length}\n`);
    } catch (error) {
      console.log(`   ${size}: ⚠️ Encoding error: ${error.message}\n`);
    }
  }
  
  // 6. Cross-scale comparison using KK kernel
  console.log('6️⃣ Cross-Scale Comparison (KK Kernel)\n');
  
  const comparisons = [];
  const sizes = Object.keys(sequences);
  
  for (let i = 0; i < sizes.length - 1; i++) {
    const seq1 = sequences[sizes[i]];
    const seq2 = sequences[sizes[i + 1]];
    
    // Compare overlapping portions
    const overlap = Math.min(seq1.length, seq2.length);
    const subseq1 = seq1.slice(0, overlap);
    const subseq2 = seq2.slice(0, overlap);
    
    // Encode both
    try {
      const gaps1 = subseq1.slice(1).map((v, i) => v - subseq1[i]);
      const gaps2 = subseq2.slice(1).map((v, i) => v - subseq2[i]);
      
      const sig1 = encodeSparseSignature(gaps1, { k: 64 });
      const sig2 = encodeSparseSignature(gaps2, { k: 64 });
      
      const similarity = cosineSparse(sig1, sig2);
      
      comparisons.push({
        scale1: sizes[i],
        scale2: sizes[i + 1],
        similarity,
        overlap
      });
      
      console.log(`   ${sizes[i]} vs ${sizes[i + 1]}:`);
      console.log(`     Similarity: ${similarity.toFixed(4)}`);
      console.log(`     Overlap: ${overlap} terms\n`);
    } catch (error) {
      console.log(`   ${sizes[i]} vs ${sizes[i + 1]}: ⚠️ ${error.message}\n`);
    }
  }
  
  // 7. Anomaly detection on proof structure
  console.log('7️⃣ Anomaly Detection on Proof Structure\n');
  
  const proofFeatures = extractProofFeatures();
  
  // Encode proof structure
  const proofVector = [
    proofFeatures.structure.totalTheorems,
    proofFeatures.structure.dependencies,
    proofFeatures.structure.constants,
    proofFeatures.theorems.length,
    proofFeatures.errorPatterns.length
  ];
  
  try {
    const proofSig = encodeSparseSignature(proofVector, { k: 16 });
    const proofAnomaly = usad.predict(proofVector);
    
    console.log(`   Proof structure encoding:`);
    console.log(`     Signature norm: ${proofSig.norm.toFixed(4)}`);
    console.log(`     Anomaly score: ${proofAnomaly.score.toFixed(4)}`);
    console.log(`     Is anomaly: ${proofAnomaly.isAnomaly ? '⚠️ Yes' : '✅ No'}`);
    console.log(`     Threshold: ${proofAnomaly.threshold.toFixed(4)}\n`);
  } catch (error) {
    console.log(`   ⚠️ Proof analysis error: ${error.message}\n`);
  }
  
  // 8. Identify convergence proof insights
  console.log('8️⃣ Convergence Proof Insights\n');
  
  const insights = [];
  
  // Insight 1: Convergence rate
  const convergenceRates = Object.values(convergenceAnalysis).map(c => c.convergence);
  const avgConvergenceRate = convergenceRates.reduce((a, b) => a + b, 0) / convergenceRates.length;
  
  insights.push({
    type: 'convergence_rate',
    finding: `Average convergence rate: ${(avgConvergenceRate * 100).toFixed(2)}%`,
    implication: avgConvergenceRate < 0.1 ? 'Fast convergence suggests provable limit' : 'Slow convergence needs error bounds'
  });
  
  // Insight 2: Error bounds from signature variance
  const variances = Object.values(errorAnalysis).map(e => e.signatureVariance);
  const maxVariance = Math.max(...variances);
  const minVariance = Math.min(...variances);
  
  insights.push({
    type: 'error_bounds',
    finding: `Signature variance range: [${minVariance.toFixed(6)}, ${maxVariance.toFixed(6)}]`,
    implication: maxVariance < 0.01 ? 'Low variance suggests tight error bounds' : 'Higher variance indicates need for careful error analysis'
  });
  
  // Insight 3: Cross-scale consistency
  const avgSimilarity = comparisons.reduce((a, b) => a + b.similarity, 0) / comparisons.length;
  
  insights.push({
    type: 'scale_consistency',
    finding: `Average cross-scale similarity: ${avgSimilarity.toFixed(4)}`,
    implication: avgSimilarity > 0.9 ? 'High consistency suggests asymptotic behavior' : 'Lower consistency indicates scale-dependent effects'
  });
  
  for (const insight of insights) {
    console.log(`   ${insight.type}:`);
    console.log(`     Finding: ${insight.finding}`);
    console.log(`     Implication: ${insight.implication}\n`);
  }
  
  // 9. Recommendations for convergence proofs
  console.log('9️⃣ Recommendations for Convergence Proofs\n');
  
  const recommendations = [];
  
  if (avgConvergenceRate < 0.1) {
    recommendations.push({
      priority: 'HIGH',
      recommendation: 'Use convergence rate to establish limit existence',
      method: 'Show |a(n)/n³ - C| < ε for n > N(ε)',
      errorBound: `Error bound: O(1/n) based on convergence rate ${(avgConvergenceRate * 100).toFixed(2)}%`
    });
  }
  
  if (maxVariance < 0.01) {
    recommendations.push({
      priority: 'HIGH',
      recommendation: 'Low variance suggests tight error bounds',
      method: 'Use Chebyshev inequality with variance bound',
      errorBound: `P(|X - μ| > kσ) < 1/k², where σ² < ${maxVariance.toFixed(6)}`
    });
  }
  
  if (avgSimilarity > 0.9) {
    recommendations.push({
      priority: 'MEDIUM',
      recommendation: 'High cross-scale similarity suggests asymptotic regime',
      method: 'Use scale invariance to prove limit',
      errorBound: 'Error decreases as scale increases'
    });
  }
  
  // Analyze gap between computational and asymptotic
  const largestSeq = Object.values(sequences).reduce((a, b) => a && b.length > a.length ? b : a, sequences.small || []);
  const computationalN = largestSeq ? largestSeq.length : 100;
  const computationalRatio = largestSeq && largestSeq.length > 0 
    ? largestSeq[computationalN - 1] / Math.pow(computationalN, 3)
    : 0.014;
  const asymptoticConstant = 0.014;
  const error = computationalRatio > 0 
    ? Math.abs(computationalRatio - asymptoticConstant) / asymptoticConstant
    : 0;
  
  recommendations.push({
    priority: 'HIGH',
    recommendation: 'Quantify error between computational and asymptotic',
    method: 'Establish error bound: |a(n)/n³ - C| ≤ E(n)',
    errorBound: `Current error at n=${computationalN}: ${(error * 100).toFixed(4)}%`
  });
  
  for (const rec of recommendations) {
    console.log(`   [${rec.priority}] ${rec.recommendation}`);
    console.log(`      Method: ${rec.method}`);
    console.log(`      Error Bound: ${rec.errorBound}\n`);
  }
  
  // 10. Summary
  console.log('='.repeat(60));
  console.log('📊 USL ANALYSIS SUMMARY\n');
  
  console.log('Key Findings:');
  console.log(`   1. Convergence: ${avgConvergenceRate < 0.1 ? 'Fast' : 'Moderate'} (${(avgConvergenceRate * 100).toFixed(2)}% rate)`);
  console.log(`   2. Variance: ${maxVariance < 0.01 ? 'Low' : 'Moderate'} (max: ${maxVariance.toFixed(6)})`);
  console.log(`   3. Scale Consistency: ${avgSimilarity > 0.9 ? 'High' : 'Moderate'} (${avgSimilarity.toFixed(4)})`);
  console.log(`   4. Computational Error: ${(error * 100).toFixed(4)}% at n=${computationalN}`);
  console.log();
  
  console.log('Proof Strategy:');
  console.log(`   1. Establish limit existence using convergence rate`);
  console.log(`   2. Bound error using variance analysis`);
  console.log(`   3. Use scale consistency for asymptotic arguments`);
  console.log(`   4. Quantify computational-to-asymptotic gap`);
  console.log();
  
  console.log('✅ USL analysis complete!');
}

uslAnalysis().catch(console.error);

