/**
 * AgentToolDialog - encapsulates tool dialog flow
 * Handles: suggestion -> confirmation -> execution -> feedback
 */

import { ReasoningBankSemantic } from '../ReasoningBankSemantic.js';
import { ToolIntegration } from './ToolIntegration.js';
import type { ToolSessionState } from './ToolIntegration.js';

export interface DialogResult {
  action: 'respond' | 'waiting_feedback' | 'ask_language' | 'record_success' | 'learn_error';
  response: string;
  fullPrompt: string;
  warnings: any[];
  languageQuestion?: string;
  errorOptions?: string;
  toolResponse?: string;
  pendingTool?: any;  // Tool that is pending confirmation
}

export class AgentToolDialog {
  private integration: ToolIntegration;
  private sessionState: ToolSessionState;
  private onFeedback: (response: string) => void;
  private onLanguageAsk: (question: string) => void;

  constructor(
    integration: ToolIntegration,
    initialState: ToolSessionState,
    callbacks: {
      onFeedback: (response: string) => void;
      onLanguageAsk: (question: string) => void;
    }
  ) {
    this.integration = integration;
    this.sessionState = initialState;
    this.onFeedback = callbacks.onFeedback;
    this.onLanguageAsk = callbacks.onLanguageAsk;
  }

  /**
   * Main entry point - process user input related to tools
   * Returns null if no tool action needed (continue normal flow)
   */
  async processInput(userInput: string, currentState?: ToolSessionState): Promise<DialogResult | null> {
    // Update state if provided
    if (currentState) {
      this.sessionState = currentState;
    }

    // 1. If waiting for tool confirmation
    if (this.sessionState.waitingForTool) {
      console.log(`[AgentToolDialog] Waiting for tool confirmation, input: "${userInput}"`);
      return this.handleToolConfirmation(userInput);
    }

    // 2. Semantic analysis - should we suggest a tool?
    console.log(`[AgentToolDialog] Running semantic analysis for: "${userInput}"`);
    const intentResult = await this.integration.analyzeIntent(userInput);
    
    if (intentResult.shouldSuggest && intentResult.tool) {
      // Save state and ask for confirmation
      this.sessionState.waitingForTool = true;
      this.sessionState.pendingTool = intentResult.tool;
      this.sessionState.pendingToolInput = userInput;

      return {
        action: 'respond',
        response: `Tool detected: "${intentResult.tool.name}".\n${intentResult.tool.content}\n\nRun tool? (yes/no)`,
        fullPrompt: '',
        warnings: [],
        pendingTool: intentResult.tool,
      };
    }

    // No tool action needed
    console.log(`[AgentToolDialog] No tool suggestion: ${intentResult.reason}`);
    return null;
  }

  /**
   * Handle tool confirmation (user said yes/no)
   */
  private async handleToolConfirmation(userInput: string): Promise<DialogResult> {
    const result = await this.integration.processConfirmation(
      userInput,
      this.sessionState.pendingTool,
      this.sessionState.pendingToolInput
    );

    if (result.action === 'waiting_confirmation' || result.action === 'waiting_parameter') {
      return {
        action: 'respond',
        response: result.response || 'Waiting for input...',
        fullPrompt: '',
        warnings: [],
      };
    }

    if (result.action === 'completed') {
      this.resetState();
      
      if (result.executionResult?.success) {
        const dialogResult: any = {
          action: 'waiting_feedback',
          response: `Tool executed: ${result.toolResponse}\n\nDid I succeed? (yes/no/cancel)`,
          fullPrompt: '',
          warnings: [],
        };
        if (result.toolResponse !== undefined) {
          dialogResult.toolResponse = result.toolResponse;
        }
        return dialogResult;
      } else {
        return {
          action: 'respond',
          response: `Tool error: ${result.executionResult?.error || 'Unknown error'}`,
          fullPrompt: '',
          warnings: [],
        };
      }
    }

    if (result.action === 'cancelled') {
      this.resetState();
      return {
        action: 'respond',
        response: result.response || 'Cancelled.',
        fullPrompt: '',
        warnings: [],
      };
    }

    // Default
    this.resetState();
    return {
      action: 'respond',
      response: 'Tool dialog completed.',
      fullPrompt: '',
      warnings: [],
    };
  }

  /**
   * Reset tool session state
   */
  private resetState(): void {
    this.sessionState.waitingForTool = false;
    this.sessionState.pendingTool = null;
    this.sessionState.pendingToolInput = '';
    this.sessionState.waitingForToolParameter = false;
    this.sessionState.pendingToolParamName = null;
  }

  /**
   * Get current session state (for saving/loading)
   */
  getSessionState(): ToolSessionState {
    return { ...this.sessionState };
  }

  /**
   * Restore session state (for resuming conversations)
   */
  restoreSessionState(state: ToolSessionState): void {
    this.sessionState = { ...state };
  }
}
