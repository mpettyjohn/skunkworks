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

Use AskUserQuestion for:
- Clarifying what they want ("Which of these matters more to you?")
- Confirming your understanding ("Does this capture what you're looking for?")
- Prioritizing features

Do NOT use AskUserQuestion to ask:
- "What framework should we use?"
- "Do you prefer REST or GraphQL?"
- Any technical implementation questions

When you have enough information, create .skunkworks/SPEC.md with:
- Overview (plain language description)
- Target Users
- User Stories ("Users can...")
- Success Criteria (observable outcomes)
- Constraints
- Out of Scope
- Notes for Technical Team (things YOU inferred, not things they told you)

${initialPrompt ? `\nThe user's initial project idea: "${initialPrompt}"` : ''}

${learningsContext ? `\n## Relevant Learnings from Past Projects\n\nThese learnings may be helpful when designing this project:\n\n${learningsContext}` : ''}

Start by understanding their vision. Be conversational and friendly.`;

    console.log(chalk.gray('Launching Claude Code in interactive mode...\n'));
    console.log(chalk.gray('-------------------------------------------\n'));

    try {
      // Run Claude Code interactively
      await this.router.runInteractive(interviewPrompt, this.state.getProjectPath());

      console.log(chalk.gray('\n-------------------------------------------'));
      console.log(chalk.green('\n✓ Interview complete!\n'));

      // Check if SPEC.md was created
      const spec = this.state.getSpec();
      if (spec) {
        console.log(chalk.green('📄 SPEC.md created successfully.'));

        // Run council review on the spec before moving to architect
        const proceed = await this.runCouncilReviewSpec(spec);

        if (proceed) {
          console.log(chalk.blue('\nMoving to architect phase (GPT-5.2-Codex)...'));
          this.state.setPhase('architect');
          await this.runArchitectPhase();
        }
        // If not proceeding, user wants to revise - don't advance phase
      } else {
        console.log(chalk.yellow('⚠️  No SPEC.md found. Run "skunkinterview" to continue.'));
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

Focus on creating a clear, implementable architecture.`,
      });
    } else if (initialPrompt) {
      messages.push({
        role: 'user',
        content: `I want to build: ${initialPrompt}\n\nPlease design the architecture and create a detailed implementation plan.`,
      });
    } else {
      console.log(chalk.yellow('⚠️  No SPEC.md found. Consider running "skunkinterview" first.\n'));
      messages.push({
        role: 'user',
        content: 'Please help me design a software architecture. What project would you like to design?',
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

      // Run verification
      const verificationLevel: VerificationLevel = currentPhase.isMilestone ? 'full' : 'tests';
      let verifyResult = await runChunkVerification(
        this.state.getProjectPath(),
        verificationLevel,
        spec
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
            spec
          );

          if (verifyResult.passed) {
            fixed = true;
            console.log(chalk.green('\n✅ Fix successful!\n'));
            break;
          }
        }

        if (!fixed) {
          this.state.markChunkPhaseFailed();
          console.log(chalk.red('\n❌ Auto-fix failed after 2 attempts.'));
          console.log(chalk.yellow('Please fix the issues manually and run: skunkcontinue\n'));
          console.log(chalk.gray('Error details saved to .skunkworks/CHUNK_CONTEXT.md'));

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

    console.log(chalk.green.bold('\n🎉 All phases complete!\n'));
    console.log(chalk.blue('Moving to reviewer phase...\n'));
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
            // Run council review on the architecture before moving to builder
            const architecture = this.state.getArchitecture();
            if (architecture) {
              await this.runCouncilReview(architecture);
            }
            console.log(chalk.blue('\nMoving to builder phase...'));
            this.state.setPhase('builder');
          } else if (phase === 'builder') {
            console.log(chalk.blue('\nMoving to reviewer phase...'));
            this.state.setPhase('reviewer');
          } else if (phase === 'reviewer') {
            console.log(chalk.green('\n✅ All phases complete!'));
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
    console.log(chalk.blue.bold('\n🏛️  Running Council Review...'));
    console.log(chalk.gray('Getting critiques from Codex and Gemini to catch blind spots.\n'));

    try {
      const result = await council.review(content, this.state.getProjectPath());

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
          rl.question(chalk.yellow('\nProceed to building? (Y to continue, N to revise plan): '), (answer) => {
            rl.close();
            resolve(answer.toLowerCase() !== 'n');
          });
        });

        if (!proceed) {
          console.log(chalk.gray('\nRevise your architecture based on the feedback, then run:'));
          console.log(chalk.white('  abr continue\n'));
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
    console.log(chalk.blue.bold('\n🏛️  Running Council Review on SPEC.md...'));
    console.log(chalk.gray('Getting critiques from Codex and Gemini on requirements.\n'));

    try {
      const result = await council.reviewSpec(specContent, this.state.getProjectPath());

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
            chalk.yellow('\nProceed to Architect phase? (Y to continue, N to revise spec): '),
            (answer) => {
              rl.close();
              resolve(answer.toLowerCase() !== 'n');
            }
          );
        });

        if (!proceed) {
          console.log(chalk.gray('\nRevise SPEC.md based on the feedback, then run:'));
          console.log(chalk.white('  abr continue\n'));
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
