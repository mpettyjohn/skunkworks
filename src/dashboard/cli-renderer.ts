/**
 * CLI Dashboard Renderer
 *
 * Renders the dashboard as colored text output in the terminal.
 */

import chalk from 'chalk';
import type { ProjectStatusInfo, ProjectStatus } from './status.js';

// Status badges with colors
const STATUS_BADGES: Record<ProjectStatus, string> = {
  BLOCKED: chalk.red('BLOCKED'),
  NEEDS_YOU: chalk.yellow('NEEDS YOU'),
  RUNNING: chalk.blue('RUNNING'),
  COMPLETE: chalk.green('DONE'),
};

// Status icons
const STATUS_ICONS: Record<ProjectStatus, string> = {
  BLOCKED: chalk.red.bold('!'),
  NEEDS_YOU: chalk.yellow.bold('?'),
  RUNNING: chalk.blue.bold('>'),
  COMPLETE: chalk.green.bold('✓'),
};

/**
 * Generate a progress bar
 */
function progressBar(percent: number, width: number = 10): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = chalk.blue('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `[${bar}]`;
}

/**
 * Format a date for display
 */
function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return '';

  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // Format as date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Truncate text to fit width
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Render a single project row
 */
function renderProject(project: ProjectStatusInfo): string[] {
  const lines: string[] = [];

  // Main line: name, phase, status, progress
  const name = chalk.white.bold(truncate(project.name, 24).padEnd(24));
  const phase = chalk.gray(project.phaseLabel.padEnd(10));
  const status = STATUS_ICONS[project.status] + ' ' + STATUS_BADGES[project.status].padEnd(12);

  let extra = '';
  if (project.status === 'RUNNING') {
    extra = progressBar(project.progressPercent) + chalk.gray(` ${project.progressPercent}%`);
  } else if (project.status === 'COMPLETE' && project.completedAt) {
    extra = chalk.gray(`Shipped ${formatDate(project.completedAt)}`);
  }

  lines.push(`  ${name} ${phase} ${status} ${extra}`);

  // Detail line based on status
  if (project.status === 'BLOCKED' && project.blockingReason) {
    lines.push(chalk.gray(`    Waiting for answer: "${truncate(project.blockingReason, 60)}"`));
  } else if (project.status === 'RUNNING' && project.currentTask) {
    lines.push(chalk.gray(`    Building: ${truncate(project.currentTask, 60)}`));
  } else if (project.status === 'NEEDS_YOU') {
    lines.push(chalk.gray(`    Ready for your input`));
  } else if (project.error) {
    lines.push(chalk.red(`    Error: ${truncate(project.error, 60)}`));
  }

  lines.push(''); // Blank line between projects

  return lines;
}

/**
 * Render the full dashboard
 */
export function renderDashboard(projects: ProjectStatusInfo[]): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.cyan.bold('SKUNKWORKS MISSION CONTROL'));
  lines.push('');

  if (projects.length === 0) {
    lines.push(chalk.yellow('  No projects registered yet.'));
    lines.push('');
    lines.push(chalk.gray('  Get started:'));
    lines.push(chalk.white('    skunk new "your project idea"    Start a new project'));
    lines.push(chalk.white('    skunk dashboard --scan           Discover existing projects'));
    lines.push('');
    return lines.join('\n');
  }

  // Group projects by status
  const blocked = projects.filter(p => p.status === 'BLOCKED');
  const needsYou = projects.filter(p => p.status === 'NEEDS_YOU');
  const running = projects.filter(p => p.status === 'RUNNING');
  const complete = projects.filter(p => p.status === 'COMPLETE');

  // Render each group
  for (const project of [...blocked, ...needsYou, ...running, ...complete]) {
    lines.push(...renderProject(project));
  }

  // Footer commands
  lines.push(chalk.gray('─'.repeat(70)));
  lines.push('');
  lines.push(chalk.gray('Commands:'));
  lines.push(chalk.white('  skunk continue --path <project>    Resume a project'));
  lines.push(chalk.white('  skunk dashboard --web              Open web dashboard'));
  lines.push(chalk.white('  skunk dashboard --scan [path]      Discover projects'));
  lines.push('');

  return lines.join('\n');
}

/**
 * Render scan results
 */
export function renderScanResults(
  discovered: number,
  scanned: number,
  skipped: number
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(chalk.cyan.bold('Scan Complete'));
  lines.push('');
  lines.push(chalk.white(`  Directories scanned: ${scanned}`));
  lines.push(chalk.gray(`  Directories skipped: ${skipped}`));
  lines.push(chalk.green(`  Projects discovered: ${discovered}`));
  lines.push('');

  if (discovered > 0) {
    lines.push(chalk.gray('Run `skunk dashboard` to view all projects.'));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Render prune results
 */
export function renderPruneResults(removed: number, remaining: number): string {
  const lines: string[] = [];

  lines.push('');
  if (removed > 0) {
    lines.push(chalk.yellow(`Removed ${removed} stale project(s) from registry.`));
  } else {
    lines.push(chalk.green('No stale projects found.'));
  }
  lines.push(chalk.gray(`${remaining} project(s) in registry.`));
  lines.push('');

  return lines.join('\n');
}
