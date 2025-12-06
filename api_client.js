// OpenAI API client
class OpenAiApiClient {
  constructor(options = {}) {
    this.model = options.model || 'gpt-4o-mini';
    this.apiKey = options.apiKey;
  }

  async call(prompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }

    const requestBody = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }]
    };

    // Use structured outputs with JSON schema if provided
    if (options.jsonSchema) {
      requestBody.response_format = {
        type: "json_schema",
        json_schema: options.jsonSchema
      };
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return data.choices[0].message.content;
  }
}

// Factory for creating API clients
function createApiClient(apiKey, options = {}) {
  return new OpenAiApiClient({ ...options, apiKey });
}

export { OpenAiApiClient, createApiClient };
