import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ProblemAnalyst } from '../agents/analyst.js';
import { ConjectureGenerator } from '../agents/conjecture-generator.js';
import { ProofPlanner } from '../agents/proof-planner.js';
import { MathObjectEncoder } from '../encoders/index.js';
import { ComputationalVerifier } from '../tools/verifier.js';

const app = new Hono();

app.use('/*', cors());

// Initialize agents (reuse across requests)
let analyst, generator, planner, encoder, verifier;

app.get('/', (c) => {
  return c.json({
    name: 'Erdős Problem Solver API',
    version: '0.1.0',
    endpoints: {
      problems: '/problems',
      analyze: '/analyze/:id',
      conjecture: '/conjecture/:id',
      plan: '/plan/:id/:conjectureId',
      verify: '/verify/:conjectureId'
    }
  });
});

/**
 * GET /problems
 * List all problems
 */
app.get('/problems', async (c) => {
  const { DB } = c.env;
  
  if (!DB) {
    return c.json({ error: 'Database not configured' }, 500);
  }
  
  try {
    const { results } = await DB.prepare(
      'SELECT id, prize, title, status, area FROM problems ORDER BY prize DESC'
    ).all();
    
    return c.json({ problems: results || [] });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /problems/:id
 * Get problem details
 */
app.get('/problems/:id', async (c) => {
  const { DB } = c.env;
  const id = c.req.param('id');
  
  if (!DB) {
    return c.json({ error: 'Database not configured' }, 500);
  }
  
  try {
    const problem = await DB.prepare(
      'SELECT * FROM problems WHERE id = ?'
    ).bind(id).first();
    
    if (!problem) {
      return c.json({ error: 'Problem not found' }, 404);
    }
    
  // Get references
  const { results: references } = await DB.prepare(
    'SELECT * FROM problem_references WHERE problem_id = ?'
  ).bind(id).all();
    
    // Get known results
    const { results: knownResults } = await DB.prepare(
      'SELECT * FROM known_results WHERE problem_id = ?'
    ).bind(id).all();
    
    return c.json({
      problem: {
        ...problem,
        metadata: typeof problem.metadata === 'string' 
          ? JSON.parse(problem.metadata || '{}') 
          : problem.metadata || {},
        references: references || [],
        knownResults: knownResults || []
      }
    });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /analyze/:id
 * Analyze a problem
 */
app.post('/analyze/:id', async (c) => {
  const { DB, ANTHROPIC_API_KEY } = c.env;
  const id = c.req.param('id');
  
  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  }
  
  // Initialize on first use
  if (!analyst) {
    analyst = new ProblemAnalyst(ANTHROPIC_API_KEY);
    encoder = new MathObjectEncoder();
  }
  
  try {
    // Get problem
    let problem;
    if (DB) {
      problem = await DB.prepare(
        'SELECT * FROM problems WHERE id = ?'
      ).bind(id).first();
      
      if (!problem) {
        return c.json({ error: 'Problem not found' }, 404);
      }
      
      // Get additional context
      const { results: references } = await DB.prepare(
        'SELECT * FROM references WHERE problem_id = ?'
      ).bind(id).all();
      
      const { results: knownResults } = await DB.prepare(
        'SELECT * FROM known_results WHERE problem_id = ?'
      ).bind(id).all();
      
      problem.references = references || [];
      problem.knownResults = knownResults || [];
      problem.metadata = typeof problem.metadata === 'string' 
        ? JSON.parse(problem.metadata || '{}') 
        : problem.metadata || {};
    } else {
      // Fallback: create mock problem if DB not available
      problem = {
        id: parseInt(id),
        prize: 100,
        title: 'Sample Problem',
        status: 'open',
        area: 'combinatorics',
        statement: 'Sample problem statement',
        references: [],
        knownResults: []
      };
    }
    
    // Analyze
    const analysis = await analyst.analyze(problem, encoder);
    
    // Store analysis in KV for caching
    if (c.env.CACHE) {
      await c.env.CACHE.put(
        `analysis:${id}`,
        analysis,
        { expirationTtl: 86400 } // 24 hours
      );
    }
    
    return c.json({ analysis });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /conjecture/:id
 * Generate conjectures for a problem
 */
app.post('/conjecture/:id', async (c) => {
  const { DB, ANTHROPIC_API_KEY, CACHE } = c.env;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  
  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  }
  
  // Initialize
  if (!generator) {
    generator = new ConjectureGenerator(ANTHROPIC_API_KEY);
    encoder = new MathObjectEncoder();
  }
  
  try {
    // Get problem
    let problem;
    if (DB) {
      problem = await DB.prepare(
        'SELECT * FROM problems WHERE id = ?'
      ).bind(id).first();
      
      if (!problem) {
        return c.json({ error: 'Problem not found' }, 404);
      }
      
      problem.metadata = typeof problem.metadata === 'string' 
        ? JSON.parse(problem.metadata || '{}') 
        : problem.metadata || {};
    } else {
      problem = {
        id: parseInt(id),
        prize: 100,
        title: 'Sample Problem',
        status: 'open',
        area: 'combinatorics',
        statement: 'Sample problem statement'
      };
    }
    
    // Get cached analysis
    let analysis;
    if (CACHE) {
      const analysisJson = await CACHE.get(`analysis:${id}`);
      analysis = analysisJson || 'No analysis found. Please run /analyze/:id first.';
    } else {
      analysis = body.analysis || 'No analysis provided. Please run /analyze/:id first.';
    }
    
    // Get signal data (from body or compute)
    const signalData = body.signalData || {};
    
    // Generate conjectures
    const conjectures = await generator.generate(
      problem,
      analysis,
      signalData,
      encoder
    );
    
    // Parse and store conjectures in DB
    const parsed = _parseConjectures(conjectures);
    if (DB) {
      for (const conj of parsed) {
        await DB.prepare(
          `INSERT INTO conjectures 
           (problem_id, statement, rationale, status, kk_score, anomaly_score)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(
          id,
          conj.statement,
          conj.rationale,
          'proposed',
          conj.kk_score || null,
          conj.anomaly_score || null
        ).run();
      }
    }
    
    return c.json({ conjectures: parsed });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /plan/:id/:conjectureId
 * Plan proof for a conjecture
 */
app.post('/plan/:id/:conjectureId', async (c) => {
  const { DB, ANTHROPIC_API_KEY } = c.env;
  const problemId = c.req.param('id');
  const conjectureId = c.req.param('conjectureId');
  
  if (!ANTHROPIC_API_KEY) {
    return c.json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);
  }
  
  // Initialize
  if (!planner) {
    planner = new ProofPlanner(ANTHROPIC_API_KEY);
  }
  
  try {
    // Get problem and conjecture
    let problem, conjecture;
    if (DB) {
      problem = await DB.prepare(
        'SELECT * FROM problems WHERE id = ?'
      ).bind(problemId).first();
      
      conjecture = await DB.prepare(
        'SELECT * FROM conjectures WHERE id = ?'
      ).bind(conjectureId).first();
      
      if (!problem || !conjecture) {
        return c.json({ error: 'Problem or conjecture not found' }, 404);
      }
      
      // Get context
      const { results: knownResults } = await DB.prepare(
        'SELECT * FROM known_results WHERE problem_id = ?'
      ).bind(problemId).all();
      
      // Plan proof
      const plan = await planner.plan(problem, conjecture, {
        knownResults: (knownResults || []).map(r => r.result_statement).join('\n')
      });
      
      return c.json({ plan });
    } else {
      return c.json({ error: 'Database not configured' }, 500);
    }
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /verify/:conjectureId
 * Computationally verify a conjecture
 */
app.post('/verify/:conjectureId', async (c) => {
  const { DB } = c.env;
  const conjectureId = c.req.param('conjectureId');
  const body = await c.req.json().catch(() => ({}));
  
  if (!verifier) {
    verifier = new ComputationalVerifier();
  }
  
  try {
    // Get conjecture
    let conjecture;
    if (DB) {
      conjecture = await DB.prepare(
        'SELECT * FROM conjectures WHERE id = ?'
      ).bind(conjectureId).first();
      
      if (!conjecture) {
        return c.json({ error: 'Conjecture not found' }, 404);
      }
    } else {
      conjecture = {
        id: parseInt(conjectureId),
        statement: body.statement || 'Sample conjecture',
        expression: body.expression
      };
    }
    
    // Verify with provided test cases
    const results = await verifier.verifySmallCases(
      conjecture,
      body.testCases || []
    );
    
    // Update status if all passed
    if (DB && results.passed === results.total && results.total > 0) {
      await DB.prepare(
        'UPDATE conjectures SET status = ? WHERE id = ?'
      ).bind('experimental', conjectureId).run();
    }
    
    return c.json({ verification: results });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// Helper: parse LLM output into structured conjectures
function _parseConjectures(text) {
  // Simple parser - would need improvement
  const conjectures = [];
  const sections = text.split(/Conjecture \d+:/i);
  
  for (let i = 1; i < sections.length; i++) {
    const lines = sections[i].trim().split('\n');
    const statement = lines[0].trim();
    const rationale = lines.slice(1).join('\n').trim();
    
    if (statement) {
      conjectures.push({
        statement,
        rationale
      });
    }
  }
  
  // If no structured format found, create single conjecture
  if (conjectures.length === 0 && text.trim()) {
    const lines = text.trim().split('\n');
    conjectures.push({
      statement: lines[0] || text.trim(),
      rationale: lines.slice(1).join('\n') || ''
    });
  }
  
  return conjectures;
}

export default app;

