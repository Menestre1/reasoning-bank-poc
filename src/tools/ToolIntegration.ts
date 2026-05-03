/**
 * ToolIntegration - integration layer between LirAgent and tool subsystem
 * Handles all tool-related state management and processing
 */

import { ReasoningBankSemantic } from '../ReasoningBankSemantic.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { Tool } from './ToolRegistry.js';
import { IntentAnalyzer } from './IntentAnalyzer.js';
import { ToolOrchestrator } from './ToolOrchestrator.js';
import type { OrchestratorResult } from './ToolOrchestrator.js';
import { ToolExecutor } from './ToolExecutor.js';

export interface ToolIntegrationConfig {
  toolThreshold: number;
  allowedToolRoots: string[];
  defaultTimeoutSec: number;
}

export interface ToolSessionState {
  waitingForTool: boolean;
  pendingTool: any;
  pendingToolInput: string;
  waitingForToolParameter: boolean;
  pendingToolParamName: string | null;
}

export class ToolIntegration {
  private memory: ReasoningBankSemantic;
  private registry: ToolRegistry;
  private analyzer: IntentAnalyzer;
  private orchestrator: ToolOrchestrator;
  private executor: ToolExecutor;

  constructor(memory: ReasoningBankSemantic, config: ToolIntegrationConfig) {
    this.memory = memory;
    this.registry = new ToolRegistry(memory);
    this.executor = new ToolExecutor({
      allowedRoots: config.allowedToolRoots,
      defaultTimeoutSec: config.defaultTimeoutSec,
    });
    this.analyzer = new IntentAnalyzer(memory, this.registry, config.toolThreshold);
    this.orchestrator = new ToolOrchestrator(this.executor);
  }

  async initialize(): Promise<void> {
    await this.registry.initialize();
  }

  getRegistry(): ToolRegistry {
    return this.registry;
  }

  getAnalyzer(): IntentAnalyzer {
    return this.analyzer;
  }

  getOrchestrator(): ToolOrchestrator {
    return this.orchestrator;
  }

  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * Analyze user input for tool suggestion
   */
  async analyzeIntent(userInput: string): Promise<{
    shouldSuggest: boolean;
    tool?: Tool;
    confidence: number;
    reason: string;
  }> {
    return await this.analyzer.analyze(userInput);
  }

  private currentTool: any = null;
  private currentToolInput: string = '';

  /**
   * Process tool confirmation response
   */
  async processConfirmation(
    userInput: string,
    pendingTool?: any,
    pendingToolInput?: string
  ): Promise<{
    action: 'waiting_confirmation' | 'waiting_parameter' | 'completed' | 'cancelled' | 'respond';
    response?: string;
    missingParameter?: string;
    executionResult?: any;
    toolResponse?: string;
  }> {
    // Use stored tool if not provided
    const tool = pendingTool || this.currentTool;
    const input = pendingToolInput || this.currentToolInput;

    console.log(`[ToolIntegration] processConfirmation: tool=${tool?.name || 'null'}, input="${input}"`);

    // Store for next call
    if (tool) {
      this.currentTool = tool;
      this.currentToolInput = input;
    } else {
      console.error('[ToolIntegration] ERROR: pendingTool is null!');
    }

    const result = await this.orchestrator.process(
      tool,
      input,
      userInput
    );

    // Map 'executing' to 'completed' for compatibility
    const mappedAction = result.action === 'executing' ? 'completed' : result.action;

    const toolResponse = result.action === 'completed'
      ? (result.executionResult?.success
        ? `Tool executed: ${result.executionResult.output}`
        : `Error: ${result.executionResult?.error}`)
      : undefined;

    const returnValue: any = {
      action: mappedAction,
      response: result.response,
      missingParameter: result.missingParameter,
      executionResult: result.executionResult,
    };
    if (toolResponse !== undefined) {
      returnValue.toolResponse = toolResponse;
    }
    return returnValue;
  }

  /**
   * Execute tool directly (for /extract-my-code etc.)
   */
  async executeTool(
    tool: Tool,
    userInput: string
  ): Promise<{
    success: boolean;
    output: string;
    error?: string;
    filePath?: string;
  }> {
    const result = await this.orchestrator.process(tool, userInput);
    
    if (result.action === 'completed') {
      const execResult = result.executionResult;
      const ret: any = {
        success: execResult?.success || false,
        output: execResult?.output || '',
      };
      if (execResult?.error !== undefined) {
        ret.error = execResult.error;
      }
      if (execResult?.file_path !== undefined) {
        ret.filePath = execResult.file_path;
      }
      return ret;
    }

    return {
      success: false,
      output: '',
      error: 'Tool execution did not complete',
    };
  }
}
