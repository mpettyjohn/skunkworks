/**
 * Design Verification Module
 *
 * Uses /rams to check accessibility (WCAG 2.1) and visual design consistency.
 * Catches issues like missing alt text, unlabeled buttons, contrast problems,
 * and inconsistent spacing/typography.
 *
 * https://www.rams.ai/
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { runCommand, CommandResult } from '../tools/terminal.js';

export interface DesignIssue {
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  category: 'accessibility' | 'visual';
  message: string;
  file?: string;
  line?: number;
  suggestion?: string;
  wcagRef?: string;
}

export interface DesignVerificationResult {
  ran: boolean;
  score: number | null;
  issues: DesignIssue[];
  filesReviewed: string[];
  stdout: string;
  stderr: string;
  error?: string;
}

/**
 * Check if /rams CLI is installed
 */
export async function isRamsInstalled(): Promise<boolean> {
  const result = await runCommand('which rams || where rams', { timeout: 5000 });
  return result.success;
}

/**
 * Find frontend files to review
 * Looks for common UI component file types
 */
export function findFrontendFiles(projectPath: string): string[] {
  const extensions = ['.tsx', '.jsx', '.vue', '.svelte', '.html'];
  const ignoreDirs = ['node_modules', 'dist', 'build', '.next', '.nuxt', 'coverage'];
  const files: string[] = [];

  function walkDir(dir: string) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
          walkDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  // Start from src directory if it exists, otherwise project root
  const srcDir = path.join(projectPath, 'src');
  if (fs.existsSync(srcDir)) {
    walkDir(srcDir);
  } else {
    walkDir(projectPath);
  }

  return files;
}

/**
 * Run /rams on a single file
 */
async function runRamsOnFile(filePath: string): Promise<CommandResult> {
  return runCommand(`rams "${filePath}"`, {
    timeout: 60000, // 1 minute per file
  });
}

/**
 * Parse /rams output to extract score and issues
 */
function parseRamsOutput(output: string): { score: number | null; issues: DesignIssue[] } {
  const issues: DesignIssue[] = [];
  let score: number | null = null;

  // Try to extract score (format: "Score: 85/100" or similar)
  const scoreMatch = output.match(/(?:score|rating)[:\s]*(\d+)(?:\s*\/\s*100)?/i);
  if (scoreMatch) {
    score = parseInt(scoreMatch[1]);
  }

  // Parse issues - /rams outputs structured information
  // Look for patterns like severity indicators and WCAG references
  const lines = output.split('\n');

  let currentIssue: Partial<DesignIssue> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect severity
    if (trimmed.match(/^(critical|serious|moderate|minor)/i)) {
      if (currentIssue && currentIssue.message) {
        issues.push(currentIssue as DesignIssue);
      }
      const severityMatch = trimmed.match(/^(critical|serious|moderate|minor)/i);
      currentIssue = {
        severity: severityMatch![1].toLowerCase() as DesignIssue['severity'],
        category: trimmed.toLowerCase().includes('wcag') ? 'accessibility' : 'visual',
        message: trimmed,
      };
    }

    // Detect file:line references
    const fileLineMatch = trimmed.match(/([^\s]+\.(tsx|jsx|vue|svelte|html)):(\d+)/i);
    if (fileLineMatch && currentIssue) {
      currentIssue.file = fileLineMatch[1];
      currentIssue.line = parseInt(fileLineMatch[3]);
    }

    // Detect WCAG references
    const wcagMatch = trimmed.match(/WCAG\s*[\d.]+[A-Z]*/i);
    if (wcagMatch && currentIssue) {
      currentIssue.wcagRef = wcagMatch[0];
      currentIssue.category = 'accessibility';
    }

    // Detect suggestions (lines starting with "Fix:" or "Suggestion:" or "→")
    if ((trimmed.startsWith('Fix:') || trimmed.startsWith('Suggestion:') || trimmed.startsWith('→')) && currentIssue) {
      currentIssue.suggestion = trimmed.replace(/^(Fix:|Suggestion:|→)\s*/i, '');
    }
  }

  // Don't forget the last issue
  if (currentIssue && currentIssue.message) {
    issues.push(currentIssue as DesignIssue);
  }

  return { score, issues };
}

/**
 * Run design verification on the project
 */
export async function runDesignVerification(projectPath: string): Promise<DesignVerificationResult> {
  // Check if /rams is installed
  const installed = await isRamsInstalled();
  if (!installed) {
    return {
      ran: false,
      score: null,
      issues: [],
      filesReviewed: [],
      stdout: '',
      stderr: '',
      error: '/rams CLI not installed. Install with: curl -fsSL https://rams.ai/install | bash',
    };
  }

  // Find frontend files
  const files = findFrontendFiles(projectPath);

  if (files.length === 0) {
    return {
      ran: false,
      score: null,
      issues: [],
      filesReviewed: [],
      stdout: '',
      stderr: '',
      error: 'No frontend files found to review (looked for .tsx, .jsx, .vue, .svelte, .html)',
    };
  }

  console.log(chalk.gray(`  Found ${files.length} frontend file(s) to review`));

  // Limit to first 10 files to avoid very long review times
  const filesToReview = files.slice(0, 10);
  if (files.length > 10) {
    console.log(chalk.gray(`  Reviewing first 10 files (${files.length - 10} skipped)`));
  }

  let allStdout = '';
  let allStderr = '';
  const allIssues: DesignIssue[] = [];
  const scores: number[] = [];

  for (const file of filesToReview) {
    const relativePath = path.relative(projectPath, file);
    console.log(chalk.gray(`  Reviewing: ${relativePath}`));

    const result = await runRamsOnFile(file);

    allStdout += `\n=== ${relativePath} ===\n${result.stdout}\n`;
    if (result.stderr) {
      allStderr += `\n=== ${relativePath} ===\n${result.stderr}\n`;
    }

    const parsed = parseRamsOutput(result.stdout);

    if (parsed.score !== null) {
      scores.push(parsed.score);
    }

    // Add file context to issues
    for (const issue of parsed.issues) {
      if (!issue.file) {
        issue.file = relativePath;
      }
      allIssues.push(issue);
    }
  }

  // Calculate average score
  const avgScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;

  return {
    ran: true,
    score: avgScore,
    issues: allIssues,
    filesReviewed: filesToReview.map(f => path.relative(projectPath, f)),
    stdout: allStdout,
    stderr: allStderr,
  };
}

/**
 * Format design verification results for Reviewer context
 */
export function formatDesignResultsForContext(result: DesignVerificationResult): string {
  if (!result.ran) {
    return `## Design & Accessibility Review

**Status:** Skipped
**Reason:** ${result.error}

Design and accessibility verification could not be completed.
`;
  }

  let context = `## Design & Accessibility Review (/rams)

**Status:** Complete
**Files Reviewed:** ${result.filesReviewed.length}
`;

  if (result.score !== null) {
    const scoreEmoji = result.score >= 90 ? '🟢' : result.score >= 70 ? '🟡' : '🔴';
    context += `**Design Score:** ${scoreEmoji} ${result.score}/100\n`;
  }

  // Group issues by severity
  const critical = result.issues.filter(i => i.severity === 'critical');
  const serious = result.issues.filter(i => i.severity === 'serious');
  const moderate = result.issues.filter(i => i.severity === 'moderate');
  const minor = result.issues.filter(i => i.severity === 'minor');

  context += `
**Issues Found:**
- Critical: ${critical.length}
- Serious: ${serious.length}
- Moderate: ${moderate.length}
- Minor: ${minor.length}

`;

  // List critical and serious issues in detail
  if (critical.length > 0) {
    context += `### Critical Issues (Must Fix)\n`;
    for (const issue of critical) {
      context += `- ${issue.message}`;
      if (issue.file && issue.line) {
        context += ` (${issue.file}:${issue.line})`;
      }
      if (issue.wcagRef) {
        context += ` [${issue.wcagRef}]`;
      }
      context += '\n';
      if (issue.suggestion) {
        context += `  → Fix: ${issue.suggestion}\n`;
      }
    }
    context += '\n';
  }

  if (serious.length > 0) {
    context += `### Serious Issues (Should Fix)\n`;
    for (const issue of serious) {
      context += `- ${issue.message}`;
      if (issue.file && issue.line) {
        context += ` (${issue.file}:${issue.line})`;
      }
      if (issue.wcagRef) {
        context += ` [${issue.wcagRef}]`;
      }
      context += '\n';
      if (issue.suggestion) {
        context += `  → Fix: ${issue.suggestion}\n`;
      }
    }
    context += '\n';
  }

  // Summarize moderate/minor
  if (moderate.length > 0 || minor.length > 0) {
    context += `### Other Issues\n`;
    context += `${moderate.length + minor.length} additional issues found. `;
    context += `Review the full /rams output for details.\n\n`;
  }

  // Files reviewed
  context += `### Files Reviewed\n`;
  for (const file of result.filesReviewed) {
    context += `- ${file}\n`;
  }

  return context;
}
