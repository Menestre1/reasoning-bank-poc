/**
 * IntentAnalyzer - semantic intent analysis
 */

import { ReasoningBankSemantic } from '../ReasoningBankSemantic.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { Tool } from './ToolRegistry.js';

export interface IntentResult {
  shouldSuggest: boolean;
  tool?: Tool;
  confidence: number;
  reason: string;
}

export class IntentAnalyzer {
  private memory: ReasoningBankSemantic;
  private registry: ToolRegistry;
  private threshold: number;

  constructor(
    memory: ReasoningBankSemantic,
    registry: ToolRegistry,
    threshold = 0.6  // Updated from 0.5 to reduce false positives
  ) {
    this.memory = memory;
    this.registry = registry;
    this.threshold = threshold;
  }

  async analyze(userInput: string): Promise<IntentResult> {
    try {
      console.log(`[IntentAnalyzer] Analyzing: "${userInput}"`);

      // Try semantic search first - use threshold for Russian matching
      const tools = await this.memory.recommendTools(userInput, {
        minScore: this.threshold,  // Use configured threshold
        filterByDomain: 'tool',
      });

      console.log(`[IntentAnalyzer] Semantic search found ${tools.length} tools`);

      // If semantic search found tools, use them
      if (tools.length > 0) {
        const bestTool = tools[0];
        if (bestTool) {
          const tool = this.registry.getToolById(bestTool.tool_id);
          if (tool) {
            const score = bestTool.score ?? 0;
            console.log(`[IntentAnalyzer] Suggesting: ${tool.name} (score: ${score.toFixed(2)})`);
            return {
              shouldSuggest: true,
              tool,
              confidence: score,
              reason: `Found tool: ${tool.name} (score: ${score.toFixed(2)})`,
            };
          }
        }
      }

      // Fallback: try direct DB query + keyword matching
      console.log(`[IntentAnalyzer] Semantic search found 0 tools, trying fallback...`);
      const dbTools = await this.memory.getToolsByDomain('tool');
      console.log(`[IntentAnalyzer] Direct DB query found ${dbTools.length} tools`);

      // Simple keyword matching as fallback
      const lowerInput = userInput.toLowerCase();
      for (const dbTool of dbTools) {
        const tool = this.registry.getToolById(dbTool.tool_id);
        if (!tool) continue;

        // Check if tool name or content matches the query
        const toolName = tool.name?.toLowerCase() || '';
        const toolContent = (dbTool.content || '').toLowerCase();
        
        const nameMatch = toolName && (toolName.includes(lowerInput) || lowerInput.includes(toolName));
        const contentMatch = toolContent && (toolContent.includes(lowerInput) || lowerInput.includes(toolContent));

        if (nameMatch || contentMatch) {
          console.log(`[IntentAnalyzer] Fallback found tool: ${tool.name}`);
          return {
            shouldSuggest: true,
            tool,
            confidence: 0.6, // Medium confidence for fallback
            reason: `Found tool via fallback: ${tool.name}`,
          };
        }
      }

      return {
        shouldSuggest: false,
        confidence: 0,
        reason: 'No suitable tools found',
      };
    } catch (error: any) {
      console.log(`[IntentAnalyzer] Error: ${error.message}`);
      return {
        shouldSuggest: false,
        confidence: 0,
        reason: `Analysis error: ${error.message}`,
      };
    }
  }

  updateThreshold(newThreshold: number): void {
    this.threshold = newThreshold;
  }
}
