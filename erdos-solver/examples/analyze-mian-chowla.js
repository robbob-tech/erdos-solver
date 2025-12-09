import { ErdosProblemScraper } from '../src/scrapers/erdos-scraper.js';
import { ProblemAnalyst } from '../src/agents/analyst.js';
import { ConjectureGenerator } from '../src/agents/conjecture-generator.js';
import { ProofPlanner } from '../src/agents/proof-planner.js';
import { MathObjectEncoder } from '../src/encoders/index.js';
import { ComputationalVerifier } from '../src/tools/verifier.js';

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    process.exit(1);
  }
  
  // 1. Scrape problem (or use mock data)
  console.log('Scraping problem #340...');
  const scraper = new ErdosProblemScraper();
  let problem;
  
  try {
    problem = await scraper.scrapeProblemDetail(340);
  } catch (error) {
    console.log('Scraping failed, using mock data:', error.message);
    problem = {
      id: 340,
      prize: 100,
      title: 'Mian-Chowla Sequence',
      status: 'open',
      area: 'combinatorics',
      statement: 'Find the largest Sidon set in {1, 2, ..., n}',
      knownResults: [],
      references: []
    };
  }
  
  // 2. Encode sequence
  console.log('\nEncoding Mian-Chowla sequence...');
  const encoder = new MathObjectEncoder();
  const mianChowla = [1,2,4,8,13,21,31,45,66,81,97,123,148,182,204];
  
  const gapSignature = encoder.encodeSequence(mianChowla, 'gaps');
  console.log(`Generated RH trace with ${gapSignature.anomalyScores.length} windows`);
  
  // 3. Analyze problem
  console.log('\nAnalyzing problem with LLM...');
  const analyst = new ProblemAnalyst(apiKey);
  const analysis = await analyst.analyze(problem, encoder);
  console.log('Analysis:', analysis);
  
  // 4. Generate conjectures
  console.log('\nGenerating conjectures...');
  const generator = new ConjectureGenerator(apiKey);
  const conjectures = await generator.generate(
    problem,
    analysis,
    { gapSignature },
    encoder
  );
  console.log('Conjectures:', conjectures);
  
  // 5. Plan proof for first conjecture
  console.log('\nPlanning proof...');
  const planner = new ProofPlanner(apiKey);
  const firstConjecture = {
    statement: conjectures.split('Conjecture 1')[1]?.split('Conjecture 2')[0] || conjectures.split('\n')[0],
    rationale: 'Generated from analysis'
  };
  
  const plan = await planner.plan(
    problem,
    firstConjecture,
    { knownResults: problem.knownResults?.map(r => r.result).join('\n') || '' }
  );
  console.log('Proof plan:', plan);
  
  // 6. Verify computationally
  console.log('\nVerifying Sidon property...');
  const verifier = new ComputationalVerifier();
  const isSidon = verifier.isSidonSet(mianChowla);
  console.log('Is Sidon set:', isSidon.valid);
  
  const stats = verifier.analyzeSequence(mianChowla);
  console.log('Sequence statistics:', stats);
}

main().catch(console.error);

