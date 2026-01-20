#!/usr/bin/env node
/**
 * Skunkworks - CLI Entry Point
 *
 * Multi-model agentic software development system:
 * - Architect: GPT-5.2-Codex Extra High reasoning (planning/design)
 * - Builder: Claude Opus 4.5 (implementation)
 * - Reviewer: Gemini 3 Flash (testing/validation)
 *
 * Uses CLI tools with SUBSCRIPTIONS - no API keys needed!
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { Orchestrator } from './harness/orchestrator.js';
import { ModelRouter } from './harness/router.js';
import { DEFAULT_CONFIGS, CLI_INFO } from './config/models.js';
import { github } from './integrations/github.js';
import { StateManager } from './harness/state.js';
import { council } from './harness/council.js';
import { initDesignSpec, analyzeExistingDesign } from './harness/design.js';
import {
  analyzeContextHealth,
  formatDetailedReport,
  estimateTokens,
} from './harness/context-health.js';
import {
  generatePhaseContext,
  deserializeContext,
} from './harness/chunk-context.js';
import {
  initLearningRegistry,
  loadIndex,
  getLearningStats,
  getLearningsByType,
  loadLearning,
  deleteLearning,
  getLearningDir,
  LearningType,
} from './harness/learning-registry.js';
import {
  extractLearningsFromProject,
  saveExtractedLearnings,
  formatExtractionResult,
} from './harness/learning-extractor.js';

const program = new Command();

// Banner - clean technical drawing aesthetic
const BANNER = `
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                                                                         │
  │      S   K   U   N   K   W   O   R   K   S                              │
  │      ─   ─   ─   ─   ─   ─   ─   ─   ─   ─                              │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
`;

program
  .name('skunkworks')
  .description('Skunkworks: Multi-model agentic dev tool')
  .version('2.0.0');

/**
 * Start a new project with the architect interview
 */
program
  .command('new [description]')
  .description('Start a new project with AI-driven architecture')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (description: string | undefined, options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.green(BANNER));
    console.log(chalk.gray('  Multi-model orchestration (subscription-based, no API keys)\n'));

    if (!description) {
      console.log(chalk.white('What do you want to build?'));
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      description = await new Promise<string>((resolve) => {
        rl.question(chalk.green('> '), (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.startNew(description);
  });

/**
 * Continue from where we left off
 */
program
  .command('continue')
  .description('Continue from the last checkpoint')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🚀 Agentic Dev Tool - Continuing...\n'));

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.continue();
  });

/**
 * Run just the interview phase
 */
program
  .command('interview')
  .description('Run only the interview phase (interactive requirements gathering)')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🎤 Running Interview Phase'));
    console.log(chalk.magenta('    Using: Claude Opus 4.5 (interactive mode with AskUserQuestion)\n'));

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.runInterviewPhase();
  });

/**
 * Run just the architect phase
 */
program
  .command('architect')
  .description('Run only the architect phase (planning & design)')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n📐 Running Architect Phase'));
    console.log(chalk.cyan('    Using: GPT-5.2-Codex Extra High reasoning\n'));

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.runArchitectPhase();
  });

/**
 * Run just the builder phase
 */
program
  .command('build')
  .description('Run only the builder phase (implementation)')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🔨 Running Builder Phase'));
    console.log(chalk.green('    Using: Claude Opus 4.5\n'));

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.runBuilderPhase();
  });

/**
 * Run just the reviewer phase
 */
program
  .command('review')
  .description('Run only the reviewer phase (testing & validation)')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🔍 Running Reviewer Phase'));
    console.log(chalk.yellow('    Using: Gemini 3 Flash\n'));

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: true,
    });

    await orchestrator.runReviewerPhase();
  });

/**
 * Show project status
 */
program
  .command('status')
  .description('Show current project status')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    const orchestrator = new Orchestrator({
      projectPath,
      verbose: false,
    });

    orchestrator.getStatus();
  });

/**
 * Show available models and CLI tools
 */
program
  .command('models')
  .description('Show model configuration and CLI tool status')
  .action(async () => {
    console.log(chalk.blue.bold('\n🤖 Model Configuration (v2.0)\n'));
    console.log(chalk.white.bold('No API keys needed - uses your subscriptions!\n'));

    const router = new ModelRouter();
    await router.ensureInitialized();

    const available = router.getAvailableProviders();

    console.log(chalk.white.bold('Phase → Model → CLI Tool:\n'));

    // Interviewer
    const intConfig = DEFAULT_CONFIGS.interviewer.primary;
    const intAvailable = available.includes(intConfig.cli);
    console.log(chalk.magenta('  🎤 Interviewer'));
    console.log(chalk.gray(`     Model: ${intConfig.model}`));
    console.log(chalk.gray(`     CLI:   ${CLI_INFO[intConfig.cli].command} (interactive mode)`));
    console.log(intAvailable
      ? chalk.green(`     Status: ✓ Installed`)
      : chalk.red(`     Status: ✗ Not found - ${CLI_INFO[intConfig.cli].installCmd}`));
    console.log();

    // Architect
    const archConfig = DEFAULT_CONFIGS.architect.primary;
    const archAvailable = available.includes(archConfig.cli);
    console.log(chalk.cyan('  📐 Architect'));
    console.log(chalk.gray(`     Model: ${archConfig.model}`));
    console.log(chalk.gray(`     CLI:   ${CLI_INFO[archConfig.cli].command}`));
    console.log(archAvailable
      ? chalk.green(`     Status: ✓ Installed`)
      : chalk.red(`     Status: ✗ Not found - ${CLI_INFO[archConfig.cli].installCmd}`));
    console.log();

    // Builder
    const buildConfig = DEFAULT_CONFIGS.builder.primary;
    const buildAvailable = available.includes(buildConfig.cli);
    console.log(chalk.green('  🔨 Builder'));
    console.log(chalk.gray(`     Model: ${buildConfig.model}`));
    console.log(chalk.gray(`     CLI:   ${CLI_INFO[buildConfig.cli].command}`));
    console.log(buildAvailable
      ? chalk.green(`     Status: ✓ Installed`)
      : chalk.red(`     Status: ✗ Not found - ${CLI_INFO[buildConfig.cli].installCmd}`));
    console.log();

    // Reviewer
    const revConfig = DEFAULT_CONFIGS.reviewer.primary;
    const revAvailable = available.includes(revConfig.cli);
    console.log(chalk.yellow('  🔍 Reviewer'));
    console.log(chalk.gray(`     Model: ${revConfig.model}`));
    console.log(chalk.gray(`     CLI:   ${CLI_INFO[revConfig.cli].command}`));
    console.log(revAvailable
      ? chalk.green(`     Status: ✓ Installed`)
      : chalk.red(`     Status: ✗ Not found - ${CLI_INFO[revConfig.cli].installCmd}`));
    console.log();

    // Summary
    if (available.length === 3) {
      console.log(chalk.green.bold('All CLI tools installed! Ready to use.\n'));
    } else {
      console.log(chalk.yellow.bold('Missing CLI tools. Install them with:\n'));
      for (const [cli, info] of Object.entries(CLI_INFO)) {
        if (!available.includes(cli as any)) {
          console.log(chalk.white(`  ${info.installCmd}`));
          console.log(chalk.gray(`    Auth: ${info.authMethod}\n`));
        }
      }
    }
  });

/**
 * Initialize a new project directory
 */
program
  .command('init')
  .description('Initialize project directory with .skunkworks folder')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);
    const abrPath = path.join(projectPath, '.skunkworks');

    if (fs.existsSync(abrPath)) {
      console.log(chalk.yellow('Project already initialized.'));
      return;
    }

    fs.mkdirSync(abrPath, { recursive: true });
    fs.mkdirSync(path.join(abrPath, 'checkpoints'), { recursive: true });

    // Create initial state
    const initialState = {
      projectName: path.basename(projectPath),
      currentPhase: 'interviewer',
      todos: [],
      artifacts: {},
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(abrPath, 'state.json'),
      JSON.stringify(initialState, null, 2)
    );

    console.log(chalk.green('✓ Project initialized!'));
    console.log(chalk.gray(`  Created: ${abrPath}`));
    console.log(chalk.gray('\nNext steps:'));
    console.log(chalk.white('  skunknew "describe your project"'));
  });

/**
 * Setup command to install CLI tools
 */
program
  .command('setup')
  .description('Check and install required CLI tools')
  .action(async () => {
    console.log(chalk.blue.bold('\n🔧 Skunkworks Setup\n'));
    console.log(chalk.white('This tool requires three CLI tools:\n'));

    console.log(chalk.magenta('1. Claude Code CLI (for Interview & Builder phases)'));
    console.log(chalk.gray('   npm i -g @anthropic-ai/claude-code'));
    console.log(chalk.gray('   Then run: claude (sign in with Claude Max account)\n'));

    console.log(chalk.cyan('2. OpenAI Codex CLI (for Architect phase)'));
    console.log(chalk.gray('   npm i -g @openai/codex'));
    console.log(chalk.gray('   Then run: codex (sign in with ChatGPT Pro account)\n'));

    console.log(chalk.yellow('3. Gemini CLI (for Reviewer phase)'));
    console.log(chalk.gray('   npm i -g @google/gemini-cli'));
    console.log(chalk.gray('   Then run: gemini (sign in with Google account)\n'));

    console.log(chalk.white.bold('After installing, run: skunkmodels'));
    console.log(chalk.gray('to verify all tools are detected.\n'));
  });

/**
 * GitHub integration commands
 */
const githubCmd = program
  .command('github')
  .description('GitHub integration for visual progress tracking');

githubCmd
  .command('init')
  .description('Initialize GitHub repo and project board')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--public', 'Make the repo public (default: private)')
  .action(async (options: { path: string; public?: boolean }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🐙 GitHub Setup\n'));

    // Check if gh CLI is installed
    const isInstalled = await github.isGhInstalled();
    if (!isInstalled) {
      console.log(chalk.red('GitHub CLI (gh) not found.\n'));
      console.log(chalk.white('Install it with:'));
      console.log(chalk.gray('  brew install gh'));
      console.log(chalk.gray('  # or: npm install -g @github/cli\n'));
      return;
    }
    console.log(chalk.green('✓ GitHub CLI installed'));

    // Check if authenticated
    const isAuth = await github.isAuthenticated();
    if (!isAuth) {
      console.log(chalk.red('Not authenticated with GitHub.\n'));
      console.log(chalk.white('Run:'));
      console.log(chalk.gray('  gh auth login\n'));
      console.log(chalk.gray('This will open your browser to authorize.\n'));
      return;
    }
    console.log(chalk.green('✓ Authenticated with GitHub'));

    // Get project name
    const projectName = path.basename(projectPath);

    console.log(chalk.gray(`\nCreating repo: ${projectName}...\n`));

    try {
      // Initialize repo
      const config = await github.initRepo(
        projectName,
        `Created with Skunkworks`,
        !options.public
      );

      console.log(chalk.green(`✓ Repository created: ${config.repoUrl}\n`));

      // Ask about project board
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const wantBoard = await new Promise<boolean>((resolve) => {
        rl.question(chalk.white('Create a visual project board? (Y/n) '), (answer) => {
          rl.close();
          resolve(answer.toLowerCase() !== 'n');
        });
      });

      if (wantBoard) {
        console.log(chalk.gray('\nCreating project board...'));
        const { projectUrl } = await github.createProject(`${projectName} Tasks`);
        console.log(chalk.green(`✓ Project board created: ${projectUrl}\n`));

        config.projectId = projectUrl.split('/').pop();
        config.projectUrl = projectUrl;
      }

      // Save config to state
      const state = new StateManager(projectPath);
      state.setGitHubConfig(config);

      console.log(chalk.green.bold('\n✓ GitHub setup complete!\n'));
      console.log(chalk.white('Your tasks will now appear on GitHub:'));
      console.log(chalk.gray(`  Repo: ${config.repoUrl}`));
      if (config.projectUrl) {
        console.log(chalk.gray(`  Board: ${config.projectUrl}`));
      }
      console.log();

    } catch (error: any) {
      console.log(chalk.red(`\nError: ${error.message}\n`));
      if (error.message.includes('already exists')) {
        console.log(chalk.yellow('Tip: The repo might already exist. Try a different name or delete the existing repo.\n'));
      }
    }
  });

githubCmd
  .command('status')
  .description('Show GitHub integration status')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);
    const state = new StateManager(projectPath);
    const config = state.getGitHubConfig();

    console.log(chalk.blue.bold('\n🐙 GitHub Status\n'));

    if (!config || !config.isEnabled) {
      console.log(chalk.yellow('GitHub integration not configured.\n'));
      console.log(chalk.white('Run: skunkgithub init\n'));
      return;
    }

    console.log(chalk.green('✓ GitHub integration enabled\n'));
    console.log(chalk.white('Repository:'));
    console.log(chalk.gray(`  ${config.repoUrl}\n`));

    if (config.projectUrl) {
      console.log(chalk.white('Project Board:'));
      console.log(chalk.gray(`  ${config.projectUrl}\n`));
    }

    // Show open issues
    try {
      github.loadConfig(config);
      const issues = await github.getOpenIssues();
      if (issues.length > 0) {
        console.log(chalk.white(`Open Issues (${issues.length}):`));
        for (const issue of issues.slice(0, 10)) {
          console.log(chalk.gray(`  #${issue.number} ${issue.title}`));
        }
        if (issues.length > 10) {
          console.log(chalk.gray(`  ... and ${issues.length - 10} more`));
        }
        console.log();
      }
    } catch {
      // Ignore errors fetching issues
    }
  });

githubCmd
  .command('sync')
  .description('Sync TODO.md items to GitHub issues')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);
    const state = new StateManager(projectPath);
    const config = state.getGitHubConfig();

    console.log(chalk.blue.bold('\n🐙 Syncing to GitHub\n'));

    if (!config || !config.isEnabled) {
      console.log(chalk.yellow('GitHub integration not configured.\n'));
      console.log(chalk.white('Run: skunkgithub init\n'));
      return;
    }

    github.loadConfig(config);

    // Get pending todos
    const todos = state.getPendingTodos();

    if (todos.length === 0) {
      console.log(chalk.yellow('No pending todos to sync.\n'));
      return;
    }

    console.log(chalk.gray(`Creating ${todos.length} issues...\n`));

    for (const todo of todos) {
      try {
        const issue = await github.createIssue(
          todo.task,
          `Phase: ${todo.phase}\n\nCreated by Skunkworks`,
          [todo.phase]
        );
        console.log(chalk.green(`  ✓ #${issue.number}: ${todo.task}`));

        // Add to project board if configured
        if (config.projectId) {
          await github.addIssueToProject(issue.number);
        }
      } catch (error: any) {
        console.log(chalk.red(`  ✗ ${todo.task}: ${error.message}`));
      }
    }

    console.log(chalk.green('\n✓ Sync complete!\n'));
  });

/**
 * Council - Multi-model plan review
 */
program
  .command('council [file]')
  .description('Get plan reviewed by multiple AI models (Codex + Gemini)')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('-s, --save', 'Save feedback to .skunkworks/COUNCIL_FEEDBACK.md')
  .action(async (file: string | undefined, options: { path: string; save?: boolean }) => {
    const projectPath = path.resolve(options.path);

    let planPath: string | undefined;
    let planContent: string;

    if (file) {
      // User specified a file
      planPath = path.resolve(file);
      if (!fs.existsSync(planPath)) {
        console.log(chalk.red(`\nFile not found: ${planPath}\n`));
        return;
      }
      planContent = fs.readFileSync(planPath, 'utf-8');
    } else {
      // Try to find a plan file automatically
      planPath = council.findPlanFile(projectPath) ?? undefined;
      if (!planPath) {
        console.log(chalk.yellow('\nNo plan file found.\n'));
        console.log(chalk.white('Usage:'));
        console.log(chalk.gray('  skunkcouncil path/to/plan.md'));
        console.log(chalk.gray('  skunkcouncil                    # auto-finds recent plan\n'));
        console.log(chalk.white('Searches for:'));
        console.log(chalk.gray('  - .claude/plans/*.md (Claude Code plans)'));
        console.log(chalk.gray('  - .skunkworks/ARCHITECTURE.md'));
        console.log(chalk.gray('  - .skunkworks/SPEC.md'));
        console.log(chalk.gray('  - PLAN.md\n'));
        return;
      }
      planContent = fs.readFileSync(planPath, 'utf-8');
      console.log(chalk.gray(`Found plan: ${planPath}\n`));
    }

    console.log(chalk.blue.bold('\n🏛️  Council Review'));
    console.log(chalk.gray('Multiple AI models will critique this plan to catch blind spots.\n'));

    // Run council review
    const result = await council.review(planContent, projectPath);

    // Display results
    council.displayResults(result);

    // Optionally save
    if (options.save) {
      const outputPath = path.join(projectPath, '.skunkworks', 'COUNCIL_FEEDBACK.md');
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      council.saveResults(result, outputPath);
    }

    // Summary
    if (result.reviews.length > 0) {
      console.log(chalk.blue.bold('What to do with this feedback:\n'));
      console.log(chalk.white('1. Review each critique for valid points'));
      console.log(chalk.white('2. Update your plan to address concerns'));
      console.log(chalk.white('3. Run council again if you make major changes'));
      console.log(chalk.white('4. Proceed to building when satisfied\n'));
    }
  });

/**
 * Design system commands
 */
const designCmd = program
  .command('design')
  .description('Design system management for consistent UI');

designCmd
  .command('init')
  .description('Initialize design system for existing project')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);
    await initDesignSpec(projectPath);
  });

designCmd
  .command('status')
  .description('Show design system status')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🎨 Design System Status\n'));

    // Check for existing spec
    const specPath = path.join(projectPath, '.skunkworks', 'DESIGN_SPEC.yaml');
    if (fs.existsSync(specPath)) {
      console.log(chalk.green('✓ DESIGN_SPEC.yaml exists\n'));

      // Parse and display key info
      try {
        const specContent = fs.readFileSync(specPath, 'utf-8');

        // Simple YAML parsing for key fields
        const getYamlValue = (key: string): string | null => {
          const match = specContent.match(new RegExp(`${key}:\\s*"?([^"\\n]+)"?`));
          return match ? match[1].trim() : null;
        };

        console.log(chalk.white('Configuration:'));
        console.log(chalk.gray(`  Platform: ${getYamlValue('platform') || 'not set'}`));
        console.log(chalk.gray(`  Archetype: ${getYamlValue('archetype') || 'not set'}`));
        console.log(chalk.gray(`  Personality: ${getYamlValue('personality') || 'not set'}`));
        console.log(chalk.gray(`  Density: ${getYamlValue('density') || 'not set'}`));
        console.log(chalk.gray(`  Baseline: ${getYamlValue('baseline_system') || 'not set'}`));
        console.log();
      } catch {
        console.log(chalk.yellow('Could not parse DESIGN_SPEC.yaml'));
      }
    } else {
      console.log(chalk.yellow('No DESIGN_SPEC.yaml found.\n'));
      console.log(chalk.white('Run: skunkdesign init\n'));
    }

    // Analyze project
    const analysis = await analyzeExistingDesign(projectPath);
    if (analysis.detectedFramework) {
      console.log(chalk.white('Detected:'));
      console.log(chalk.gray(`  Framework: ${analysis.detectedFramework}`));
      console.log(chalk.gray(`  Existing tokens: ${analysis.hasExistingTokens ? 'yes' : 'no'}`));
      console.log();
    }
  });

/**
 * Context health command
 */
program
  .command('context-health')
  .description('Show context size and health for current build phase')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .action(async (options: { path: string }) => {
    const projectPath = path.resolve(options.path);
    const state = new StateManager(projectPath);

    // Check if we have build context
    const chunkContextPath = path.join(projectPath, '.skunkworks', 'CHUNK_CONTEXT.md');
    const specPath = path.join(projectPath, '.skunkworks', 'SPEC.md');
    const archPath = path.join(projectPath, '.skunkworks', 'ARCHITECTURE.md');
    const designSpecPath = path.join(projectPath, '.skunkworks', 'DESIGN_SPEC.yaml');

    // Build a simulated context to analyze
    let totalContext = '';
    const breakdown: Record<string, number> = {};

    if (fs.existsSync(specPath)) {
      const spec = fs.readFileSync(specPath, 'utf-8');
      breakdown.spec = estimateTokens(spec);
      totalContext += spec + '\n\n';
    }

    if (fs.existsSync(archPath)) {
      const arch = fs.readFileSync(archPath, 'utf-8');
      breakdown.architecture = estimateTokens(arch);
      totalContext += arch + '\n\n';
    }

    if (fs.existsSync(designSpecPath)) {
      const designSpec = fs.readFileSync(designSpecPath, 'utf-8');
      breakdown.designSpec = estimateTokens(designSpec);
      totalContext += designSpec + '\n\n';
    }

    if (fs.existsSync(chunkContextPath)) {
      const chunkContext = fs.readFileSync(chunkContextPath, 'utf-8');
      const parsed = deserializeContext(chunkContext);
      if (parsed) {
        // Estimate completed phases
        const phasesStr = JSON.stringify(parsed.completedPhases);
        breakdown.completedPhases = estimateTokens(phasesStr);

        // Estimate file map
        const fileMapStr = JSON.stringify(parsed.fileMap);
        breakdown.fileMap = estimateTokens(fileMapStr);

        totalContext += chunkContext + '\n\n';
      }
    }

    if (!totalContext) {
      console.log(chalk.yellow('\n⚠️  No build context found.\n'));
      console.log(chalk.gray('Run a build first with: skunknew "project" or skunkbuild\n'));
      return;
    }

    // Analyze health
    const report = analyzeContextHealth(totalContext, breakdown);
    console.log(formatDetailedReport(report));

    // Show tips
    console.log(chalk.gray('\n─────────────────────────────────\n'));
    console.log(chalk.white('Tips:\n'));

    if (report.status === 'healthy') {
      console.log(chalk.green('  ✓ Context is healthy - no action needed\n'));
    } else if (report.status === 'warning') {
      console.log(chalk.yellow('  ⚠ Context is growing large'));
      console.log(chalk.gray('    Compression will be automatically applied during builds\n'));
    } else {
      console.log(chalk.red('  ⚠ Context exceeds budget'));
      console.log(chalk.gray('    Aggressive compression will be applied'));
      console.log(chalk.gray('    Consider breaking the project into smaller phases\n'));
    }
  });

/**
 * Compound command - capture learnings from a project
 */
program
  .command('compound')
  .description('Capture learnings from a project for future use')
  .option('-p, --path <path>', 'Project path', process.cwd())
  .option('--auto', 'Skip interactive review and save all learnings')
  .action(async (options: { path: string; auto?: boolean }) => {
    const projectPath = path.resolve(options.path);

    console.log(chalk.blue.bold('\n🎓 Compound Learning Capture\n'));
    console.log(chalk.gray('Extracting learnings from project artifacts...\n'));

    // Initialize learning registry
    initLearningRegistry();

    // Check for project artifacts
    const skunkworksDir = path.join(projectPath, '.skunkworks');
    if (!fs.existsSync(skunkworksDir)) {
      console.log(chalk.yellow('No .skunkworks folder found.\n'));
      console.log(chalk.gray('Run this command in a Skunkworks project directory.\n'));
      return;
    }

    // Extract learnings
    const result = extractLearningsFromProject(projectPath);

    if (result.totalExtracted === 0) {
      console.log(chalk.yellow('No learnings found to extract.\n'));
      console.log(chalk.gray('Learnings are extracted from:'));
      console.log(chalk.gray('  - REVIEW.md (issues and recommendations)'));
      console.log(chalk.gray('  - ARCHITECTURE.md (patterns and decisions)'));
      console.log(chalk.gray('  - DESIGN_SPEC.yaml (design tokens)\n'));
      return;
    }

    // Display extraction result
    console.log(formatExtractionResult(result));

    // Auto-save or interactive review
    if (options.auto) {
      console.log(chalk.gray('Auto-saving all learnings...\n'));

      const allLearnings = [...result.solutions, ...result.patterns, ...result.designTokens];
      const saved = saveExtractedLearnings(allLearnings, result.projectName);

      console.log(chalk.green(`✓ Saved ${saved.length} learnings to registry\n`));
      console.log(chalk.gray(`Location: ${getLearningDir()}\n`));
    } else {
      // Interactive review
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askQuestion = (prompt: string): Promise<string> => {
        return new Promise(resolve => {
          rl.question(prompt, resolve);
        });
      };

      console.log(chalk.white('Review extracted learnings:\n'));

      const allLearnings = [...result.solutions, ...result.patterns, ...result.designTokens];
      const toSave: typeof allLearnings = [];

      for (let i = 0; i < allLearnings.length; i++) {
        const learning = allLearnings[i];
        console.log(chalk.cyan(`\n${i + 1}/${allLearnings.length}: [${learning.type.toUpperCase()}] ${learning.title}`));
        console.log(chalk.gray(`Category: ${learning.category} | Confidence: ${learning.confidence}`));
        console.log(chalk.gray(`${learning.description.slice(0, 100)}...`));

        const answer = await askQuestion(chalk.yellow('Save this learning? (Y/n/q to quit): '));

        if (answer.toLowerCase() === 'q') {
          break;
        }

        if (answer.toLowerCase() !== 'n') {
          toSave.push(learning);
        }
      }

      rl.close();

      if (toSave.length > 0) {
        console.log(chalk.gray(`\nSaving ${toSave.length} learnings...\n`));
        const saved = saveExtractedLearnings(toSave, result.projectName);
        console.log(chalk.green(`✓ Saved ${saved.length} learnings to registry\n`));
      } else {
        console.log(chalk.yellow('\nNo learnings saved.\n'));
      }
    }

    console.log(chalk.gray('View all learnings: skunklearnings'));
    console.log(chalk.gray(`Registry location: ${getLearningDir()}\n`));
  });

/**
 * Learnings command - browse all captured learnings
 */
program
  .command('learnings')
  .description('Browse all captured learnings')
  .option('-t, --type <type>', 'Filter by type (solution, pattern, design-token)')
  .option('-c, --category <category>', 'Filter by category')
  .option('--stats', 'Show statistics only')
  .action(async (options: { type?: string; category?: string; stats?: boolean }) => {
    initLearningRegistry();

    console.log(chalk.blue.bold('\n📚 Learning Registry\n'));

    // Show statistics
    const stats = getLearningStats();

    if (options.stats || stats.total === 0) {
      console.log(chalk.white('Statistics:\n'));
      console.log(`  Total learnings: ${stats.total}`);
      console.log(`  Solutions: ${stats.byType.solution}`);
      console.log(`  Patterns: ${stats.byType.pattern}`);
      console.log(`  Design tokens: ${stats.byType['design-token']}`);
      console.log(`\n  Last updated: ${stats.lastUpdated}\n`);

      if (Object.keys(stats.byCategory).length > 0) {
        console.log(chalk.white('By category:'));
        for (const [cat, count] of Object.entries(stats.byCategory).slice(0, 10)) {
          console.log(`  ${cat}: ${count}`);
        }
        console.log();
      }

      if (stats.total === 0) {
        console.log(chalk.yellow('No learnings captured yet.\n'));
        console.log(chalk.gray('Run "skunkcompound" in a project directory to capture learnings.\n'));
      }

      console.log(chalk.gray(`Registry location: ${getLearningDir()}\n`));
      return;
    }

    // List learnings
    const index = loadIndex();
    let learnings = index.learnings;

    // Apply filters
    if (options.type) {
      learnings = learnings.filter(l => l.type === options.type);
    }
    if (options.category) {
      learnings = learnings.filter(l => l.category === options.category);
    }

    if (learnings.length === 0) {
      console.log(chalk.yellow('No learnings match the filters.\n'));
      return;
    }

    console.log(chalk.white(`Found ${learnings.length} learnings:\n`));

    // Group by type
    const grouped = {
      solution: learnings.filter(l => l.type === 'solution'),
      pattern: learnings.filter(l => l.type === 'pattern'),
      'design-token': learnings.filter(l => l.type === 'design-token'),
    };

    for (const [type, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;

      const emoji = type === 'solution' ? '🔧' : type === 'pattern' ? '📐' : '🎨';
      console.log(chalk.cyan.bold(`${emoji} ${type.toUpperCase()}S (${items.length}):\n`));

      for (const item of items.slice(0, 10)) {
        console.log(`  ${chalk.white(item.title)}`);
        console.log(chalk.gray(`    Category: ${item.category} | Tags: ${item.tags.slice(0, 3).join(', ')}`));
        console.log(chalk.gray(`    ID: ${item.id}\n`));
      }

      if (items.length > 10) {
        console.log(chalk.gray(`  ... and ${items.length - 10} more\n`));
      }
    }

    console.log(chalk.gray('─────────────────────────────────\n'));
    console.log(chalk.white('Commands:\n'));
    console.log(chalk.gray('  View a learning:    skunklearnings --stats'));
    console.log(chalk.gray('  Filter by type:     skunklearnings -t solution'));
    console.log(chalk.gray('  Filter by category: skunklearnings -c react\n'));
  });

// Interactive mode if no command provided
async function runInteractiveMode() {
  console.log(chalk.green(BANNER));
  console.log(chalk.gray('  Multi-model AI orchestration for software development'));
  console.log(chalk.gray('  Uses subscriptions (no API keys needed)\n'));

  console.log(chalk.white.bold('  Pipeline:'));
  console.log(chalk.magenta('    Interview  →') + chalk.cyan('  Architect  →') + chalk.green('  Builder  →') + chalk.yellow('  Reviewer\n'));

  console.log(chalk.white('  What do you want to build?'));
  console.log(chalk.gray('  Just describe it, or type "help" for options\n'));

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const projectPath = process.cwd();

  const askForProject = () => {
    rl.question(chalk.green('  > '), async (answer) => {
      const trimmed = answer.trim();

      if (!trimmed) {
        askForProject();
        return;
      }

      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        console.log(chalk.gray('\n  Goodbye!\n'));
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'help') {
        console.log(chalk.white('\n  To start building, just describe your idea:\n'));
        console.log(chalk.green('    > ') + chalk.white('a personal biographer that interviews me weekly and compiles my life story'));
        console.log(chalk.green('    > ') + chalk.white('an app that watches me do physical therapy exercises and corrects my form'));
        console.log(chalk.green('    > ') + chalk.white('a gift recommender that knows my family and suggests meaningful presents'));
        console.log(chalk.green('    > ') + chalk.white('a tool that explains my medical test results in plain english'));
        console.log(chalk.green('    > ') + chalk.white('a high-altitude strategic recon aircraft capable of mach 3.2 at 85,000 feet\n'));
        console.log(chalk.gray('  Other commands:'));
        console.log(chalk.gray('    continue  - Resume a project in progress'));
        console.log(chalk.gray('    status    - Show current project status'));
        console.log(chalk.gray('    models    - Check if AI tools are installed'));
        console.log(chalk.gray('    setup     - Installation help'));
        console.log(chalk.gray('    quit      - Exit\n'));
        askForProject();
        return;
      }

      if (trimmed.toLowerCase() === 'status') {
        rl.close();
        const orchestrator = new Orchestrator({ projectPath, verbose: false });
        orchestrator.getStatus();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'models') {
        rl.close();
        process.argv = ['node', 'skunkworks', 'models'];
        program.parse();
        return;
      }

      if (trimmed.toLowerCase() === 'setup') {
        rl.close();
        process.argv = ['node', 'skunkworks', 'setup'];
        program.parse();
        return;
      }

      if (trimmed.toLowerCase() === 'continue') {
        rl.close();
        const orchestrator = new Orchestrator({ projectPath, verbose: true });
        await orchestrator.continue();
        return;
      }

      // Start building
      rl.close();

      const orchestrator = new Orchestrator({
        projectPath,
        verbose: true,
      });

      await orchestrator.startNew(trimmed);
    });
  };

  askForProject();
}

// Check if running without arguments
if (process.argv.length <= 2) {
  runInteractiveMode();
} else {
  // Parse arguments for subcommands
  program.parse();
}
