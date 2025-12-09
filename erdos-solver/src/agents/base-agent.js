import Anthropic from '@anthropic-ai/sdk';

export class BaseAgent {
  constructor(apiKey, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.tools = [];
  }

  async call(systemPrompt, userMessage, context = {}) {
    const messages = [
      { role: 'user', content: userMessage }
    ];

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: systemPrompt,
      messages,
      tools: this.tools.length > 0 ? this.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema
      })) : undefined
    });

    return this._handleResponse(response, context);
  }

  async _handleResponse(response, context) {
    // Handle tool calls
    if (response.stop_reason === 'tool_use') {
      const toolResults = [];
      
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await this._executeTool(block.name, block.input, context);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }
      }
      
      // Continue conversation with tool results
      const followUp = await this.client.messages.create({
        model: this.model,
        max_tokens: 8000,
        system: response.system || '',
        messages: [
          ...response.content,
          ...toolResults
        ],
        tools: this.tools.length > 0 ? this.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema
        })) : undefined
      });
      
      return this._extractText(followUp);
    }
    
    return this._extractText(response);
  }

  _extractText(response) {
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }

  async _executeTool(name, input, context) {
    const tool = this.tools.find(t => t.name === name);
    if (!tool || !tool.handler) {
      throw new Error(`Tool ${name} not found or has no handler`);
    }
    return await tool.handler(input, context);
  }

  registerTool(tool) {
    this.tools.push(tool);
  }
}

