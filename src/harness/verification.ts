/**
 * Test Verification Module
 *
 * Runs tests and captures results for the Reviewer phase.
 * Provides context about test outcomes so the reviewer can see
 * both code AND whether it passes tests.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { runCommand, CommandResult } from '../tools/terminal.js';

export interface TestResult {
  ran: boolean;
  passed: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  testCount?: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  duration?: number;
  error?: string;
}

/**
 * Detect if the project has a test script configured
 */
export async function hasTestScript(projectPath: string): Promise<boolean> {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    // Check that test script exists and isn't the default "no test specified"
    const testScript = packageJson.scripts?.test;
    return !!(testScript && !testScript.includes('no test specified'));
  } catch {
    return false;
  }
}

/**
 * Get the test command for the project
 */
export function getTestCommand(projectPath: string): string | null {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const testScript = packageJson.scripts?.test;

    if (testScript && !testScript.includes('no test specified')) {
      return 'npm test';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Run tests and capture results
 */
export async function runTests(projectPath: string): Promise<TestResult> {
  const testCommand = getTestCommand(projectPath);

  if (!testCommand) {
    return {
      ran: false,
      passed: false,
      command: '',
      stdout: '',
      stderr: '',
      exitCode: null,
      error: 'No test script found in package.json',
    };
  }

  console.log(chalk.gray(`  Running: ${testCommand}`));

  const startTime = Date.now();
  const result = await runCommand(testCommand, {
    cwd: projectPath,
    timeout: 300000, // 5 minute timeout for tests
  });
  const duration = Date.now() - startTime;

  // Try to parse test count from output (works with Jest, Mocha, Vitest, etc.)
  const testCount = parseTestCount(result.stdout + result.stderr);

  return {
    ran: true,
    passed: result.success,
    command: testCommand,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    testCount,
    duration,
  };
}

/**
 * Parse test count from common test runner output
 */
function parseTestCount(output: string): TestResult['testCount'] | undefined {
  // Jest format: "Tests: 5 passed, 2 failed, 7 total"
  const jestMatch = output.match(
    /Tests:\s*(\d+)\s*passed,?\s*(\d+)?\s*failed?,?\s*(\d+)?\s*skipped?,?\s*(\d+)\s*total/i
  );
  if (jestMatch) {
    return {
      passed: parseInt(jestMatch[1]) || 0,
      failed: parseInt(jestMatch[2]) || 0,
      skipped: parseInt(jestMatch[3]) || 0,
      total: parseInt(jestMatch[4]) || 0,
    };
  }

  // Vitest format: "Tests  5 passed (5)"
  const vitestMatch = output.match(/Tests\s+(\d+)\s+passed.*\((\d+)\)/i);
  if (vitestMatch) {
    return {
      passed: parseInt(vitestMatch[1]) || 0,
      failed: 0,
      skipped: 0,
      total: parseInt(vitestMatch[2]) || parseInt(vitestMatch[1]) || 0,
    };
  }

  // Mocha format: "5 passing (2s)" and "2 failing"
  const mochaPassMatch = output.match(/(\d+)\s*passing/i);
  const mochaFailMatch = output.match(/(\d+)\s*failing/i);
  const mochaSkipMatch = output.match(/(\d+)\s*pending/i);
  if (mochaPassMatch) {
    const passed = parseInt(mochaPassMatch[1]) || 0;
    const failed = mochaFailMatch ? parseInt(mochaFailMatch[1]) : 0;
    const skipped = mochaSkipMatch ? parseInt(mochaSkipMatch[1]) : 0;
    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
    };
  }

  return undefined;
}

/**
 * Format test results for inclusion in Reviewer context
 */
export function formatTestResultsForContext(result: TestResult): string {
  if (!result.ran) {
    return `## Test Results

**Status:** No tests configured

${result.error || 'No test script found in package.json. Consider adding tests.'}
`;
  }

  let context = `## Test Results

**Status:** ${result.passed ? '✅ PASSING' : '❌ FAILING'}
**Command:** \`${result.command}\`
**Exit Code:** ${result.exitCode}
`;

  if (result.testCount) {
    context += `**Test Count:** ${result.testCount.passed} passed, ${result.testCount.failed} failed`;
    if (result.testCount.skipped > 0) {
      context += `, ${result.testCount.skipped} skipped`;
    }
    context += ` (${result.testCount.total} total)\n`;
  }

  if (result.duration) {
    context += `**Duration:** ${(result.duration / 1000).toFixed(2)}s\n`;
  }

  // Truncate very long output
  const maxOutputLength = 5000;
  let stdout = result.stdout || '(no output)';
  let stderr = result.stderr || '';

  if (stdout.length > maxOutputLength) {
    stdout = stdout.substring(0, maxOutputLength) + '\n... (output truncated)';
  }
  if (stderr.length > maxOutputLength) {
    stderr = stderr.substring(0, maxOutputLength) + '\n... (output truncated)';
  }

  context += `
### Output
\`\`\`
${stdout}
\`\`\`
`;

  if (stderr && stderr !== result.stdout) {
    context += `
### Errors
\`\`\`
${stderr}
\`\`\`
`;
  }

  return context;
}
