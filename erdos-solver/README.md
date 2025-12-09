# Erdős Problem Solver

A comprehensive system for analyzing Erdős problems using sparse encoders and LLM agents.

## Overview

This project implements a multi-agent system that:
- Scrapes Erdős problems from erdosproblems.com
- Encodes mathematical sequences using sparse signatures (RH-style, Data Supernova, KK kernel)
- Uses LLM agents to analyze problems, generate conjectures, and plan proofs
- Verifies conjectures computationally

## Architecture

### Components

1. **Sparse Encoders** (`src/encoders/`)
   - USAD (Universal Sparse Anomaly Detector)
   - KK Kernel for construction comparison
   - RH-style encoding for gap distributions
   - Data Supernova for numerical features

2. **Agents** (`src/agents/`)
   - `ProblemAnalyst`: Analyzes problems and proposes subproblems
   - `ConjectureGenerator`: Generates testable conjectures
   - `ProofPlanner`: Plans proof strategies

3. **Tools** (`src/tools/`)
   - `ComputationalVerifier`: Verifies conjectures on test cases
   - `LeanIntegration`: Interface for formal verification (stub)

4. **API** (`src/api/`)
   - Cloudflare Workers API using Hono
   - RESTful endpoints for problem analysis

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account (for deployment)
- Anthropic API key

### Installation

```bash
# Install dependencies
npm install

# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...

# Initialize D1 database
wrangler d1 create erdos-problems
wrangler d1 execute erdos-problems --file=schema.sql

# Initialize KV namespace
wrangler kv:namespace create CACHE
```

### Configuration

Update `wrangler.toml` with your D1 database ID and KV namespace ID after creation.

## Usage

### Local Development

```bash
# Run development server
npm run dev

# Run scraper
npm run scrape

# Run tests
npm test
```

### API Endpoints

- `GET /` - API information
- `GET /problems` - List all problems
- `GET /problems/:id` - Get problem details
- `POST /analyze/:id` - Analyze a problem
- `POST /conjecture/:id` - Generate conjectures
- `POST /plan/:id/:conjectureId` - Plan proof
- `POST /verify/:conjectureId` - Verify conjecture

### Example Workflow

See `examples/analyze-mian-chowla.js` for a complete example.

```javascript
import { ProblemAnalyst } from './src/agents/analyst.js';
import { MathObjectEncoder } from './src/encoders/index.js';

const encoder = new MathObjectEncoder();
const analyst = new ProblemAnalyst(process.env.ANTHROPIC_API_KEY);

const problem = { /* ... */ };
const analysis = await analyst.analyze(problem, encoder);
```

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## Project Structure

```
erdos-solver/
├── src/
│   ├── agents/          # LLM agents
│   ├── encoders/         # Sparse encoders
│   ├── scrapers/         # Problem scrapers
│   ├── tools/            # Verification tools
│   └── api/              # API handlers
├── tests/                # Test files
├── examples/             # Example workflows
├── docs/                 # Documentation
└── schema.sql            # Database schema
```

## Notes

- Encoder implementations are stubs - replace with actual implementations when available
- Scraper selectors may need adjustment based on actual website structure
- Lean integration is a stub and requires external Lean installation
- Never claims problems are "solved" - only proposes conjectures

## License

MIT

