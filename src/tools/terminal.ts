/**
 * Terminal Tools
 *
 * Provides command execution capabilities for agents.
 * Includes safety measures to prevent dangerous operations.
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';

export interface CommandResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
}

// Commands that are blocked for safety
const BLOCKED_COMMANDS = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf /*',
  ':(){:|:&};:',  // Fork bomb
  'mkfs',
  'dd if=/dev/zero',
  'chmod -R 777 /',
  'chown -R',
  '> /dev/sda',
  'wget | sh',
  'curl | sh',
  'wget | bash',
  'curl | bash',
];

// Commands that require confirmation
const DANGEROUS_PATTERNS = [
  /rm\s+-rf?\s+/,
  /sudo\s+/,
  /chmod\s+/,
  /chown\s+/,
  />\s*\/\w+/,  // Overwriting system files
];

/**
 * Check if a command is safe to run
 */
function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  // Check blocked commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (command.includes(blocked)) {
      return {
        safe: false,
        reason: `Blocked command pattern detected: ${blocked}`,
      };
    }
  }

  // Check dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: false,
        reason: `Potentially dangerous command pattern: ${pattern}`,
      };
    }
  }

  return { safe: true };
}

/**
 * Run a shell command
 */
export async function runCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    allowDangerous?: boolean;
  } = {}
): Promise<CommandResult> {
  const { cwd = process.cwd(), timeout = 60000, allowDangerous = false } = options;

  // Safety check
  if (!allowDangerous) {
    const safetyCheck = isCommandSafe(command);
    if (!safetyCheck.safe) {
      return {
        success: false,
        command,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: safetyCheck.reason,
      };
    }
  }

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: path.resolve(cwd),
      shell: true,
      timeout,
    };

    const child = spawn(command, [], spawnOptions);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: null,
        error: error.message,
      });
    });
  });
}

/**
 * Run npm commands
 */
export async function runNpm(
  args: string[],
  cwd?: string
): Promise<CommandResult> {
  const command = `npm ${args.join(' ')}`;
  return runCommand(command, { cwd, timeout: 300000 }); // 5 min timeout for npm
}

/**
 * Run git commands
 */
export async function runGit(
  args: string[],
  cwd?: string
): Promise<CommandResult> {
  const command = `git ${args.join(' ')}`;
  return runCommand(command, { cwd });
}

/**
 * Get current directory contents (like ls)
 */
export async function listDirectory(dirPath?: string): Promise<CommandResult> {
  const command = process.platform === 'win32' ? 'dir' : 'ls -la';
  return runCommand(command, { cwd: dirPath });
}

/**
 * Check if a command exists
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const checkCommand = process.platform === 'win32'
    ? `where ${cmd}`
    : `which ${cmd}`;

  const result = await runCommand(checkCommand);
  return result.success;
}

/**
 * Run a command and stream output
 */
export function runCommandStreaming(
  command: string,
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
  options: {
    cwd?: string;
    timeout?: number;
  } = {}
): Promise<CommandResult> {
  const { cwd = process.cwd(), timeout = 60000 } = options;

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: path.resolve(cwd),
      shell: true,
      timeout,
    };

    const child = spawn(command, [], spawnOptions);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      onStdout(str);
    });

    child.stderr?.on('data', (data) => {
      const str = data.toString();
      stderr += str;
      onStderr(str);
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: null,
        error: error.message,
      });
    });
  });
}
