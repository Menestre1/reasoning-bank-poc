/**
 * ToolOrchestrator - dialog management and parameter extraction
 */

import { ToolExecutor } from './ToolExecutor.js';
import type { ExecutionResult } from './ToolExecutor.js';
import type { Tool } from './ToolRegistry.js';

export interface OrchestratorResult {
  action: 'waiting_confirmation' | 'waiting_parameter' | 'executing' | 'completed' | 'cancelled';
  response?: string;
  missingParameter?: string;
  executionResult?: ExecutionResult;
}

export class ToolOrchestrator {
  private executor: ToolExecutor;

  constructor(executor: ToolExecutor) {
    this.executor = executor;
  }

  extractParameters(tool: Tool, userInput: string): {
    extracted: Record<string, string>;
    missing: string[];
  } {
    // Unwrap tool metadata if it has 'tool' wrapper
    const rawMetadata = tool.metadata as any;
    const metadata = rawMetadata.tool ? rawMetadata.tool : rawMetadata;
    
    const paramPatterns = metadata.param_patterns || {};
    const extracted: Record<string, string> = {};
    const missing: string[] = [];

    const template = tool.metadata.args_template || '';
    const paramMatches = template.matchAll(/\{(\w+)\}/g);
    const expectedParams = [...paramMatches].map(m => m[1]);

    for (const paramName of expectedParams) {
      if (paramName === undefined) continue;
      const paramNameStr = paramName as string;
      const pattern = paramPatterns[paramNameStr];
      if (!pattern) {
        missing.push(paramNameStr);
        continue;
      }

      try {
        const regex = new RegExp(pattern);
        const match = userInput.match(regex);
        if (match) {
          extracted[paramNameStr] = match[1] || match[0];
        } else {
          missing.push(paramNameStr);
        }
      } catch (e) {
        missing.push(paramNameStr);
      }
    }

    return { extracted, missing };
  }

  buildArgs(tool: Tool, params: Record<string, string>): string[] {
    // Unwrap tool metadata if it has 'tool' wrapper
    const rawMetadata = tool.metadata as any;
    const metadata = rawMetadata.tool ? rawMetadata.tool : rawMetadata;
    
    let argsTemplate = metadata.args_template || '';
    
    // Replace params, use defaults if missing
    const allParams = { ...params };
    if (!allParams.output) {
      allParams.output = 'extracted_code.txt'; // Default output file
    }
    
    for (const [key, value] of Object.entries(allParams)) {
      argsTemplate = argsTemplate.replace(`{${key}}`, value);
    }

    // Remove any remaining {placeholders}
    argsTemplate = argsTemplate.replace(/\{(\w+)\}/g, '');

    return argsTemplate.split(/\s+/).filter((arg: string) => arg.length > 0);
  }

  async process(
    tool: Tool,
    userInput: string,
    userResponse?: string
  ): Promise<OrchestratorResult> {
    if (userResponse !== undefined) {
      const lowerResponse = userResponse.toLowerCase();
      
      if (lowerResponse.includes('нет') || lowerResponse.includes('отмена') || lowerResponse.includes('cancel')) {
        return {
          action: 'cancelled',
          response: 'Cancelled by user.',
        };
      }

      if (lowerResponse.includes('да') || lowerResponse.includes('yes')) {
        return this.executeTool(tool, userInput);
      }

      return this.handleParameterInput(tool, userInput, userResponse);
    }

    const { extracted, missing } = this.extractParameters(tool, userInput);

    if (missing.length > 0) {
      const ret: any = {
        action: 'waiting_parameter' as const,
        missingParameter: missing[0],
        response: `Enter parameter "${missing[0]}":`,
      };
      return ret;
    }

    const args = this.buildArgs(tool, extracted);
    return {
      action: 'waiting_confirmation' as const,
      response: `Found tool: "${tool.name}".\nParameters: ${JSON.stringify(extracted)}\nRun? (yes/no)`,
    };
  }

  private async executeTool(tool: Tool, userInput: string): Promise<OrchestratorResult> {
    const { extracted } = this.extractParameters(tool, userInput);
    const args = this.buildArgs(tool, extracted);

    const execOptions: any = {};
    if (tool.metadata.timeout_sec !== undefined) {
      execOptions.timeoutSec = tool.metadata.timeout_sec;
    }
    if (tool.metadata.output_handling !== undefined) {
      execOptions.outputHandling = tool.metadata.output_handling;
    }
    const expectedPath = extracted['output'] || extracted['outputFile'];
    if (expectedPath !== undefined) {
      execOptions.expectedOutputPath = expectedPath;
    }

    const result = await this.executor.execute(
      tool.metadata.type,
      tool.metadata.path,
      args,
      execOptions
    );

    const ret: any = {
      action: 'completed' as const,
      executionResult: result,
      response: result.success
        ? `Tool executed successfully.\n${result.output}`
        : `Execution error: ${result.error}`,
    };
    return ret;
  }

  private handleParameterInput(
    tool: Tool,
    userInput: string,
    parameterValue: string
  ): OrchestratorResult {
    const { extracted, missing } = this.extractParameters(tool, userInput + ' ' + parameterValue);

    if (missing.length > 0) {
      const firstMissing = missing[0];
      const ret: any = {
        action: 'waiting_parameter' as const,
      };
      if (firstMissing !== undefined) {
        ret.missingParameter = firstMissing;
        ret.response = `Enter parameter "${firstMissing}":`;
      } else {
        ret.response = 'Missing parameter not identified.';
      }
      return ret;
    }

    return {
      action: 'waiting_confirmation' as const,
      response: `Run tool "${tool.name}" with parameters: ${JSON.stringify(extracted)}? (yes/no)`,
    };
  }
}
