import { describe, it, expect } from 'vitest';
import { ErdosProblemScraper } from '../src/scrapers/erdos-scraper.js';
import { MathObjectEncoder } from '../src/encoders/index.js';
import { ComputationalVerifier } from '../src/tools/verifier.js';

describe('Erdős Solver Integration', () => {
  it('should create encoder instance', () => {
    const encoder = new MathObjectEncoder();
    expect(encoder).toBeDefined();
    expect(encoder.usad).toBeDefined();
    expect(encoder.dataSupernova).toBeDefined();
  });

  it('should encode Mian-Chowla sequence', () => {
    const encoder = new MathObjectEncoder();
    const mianChowla = [1, 2, 4, 8, 13, 21, 31, 45, 66, 81, 97];
    
    const sig = encoder.encodeSequence(mianChowla, 'gaps');
    
    expect(sig.type).toBe('rh_trace');
    expect(sig.anomalyScores).toBeDefined();
    expect(sig.signatures.length).toBeGreaterThan(0);
  });

  it('should verify Sidon property', () => {
    const verifier = new ComputationalVerifier();
    
    const sidonSet = [1, 2, 4, 8, 13];
    const notSidon = [1, 2, 3, 4]; // 1+3 = 2+2 = 4
    
    expect(verifier.isSidonSet(sidonSet).valid).toBe(true);
    expect(verifier.isSidonSet(notSidon).valid).toBe(false);
  });

  it('should compute sequence statistics', () => {
    const verifier = new ComputationalVerifier();
    const sequence = [1, 2, 4, 8, 13, 21];
    
    const stats = verifier.analyzeSequence(sequence);
    
    expect(stats.length).toBe(6);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(21);
    expect(stats.gaps).toBeDefined();
    expect(stats.gaps.min).toBeGreaterThan(0);
  });

  it('should encode numerical sequences', () => {
    const encoder = new MathObjectEncoder();
    const sequence = [1, 2, 4, 8, 13, 21, 31, 45, 66, 81, 97];
    
    // Need at least 100 values for numerical encoding
    const longSequence = Array.from({ length: 150 }, (_, i) => i + 1);
    const sig = encoder.encodeSequence(longSequence, 'values');
    
    expect(sig.type).toBe('numerical');
    expect(sig.signatures).toBeDefined();
    expect(sig.stats).toBeDefined();
  });

  it('should compare sequences with KK kernel', () => {
    const encoder = new MathObjectEncoder();
    
    const seq1 = [1, 2, 4, 8, 13];
    const seq2 = [1, 2, 4, 8, 14]; // similar but different
    
    const sig1 = encoder.encodeSequence(seq1, 'gaps');
    const sig2 = encoder.encodeSequence(seq2, 'gaps');
    
    // Compare first signatures
    if (sig1.signatures.length > 0 && sig2.signatures.length > 0) {
      const similarity = encoder.compareKK(
        sig1.signatures[0],
        sig2.signatures[0]
      );
      
      expect(similarity.total).toBeGreaterThanOrEqual(0);
      expect(similarity.total).toBeLessThanOrEqual(1);
    }
  });

  it('should create scraper instance', () => {
    const scraper = new ErdosProblemScraper();
    expect(scraper).toBeDefined();
    expect(scraper.baseUrl).toBe('https://www.erdosproblems.com');
    expect(scraper.prizeTiers.length).toBeGreaterThan(0);
  });
});

