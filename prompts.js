// Critic Prompt for content analysis
class CriticPrompt {
  constructor(options = {}) {
    this.language = options.language || 'ENGLISH';
    this.maxTokens = options.maxTokens || 20000;
    this.model = options.model || 'gpt-5.1';
    this.validHighlightTypes = ['fluff', 'fallacy', 'assumption', 'contradiction', 'inconsistency'];
  }

  formatWithContent(content) {
    return `${this.getPrompt()}\n\n${content}`;
  }

  getPrompt() {
    return `You are a sharp, relentless content critic.
Your job is to break down any post, article, or idea I give you.

IMPORTANT: The content provided is extracted from a whole HTML page. It may contain a lot of noise such as navigation menus, headers, footers, sidebars, ads, and other irrelevant elements. Your task is to identify the "meat" of the page - the main article or core content - and focus your analysis ONLY on that. Ignore navigation, boilerplate, and peripheral content.

You do not summarize. You do not agree. You challenge.

You focus on:
- Uncovering assumptions (stated or hidden)
- Spotting contradictions or weak logic
- Testing ideas with second-order thinking, inversion, tradeoffs, and leverage analysis
- Surfacing what others miss: blind spots, sharper framings, edge opportunities

Ask hard questions like:
- What breaks this?
- What's true but non-obvious? (edge cases, hidden insights)
- What's assumed? What are the tradeoffs?
- What will be the new limiting factor if this is true?
- What's the force multiplier/leverage/wedge? Is there an asymmetry?

Tone:
- No fluff. No praise unless it serves the analysis. Stay curious, sharp, and bold. Push thinking further.
- Be concise without losing meaning. Use symbols to improve readability: *, →, ≠, ~, ::, =, <, >, //, @, ^

Output rules: return ONLY a valid JSON object like this:
{
  "analysis": {
    "summary": "A 5-10 rows table (Markdown format) summary highlighting core premise, risks, effects, and tradeoffs",
    "critique": "Your detailed analysis and critique in markdown format using #, ##, ### for headers."
  },
  "highlights": [
    {
      "text": "EXACT QUOTE FROM THE CONTENT - Copy and paste the exact text you want to highlight, word for word",
      "type": "fluff|fallacy|assumption|contradiction|inconsistency",
      "explanation": "Your analysis of why this text is problematic",
      "suggestion": "Optional suggestion for improvement"
    }
  ]
}

CRITICAL RULES:
1. Return ONLY the JSON object, with no other text, it must be valid and complete
2. Do not include any markdown formatting outside of the JSON
3. Do not include any explanations or notes outside of the JSON
4. Focus ONLY on the main article content, ignore navigation, headers, footers, and other page noise
5. Each highlight's "text" field must be an EXACT quote from the content, NOT altered, NOT paraphrased, NOT summarized, NOT changed in any way.
6. Do not put your analysis in the "text" field - use the "explanation" field instead
7. Please generate minimum 5 and maximum 15 highlights. The more the better.
8. DO NOT wrap markdown tables or headers in code blocks
9. Highlight types MUST only be one of: fluff|fallacy|assumption|contradiction|inconsistency.

Your answer must be in ${this.language}.
Please analyze and critique the following content:`;
  }

  validateResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new Error('Response must be a JSON object');
    }

    if (!response.analysis || typeof response.analysis !== 'object') {
      throw new Error('Response must have an "analysis" object');
    }

    if (!response.analysis.summary || typeof response.analysis.summary !== 'string') {
      throw new Error('Analysis must have a "summary" string');
    }

    if (!response.analysis.critique || typeof response.analysis.critique !== 'string') {
      throw new Error('Analysis must have a "critique" string');
    }

    if (!Array.isArray(response.highlights)) {
      throw new Error('Response must have a "highlights" array');
    }

    response.highlights.forEach((highlight, index) => {
      if (!highlight || typeof highlight !== 'object') {
        throw new Error(`Highlight at index ${index} must be an object`);
      }

      if (!highlight.text || typeof highlight.text !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "text" string`);
      }

      if (!highlight.type || typeof highlight.type !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "type" string`);
      }

      if (!highlight.explanation || typeof highlight.explanation !== 'string') {
        throw new Error(`Highlight at index ${index} must have an "explanation" string`);
      }

      if (!this.validHighlightTypes.includes(highlight.type)) {
        throw new Error(`Highlight at index ${index} has invalid type "${highlight.type}". Must be one of: ${this.validHighlightTypes.join(', ')}`);
      }

      if (highlight.suggestion !== undefined && typeof highlight.suggestion !== 'string') {
        throw new Error(`Highlight at index ${index} must have a "suggestion" string if provided`);
      }
    });

    return true;
  }

  parseResponse(rawResponse) {
    // For critic prompts, we expect a JSON object
    let parsedResult;

    // Try to parse as JSON directly first (for structured outputs)
    try {
      parsedResult = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    } catch {
      // Fall back to regex extraction for non-structured responses
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON object found in response for CRITIC task');
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    }

    this.validateResponse(parsedResult);

    return {
      analysis: parsedResult.analysis,
      highlights: parsedResult.highlights || []
    };
  }

  getJsonSchema() {
    return {
      name: "critic_response",
      strict: true,
      schema: {
        type: "object",
        properties: {
          analysis: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "A 5-10 rows table (Markdown format) summary highlighting core premise, risks, effects, and tradeoffs"
              },
              critique: {
                type: "string",
                description: "Detailed analysis and critique in markdown format using #, ##, ### for headers"
              }
            },
            required: ["summary", "critique"],
            additionalProperties: false
          },
          highlights: {
            type: "array",
            description: "Array of 5-15 highlights from the content",
            items: {
              type: "object",
              properties: {
                text: {
                  type: "string",
                  description: "EXACT quote from the content - copy and paste word for word, no alterations"
                },
                type: {
                  type: "string",
                  enum: ["fluff", "fallacy", "assumption", "contradiction", "inconsistency"],
                  description: "Type of issue identified"
                },
                explanation: {
                  type: "string",
                  description: "Analysis of why this text is problematic"
                },
                suggestion: {
                  type: "string",
                  description: "Suggestion for improvement, or empty string if none"
                }
              },
              required: ["text", "type", "explanation", "suggestion"],
              additionalProperties: false
            }
          }
        },
        required: ["analysis", "highlights"],
        additionalProperties: false
      }
    };
  }
}

// Export the classes
export {
  CriticPrompt
}; 