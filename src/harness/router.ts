/**
 * Model Router (CLI-Based)
 *
 * Routes tasks to AI models via their CLI tools, using SUBSCRIPTIONS not API keys:
 * - OpenAI Codex CLI (`codex exec`) - ChatGPT Pro subscription
 * - Claude Code (`claude -p`) - Claude Max subscription
 * - Gemini CLI (`gemini --yolo`) - Google account
 *
 * Updated January 2026 with correct non-interactive flags.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentPhase,
  CLITool,
  ModelConfig,
  getModelConfig,
  getCLIInfo,
  CLI_INFO,
} from '../config/models.js';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CompletionOptions {
  messages: Message[];
  systemPrompt?: string;
  workingDir?: string;
}

export interface CompletionResult {
  content: string;
  model: string;
  cli: CLITool;
}

export class ModelRouter {
  private availableCLIs: Set<CLITool> = new Set();
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Start detection immediately, store promise for later await
    this.initPromise = this.detectAvailableCLIs();
  }

  /**
   * Ensure CLI detection has completed before proceeding
   */
  async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Detect which CLI tools are installed
   */
  private async detectAvailableCLIs(): Promise<void> {
    const checks = Object.entries(CLI_INFO).map(async ([cli, info]) => {
      const available = await this.checkCLIAvailable(info.command);
      if (available) {
        this.availableCLIs.add(cli as CLITool);
      }
    });
    await Promise.all(checks);
  }

  /**
   * Check if a CLI command is available
   */
  private checkCLIAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const which = process.platform === 'win32' ? 'where' : 'which';
      const child = spawn(which, [command]);
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    });
  }

  /**
   * Get list of available CLI tools
   */
  getAvailableProviders(): CLITool[] {
    return Array.from(this.availableCLIs);
  }

  /**
   * Check if a specific CLI is available
   */
  async isCLIAvailable(cli: CLITool): Promise<boolean> {
    if (this.availableCLIs.has(cli)) return true;
    // Re-check in case it was installed after initialization
    const info = getCLIInfo(cli);
    const available = await this.checkCLIAvailable(info.command);
    if (available) this.availableCLIs.add(cli);
    return available;
  }

  /**
   * Route a completion request to the appropriate CLI based on phase
   */
  async complete(
    phase: AgentPhase,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    const config = getModelConfig(phase);

    // Check if primary CLI is available, fall back if not
    let activeConfig = config;
    if (!(await this.isCLIAvailable(config.cli))) {
      const fallbackConfig = getModelConfig(phase, true);
      if (!(await this.isCLIAvailable(fallbackConfig.cli))) {
        throw new Error(
          `No available CLI for ${phase} phase. ` +
            `Install one of: ${getCLIInfo(config.cli).installCmd} or ${getCLIInfo(fallbackConfig.cli).installCmd}`
        );
      }
      activeConfig = fallbackConfig;
      console.log(`Using fallback for ${phase}: ${fallbackConfig.cli}`);
    }

    return this.sendToCLI(activeConfig, options);
  }

  /**
   * Send request to a CLI tool
   */
  private async sendToCLI(
    config: ModelConfig,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    switch (config.cli) {
      case 'codex':
        return this.sendToCodex(config, options);
      case 'claude-code':
        return this.sendToClaudeCode(config, options);
      case 'gemini':
        return this.sendToGemini(config, options);
      default:
        throw new Error(`Unknown CLI: ${config.cli}`);
    }
  }

  /**
   * Run Claude Code in interactive mode for interviewer phase
   * Uses stdio: 'inherit' to pass terminal control to Claude Code
   * so that AskUserQuestion works properly
   */
  async runInteractive(
    prompt: string,
    workingDir?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Add the initial prompt as the only argument
      const args: string[] = [prompt];

      // Spawn Claude Code in interactive mode (no -p flag)
      // stdio: 'inherit' passes terminal control to the child process
      // Working directory is set via cwd spawn option
      const child = spawn('claude', args, {
        env: { ...process.env },
        stdio: 'inherit',
        shell: false,
        cwd: workingDir || process.cwd(),
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Claude Code exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to run Claude Code: ${err.message}`));
      });
    });
  }

  /**
   * Send to OpenAI Codex CLI (non-interactive exec mode)
   * Docs: https://developers.openai.com/codex/noninteractive/
   */
  private async sendToCodex(
    config: ModelConfig,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    const prompt = this.buildPrompt(options);

    // Use 'codex exec' for non-interactive mode
    const args = [
      'exec',
      '--full-auto',                // Allow edits without approval
      '--skip-git-repo-check',      // Work outside git repos
    ];

    // Add working directory if specified
    if (options.workingDir) {
      args.push('-C', options.workingDir);
    }

    // Pipe prompt via stdin to avoid shell escaping issues
    const output = await this.runCLIWithStdin('codex', args, prompt);

    return {
      content: output,
      model: config.model,
      cli: 'codex',
    };
  }

  /**
   * Send to Claude Code CLI (headless mode)
   * Docs: https://code.claude.com/docs/en/headless
   */
  private async sendToClaudeCode(
    config: ModelConfig,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    const prompt = this.buildPrompt(options);

    const args = [
      '-p',                              // Print mode (non-interactive)
      '--dangerously-skip-permissions',  // Skip permission prompts
    ];

    // Add working directory if specified
    if (options.workingDir) {
      args.push('--cwd', options.workingDir);
    }

    // Pipe prompt via stdin to avoid shell escaping issues
    const output = await this.runCLIWithStdin('claude', args, prompt);

    return {
      content: output,
      model: config.model,
      cli: 'claude-code',
    };
  }

  /**
   * Send to Gemini CLI (yolo mode for auto-approval)
   * Docs: https://geminicli.com/docs/get-started/configuration/
   */
  private async sendToGemini(
    config: ModelConfig,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    const prompt = this.buildPrompt(options);

    const args = [
      '--yolo',  // Auto-approve all tool calls (no permission prompts)
    ];

    // Note: Gemini CLI doesn't currently support a --thinking flag
    // Reasoning level from config is ignored for now

    // Pipe prompt via stdin to avoid shell escaping issues
    const output = await this.runCLIWithStdin('gemini', args, prompt);

    return {
      content: output,
      model: config.model,
      cli: 'gemini',
    };
  }

  /**
   * Build a prompt string from messages
   */
  private buildPrompt(options: CompletionOptions): string {
    let prompt = '';

    if (options.systemPrompt) {
      prompt += `<system>\n${options.systemPrompt}\n</system>\n\n`;
    }

    for (const msg of options.messages) {
      if (msg.role === 'system') continue; // Already handled above
      prompt += `<${msg.role}>\n${msg.content}\n</${msg.role}>\n\n`;
    }

    return prompt.trim();
  }

  /**
   * Write prompt to temp file
   */
  private writeTempPrompt(prompt: string): string {
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `abr-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, prompt, 'utf-8');
    return tempFile;
  }

  /**
   * Run a CLI command with stdin input and capture output
   */
  private runCLIWithStdin(command: string, args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Don't use shell: true to avoid escaping issues
      const child = spawn(command, args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to run ${command}: ${err.message}`));
      });

      // Write prompt to stdin and close it
      child.stdin?.write(stdin);
      child.stdin?.end();
    });
  }

  /**
   * Run a CLI command and capture output (no stdin)
   */
  private runCLI(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const child = spawn(command, args, {
        env: { ...process.env },
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`${command} exited with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to run ${command}: ${err.message}`));
      });
    });
  }

  /**
   * Get installation instructions for missing CLIs
   */
  getInstallInstructions(): string {
    const instructions: string[] = [];

    for (const [cli, info] of Object.entries(CLI_INFO)) {
      if (!this.availableCLIs.has(cli as CLITool)) {
        instructions.push(`${cli}:\n  Install: ${info.installCmd}\n  Auth: ${info.authMethod}`);
      }
    }

    return instructions.length > 0
      ? `Missing CLI tools:\n\n${instructions.join('\n\n')}`
      : 'All CLI tools are installed!';
  }

  /**
   * Stream completion (delegates to appropriate CLI's streaming mode)
   */
  async *stream(
    phase: AgentPhase,
    options: CompletionOptions
  ): AsyncGenerator<string> {
    // For now, fall back to non-streaming and yield entire result
    // TODO: Implement true streaming using --output-format stream-json
    const result = await this.complete(phase, options);
    yield result.content;
  }
}
