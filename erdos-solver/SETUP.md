# Setup Instructions

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and add your ANTHROPIC_API_KEY
   ```

3. **Initialize Cloudflare resources:**
   ```bash
   # Create D1 database
   wrangler d1 create erdos-problems
   
   # Update wrangler.toml with the database_id from the output above
   
   # Execute schema
   wrangler d1 execute erdos-problems --file=schema.sql
   
   # Create KV namespace
   wrangler kv:namespace create CACHE
   
   # Update wrangler.toml with the KV namespace id from the output above
   ```

4. **Test locally:**
   ```bash
   npm run dev
   ```

5. **Run tests:**
   ```bash
   npm test
   ```

6. **Deploy:**
   ```bash
   npm run deploy
   ```

## Development Workflow

### Adding a New Encoder

1. Create encoder file in `src/encoders/`
2. Export encoder class/function
3. Add to `MathObjectEncoder` in `src/encoders/index.js`
4. Register as tool in relevant agent

### Adding a New Agent

1. Create agent class extending `BaseAgent` in `src/agents/`
2. Define system prompt
3. Register tools
4. Add endpoint to `src/api/index.js`

### Testing

- Unit tests: `tests/integration.test.js`
- Example workflow: `examples/analyze-mian-chowla.js`

## Troubleshooting

### CORS Import Error

If you see an error with `hono/cors`, ensure you're using Hono v3.11.7 or later:
```bash
npm install hono@^3.11.7
```

### Database Connection

If database queries fail, verify:
- D1 database is created
- `database_id` is set in `wrangler.toml`
- Schema is executed: `wrangler d1 execute erdos-problems --file=schema.sql`

### API Key Issues

Ensure `ANTHROPIC_API_KEY` is set in your environment or `.env` file.

