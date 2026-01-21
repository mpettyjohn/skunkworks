/**
 * Chunk Verification Module
 *
 * Orchestrates verification between building phases.
 * Supports two levels:
 * - "tests": Quick verification (just npm test)
 * - "full": Complete verification (tests + visual + design)
 */

import chalk from 'chalk';
import { runTests, hasTestScript, formatTestResultsForContext, TestResult } from './verification.js';
import {
  hasDevServer,
  runVisualVerification,
  VisualVerificationResult,
} from './visual-verification.js';
import {
  runDesignVerification,
  DesignVerificationResult,
  formatDesignResultsForContext,
} from './design-verification.js';
import { estimateTokens } from './context-health.js';

export type VerificationLevel = 'tests' | 'full';

export interface ChunkVerificationResult {
  passed: boolean;
  level: VerificationLevel;
  testResult?: TestResult;
  visualResult?: VisualVerificationResult;
  designResult?: DesignVerificationResult;
  summary: string;
  errorOutput: string;
}

type ProjectType = 'web' | 'ios' | 'android' | 'desktop' | 'cli' | 'backend' | 'library';

/**
 * Run verification at the specified level
 */
export async function runChunkVerification(
  projectPath: string,
  level: VerificationLevel,
  spec?: string,
  projectTypes?: ProjectType[]
): Promise<ChunkVerificationResult> {
  console.log(chalk.blue(`\n📋 Running ${level} verification...\n`));

  let passed = true;
  let summary = '';
  let errorOutput = '';
  let testResult: TestResult | undefined;
  let visualResult: VisualVerificationResult | undefined;
  let designResult: DesignVerificationResult | undefined;

  // Always run tests if available
  if (await hasTestScript(projectPath)) {
    console.log(chalk.gray('  Running tests...'));
    testResult = await runTests(projectPath, projectTypes);

    if (!testResult.passed) {
      passed = false;
      errorOutput += `## Test Failures\n\n`;
      errorOutput += formatTestResultsForContext(testResult);
      summary += `❌ Tests failed (${testResult.testCount?.failed ?? '?'} failures)\n`;
    } else {
      summary += `✅ Tests passed (${testResult.testCount?.passed ?? '?'} passing)\n`;
    }
  } else {
    summary += `⚠️ No tests configured\n`;
  }

  // Full verification includes visual and design checks
  if (level === 'full') {
    // Visual verification
    if (hasDevServer(projectPath) && spec) {
      console.log(chalk.gray('  Running visual verification...'));
      try {
        visualResult = await runVisualVerification(projectPath, spec);

        if (!visualResult.success) {
          // Visual verification is advisory, not blocking
          summary += `⚠️ Visual verification had issues\n`;
          if (visualResult.error) {
            errorOutput += `## Visual Verification Issues\n\n${visualResult.error}\n\n`;
          }
        } else {
          const issueCount = visualResult.analyses.reduce(
            (acc, a) => acc + a.issues.length,
            0
          );
          if (issueCount > 0) {
            summary += `⚠️ Visual verification found ${issueCount} issues\n`;
            for (const analysis of visualResult.analyses) {
              if (analysis.issues.length > 0) {
                errorOutput += `## Visual Issues (${analysis.url})\n\n`;
                errorOutput += analysis.issues.map(i => `- ${i}`).join('\n') + '\n\n';
              }
            }
          } else {
            summary += `✅ Visual verification passed\n`;
          }
        }
      } catch (err) {
        summary += `⚠️ Visual verification skipped (${err instanceof Error ? err.message : 'error'})\n`;
      }
    } else {
      summary += `⚠️ Visual verification skipped (no dev server or spec)\n`;
    }

    // Design verification
    console.log(chalk.gray('  Running design verification...'));
    try {
      designResult = await runDesignVerification(projectPath);

      if (designResult.ran) {
        const criticalIssues = designResult.issues.filter(
          i => i.severity === 'critical'
        );
        const seriousIssues = designResult.issues.filter(
          i => i.severity === 'serious'
        );

        if (criticalIssues.length > 0) {
          // Critical accessibility issues are blocking
          passed = false;
          summary += `❌ Design verification: ${criticalIssues.length} critical issues\n`;
          errorOutput += formatDesignResultsForContext(designResult);
        } else if (seriousIssues.length > 0) {
          summary += `⚠️ Design verification: ${seriousIssues.length} serious issues\n`;
          errorOutput += formatDesignResultsForContext(designResult);
        } else if (designResult.score !== null) {
          summary += `✅ Design score: ${designResult.score}/100\n`;
        } else {
          summary += `✅ Design verification passed\n`;
        }
      } else {
        summary += `⚠️ Design verification skipped (${designResult.error || '/rams not available'})\n`;
      }
    } catch (err) {
      summary += `⚠️ Design verification skipped (${err instanceof Error ? err.message : 'error'})\n`;
    }
  }

  // Print summary
  console.log(chalk.blue('\n📋 Verification Summary:'));
  console.log(summary);

  if (passed) {
    console.log(chalk.green('✅ Phase verification passed\n'));
  } else {
    console.log(chalk.red('❌ Phase verification failed\n'));
  }

  return {
    passed,
    level,
    testResult,
    visualResult,
    designResult,
    summary,
    errorOutput,
  };
}

/**
 * Format verification failure for auto-fix attempt
 * Note: For large contexts, use compressFixContext from context-compression.ts instead
 */
export function formatVerificationForFix(
  result: ChunkVerificationResult,
  attemptNumber: number,
  previousAttempts: string[]
): string {
  let output = `# Verification Failed - Fix Required

**Attempt ${attemptNumber} of 2**

## Summary
${result.summary}

`;

  if (result.errorOutput) {
    // Truncate very long error output to prevent context bloat
    const maxErrorLength = 3000;
    const truncatedError = result.errorOutput.length > maxErrorLength
      ? result.errorOutput.slice(0, maxErrorLength) + '\n\n... (error output truncated)'
      : result.errorOutput;

    output += `## Error Details
${truncatedError}
`;
  }

  if (previousAttempts.length > 0) {
    // Compress previous attempts more aggressively
    const maxAttemptLength = 500;
    output += `## Previous Fix Attempts (summarized)

${previousAttempts.map((attempt, i) => {
  const truncated = attempt.slice(0, maxAttemptLength);
  return `### Attempt ${i + 1}\n${truncated}${attempt.length > maxAttemptLength ? '...' : ''}`;
}).join('\n\n')}

`;
  }

  output += `## Instructions

1. Review the errors above carefully
2. Fix ONLY what is broken - do not refactor unrelated code
3. Make the minimal change needed to pass verification
4. Do not add new features or improvements
5. Focus on the specific test/design failures listed
`;

  // Add token estimate as a comment for debugging
  const tokens = estimateTokens(output);
  output += `\n<!-- Fix context: ~${tokens} tokens -->`;

  return output;
}

/**
 * Quick check if verification is likely to pass (before full run)
 * Used to skip expensive verification if there are obvious problems
 */
export async function quickVerificationCheck(
  projectPath: string
): Promise<{ likely: boolean; reason?: string }> {
  // Check if TypeScript compilation would fail
  const tsConfigPath = `${projectPath}/tsconfig.json`;
  const hasTypeScript = await import('fs').then(fs =>
    fs.existsSync(tsConfigPath)
  );

  if (hasTypeScript) {
    const { runCommand } = await import('../tools/terminal.js');
    const tscResult = await runCommand('npx tsc --noEmit', {
      cwd: projectPath,
      timeout: 60000,
    });

    if (!tscResult.success) {
      return {
        likely: false,
        reason: `TypeScript compilation errors:\n${tscResult.stderr || tscResult.stdout}`,
      };
    }
  }

  return { likely: true };
}
