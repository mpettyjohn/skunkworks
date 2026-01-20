/**
 * Context Health Module
 *
 * Monitors context size and reports health status.
 * Helps prevent AI quality degradation from bloated contexts.
 */

import chalk from 'chalk';

export interface ContextHealthReport {
  totalTokens: number;
  budgetTokens: number;
  percentageUsed: number;
  status: 'healthy' | 'warning' | 'critical';
  breakdown: ContextBreakdown;
  recommendations: string[];
}

export interface ContextBreakdown {
  spec: number;
  architecture: number;
  designSpec: number;
  completedPhases: number;
  currentPhase: number;
  fileMap: number;
  other: number;
}

// Token estimation: roughly 4 characters per token for English text
const CHARS_PER_TOKEN = 4;

// Context budget - Claude's context window minus reserved space for response
const DEFAULT_BUDGET_TOKENS = 8000; // Conservative budget for good quality output

/**
 * Estimate token count from text
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Analyze context health
 */
export function analyzeContextHealth(
  context: string,
  breakdown?: Partial<ContextBreakdown>,
  budgetTokens: number = DEFAULT_BUDGET_TOKENS
): ContextHealthReport {
  const totalTokens = estimateTokens(context);
  const percentageUsed = Math.round((totalTokens / budgetTokens) * 100);

  // Determine status
  let status: 'healthy' | 'warning' | 'critical';
  if (percentageUsed <= 80) {
    status = 'healthy';
  } else if (percentageUsed <= 120) {
    status = 'warning';
  } else {
    status = 'critical';
  }

  // Build recommendations
  const recommendations: string[] = [];

  if (status === 'warning') {
    recommendations.push('Context is growing large - compression will be applied');
  }

  if (status === 'critical') {
    recommendations.push('Context exceeds budget - aggressive compression needed');
    recommendations.push('Older phases will be summarized to single lines');
  }

  // Analyze breakdown if we have section markers
  const computedBreakdown = breakdown || analyzeBreakdown(context);

  if ((computedBreakdown.completedPhases ?? 0) > budgetTokens * 0.3) {
    recommendations.push('Completed phases history is large - using compression');
  }

  if ((computedBreakdown.architecture ?? 0) > budgetTokens * 0.25) {
    recommendations.push('Architecture section is large - extracting relevant parts only');
  }

  return {
    totalTokens,
    budgetTokens,
    percentageUsed,
    status,
    breakdown: {
      spec: computedBreakdown.spec || 0,
      architecture: computedBreakdown.architecture || 0,
      designSpec: computedBreakdown.designSpec || 0,
      completedPhases: computedBreakdown.completedPhases || 0,
      currentPhase: computedBreakdown.currentPhase || 0,
      fileMap: computedBreakdown.fileMap || 0,
      other: computedBreakdown.other || 0,
    },
    recommendations,
  };
}

/**
 * Analyze context breakdown by section
 */
function analyzeBreakdown(context: string): ContextBreakdown {
  const breakdown: ContextBreakdown = {
    spec: 0,
    architecture: 0,
    designSpec: 0,
    completedPhases: 0,
    currentPhase: 0,
    fileMap: 0,
    other: 0,
  };

  // Find section boundaries
  const sections = [
    { key: 'spec' as const, patterns: ['## Spec Summary', '## Reference Documents', '### Spec Summary'] },
    { key: 'architecture' as const, patterns: ['### Architecture Overview', '## Architecture'] },
    { key: 'designSpec' as const, patterns: ['### Design Tokens', '## Design Tokens', '```yaml'] },
    { key: 'completedPhases' as const, patterns: ['## Completed Phases'] },
    { key: 'currentPhase' as const, patterns: ['## Current Phase', '## Tasks for This Phase'] },
    { key: 'fileMap' as const, patterns: ['## File Map'] },
  ];

  let accounted = 0;

  for (const section of sections) {
    for (const pattern of section.patterns) {
      const startIdx = context.indexOf(pattern);
      if (startIdx !== -1) {
        // Find the end (next ## or end of content)
        let endIdx = context.length;
        const nextSectionIdx = context.indexOf('\n## ', startIdx + pattern.length);
        if (nextSectionIdx !== -1) {
          endIdx = nextSectionIdx;
        }

        const sectionText = context.substring(startIdx, endIdx);
        breakdown[section.key] = estimateTokens(sectionText);
        accounted += breakdown[section.key];
        break;
      }
    }
  }

  breakdown.other = Math.max(0, estimateTokens(context) - accounted);

  return breakdown;
}

/**
 * Format health report for display
 */
export function formatHealthReport(report: ContextHealthReport): string {
  const statusEmoji = {
    healthy: '🟢',
    warning: '🟡',
    critical: '🔴',
  }[report.status];

  let output = `${statusEmoji} Context: ${report.totalTokens} tokens (${report.percentageUsed}% of budget)\n`;

  if (report.status !== 'healthy') {
    output += '\n';
    for (const rec of report.recommendations) {
      output += `  ⚠ ${rec}\n`;
    }
  }

  return output;
}

/**
 * Format detailed breakdown for skunkcontext-health command
 */
export function formatDetailedReport(report: ContextHealthReport): string {
  const statusEmoji = {
    healthy: '🟢',
    warning: '🟡',
    critical: '🔴',
  }[report.status];

  let output = chalk.blue.bold('\n📊 Context Health Report\n\n');

  output += `Status: ${statusEmoji} ${report.status.toUpperCase()}\n`;
  output += `Total: ${report.totalTokens} tokens\n`;
  output += `Budget: ${report.budgetTokens} tokens\n`;
  output += `Usage: ${report.percentageUsed}%\n`;

  // Progress bar
  const barLength = 30;
  const filledLength = Math.min(barLength, Math.round((report.percentageUsed / 100) * barLength));
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  const barColor = report.status === 'healthy' ? chalk.green :
                   report.status === 'warning' ? chalk.yellow : chalk.red;
  output += `\n${barColor(bar)} ${report.percentageUsed}%\n`;

  output += chalk.gray('\n─────────────────────────────────\n');
  output += chalk.white('Breakdown by Section:\n\n');

  const sections = [
    { label: 'Spec', value: report.breakdown.spec },
    { label: 'Architecture', value: report.breakdown.architecture },
    { label: 'Design Tokens', value: report.breakdown.designSpec },
    { label: 'Completed Phases', value: report.breakdown.completedPhases },
    { label: 'Current Phase', value: report.breakdown.currentPhase },
    { label: 'File Map', value: report.breakdown.fileMap },
    { label: 'Other', value: report.breakdown.other },
  ];

  for (const section of sections) {
    if (section.value > 0) {
      const pct = Math.round((section.value / report.totalTokens) * 100);
      const sectionBar = '▓'.repeat(Math.ceil(pct / 5));
      output += `  ${section.label.padEnd(18)} ${String(section.value).padStart(5)} tokens  ${chalk.gray(sectionBar)} ${pct}%\n`;
    }
  }

  if (report.recommendations.length > 0) {
    output += chalk.gray('\n─────────────────────────────────\n');
    output += chalk.yellow('Recommendations:\n\n');
    for (const rec of report.recommendations) {
      output += `  ⚠ ${rec}\n`;
    }
  }

  return output;
}

/**
 * Get inline health indicator for build progress display
 */
export function getHealthIndicator(context: string, budgetTokens?: number): string {
  const report = analyzeContextHealth(context, undefined, budgetTokens);
  return formatHealthReport(report);
}
