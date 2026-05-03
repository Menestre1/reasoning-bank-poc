/**
 * ToolRegistry - loads tools from database
 */

import { ReasoningBankSemantic } from '../ReasoningBankSemantic.js';

export interface ToolMetadata {
  type: 'python' | 'node' | 'shell' | '1c';
  path: string;
  args_template: string;
  param_patterns?: Record<string, string>;
  confirm?: boolean;
  timeout_sec?: number;
  output_handling?: 'file' | 'stdout';
  auto_suggest_threshold?: number;
}

export interface Tool {
  tool_id: string;
  name: string;
  content: string;
  score?: number;
  metadata: ToolMetadata;
}

export class ToolRegistry {
  private memory: ReasoningBankSemantic;
  private cache: Tool[] = [];
  private initialized = false;

  constructor(memory: ReasoningBankSemantic) {
    this.memory = memory;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load tools directly from DB (bypass semantic search)
      await this.memory.ensureInitialized();
      
      // Use getToolsByDomain which directly queries DB
      const tools = await this.memory.getToolsByDomain('tool');
      
      this.cache = tools.map(t => {
        // Parse tool_metadata (might be JSON string)
        let rawMetadata: any = t.tool_metadata;
        if (typeof rawMetadata === 'string') {
          try {
            rawMetadata = JSON.parse(rawMetadata);
          } catch (e) {
            console.error('[ToolRegistry] Failed to parse tool_metadata:', e);
            rawMetadata = {};
          }
        }
        
        // Unwrap the 'tool' wrapper if present
        const toolMetadata = rawMetadata.tool ? rawMetadata.tool : rawMetadata;
        
        return {
          tool_id: t.tool_id,
          name: t.name,
          content: t.content,
          score: t.score,
          metadata: toolMetadata as ToolMetadata,
        };
      });

      this.initialized = true;
      console.log(`[ToolRegistry] Loaded ${this.cache.length} tools`);
    } catch (error: any) {
      console.error('[ToolRegistry] Error:', error.message);
    }
  }

  getToolById(toolId: string): Tool | undefined {
    return this.cache.find(t => t.tool_id === toolId);
  }

  getToolByName(name: string): Tool | undefined {
    return this.cache.find(t => t.name === name);
  }

  getAllTools(): Tool[] {
    return [...this.cache];
  }

  async refresh(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }
}
