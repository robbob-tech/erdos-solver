import { BaseAgent } from './base-agent.js';

export class ConjectureGenerator extends BaseAgent {
  constructor(apiKey) {
    super(apiKey);
    
    this.registerTool({
      name: 'compute_kk_similarity',
      description: 'Compare two mathematical constructions using KK kernel',
      input_schema: {
        type: 'object',
        properties: {
          construction1: {
            type: 'object',
            description: 'First construction signature'
          },
          construction2: {
            type: 'object',
            description: 'Second construction signature'
          },
          beta: { type: 'number', default: 0.5 },
          gamma: { type: 'number', default: 0.5 },
          M: { type: 'number', default: 8 }
        },
        required: ['construction1', 'construction2']
      },
      handler: async (input, context) => {
        return context.encoder.compareKK(
          input.construction1,
          input.construction2,
          input.beta,
          input.gamma,
          input.M
        );
      }
    });
  }

  getSystemPrompt() {
    return `You generate concrete mathematical conjectures and intermediate claims for Erdős problems.

Your role is to propose **testable, precise conjectures** based on:
- Problem decomposition
- Known results and patterns
- Sparse signature analysis (anomaly signals, KK kernel comparisons)

For each conjecture, provide:

1. **Precise statement**: Use rigorous mathematical language with all variables defined
2. **Informal rationale**: Explain why this conjecture is plausible (patterns, heuristics, analogies)
3. **Test instance**: Specify a minimal concrete example that can be checked computationally
4. **Relation to main problem**: Clarify whether this:
   - **Strengthens**: Proves the main result if true
   - **Weakens**: Provides a partial result
   - **Equivalent**: Reformulation of the original
   - **Independent**: Related but orthogonal

Generate at most 5 conjectures per request, prioritizing:
- Conjectures that isolate critical thresholds or phase transitions
- Restrictions to natural subclasses that preserve difficulty
- Statements that can be verified experimentally before attempting a proof

Use \`compute_kk_similarity\` to assess whether proposed constructions are "on-manifold" (high similarity to known optimal examples) or "off-manifold" (genuinely novel).

**Important**: Never claim to have solved a problem. Frame all outputs as conjectures requiring verification.`;
  }

  async generate(problem, analysis, signalData, encoder) {
    const context = { encoder, signalData };
    
    const userMessage = `Generate conjectures for Erdős Problem #${problem.id}:

**Analysis Summary**:
${analysis}

**Sparse Signal Data**:
${JSON.stringify(signalData, null, 2)}

Generate 3-5 concrete, testable conjectures following your methodology.`;

    return await this.call(this.getSystemPrompt(), userMessage, context);
  }
}

