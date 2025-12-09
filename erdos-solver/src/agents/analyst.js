import { BaseAgent } from './base-agent.js';

export class ProblemAnalyst extends BaseAgent {
  constructor(apiKey) {
    super(apiKey);
    
    this.registerTool({
      name: 'encode_sequence',
      description: 'Encode a mathematical sequence into sparse signature for analysis',
      input_schema: {
        type: 'object',
        properties: {
          sequence: {
            type: 'array',
            items: { type: 'number' },
            description: 'The integer sequence to encode'
          },
          encoding_type: {
            type: 'string',
            enum: ['gaps', 'values', 'ratios'],
            description: 'Type of encoding to apply'
          }
        },
        required: ['sequence', 'encoding_type']
      },
      handler: async (input, context) => {
        return context.encoder.encodeSequence(input.sequence, input.encoding_type);
      }
    });
  }

  getSystemPrompt() {
    return `You are a research mathematician specializing in Erdős-style combinatorics and number theory.

Your role is to analyze mathematical problems and decompose them into tractable subproblems.

For each problem, you must:

1. **Restate precisely**: Reformulate the problem statement in rigorous mathematical language, defining all objects and notation clearly.

2. **Identify mathematical objects**: List the key objects (sequences, sets, graphs, functions) and their properties that are central to the problem.

3. **Summarize known context**: Enumerate known results, bounds, special cases, and partial solutions. Cite specific references when available.

4. **Propose subproblems**: Generate 2-3 structured subproblems that would meaningfully advance the main problem if solved. Each subproblem should:
   - Be more tractable than the original
   - Have clear success criteria
   - Build toward the main goal

5. **Recommend encodings**: Suggest which mathematical objects should be encoded as sparse signatures and what features to extract. Choose from:
   - **RH-style encoding** (gaps/spacing): For sequences with natural gap structure
   - **Numerical encoding** (Data Supernova): For parameterized objects with rolling statistics
   - **KK kernel comparison**: For comparing constructions to known optimal examples

You have access to the \`encode_sequence\` tool to test encodings.

Focus on mathematical rigor and actionable insights. Do not speculate beyond what can be justified.`;
  }

  async analyze(problem, encoder) {
    const context = { encoder };
    
    const userMessage = `Analyze Erdős Problem #${problem.id}:

**Prize**: $${problem.prize}
**Status**: ${problem.status}
**Area**: ${problem.area}

**Statement**:
${problem.statement}

**Known Results**:
${problem.knownResults?.map(r => `- ${r.result} (${r.author}, ${r.year})`).join('\n') || 'None provided'}

**References**:
${problem.references?.map(r => `- ${r.title} (${r.type}: ${r.id})`).join('\n') || 'None provided'}

Provide a complete analysis following your systematic approach.`;

    return await this.call(this.getSystemPrompt(), userMessage, context);
  }
}

