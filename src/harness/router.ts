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

export interface RateLimitStatus {
  cli: CLITool;
  callsThisHour: number;
  lastCallTime: number;
  isLimited: boolean;
  resetTime?: number;
}

export class ModelRouter {
  private availableCLIs: Set<CLITool> = new Set();
  private initPromise: Promise<void> | null = null;

  // Rate limit tracking
  private callCounts: Map<CLITool, { count: number; windowStart: number }> = new Map();
  private rateLimitedUntil: Map<CLITool, number> = new Map();

  // Estimated limits per hour (conservative, actual may vary by subscription)
  private static readonly RATE_LIMITS: Partial<Record<CLITool, number>> = {
    'claude-code': 45,  // Claude Max has higher limits but varies
    'codex': 50,        // ChatGPT Pro varies
    'gemini': 60,       // Google typically generous
  };

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
   * Track a call for rate limit purposes
   */
  private trackCall(cli: CLITool): void {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    const current = this.callCounts.get(cli);

    if (!current || now - current.windowStart > hourMs) {
      // Start new window
      this.callCounts.set(cli, { count: 1, windowStart: now });
    } else {
      // Increment in current window
      this.callCounts.set(cli, { count: current.count + 1, windowStart: current.windowStart });
    }
  }

  /**
   * Check if we're approaching rate limits
   * Returns true if we should warn/pause
   */
  private isApproachingLimit(cli: CLITool): boolean {
    const limit = ModelRouter.RATE_LIMITS[cli];
    if (!limit) return false;

    const current = this.callCounts.get(cli);
    if (!current) return false;

    // Warn when at 80% of limit
    return current.count >= limit * 0.8;
  }

  /**
   * Check if we're rate limited
   */
  private isRateLimited(cli: CLITool): boolean {
    const limitedUntil = this.rateLimitedUntil.get(cli);
    if (!limitedUntil) return false;
    return Date.now() < limitedUntil;
  }

  /**
   * Mark a CLI as rate limited
   */
  private markRateLimited(cli: CLITool, retryAfterSeconds: number = 60): void {
    this.rateLimitedUntil.set(cli, Date.now() + retryAfterSeconds * 1000);
  }

  /**
   * Get rate limit status for all CLIs
   */
  getRateLimitStatus(): RateLimitStatus[] {
    const status: RateLimitStatus[] = [];

    for (const cli of this.availableCLIs) {
      const current = this.callCounts.get(cli);
      const limitedUntil = this.rateLimitedUntil.get(cli);

      status.push({
        cli,
        callsThisHour: current?.count || 0,
        lastCallTime: current?.windowStart || 0,
        isLimited: this.isRateLimited(cli),
        resetTime: limitedUntil,
      });
    }

    return status;
  }

  /**
   * Detect rate limit errors in CLI output
   */
  private detectRateLimitError(output: string): { isRateLimited: boolean; retryAfter?: number } {
    const patterns = [
      /rate.?limit/i,
      /too.?many.?requests/i,
      /429/,
      /quota.?exceeded/i,
      /limit.?reached/i,
      /try.?again.?in.?(\d+)/i,
      /retry.?after.?(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        // Try to extract retry time
        const retryMatch = output.match(/(\d+)\s*(second|minute|hour)/i);
        let retryAfter = 60; // Default 1 minute
        if (retryMatch) {
          const value = parseInt(retryMatch[1], 10);
          const unit = retryMatch[2].toLowerCase();
          if (unit.startsWith('minute')) retryAfter = value * 60;
          else if (unit.startsWith('hour')) retryAfter = value * 3600;
          else retryAfter = value;
        }
        return { isRateLimited: true, retryAfter };
      }
    }

    return { isRateLimited: false };
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
   * Send request to a CLI tool with rate limit handling
   */
  private async sendToCLI(
    config: ModelConfig,
    options: CompletionOptions
  ): Promise<CompletionResult> {
    const cli = config.cli;

    // Check if currently rate limited
    if (this.isRateLimited(cli)) {
      const resetTime = this.rateLimitedUntil.get(cli);
      const waitSec = resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : 60;
      throw new Error(
        `${cli} is rate limited. Try again in ${waitSec} seconds. ` +
        `Run 'skunkcontinue' later to resume.`
      );
    }

    // Warn if approaching limit
    if (this.isApproachingLimit(cli)) {
      const current = this.callCounts.get(cli);
      const limit = ModelRouter.RATE_LIMITS[cli] || 50;
      console.log(`⚠️  Approaching rate limit for ${cli} (${current?.count}/${limit} calls this hour)`);
    }

    // Track this call
    this.trackCall(cli);

    // Execute the call
    switch (cli) {
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
   * Detects rate limit errors and marks the CLI as limited
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
          // Check for rate limit errors
          const combined = stdout + stderr;
          const rateLimit = this.detectRateLimitError(combined);

          if (rateLimit.isRateLimited) {
            // Mark this CLI as rate limited
            const cli = command === 'codex' ? 'codex' :
                       command === 'claude' ? 'claude-code' :
                       command === 'gemini' ? 'gemini' : null;

            if (cli) {
              this.markRateLimited(cli as CLITool, rateLimit.retryAfter || 60);
            }

            reject(new Error(
              `Rate limited by ${command}. ` +
              `Try again in ${rateLimit.retryAfter || 60} seconds. ` +
              `Run 'skunkcontinue' to resume after the limit resets.`
            ));
          } else {
            reject(new Error(`${command} exited with code ${code}: ${stderr}`));
          }
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
   * Check auth status for all available CLI tools
   * Returns issues detected (empty array = all healthy)
   *
   * CLI tools can require re-auth mid-session which breaks the pipeline.
   * This method proactively checks before starting work.
   */
  async checkAuthStatus(): Promise<{ cli: CLITool; status: 'ok' | 'needs_auth' | 'error'; message?: string }[]> {
    await this.ensureInitialized();
    const results: { cli: CLITool; status: 'ok' | 'needs_auth' | 'error'; message?: string }[] = [];

    for (const cli of this.availableCLIs) {
      try {
        const status = await this.checkSingleCLIAuth(cli);
        results.push(status);
      } catch (error: any) {
        results.push({
          cli,
          status: 'error',
          message: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Check auth status for a single CLI
   */
  private async checkSingleCLIAuth(cli: CLITool): Promise<{ cli: CLITool; status: 'ok' | 'needs_auth' | 'error'; message?: string }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let command: string;
      let args: string[];

      // Different health check commands for each CLI
      switch (cli) {
        case 'claude-code':
          // Claude Code: use /doctor command for health check
          command = 'claude';
          args = ['/doctor'];
          break;
        case 'codex':
          // Codex: simple version check to see if it runs
          command = 'codex';
          args = ['--version'];
          break;
        case 'gemini':
          // Gemini: version check
          command = 'gemini';
          args = ['--version'];
          break;
        default:
          resolve({ cli, status: 'error', message: `Unknown CLI: ${cli}` });
          return;
      }

      const child = spawn(command, args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000, // 10 second timeout
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        const combined = stdout + stderr;

        // Check for common re-auth indicators
        const authPatterns = [
          /login|authenticate|sign in|authorization|expired|re-auth/i,
          /token.*invalid|token.*expired/i,
          /session.*expired/i,
          /please.*login/i,
          /unauthorized/i,
        ];

        for (const pattern of authPatterns) {
          if (pattern.test(combined)) {
            resolve({
              cli,
              status: 'needs_auth',
              message: `${cli} may need re-authentication. Check output: ${combined.slice(0, 200)}`,
            });
            return;
          }
        }

        if (code === 0) {
          resolve({ cli, status: 'ok' });
        } else {
          // Non-zero exit but no auth pattern - could be other issue
          resolve({
            cli,
            status: 'error',
            message: `${cli} health check failed (exit ${code}): ${combined.slice(0, 200)}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          cli,
          status: 'error',
          message: `Failed to check ${cli}: ${err.message}`,
        });
      });

      // Send empty input for commands that expect it
      child.stdin?.end();
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
