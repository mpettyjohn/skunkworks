/**
 * Orchestrator
 *
 * The "harness" that coordinates the Architect → Builder → Reviewer pipeline.
 * "Think of the model as an engine and the harness as the car—the best engine
 * without steering and brakes goes nowhere useful."
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import ora, { Ora } from 'ora';
import { StateManager, TodoItem } from './state.js';
import { ModelRouter, Message } from './router.js';
import { AgentPhase } from '../config/models.js';
import { github } from '../integrations/github.js';
import { council, CouncilResult } from './council.js';
import {
  hasTestScript,
  runTests,
  formatTestResultsForContext,
} from './verification.js';
import {
  hasDevServer,
  runVisualVerification,
  formatVisualResultsForContext,
} from './visual-verification.js';
import {
  detectRequiredRuntimes,
  checkMissingRuntimes,
  promptForDependencies,
  showInstallInstructions,
} from './dependency-manager.js';
import {
  runDesignVerification,
  formatDesignResultsForContext,
} from './design-verification.js';
import {
  runChunkVerification,
  formatVerificationForFix,
  VerificationLevel,
} from './chunk-verification.js';
import {
  generateInitialContext,
  generatePhaseContext,
  updateContextAfterPhase,
  deserializeContext,
  serializeContext,
  ChunkContext,
} from './chunk-context.js';
import { ChunkPhase } from './state.js';
import {
  analyzeContextHealth,
  formatHealthReport,
  getHealthIndicator,
} from './context-health.js';
import {
  generateCompressedPhaseContext,
  shouldCompress,
  compressFixContext,
} from './context-compression.js';
import {
  queryRelevantLearnings,
  formatLearningsForPrompt,
  initLearningRegistry,
  getLearningStats,
} from './learning-registry.js';
import {
  extractLearningsFromProject,
  saveExtractedLearnings,
} from './learning-extractor.js';

// Load prompts
const PROMPTS_DIR = path.join(process.cwd(), 'prompts');

function loadPrompt(name: string): string {
  const promptPath = path.join(PROMPTS_DIR, `${name}.md`);
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf-8');
  }
  // Fallback to inline prompts if files don't exist
  return getDefaultPrompt(name);
}

function getDefaultPrompt(name: string): string {
  const prompts: Record<string, string> = {
    architect: `You are an expert software architect. Your role is to:

1. INTERVIEW the user to understand their requirements thoroughly
2. Ask clarifying questions about scope, constraints, and goals
3. Design a clear architecture for the solution
4. Create a detailed specification document
5. Break down the work into implementable tasks

Always start by asking questions. Don't assume - extract intent.

Output format:
- Questions (when gathering requirements)
- SPEC.md content (when ready to document)
- ARCHITECTURE.md content (when designing)
- TODO list (implementation tasks)`,

    builder: `You are an expert software developer. Your role is to:

1. READ the specification and architecture documents
2. EXECUTE the todo list items one by one
3. WRITE clean, well-documented code
4. TEST each piece before moving on
5. UPDATE the todo list as you complete items

Follow the spec precisely. If something is unclear, note it but don't deviate.

Tools available:
- readFile(path) - Read file contents
- writeFile(path, content) - Write to file
- runCommand(cmd) - Execute shell command
- listFiles(pattern) - List matching files`,

    reviewer: `You are an expert code reviewer. Your role is to:

1. READ the original specification
2. EXAMINE the implementation against each requirement
3. RUN tests and check for issues
4. IDENTIFY bugs, security issues, and improvements
5. PRODUCE a detailed review report

Be thorough but constructive. Focus on:
- Spec compliance (does it do what was asked?)
- Code quality (is it maintainable?)
- Security (any vulnerabilities?)
- Performance (any obvious issues?)

Output: REVIEW.md with findings and recommendations`,
  };

  return prompts[name] || '';
}

export interface OrchestratorOptions {
  projectPath: string;
  verbose?: boolean;
}

/**
 * Pipeline phases in order
 */
type PipelinePhase = 'interview' | 'council-spec' | 'architect' | 'council-arch' | 'builder' | 'reviewer' | 'complete';

/**
 * Render the pipeline visualization showing current progress
 */
function renderPipeline(currentPhase: PipelinePhase, completedPhases: PipelinePhase[] = []): string {
  const phases: { id: PipelinePhase; label: string; model: string }[] = [
    { id: 'interview', label: 'Interview', model: 'Claude Opus 4.5' },
    { id: 'council-spec', label: 'Council Review', model: 'Codex + Gemini' },
    { id: 'architect', label: 'Architect', model: 'GPT-5.2-Codex' },
    { id: 'council-arch', label: 'Council Review', model: 'Codex + Gemini' },
    { id: 'builder', label: 'Builder', model: 'Claude Opus 4.5' },
    { id: 'reviewer', label: 'Reviewer', model: 'Gemini 3' },
  ];

  let output = '\n' + chalk.gray('  ─────────────────────────────────────────\n');
  output += chalk.white.bold('  PIPELINE STATUS\n');
  output += chalk.gray('  ─────────────────────────────────────────\n\n');

  for (const phase of phases) {
    const isComplete = completedPhases.includes(phase.id);
    const isCurrent = phase.id === currentPhase;

    let status: string;
    let label: string;

    if (isComplete) {
      status = chalk.green('  ✓');
      label = chalk.gray(`${phase.label}`);
    } else if (isCurrent) {
      status = chalk.cyan('  ▶');
      label = chalk.white.bold(`${phase.label}`) + chalk.cyan(` ← YOU ARE HERE`);
    } else {
      status = chalk.gray('  ○');
      label = chalk.gray(`${phase.label}`);
    }

    output += `${status} ${label}\n`;
    output += chalk.gray(`      ${phase.model}\n\n`);
  }

  output += chalk.gray('  ─────────────────────────────────────────\n');
  return output;
}

/**
 * Render a phase completion banner
 */
function renderPhaseComplete(phase: string, artifact?: string): string {
  let output = '\n';
  output += chalk.green('  ╔═══════════════════════════════════════════════════════════╗\n');
  output += chalk.green('  ║') + chalk.green.bold(`  ✓ ${phase.toUpperCase()} COMPLETE`) + ' '.repeat(44 - phase.length) + chalk.green('║\n');
  output += chalk.green('  ╚═══════════════════════════════════════════════════════════╝\n');
  if (artifact) {
    output += chalk.gray(`\n  Created: ${artifact}\n`);
  }
  return output;
}

/**
 * Render what's happening next
 */
function renderNextStep(nextPhase: string, description: string, model: string): string {
  let output = '\n';
  output += chalk.white.bold(`  NEXT: ${nextPhase}\n\n`);
  output += chalk.gray(`  ${description}\n`);
  output += chalk.gray(`  Using: ${model}\n\n`);
  return output;
}

export class Orchestrator {
  private state: StateManager;
  private router: ModelRouter;
  private verbose: boolean;
  private spinner: Ora | null = null;

  constructor(options: OrchestratorOptions) {
    this.state = new StateManager(options.projectPath);
    this.router = new ModelRouter();
    this.verbose = options.verbose || false;
  }

  /**
   * Start a new project with user interview
   */
  async startNew(initialPrompt: string): Promise<void> {
    console.log(chalk.blue('\n🏗️  Starting new project...\n'));

    // Wait for CLI detection to complete
    await this.router.ensureInitialized();

    // Check CLI auth status before starting
    const authCheck = await this.checkCLIHealth();
    if (!authCheck) {
      return; // User chose not to proceed
    }

    // Initialize GitHub if configured
    this.initGitHub();
    if (this.state.isGitHubEnabled()) {
      const config = this.state.getGitHubConfig();
      console.log(chalk.gray(`GitHub: ${config?.repoUrl}`));
      if (config?.projectUrl) {
        console.log(chalk.gray(`Board: ${config.projectUrl}`));
      }
      console.log();
    }

    // Check available CLI tools
    const providers = this.router.getAvailableProviders();
    if (providers.length === 0) {
      console.log(chalk.red('Error: No CLI tools found.'));
      console.log('Please install at least one CLI tool:');
      console.log('  - npm i -g @openai/codex        (ChatGPT Pro)');
      console.log('  - npm i -g @anthropic-ai/claude-code (Claude Max)');
      console.log('  - npm i -g @google/gemini-cli   (Google account)');
      console.log('\nRun: agentic setup for full instructions.');
      return;
    }

    console.log(chalk.gray(`Available CLI tools: ${providers.join(', ')}\n`));

    // Start with interview phase (uses Claude Code interactive mode)
    await this.runInterviewPhase(initialPrompt);
  }

  /**
   * Continue from where we left off
   */
  async continue(): Promise<void> {
    await this.router.ensureInitialized();

    // Check CLI auth status before continuing
    const authCheck = await this.checkCLIHealth();
    if (!authCheck) {
      return; // User chose not to proceed
    }

    this.initGitHub();
    const currentPhase = this.state.getCurrentPhase();
    console.log(chalk.blue(`\n📍 Continuing from ${currentPhase} phase...\n`));

    switch (currentPhase) {
      case 'interviewer':
        await this.runInterviewPhase();
        break;
      case 'architect':
        await this.runArchitectPhase();
        break;
      case 'builder':
        await this.runBuilderPhase();
        break;
      case 'reviewer':
        await this.runReviewerPhase();
        break;
      case 'complete':
        console.log(chalk.green('✅ Project is complete!'));
        break;
    }
  }

  /**
   * Run the interview phase (interactive Claude Code with AskUserQuestion)
   */
  async runInterviewPhase(initialPrompt?: string): Promise<void> {
    this.state.setPhase('interviewer');

    console.log(chalk.yellow('🎤 INTERVIEW PHASE\n'));
    console.log(chalk.gray('Claude Code will interview you to understand your requirements.'));
    console.log(chalk.gray('This uses AskUserQuestion for structured information gathering.\n'));
    console.log(chalk.cyan('Using: Claude Opus 4.5 (interactive mode)\n'));

    // Check for relevant learnings from past projects
    initLearningRegistry();
    const stats = getLearningStats();
    let learningsContext = '';

    if (stats.total > 0 && initialPrompt) {
      // Extract tech-related keywords from the prompt
      const keywords = initialPrompt.toLowerCase().split(/[\s,.\-_()[\]]+/).filter(w => w.length > 3);
      const relevantLearnings = queryRelevantLearnings(keywords, initialPrompt, 3);

      if (relevantLearnings.length > 0) {
        console.log(chalk.blue(`🎓 Found ${relevantLearnings.length} relevant learnings from past projects:`));
        for (const learning of relevantLearnings) {
          console.log(chalk.gray(`  - ${learning.title} (${learning.category})`));
        }
        console.log();

        learningsContext = formatLearningsForPrompt(relevantLearnings);
      }
    }

    // Build the interview prompt
    const interviewPrompt = `You are a friendly product consultant helping define a software project.

CRITICAL: The user is non-technical. This means:
- Do NOT ask them to MAKE technical decisions ("Should we use React or Vue?")
- DO ask about existing things they have or need to integrate with (APIs, models, tools, data)
- Focus on WHAT they want and WHY, not HOW to build it
- Make architectural decisions yourself - don't burden them with choices they can't meaningfully make
- If something technical affects their experience, explain it simply and recommend an option
- If they mention technical things they have (APIs, models, datasets), ask clarifying questions to understand them

Your goal is to create a SPEC.md document by understanding:
1. What problem they're solving
2. Who will use this
3. What it should DO (features, behaviors, user experience)
4. What success looks like
5. Any constraints (timeline, existing tools to integrate with)
6. What type of project this is (web, mobile, desktop, CLI, backend, etc.)

Use AskUserQuestion for:
- Clarifying what they want ("Which of these matters more to you?")
- Confirming your understanding ("Does this capture what you're looking for?")
- Prioritizing features

Do NOT use AskUserQuestion to ask:
- "What framework should we use?"
- "Do you prefer REST or GraphQL?"
- Any technical implementation questions

Before creating the spec, ask what they want to call this project:
"What should we call this project? (This helps you find it later)"
If they skip, generate a short name from the description (e.g., "heart-rate-tracker").

When you have enough information, create .skunkworks/SPEC.md with:
- Project name as the title: "# [Name] - Product Specification"
- Overview (plain language description)
- Target Users
- User Stories ("Users can...")
- Success Criteria (observable outcomes)
- Constraints
- Out of Scope
- Notes for Technical Team (things YOU inferred, not things they told you)

CRITICAL: DO NOT BUILD CODE.
Your ONLY job is to create SPEC.md. You are the Interviewer, not the Builder.
If the user says "build it", "let's build", or similar:
1. Do NOT write any code or create project files
2. Confirm you've captured their requirements in SPEC.md
3. Say: "I've captured everything in the spec. The building happens automatically in the next phase."
After creating SPEC.md, your job is DONE. Do not continue to the next step yourself.

${initialPrompt ? `\nThe user's initial project idea: "${initialPrompt}"` : ''}

${learningsContext ? `\n## Relevant Learnings from Past Projects\n\nThese learnings may be helpful when designing this project:\n\n${learningsContext}` : ''}

Start by understanding their vision. Be conversational and friendly.`;

    console.log(chalk.gray('Launching Claude Code in interactive mode...\n'));
    console.log(chalk.gray('-------------------------------------------\n'));

    try {
      // Run Claude Code interactively
      await this.router.runInteractive(interviewPrompt, this.state.getProjectPath());

      console.log(chalk.gray('\n-------------------------------------------'));

      // Validate phase boundary - Interview should only create SPEC.md
      const violation = await this.validateInterviewOutputs();
      if (violation) {
        console.log(chalk.red('\n⚠️  Phase Boundary Violation Detected\n'));
        console.log(chalk.yellow(`  The Interview phase created unauthorized files:`));
        console.log(chalk.gray(`  ${violation.files.join('\n  ')}\n`));
        console.log(chalk.yellow('  The Interview phase should ONLY create SPEC.md.'));
        console.log(chalk.yellow('  These files have been removed. Please run the interview again.\n'));

        // Clean up unauthorized files
        for (const file of violation.files) {
          try {
            fs.unlinkSync(path.join(this.state.getProjectPath(), file));
          } catch {
            // Ignore cleanup errors
          }
        }
        return;
      }

      // Check if SPEC.md was created
      const spec = this.state.getSpec();
      if (spec) {
        // Extract project name from spec and update registry
        const projectName = this.extractProjectName(spec);
        if (projectName) {
          const { updateProjectName } = await import('../dashboard/registry.js');
          updateProjectName(this.state.getProjectPath(), projectName);
          console.log(chalk.blue(`\n  Project: ${projectName}\n`));
        }

        // Extract and store project types
        const projectTypes = this.extractProjectTypes(spec);
        if (projectTypes.length > 0) {
          this.state.setProjectTypes(projectTypes);
          console.log(chalk.gray(`  Type: ${projectTypes.join(', ')}\n`));

          // Check platform compatibility
          const compatibility = this.checkPlatformCompatibility(projectTypes);
          if (!compatibility.compatible) {
            console.log(chalk.red(`\n⚠️  Platform Compatibility Issue\n`));
            console.log(chalk.white(`  ${compatibility.message}\n`));

            if (compatibility.suggestions && compatibility.suggestions.length > 0) {
              console.log(chalk.gray('  Suggestions:'));
              for (const suggestion of compatibility.suggestions) {
                console.log(chalk.white(`    • ${suggestion}`));
              }
              console.log();
            }

            // Ask if user wants to continue anyway
            const readline = await import('readline');
            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const proceed = await new Promise<boolean>((resolve) => {
              rl.question(chalk.yellow('  Continue anyway? (y/N): '), (answer) => {
                rl.close();
                resolve(answer.toLowerCase() === 'y');
              });
            });

            if (!proceed) {
              console.log(chalk.gray('\n  Paused. Consider changing project type or using a compatible machine.\n'));
              return;
            }
          }
        }

        // Show phase completion banner
        console.log(renderPhaseComplete('Interview', '.skunkworks/SPEC.md'));

        // Show pipeline status
        console.log(renderPipeline('council-spec', ['interview']));

        // Show what's next
        console.log(renderNextStep(
          'Council Review',
          'Multiple AI models will review your spec to catch\n  any gaps or unclear requirements before we design the system.',
          'Codex + Gemini (in parallel)'
        ));

        // Prompt user to continue
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const continueToCouncil = await new Promise<boolean>((resolve) => {
          rl.question(chalk.green('  Press Enter to continue (or "q" to stop here): '), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() !== 'q');
          });
        });

        if (!continueToCouncil) {
          console.log(chalk.gray('\n  Paused. Run "skunkcontinue" to resume.\n'));
          return;
        }

        // Run council review on the spec before moving to architect
        const proceed = await this.runCouncilReviewSpec(spec);

        if (proceed) {
          // Show transition to architect
          console.log(renderPhaseComplete('Council Review (Spec)', '.skunkworks/COUNCIL_FEEDBACK_SPEC.md'));
          console.log(renderPipeline('architect', ['interview', 'council-spec']));
          console.log(renderNextStep(
            'Architect',
            'GPT-5.2-Codex will design the system architecture\n  and create a detailed implementation plan.',
            'GPT-5.2-Codex (Extra High reasoning)'
          ));

          this.state.setPhase('architect');
          await this.runArchitectPhase();
        }
        // If not proceeding, user wants to revise - don't advance phase
      } else {
        console.log(chalk.yellow('\n⚠️  No SPEC.md found. Run "skunkinterview" to continue.\n'));
      }
    } catch (error) {
      console.log(chalk.red(`\nInterview phase error: ${error}`));
      console.log(chalk.yellow('Run "skunkcontinue" to try again.'));
    }
  }

  /**
   * Run just the architect phase (uses GPT-5.2-Codex)
   */
  async runArchitectPhase(initialPrompt?: string): Promise<void> {
    this.state.setPhase('architect');
    const systemPrompt = loadPrompt('architect');

    console.log(chalk.yellow('📐 ARCHITECT PHASE\n'));
    console.log(chalk.cyan('Using: GPT-5.2-Codex Extra High reasoning\n'));

    // Query relevant learnings for architecture
    initLearningRegistry();
    let archLearningsContext = '';
    const existingSpec = this.state.getSpec();

    if (existingSpec) {
      // Extract tech keywords from spec
      const specKeywords = existingSpec.toLowerCase().split(/[\s,.\-_()[\]]+/).filter(w => w.length > 3);
      const archLearnings = queryRelevantLearnings(specKeywords, existingSpec, 5);

      if (archLearnings.length > 0) {
        console.log(chalk.blue(`🎓 Found ${archLearnings.length} relevant learnings for architecture:`));
        for (const learning of archLearnings) {
          console.log(chalk.gray(`  - ${learning.title} (${learning.category})`));
        }
        console.log();

        archLearningsContext = formatLearningsForPrompt(archLearnings);
      }
    }

    const messages: Message[] = [];

    // Check if we have a SPEC.md from the interview phase
    if (existingSpec) {
      console.log(chalk.green('📄 Found SPEC.md from interview phase.\n'));
      messages.push({
        role: 'user',
        content: `Here is the project specification from the requirements interview:

${existingSpec}

${archLearningsContext ? `\n## Learnings from Past Projects\n\nConsider these learnings when designing the architecture:\n\n${archLearningsContext}` : ''}

Based on this specification, please:
1. Design the system architecture
2. Create ARCHITECTURE.md with component diagrams and design decisions
3. Create a detailed TODO.md with implementation tasks

IMPORTANT: The user is non-technical. Do NOT ask them technical questions like "Should we use X or Y framework?" - make those decisions yourself based on the requirements. You are the expert architect; use your expertise to make good choices and document them.

Focus on creating a clear, implementable architecture. When you're done, type "done" to proceed.`,
      });
    } else if (initialPrompt) {
      messages.push({
        role: 'user',
        content: `I want to build: ${initialPrompt}

Please design the architecture and create a detailed implementation plan.

IMPORTANT: The user is non-technical. Do NOT ask them technical questions - make architectural decisions yourself based on the requirements. You are the expert.`,
      });
    } else {
      console.log(chalk.yellow('⚠️  No SPEC.md found. Consider running "skunkinterview" first.\n'));
      messages.push({
        role: 'user',
        content: `Please help me design a software architecture based on requirements I'll provide.

IMPORTANT: The user is non-technical. Do NOT ask technical questions like "Should we use React or Vue?" - if you need to understand the project better, ask about what they want to achieve, not how to build it.`,
      });
    }

    // Non-interactive conversation with Codex
    await this.conversationLoop('architect', systemPrompt, messages);
  }

  /**
   * Run just the builder phase
   * Automatically detects if chunked building is available
   */
  async runBuilderPhase(): Promise<void> {
    this.state.setPhase('builder');

    console.log(chalk.yellow('\n🔨 BUILDER PHASE\n'));

    // Load context
    const spec = this.state.getSpec();
    const architecture = this.state.getArchitecture();

    if (!spec) {
      console.log(chalk.red('No specification found. Please run architect phase first.'));
      return;
    }

    // Check for missing dependencies before building
    if (architecture) {
      const depResult = await this.checkDependencies(architecture);
      if (depResult === 'pause') {
        console.log(chalk.gray('\nPaused. Run "skunkcontinue" after installing dependencies.\n'));
        return;
      }
    }

    // Check for implementation phases in architecture
    if (architecture) {
      const phases = this.state.parsePhases(architecture);
      if (phases.length > 0) {
        console.log(chalk.blue(`📦 Found ${phases.length} implementation phases. Using chunked building.\n`));
        await this.runChunkedBuilderPhase(phases);
        return;
      }
    }

    // Fall back to non-chunked building
    console.log(chalk.gray('No implementation phases found. Using single-pass building.\n'));
    await this.runSinglePassBuilder();
  }

  /**
   * Run chunked builder - implements one phase at a time with verification
   */
  private async runChunkedBuilderPhase(phases: ChunkPhase[]): Promise<void> {
    // Initialize chunk state if not already
    if (!this.state.getChunks()) {
      this.state.initializeChunks(phases);
    }

    const spec = this.state.getSpec()!;
    const architecture = this.state.getArchitecture()!;
    const designSpec = this.state.getDesignSpec();
    const totalPhases = phases.length;

    // Resume from current phase
    while (!this.state.isChunkedBuildComplete()) {
      const currentPhase = this.state.getCurrentChunkPhase();
      if (!currentPhase) break;

      const phaseIndex = this.state.getCurrentChunkPhaseIndex();

      console.log(chalk.blue.bold(`\n━━━ Phase ${phaseIndex + 1} of ${totalPhases}: ${currentPhase.name} ━━━\n`));
      console.log(chalk.gray(`Goal: ${currentPhase.goal}`));
      console.log(chalk.gray(`Tasks: ${currentPhase.tasks.length}`));
      console.log(chalk.gray(`Verification: ${currentPhase.isMilestone ? 'Full (milestone)' : 'Tests only'}\n`));

      // Mark phase as in progress
      this.state.setChunkPhaseStatus('in_progress');

      // Build context for this phase
      let phaseContext: string;
      let compressionApplied = false;

      if (phaseIndex === 0) {
        // First phase - use initial context (no compression needed)
        phaseContext = generateInitialContext(spec, architecture, designSpec, currentPhase);
      } else {
        // Subsequent phases - check if compression is needed
        const savedContext = this.state.getChunkContext();
        const parsedContext = savedContext ? deserializeContext(savedContext) : null;

        // Generate uncompressed context first to check size
        const uncompressedContext = generatePhaseContext(
          parsedContext || { completedPhases: [], fileMap: {}, architecturalDecisions: [], knownIssues: [] },
          phaseIndex,
          totalPhases,
          currentPhase,
          spec,
          designSpec
        );

        // Check if compression is beneficial
        if (shouldCompress(uncompressedContext)) {
          const { context: compressedContext, compressionStats } = generateCompressedPhaseContext(
            parsedContext,
            phaseIndex,
            totalPhases,
            currentPhase,
            spec,
            architecture,
            designSpec
          );
          phaseContext = compressedContext;
          compressionApplied = true;

          if (compressionStats.savedTokens > 0) {
            console.log(chalk.gray(`  📦 Context compressed: saved ~${compressionStats.savedTokens} tokens`));
            for (const detail of compressionStats.sectionsCompressed.slice(0, 2)) {
              console.log(chalk.gray(`     ${detail}`));
            }
            console.log();
          }
        } else {
          phaseContext = uncompressedContext;
        }
      }

      // Display context health indicator
      const healthIndicator = getHealthIndicator(phaseContext);
      console.log(healthIndicator);

      // Run builder for this phase
      console.log(chalk.cyan('Launching Claude Code for this phase...\n'));
      const builderOutput = await this.runSinglePhaseBuilder(currentPhase, phaseContext);

      // Run verification (using project-type-specific test commands)
      const verificationLevel: VerificationLevel = currentPhase.isMilestone ? 'full' : 'tests';
      const projectTypes = this.state.getProjectTypes();
      let verifyResult = await runChunkVerification(
        this.state.getProjectPath(),
        verificationLevel,
        spec,
        projectTypes
      );

      // Handle verification failure with auto-fix
      if (!verifyResult.passed) {
        console.log(chalk.yellow('\n⚠️  Verification failed. Attempting auto-fix...\n'));

        const previousAttempts: string[] = [];
        let fixed = false;

        while (this.state.incrementFixAttempt() <= 2) {
          const attemptNum = this.state.getCurrentChunkPhase()?.fixAttempts ?? 1;
          console.log(chalk.gray(`Fix attempt ${attemptNum} of 2...\n`));

          // Generate fix context with compression to avoid context bloat
          const baseFixContext = formatVerificationForFix(verifyResult, attemptNum, previousAttempts);
          const fixContext = compressFixContext(phaseContext, verifyResult.errorOutput, attemptNum, previousAttempts);

          // Display fix context health
          const fixHealthIndicator = getHealthIndicator(fixContext);
          console.log(chalk.gray('Fix context: ') + fixHealthIndicator);

          // Run builder with fix context
          const fixOutput = await this.runFixAttempt(currentPhase, fixContext);
          previousAttempts.push(fixOutput);

          // Re-verify
          verifyResult = await runChunkVerification(
            this.state.getProjectPath(),
            verificationLevel,
            spec,
            projectTypes
          );

          if (verifyResult.passed) {
            fixed = true;
            console.log(chalk.green('\n✅ Fix successful!\n'));
            break;
          }
        }

        if (!fixed) {
          this.state.markChunkPhaseFailed();

          // Provide better recovery UX
          const recoveryChoice = await this.showRecoveryOptions(
            currentPhase.name,
            verifyResult.errorOutput,
            previousAttempts
          );

          if (recoveryChoice === 'pause') {
            // Save the error context for manual debugging
            const errorContext = `# Build Stopped - Manual Fix Required

## Phase
${currentPhase.name}

## Verification Failures
${verifyResult.errorOutput}

## Previous Fix Attempts
${previousAttempts.map((a, i) => `### Attempt ${i + 1}\n${a.slice(0, 1000)}`).join('\n\n')}
`;
            this.state.saveChunkContext(errorContext);
            return;
          } else if (recoveryChoice === 'skip') {
            console.log(chalk.yellow('\n⚠️  Skipping this phase. Continuing with next phase...\n'));
            this.state.setChunkPhaseStatus('completed');
            this.state.resetFixAttempts();
            this.state.advanceChunkPhase();
            continue;
          } else if (recoveryChoice === 'retry') {
            // Reset and try from scratch
            this.state.resetFixAttempts();
            continue;
          }
          return;
        }
      }

      // Phase passed - update context for next phase
      console.log(chalk.green(`\n✅ Phase ${phaseIndex + 1} complete!\n`));

      // Generate and save context summary
      const savedContext = this.state.getChunkContext();
      const existingContext = savedContext ? deserializeContext(savedContext) : null;
      const updatedContext = updateContextAfterPhase(existingContext, currentPhase, builderOutput);
      this.state.saveChunkContext(serializeContext(updatedContext));

      // Mark phase complete and advance
      this.state.setChunkPhaseStatus('completed');
      this.state.resetFixAttempts();
      this.state.advanceChunkPhase();

      // Create checkpoint after successful phase
      this.state.createCheckpoint(`chunk_phase_${phaseIndex + 1}_complete`);
    }

    // Show builder completion
    console.log(renderPhaseComplete('Builder', 'Your project code'));
    console.log(renderPipeline('reviewer', ['interview', 'council-spec', 'architect', 'council-arch', 'builder']));
    console.log(renderNextStep(
      'Reviewer',
      'Gemini 3 will review the implementation for bugs,\n  security issues, and spec compliance.',
      'Gemini 3 Flash'
    ));
    await this.runReviewerPhase();
  }

  /**
   * Run builder for a single phase
   */
  private async runSinglePhaseBuilder(phase: ChunkPhase, context: string): Promise<string> {
    const systemPrompt = loadPrompt('builder');

    const messages: Message[] = [
      {
        role: 'user',
        content: `${context}

Please implement ONLY the tasks listed for this phase. Do not implement tasks from other phases.

When you complete all tasks, say "PHASE COMPLETE" and list:
1. Files created
2. Files modified
3. Key decisions made
4. Design tokens used`,
      },
    ];

    // Non-interactive execution for chunked building
    this.spinner = ora({
      text: `Building phase: ${phase.name}...`,
      color: 'cyan',
    }).start();

    const result = await this.router.complete('builder', {
      messages,
      systemPrompt,
      workingDir: this.state.getProjectPath(),
    });

    this.spinner.stop();

    // Display output
    console.log(chalk.cyan('\n[BUILDER]:'));
    console.log(result.content);

    return result.content;
  }

  /**
   * Run a fix attempt for a failed phase
   */
  private async runFixAttempt(phase: ChunkPhase, fixContext: string): Promise<string> {
    const systemPrompt = loadPrompt('builder');

    const messages: Message[] = [
      {
        role: 'user',
        content: fixContext,
      },
    ];

    this.spinner = ora({
      text: `Attempting fix for ${phase.name}...`,
      color: 'yellow',
    }).start();

    const result = await this.router.complete('builder', {
      messages,
      systemPrompt,
      workingDir: this.state.getProjectPath(),
    });

    this.spinner.stop();

    console.log(chalk.yellow('\n[FIX ATTEMPT]:'));
    console.log(result.content);

    return result.content;
  }

  /**
   * Run builder without chunking (legacy single-pass mode)
   */
  private async runSinglePassBuilder(): Promise<void> {
    const systemPrompt = loadPrompt('builder');
    const spec = this.state.getSpec();
    const architecture = this.state.getArchitecture();
    const todos = this.state.getPendingTodos('builder');

    // Get design spec if available
    const designSpec = this.state.getDesignSpec();
    const designContext = designSpec
      ? `## Design System
The following DESIGN_SPEC.yaml defines all visual tokens. You MUST use these tokens - no hardcoded values.

\`\`\`yaml
${designSpec}
\`\`\`

**Critical:** Never use raw hex colors, arbitrary pixel values, or non-token font sizes. All visual values must come from the design spec above.
`
      : '';

    const contextMessage = `
## Project Specification
${spec}

## Architecture
${architecture || 'No architecture document yet.'}

${designContext}

## Pending Tasks
${todos.map(t => `- [ ] ${t.task}`).join('\n') || 'No pending tasks.'}

Please implement the pending tasks. For each task:
1. Announce what you're working on
2. Check what design tokens you need from DESIGN_SPEC.yaml
3. Write the code using ONLY tokens from the spec
4. Mark the task complete
5. Move to the next task
`;

    const messages: Message[] = [
      { role: 'user', content: contextMessage },
    ];

    await this.conversationLoop('builder', systemPrompt, messages);
  }

  /**
   * Run just the reviewer phase
   */
  async runReviewerPhase(): Promise<void> {
    this.state.setPhase('reviewer');
    const systemPrompt = loadPrompt('reviewer');

    console.log(chalk.yellow('\n🔍 REVIEWER PHASE\n'));
    console.log(chalk.gray('Using a different model to catch errors the builder might miss.\n'));

    const spec = this.state.getSpec();
    const projectPath = this.state.getProjectPath();

    if (!spec) {
      console.log(chalk.red('No specification found. Nothing to review.'));
      return;
    }

    // Run test verification before review
    let testContext = '';
    if (await hasTestScript(projectPath)) {
      console.log(chalk.blue('🧪 Running test verification...\n'));
      const testResult = await runTests(projectPath);
      testContext = formatTestResultsForContext(testResult);

      if (testResult.passed) {
        console.log(chalk.green('  ✓ Tests passing\n'));
      } else {
        console.log(chalk.red('  ✗ Tests failing\n'));
      }
    } else {
      console.log(chalk.gray('No test script found, skipping test verification.\n'));
      testContext = `## Test Results

**Status:** No tests configured

The project does not have a test script in package.json. Consider recommending that tests be added.
`;
    }

    // Run visual verification if dev server exists
    let visualContext = '';
    if (hasDevServer(projectPath)) {
      console.log(chalk.blue('📸 Running visual verification...\n'));
      try {
        const visualResult = await runVisualVerification(projectPath, spec);
        visualContext = formatVisualResultsForContext(visualResult);

        if (visualResult.success) {
          console.log(chalk.green('  ✓ Visual verification complete\n'));
        } else {
          console.log(chalk.yellow(`  ⚠ Visual verification: ${visualResult.error}\n`));
        }
      } catch (error: any) {
        console.log(chalk.yellow(`  ⚠ Visual verification skipped: ${error.message}\n`));
        visualContext = `## Visual Verification

**Status:** Skipped
**Reason:** ${error.message}

Visual verification could not be completed.
`;
      }
    } else {
      console.log(chalk.gray('No dev server found, skipping visual verification.\n'));
    }

    // Run design/accessibility verification with /rams
    let designContext = '';
    console.log(chalk.blue('🎨 Running design & accessibility review (/rams)...\n'));
    try {
      const designResult = await runDesignVerification(projectPath);
      designContext = formatDesignResultsForContext(designResult);

      if (designResult.ran) {
        if (designResult.score !== null) {
          const scoreEmoji = designResult.score >= 90 ? '🟢' : designResult.score >= 70 ? '🟡' : '🔴';
          console.log(chalk.green(`  ✓ Design score: ${scoreEmoji} ${designResult.score}/100\n`));
        } else {
          console.log(chalk.green('  ✓ Design review complete\n'));
        }
      } else {
        console.log(chalk.yellow(`  ⚠ Design review: ${designResult.error}\n`));
      }
    } catch (error: any) {
      console.log(chalk.yellow(`  ⚠ Design review skipped: ${error.message}\n`));
      designContext = `## Design & Accessibility Review

**Status:** Skipped
**Reason:** ${error.message}

Design verification could not be completed.
`;
    }

    // Get design spec for compliance checking
    const designSpec = this.state.getDesignSpec();
    const designSpecContext = designSpec
      ? `## Design System (DESIGN_SPEC.yaml)
Check the implementation against these tokens:

\`\`\`yaml
${designSpec}
\`\`\`

Use this to verify: no hardcoded colors, spacing values from token scale, typography from scale, etc.
`
      : '';

    const contextMessage = `
## Original Specification
${spec}

## Architecture
${this.state.getArchitecture() || 'No architecture document.'}

${designSpecContext}

${testContext}

${visualContext}

${designContext}

Please review the implementation against the specification:
1. Check each requirement is implemented
2. Look for bugs and issues
3. Check code quality
4. Identify security concerns
5. Suggest improvements
6. ${testContext.includes('PASSING') || testContext.includes('FAILING') ? 'Review test results and coverage' : 'Note that no tests exist and recommend adding them'}
7. ${visualContext.includes('Complete') ? 'Consider the visual verification findings' : 'Note that visual verification was not available'}
8. ${designContext.includes('Complete') ? 'Address accessibility and design issues from /rams review' : 'Note that design verification was not available'}
9. ${designSpecContext ? 'Check design system compliance: no hardcoded values, correct token usage, semantic HTML, complete component states' : 'Note that no design spec was found'}

Produce a detailed REVIEW.md document with a Design System Compliance section.
`;

    const messages: Message[] = [
      { role: 'user', content: contextMessage },
    ];

    await this.conversationLoop('reviewer', systemPrompt, messages);
  }

  /**
   * Interactive conversation with an agent
   */
  private async conversationLoop(
    phase: AgentPhase,
    systemPrompt: string,
    initialMessages: Message[]
  ): Promise<void> {
    const messages = [...initialMessages];
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

    try {
      while (true) {
        // Get response from AI
        this.spinner = ora({
          text: `${phase} is thinking...`,
          color: 'cyan',
        }).start();

        const result = await this.router.complete(phase, {
          messages,
          systemPrompt,
          workingDir: this.state.getProjectPath(),
        });

        this.spinner.stop();

        // Display response
        console.log(chalk.cyan(`\n[${phase.toUpperCase()}]:`));
        console.log(result.content);
        console.log();

        // Check for special commands in response
        if (this.detectArtifact(result.content, 'SPEC.md')) {
          const specContent = this.extractArtifact(result.content, 'SPEC.md');
          if (specContent) {
            this.state.saveSpec(specContent);
            console.log(chalk.green('📄 Saved SPEC.md'));
            await this.pushToGitHub('Add SPEC.md');
          }
        }

        if (this.detectArtifact(result.content, 'ARCHITECTURE.md')) {
          const archContent = this.extractArtifact(result.content, 'ARCHITECTURE.md');
          if (archContent) {
            this.state.saveArchitecture(archContent);
            console.log(chalk.green('📄 Saved ARCHITECTURE.md'));
            await this.pushToGitHub('Add ARCHITECTURE.md');
          }
        }

        if (this.detectArtifact(result.content, 'REVIEW.md')) {
          const reviewContent = this.extractArtifact(result.content, 'REVIEW.md');
          if (reviewContent) {
            this.state.saveReview(reviewContent);
            console.log(chalk.green('📄 Saved REVIEW.md'));
            await this.pushToGitHub('Add REVIEW.md');
          }
        }

        if (this.detectArtifact(result.content, 'DESIGN_SPEC.yaml') || this.detectArtifact(result.content, 'DESIGN_SPEC')) {
          const designContent = this.extractYamlArtifact(result.content);
          if (designContent) {
            this.state.saveDesignSpec(designContent);
            console.log(chalk.green('🎨 Saved DESIGN_SPEC.yaml'));
            await this.pushToGitHub('Add DESIGN_SPEC.yaml');
          }
        }

        // Add assistant response to history
        messages.push({ role: 'assistant', content: result.content });

        // Get user input
        const userInput = await askQuestion(chalk.green('\nYou: '));

        // Check for exit commands
        if (['exit', 'quit', 'done', 'next'].includes(userInput.toLowerCase().trim())) {
          console.log(chalk.gray('\nEnding conversation...'));

          // Create checkpoint
          this.state.createCheckpoint(`${phase}_complete`);

          // Move to next phase
          if (phase === 'architect') {
            // Show architect completion
            console.log(renderPhaseComplete('Architect', '.skunkworks/ARCHITECTURE.md'));
            console.log(renderPipeline('council-arch', ['interview', 'council-spec', 'architect']));

            // Run council review on the architecture before moving to builder
            const architecture = this.state.getArchitecture();
            if (architecture) {
              await this.runCouncilReview(architecture);
            }

            // Show transition to builder
            console.log(renderPhaseComplete('Council Review (Architecture)', '.skunkworks/COUNCIL_FEEDBACK.md'));
            console.log(renderPipeline('builder', ['interview', 'council-spec', 'architect', 'council-arch']));
            console.log(renderNextStep(
              'Builder',
              'Claude Opus 4.5 will implement the code based on\n  the architecture. This is where your project gets built.',
              'Claude Opus 4.5'
            ));

            this.state.setPhase('builder');
          } else if (phase === 'builder') {
            // Show builder completion
            console.log(renderPhaseComplete('Builder', 'Your project code'));
            console.log(renderPipeline('reviewer', ['interview', 'council-spec', 'architect', 'council-arch', 'builder']));
            console.log(renderNextStep(
              'Reviewer',
              'Gemini 3 will review the implementation for bugs,\n  security issues, and spec compliance.',
              'Gemini 3 Flash'
            ));

            this.state.setPhase('reviewer');
          } else if (phase === 'reviewer') {
            // Show final completion
            console.log(renderPhaseComplete('Reviewer', '.skunkworks/REVIEW.md'));

            console.log('\n');
            console.log(chalk.green.bold('  ╔═══════════════════════════════════════════════════════════╗'));
            console.log(chalk.green.bold('  ║                                                           ║'));
            console.log(chalk.green.bold('  ║              🎉  PROJECT COMPLETE!  🎉                    ║'));
            console.log(chalk.green.bold('  ║                                                           ║'));
            console.log(chalk.green.bold('  ╚═══════════════════════════════════════════════════════════╝'));
            console.log('\n');
            console.log(chalk.white('  Your project has been:'));
            console.log(chalk.gray('    ✓ Specified (SPEC.md)'));
            console.log(chalk.gray('    ✓ Reviewed by council (COUNCIL_FEEDBACK_SPEC.md)'));
            console.log(chalk.gray('    ✓ Architected (ARCHITECTURE.md)'));
            console.log(chalk.gray('    ✓ Reviewed by council (COUNCIL_FEEDBACK.md)'));
            console.log(chalk.gray('    ✓ Built (your code)'));
            console.log(chalk.gray('    ✓ Reviewed (REVIEW.md)'));
            console.log('\n');

            this.state.setPhase('complete');

            // Auto-capture learnings
            await this.captureLearnings();
          }
          break;
        }

        // Add user message
        messages.push({ role: 'user', content: userInput });
      }
    } finally {
      rl.close();
    }
  }

  /**
   * Detect if response contains an artifact
   */
  private detectArtifact(content: string, artifactName: string): boolean {
    const patterns = [
      `## ${artifactName}`,
      `# ${artifactName}`,
      `\`\`\`${artifactName}`,
      `**${artifactName}**`,
    ];
    return patterns.some(p => content.includes(p));
  }

  /**
   * Extract artifact content from response
   */
  private extractArtifact(content: string, artifactName: string): string | null {
    // Try to find content between markers
    const startPatterns = [
      `## ${artifactName}\n`,
      `# ${artifactName}\n`,
      `\`\`\`markdown\n`,
      `\`\`\`\n`,
    ];

    for (const start of startPatterns) {
      const startIndex = content.indexOf(start);
      if (startIndex !== -1) {
        const contentStart = startIndex + start.length;
        // Find end (next ## or ``` or end of content)
        let endIndex = content.length;

        const endPatterns = ['\n## ', '\n# ', '\n```'];
        for (const end of endPatterns) {
          const idx = content.indexOf(end, contentStart);
          if (idx !== -1 && idx < endIndex) {
            endIndex = idx;
          }
        }

        return content.substring(contentStart, endIndex).trim();
      }
    }

    return null;
  }

  /**
   * Extract YAML artifact (like DESIGN_SPEC.yaml) from response
   */
  private extractYamlArtifact(content: string): string | null {
    // Look for YAML code block
    const yamlBlockMatch = content.match(/```ya?ml\n([\s\S]*?)```/);
    if (yamlBlockMatch) {
      return yamlBlockMatch[1].trim();
    }

    // Look for content after DESIGN_SPEC header
    const headerMatch = content.match(/##?\s*DESIGN_SPEC(?:\.yaml)?\s*\n([\s\S]*?)(?=\n##|\n```|$)/);
    if (headerMatch) {
      return headerMatch[1].trim();
    }

    return null;
  }

  /**
   * Show recovery options when a build fails
   */
  private async showRecoveryOptions(
    phaseName: string,
    errorOutput: string,
    previousAttempts: string[]
  ): Promise<'pause' | 'skip' | 'retry'> {
    console.log(chalk.red('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.red.bold('  Build Failed'));
    console.log(chalk.red('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // Categorize the error
    const errorCategory = this.categorizeError(errorOutput);
    console.log(chalk.white(`  Phase: ${phaseName}`));
    console.log(chalk.white(`  Issue: ${errorCategory.summary}\n`));

    if (errorCategory.suggestion) {
      console.log(chalk.cyan(`  💡 ${errorCategory.suggestion}\n`));
    }

    // Show truncated error
    const errorLines = errorOutput.split('\n').slice(0, 10);
    console.log(chalk.gray('  Error details:'));
    for (const line of errorLines) {
      console.log(chalk.gray(`    ${line.slice(0, 80)}`));
    }
    if (errorOutput.split('\n').length > 10) {
      console.log(chalk.gray('    ... (more in .skunkworks/CHUNK_CONTEXT.md)'));
    }
    console.log();

    // Options
    console.log(chalk.white('  What would you like to do?\n'));
    console.log(chalk.white('  [1] Pause and come back later'));
    console.log(chalk.gray('      Save progress and exit. Run "skunkcontinue" to resume.'));
    console.log();
    console.log(chalk.white('  [2] Skip this phase and continue'));
    console.log(chalk.gray('      Move to the next phase. Some features may not work.'));
    console.log();
    console.log(chalk.white('  [3] Try again from scratch'));
    console.log(chalk.gray('      Reset this phase and attempt to build it again.'));
    console.log();

    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(chalk.green('  Your choice [1]: '), (answer) => {
        rl.close();
        const choice = answer.trim() || '1';
        if (choice === '2') resolve('skip');
        else if (choice === '3') resolve('retry');
        else resolve('pause');
      });
    });
  }

  /**
   * Categorize an error to provide helpful context
   */
  private categorizeError(errorOutput: string): { summary: string; suggestion?: string } {
    const lower = errorOutput.toLowerCase();

    // Missing dependency
    if (lower.includes('cannot find module') || lower.includes('module not found')) {
      const match = errorOutput.match(/cannot find module ['"]([^'"]+)['"]/i);
      const module = match ? match[1] : 'a package';
      return {
        summary: `Missing dependency: ${module}`,
        suggestion: `Try running "npm install" or "npm install ${module}"`,
      };
    }

    // TypeScript errors
    if (lower.includes('ts') && (lower.includes('error') || lower.includes('cannot find name'))) {
      return {
        summary: 'TypeScript compilation error',
        suggestion: 'There may be a type mismatch or missing type definition.',
      };
    }

    // Test failures
    if (lower.includes('test failed') || lower.includes('assertion') || lower.includes('expect')) {
      return {
        summary: 'Test failures',
        suggestion: 'Some tests are not passing. The code may not match the expected behavior.',
      };
    }

    // Permission errors
    if (lower.includes('permission denied') || lower.includes('eacces')) {
      return {
        summary: 'Permission denied',
        suggestion: 'The build process cannot access a file or directory. Check file permissions.',
      };
    }

    // Network errors
    if (lower.includes('network') || lower.includes('enotfound') || lower.includes('timeout')) {
      return {
        summary: 'Network error',
        suggestion: 'Check your internet connection or try again later.',
      };
    }

    // Syntax errors
    if (lower.includes('syntaxerror') || lower.includes('unexpected token')) {
      return {
        summary: 'Syntax error in code',
        suggestion: 'There is a typo or formatting issue in the generated code.',
      };
    }

    // Default
    return {
      summary: 'Build or verification failed',
    };
  }

  /**
   * Check for missing dependencies and prompt user
   */
  private async checkDependencies(architectureContent: string): Promise<'continue' | 'pause'> {
    const required = detectRequiredRuntimes(architectureContent);
    if (required.length === 0) return 'continue';

    const missing = await checkMissingRuntimes(required);
    if (missing.length === 0) {
      console.log(chalk.green('✓ All required runtimes are installed\n'));
      return 'continue';
    }

    const readline = await import('readline');
    const choice = await promptForDependencies(missing, readline);

    if (choice === 'manual') {
      showInstallInstructions(missing);
      return 'pause';
    } else if (choice === 'skip') {
      console.log(chalk.yellow('\n⚠️  Continuing without required dependencies. Build may fail.\n'));
      return 'continue';
    }

    return 'continue';
  }

  /**
   * Validate that Interview phase only created allowed files
   * Returns violation details if unauthorized files were created
   */
  private async validateInterviewOutputs(): Promise<{ files: string[] } | null> {
    const projectPath = this.state.getProjectPath();
    const allowedFiles = [
      '.skunkworks/SPEC.md',
      '.skunkworks/state.json',
    ];

    // Code file extensions that should NOT be created during interview
    const codeExtensions = [
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.swift', '.kt', '.java', '.py', '.rb', '.go', '.rs',
      '.vue', '.svelte', '.html', '.css', '.scss', '.sass',
      '.json', '.yaml', '.yml', '.toml',  // Config files (except in .skunkworks)
    ];

    // Project config files that indicate code was created
    const projectConfigFiles = [
      'package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js',
      'Cargo.toml', 'go.mod', 'pyproject.toml', 'Gemfile',
      'Podfile', 'build.gradle', 'pom.xml',
    ];

    const violations: string[] = [];

    // Check for code files in project root (excluding .skunkworks and node_modules)
    const scanDir = (dir: string, relativePath: string = ''): void => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          // Skip allowed directories
          if (entry.isDirectory()) {
            if (entry.name === '.skunkworks' || entry.name === 'node_modules' || entry.name === '.git') {
              continue;
            }
            // New directories created during interview are suspicious
            scanDir(fullPath, relPath);
          } else {
            // Check if this is a code file
            const ext = path.extname(entry.name).toLowerCase();
            if (codeExtensions.includes(ext) && !relPath.startsWith('.skunkworks')) {
              violations.push(relPath);
            }
            // Check for project config files
            if (projectConfigFiles.includes(entry.name) && !relPath.startsWith('.skunkworks')) {
              violations.push(relPath);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    };

    // Only scan if this is a fresh interview (no existing code)
    // Check if there was already a package.json before interview
    const hadExistingCode = fs.existsSync(path.join(projectPath, 'package.json')) ||
                           fs.existsSync(path.join(projectPath, 'src'));

    if (!hadExistingCode) {
      scanDir(projectPath);
    }

    return violations.length > 0 ? { files: violations } : null;
  }

  /**
   * Extract project types from SPEC.md
   * Looks for "Project Type:" field or keywords in the content
   */
  private extractProjectTypes(specContent: string): import('./state.js').ProjectType[] {
    const types: import('./state.js').ProjectType[] = [];
    const content = specContent.toLowerCase();

    // Try to find explicit project type field
    const typeMatch = content.match(/project\s+type[:\s]+([^\n]+)/i);
    if (typeMatch) {
      const typeStr = typeMatch[1].toLowerCase();
      if (typeStr.includes('web')) types.push('web');
      if (typeStr.includes('ios') || typeStr.includes('iphone')) types.push('ios');
      if (typeStr.includes('android')) types.push('android');
      if (typeStr.includes('desktop')) types.push('desktop');
      if (typeStr.includes('cli') || typeStr.includes('command')) types.push('cli');
      if (typeStr.includes('backend') || typeStr.includes('api')) types.push('backend');
      if (typeStr.includes('library') || typeStr.includes('package')) types.push('library');
    }

    // If no explicit field, try to infer from content
    if (types.length === 0) {
      if (content.includes('ios app') || content.includes('iphone') || content.includes('swift')) {
        types.push('ios');
      }
      if (content.includes('android app')) {
        types.push('android');
      }
      if (content.includes('mobile app') && types.length === 0) {
        types.push('ios', 'android'); // Assume both if generic "mobile"
      }
      if (content.includes('website') || content.includes('web app') || content.includes('browser')) {
        types.push('web');
      }
      if (content.includes('command line') || content.includes('cli tool') || content.includes('terminal')) {
        types.push('cli');
      }
      if (content.includes('api') || content.includes('backend') || content.includes('server')) {
        types.push('backend');
      }
      if (content.includes('desktop app') || content.includes('electron')) {
        types.push('desktop');
      }
    }

    // Default to web if nothing detected
    if (types.length === 0) {
      types.push('web');
    }

    return [...new Set(types)]; // Remove duplicates
  }

  /**
   * Check if the current platform can build the detected project types
   */
  private checkPlatformCompatibility(projectTypes: import('./state.js').ProjectType[]): {
    compatible: boolean;
    message?: string;
    suggestions?: string[];
  } {
    const platform = process.platform; // 'darwin' | 'win32' | 'linux'

    // Platform requirements for each project type
    const requirements: Record<import('./state.js').ProjectType, {
      platforms: string[];
      reason: string;
      suggestions: string[];
    }> = {
      ios: {
        platforms: ['darwin'],
        reason: 'iOS apps require Xcode, which only runs on macOS.',
        suggestions: [
          'Use a Mac for iOS development',
          'Consider using a cloud-based Mac service (MacStadium, MacinCloud)',
          'Build a web app or PWA instead for cross-platform reach',
        ],
      },
      android: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'Android development works on all platforms.',
        suggestions: [],
      },
      web: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'Web development works on all platforms.',
        suggestions: [],
      },
      desktop: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'Desktop app development works on all platforms (though cross-compilation may have limits).',
        suggestions: [],
      },
      cli: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'CLI tools can be built on any platform.',
        suggestions: [],
      },
      backend: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'Backend development works on all platforms.',
        suggestions: [],
      },
      library: {
        platforms: ['darwin', 'win32', 'linux'],
        reason: 'Library development works on all platforms.',
        suggestions: [],
      },
    };

    // Check each project type
    for (const type of projectTypes) {
      const req = requirements[type];
      if (!req) continue;

      if (!req.platforms.includes(platform)) {
        const platformName = platform === 'darwin' ? 'macOS' :
                            platform === 'win32' ? 'Windows' : 'Linux';

        return {
          compatible: false,
          message: `${type.toUpperCase()} projects cannot be built on ${platformName}. ${req.reason}`,
          suggestions: req.suggestions,
        };
      }
    }

    return { compatible: true };
  }

  /**
   * Extract project name from SPEC.md
   * Looks for "# [Name] - Product Specification" or similar patterns
   */
  private extractProjectName(specContent: string): string | null {
    // Try to extract from title line: "# Project Name - Product Specification"
    const titleMatch = specContent.match(/^#\s+(.+?)\s*[-–—]\s*(?:Product\s+)?Specification/im);
    if (titleMatch) {
      return titleMatch[1].trim();
    }

    // Try simpler title: "# Project Name"
    const simpleMatch = specContent.match(/^#\s+(.+?)(?:\n|$)/m);
    if (simpleMatch) {
      const name = simpleMatch[1].trim();
      // Filter out generic titles
      if (!name.toLowerCase().includes('specification') && !name.toLowerCase().includes('spec')) {
        return name;
      }
    }

    // Try to find "Project Name:" or "Name:" in the content
    const nameMatch = specContent.match(/(?:Project\s+)?Name:\s*(.+?)(?:\n|$)/i);
    if (nameMatch) {
      return nameMatch[1].trim();
    }

    return null;
  }

  /**
   * Get current status
   */
  getStatus(): void {
    const state = this.state.getFullState();
    console.log(chalk.blue('\n📊 Project Status\n'));
    console.log(`Project: ${state.projectName}`);
    console.log(`Current Phase: ${state.currentPhase}`);
    console.log(`Created: ${state.createdAt}`);
    console.log(`Last Updated: ${state.lastUpdated}`);
    console.log();

    const pendingTodos = this.state.getPendingTodos();
    const completedTodos = state.todos.filter(t => t.status === 'completed');

    console.log(`Todos: ${completedTodos.length}/${state.todos.length} complete`);

    if (state.artifacts.spec) console.log('✅ SPEC.md exists');
    if (state.artifacts.architecture) console.log('✅ ARCHITECTURE.md exists');
    if (state.artifacts.review) console.log('✅ REVIEW.md exists');

    // GitHub status
    if (state.github?.isEnabled) {
      console.log();
      console.log(chalk.blue('GitHub Integration:'));
      console.log(`  Repo: ${state.github.repoUrl}`);
      if (state.github.projectUrl) {
        console.log(`  Board: ${state.github.projectUrl}`);
      }
    }
  }

  /**
   * Check CLI health/auth status before starting work
   * Returns true if OK to proceed, false if user wants to stop
   */
  private async checkCLIHealth(): Promise<boolean> {
    console.log(chalk.gray('Checking CLI health...'));

    const results = await this.router.checkAuthStatus();
    const issues = results.filter(r => r.status !== 'ok');

    if (issues.length === 0) {
      console.log(chalk.green('✓ All CLI tools healthy\n'));
      return true;
    }

    // Show issues
    console.log(chalk.yellow('\n⚠️  CLI Health Issues Detected:\n'));

    for (const issue of issues) {
      const icon = issue.status === 'needs_auth' ? '🔐' : '❌';
      console.log(chalk.white(`  ${icon} ${issue.cli}: ${issue.status}`));
      if (issue.message) {
        console.log(chalk.gray(`     ${issue.message.slice(0, 100)}...`));
      }
    }

    // If any need auth, warn but let user choose
    const needsAuth = issues.filter(r => r.status === 'needs_auth');
    if (needsAuth.length > 0) {
      console.log(chalk.yellow('\nSome CLI tools may need re-authentication.'));
      console.log(chalk.gray('The pipeline might fail if these tools require login mid-session.\n'));

      console.log(chalk.white('Options:'));
      console.log(chalk.white('  [1] Continue anyway (might work)'));
      console.log(chalk.white('  [2] Stop and fix auth issues first\n'));

      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.green('Your choice [1]: '), (input) => {
          rl.close();
          resolve(input.trim() || '1');
        });
      });

      if (answer === '2') {
        console.log(chalk.gray('\nTo fix auth issues:'));
        for (const issue of needsAuth) {
          if (issue.cli === 'claude-code') {
            console.log(chalk.white(`  claude: Run 'claude /login' to re-authenticate`));
          } else if (issue.cli === 'codex') {
            console.log(chalk.white(`  codex: Run 'codex auth login' to re-authenticate`));
          } else if (issue.cli === 'gemini') {
            console.log(chalk.white(`  gemini: Run 'gemini auth login' to re-authenticate`));
          }
        }
        console.log(chalk.gray('\nThen run skunkcontinue to resume.\n'));
        return false;
      }
    }

    return true;
  }

  /**
   * Initialize GitHub integration and load config
   */
  private initGitHub(): void {
    const config = this.state.getGitHubConfig();
    if (config?.isEnabled) {
      github.loadConfig(config);
    }
  }

  /**
   * Create GitHub issue for a todo item (if GitHub is enabled)
   */
  private async createGitHubIssue(todo: TodoItem): Promise<void> {
    if (!this.state.isGitHubEnabled()) return;

    try {
      const issue = await github.createIssue(
        todo.task,
        `Phase: ${todo.phase}\n\nCreated by Skunkworks`,
        [todo.phase]
      );
      console.log(chalk.gray(`  → Created GitHub issue #${issue.number}`));

      // Add to project board if configured
      const config = this.state.getGitHubConfig();
      if (config?.projectId) {
        await github.addIssueToProject(issue.number);
      }
    } catch (error) {
      // Silently ignore GitHub errors - don't block the workflow
    }
  }

  /**
   * Close GitHub issue when todo is completed
   */
  private async closeGitHubIssue(issueNumber: number, message: string): Promise<void> {
    if (!this.state.isGitHubEnabled()) return;

    try {
      await github.closeIssue(issueNumber, message);
      console.log(chalk.gray(`  → Closed GitHub issue #${issueNumber}`));
    } catch (error) {
      // Silently ignore GitHub errors
    }
  }

  /**
   * Commit and push to GitHub (if enabled)
   */
  private async pushToGitHub(message: string): Promise<void> {
    if (!this.state.isGitHubEnabled()) return;

    try {
      await github.commitAndPush(message);
      console.log(chalk.gray(`  → Pushed to GitHub: ${message}`));
    } catch (error) {
      // Silently ignore GitHub errors
    }
  }

  /**
   * Run council review on a plan/architecture
   * Gets critiques from multiple models to catch blind spots
   */
  private async runCouncilReview(content: string): Promise<CouncilResult | null> {
    console.log(chalk.cyan.bold('\n  🏛️  COUNCIL REVIEW\n'));
    console.log(chalk.gray('  Codex and Gemini are reviewing the architecture in parallel...'));
    console.log(chalk.gray('  They look for: design flaws, missing pieces, risky decisions.\n'));

    try {
      let result = await council.review(content, this.state.getProjectPath());

      // Synthesize feedback if we got multiple reviews (Architect resolves conflicts)
      if (result.reviews.length >= 2) {
        result = await council.synthesizeCouncilFeedback(result, this.state.getProjectPath());
      }

      if (result.reviews.length > 0) {
        council.displayResults(result);

        // Save the feedback
        const feedbackPath = path.join(this.state.getProjectPath(), '.skunkworks', 'COUNCIL_FEEDBACK.md');
        council.saveResults(result, feedbackPath);

        // Ask user if they want to proceed or revise
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const proceed = await new Promise<boolean>((resolve) => {
          rl.question(chalk.green('\n  Continue to Builder phase? (Y/n): '), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() !== 'n');
          });
        });

        if (!proceed) {
          console.log(chalk.gray('\n  Edit .skunkworks/ARCHITECTURE.md based on the feedback, then run:'));
          console.log(chalk.white('    skunkcontinue\n'));
          return result;
        }
      }

      return result;
    } catch (error) {
      console.log(chalk.yellow('Council review skipped (models unavailable).\n'));
      return null;
    }
  }

  /**
   * Capture learnings from the project when it completes
   */
  private async captureLearnings(): Promise<void> {
    try {
      initLearningRegistry();

      const projectPath = this.state.getProjectPath();
      const result = extractLearningsFromProject(projectPath);

      if (result.totalExtracted === 0) {
        return;
      }

      console.log(chalk.blue.bold(`\n🎓 Captured ${result.totalExtracted} learnings for future projects`));

      // Show what was captured
      if (result.solutions.length > 0) {
        console.log(chalk.gray(`   ${result.solutions.length} solution(s)`));
      }
      if (result.patterns.length > 0) {
        console.log(chalk.gray(`   ${result.patterns.length} pattern(s)`));
      }
      if (result.designTokens.length > 0) {
        console.log(chalk.gray(`   ${result.designTokens.length} design token(s)`));
      }

      // Auto-save with medium/high confidence
      const allLearnings = [...result.solutions, ...result.patterns, ...result.designTokens];
      const worthSaving = allLearnings.filter(l => l.confidence !== 'low');

      if (worthSaving.length > 0) {
        saveExtractedLearnings(worthSaving, result.projectName);
        console.log(chalk.green(`   ✓ Saved ${worthSaving.length} high-confidence learnings`));
      }

      console.log(chalk.gray('\n   Press [L] to review, [Enter] to continue'));

      // Quick interactive check
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const input = await new Promise<string>((resolve) => {
        rl.question('', (answer) => {
          rl.close();
          resolve(answer.toLowerCase().trim());
        });
      });

      if (input === 'l') {
        console.log(chalk.blue('\n📚 Learnings captured:\n'));

        for (let i = 0; i < allLearnings.length; i++) {
          const learning = allLearnings[i];
          console.log(`${i + 1}. [${learning.type.toUpperCase()}] ${learning.title}`);
          console.log(chalk.gray(`   Category: ${learning.category} | Confidence: ${learning.confidence}\n`));
        }

        console.log(chalk.gray('Run "skunklearnings" to browse all learnings'));
        console.log(chalk.gray('Run "skunkcompound" to re-capture or refine\n'));
      }
    } catch (error) {
      // Silently ignore learning capture errors - don't block completion
      if (this.verbose) {
        console.log(chalk.gray(`Note: Could not capture learnings: ${error}`));
      }
    }
  }

  /**
   * Run council review on the specification document
   * Gets critiques from multiple models to catch requirements issues early
   * Returns true if user wants to proceed, false if they want to revise
   */
  private async runCouncilReviewSpec(specContent: string): Promise<boolean> {
    console.log(chalk.cyan.bold('\n  🏛️  COUNCIL REVIEW\n'));
    console.log(chalk.gray('  Codex and Gemini are reviewing your spec in parallel...'));
    console.log(chalk.gray('  They look for: unclear requirements, gaps, conflicts, risks.\n'));

    try {
      let result = await council.reviewSpec(specContent, this.state.getProjectPath());

      // Synthesize feedback if we got multiple reviews (Architect resolves conflicts)
      if (result.reviews.length >= 2) {
        result = await council.synthesizeCouncilFeedback(result, this.state.getProjectPath());
      }

      if (result.reviews.length > 0) {
        council.displayResults(result);

        // Save the feedback to separate file for spec
        const feedbackPath = path.join(
          this.state.getProjectPath(),
          '.skunkworks',
          'COUNCIL_FEEDBACK_SPEC.md'
        );
        council.saveResults(result, feedbackPath);

        // Ask user if they want to proceed or revise
        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const proceed = await new Promise<boolean>((resolve) => {
          rl.question(
            chalk.green('\n  Continue to Architect phase? (Y/n): '),
            (answer) => {
              rl.close();
              resolve(answer.toLowerCase() !== 'n');
            }
          );
        });

        if (!proceed) {
          console.log(chalk.gray('\n  Edit .skunkworks/SPEC.md based on the feedback, then run:'));
          console.log(chalk.white('    skunkcontinue\n'));
          return false;
        }
      }

      return true;
    } catch (error) {
      console.log(chalk.yellow('Council review skipped (models unavailable).\n'));
      return true; // Proceed if council fails
    }
  }
}
