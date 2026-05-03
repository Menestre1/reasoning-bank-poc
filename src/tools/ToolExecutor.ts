/**
 * ToolExecutor - safe external process execution
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ToolExecutorOptions {
  allowedRoots: string[];
  defaultTimeoutSec: number;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  file_path?: string;
  exitCode?: number;
}

export class ToolExecutor {
  private allowedRoots: string[];
  private defaultTimeoutSec: number;

  constructor(options: ToolExecutorOptions) {
    this.allowedRoots = options.allowedRoots.map(p => path.resolve(p));
    this.defaultTimeoutSec = options.defaultTimeoutSec || 30;
  }

  private isPathAllowed(targetPath: string): boolean {
    const resolved = path.resolve(targetPath);
    return this.allowedRoots.some(root => {
      const normalizedRoot = path.normalize(root);
      const normalizedTarget = path.normalize(resolved);
      return normalizedTarget.startsWith(normalizedRoot);
    });
  }

  async execute(
    toolType: string,
    toolPath: string,
    args: string[],
    options: {
      timeoutSec?: number;
      outputHandling?: 'file' | 'stdout';
      expectedOutputPath?: string;
    } = {}
  ): Promise<ExecutionResult> {
    const timeoutSec = options.timeoutSec || this.defaultTimeoutSec;
    const outputHandling = options.outputHandling || 'stdout';

    if (!this.isPathAllowed(toolPath)) {
      return {
        success: false,
        output: '',
        error: `Path not allowed: ${toolPath}`,
      };
    }

    let command: string;
    let spawnArgs: string[];

    switch (toolType) {
      case 'python':
        command = 'python';
        spawnArgs = [toolPath, ...args];
        break;
      case 'node':
        command = 'node';
        spawnArgs = [toolPath, ...args];
        break;
      case 'shell':
        command = 'bash';
        spawnArgs = ['-c', `${toolPath} ${args.join(' ')}`];
        break;
      case '1c':
        return {
          success: false,
          output: '',
          error: '1C type not supported yet',
        };
      default:
        return {
          success: false,
          output: '',
          error: `Unknown tool type: ${toolType}`,
        };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let isTimedOut = false;

      const child: ChildProcess = spawn(command, spawnArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGKILL');
      }, timeoutSec * 1000);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (isTimedOut) {
          resolve({
            success: false,
            output: stdout,
            error: `Timeout exceeded (${timeoutSec}s)`,
            exitCode: -1,
          });
          return;
        }

        const success = code === 0;

        if (success && outputHandling === 'file' && options.expectedOutputPath) {
          const filePath = path.resolve(options.expectedOutputPath);
          if (fs.existsSync(filePath)) {
            resolve({
              success: true,
              output: stdout || `File created: ${filePath}`,
              file_path: filePath,
              exitCode: code || 0,
            });
          } else {
            resolve({
              success: false,
              output: stdout,
              error: `Expected file not created: ${filePath}`,
              exitCode: code || 0,
            });
          }
          return;
        }

        const result: any = {
          success,
          output: stdout,
          exitCode: code || 0,
        };
        if (!success) {
          result.error = stderr || 'Unknown error';
        }
        resolve(result);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          output: '',
          error: `Execution error: ${err.message}`,
        } as any);
      });
    });
  }
}
