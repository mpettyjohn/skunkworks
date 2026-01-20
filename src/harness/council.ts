/**
 * Council - Multi-Model Plan Review
 *
 * The insight: same model family = same blind spots.
 * By sending a plan to multiple differently-trained models,
 * we catch errors and alternatives that any single model would miss.
 *
 * "if u just have opus or even fresh opus instances review the same plan
 * they'll keep missing the same things bc they all have the same blind spots"
 * - @tenobrus
 */

import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { ModelRouter } from './router.js';

export interface CouncilReview {
  model: string;
  critique: string;
  timestamp: string;
}

export interface CouncilResult {
  planContent: string;
  reviews: CouncilReview[];
  summary?: string;
}

const COUNCIL_PROMPT = `You are reviewing a plan created by another AI model. Your job is to be a critical design reviewer.

IMPORTANT: You are a DIFFERENT model than the one that created this plan. Your unique perspective is valuable precisely because you think differently.

Please review this plan and provide:

1. **Errors or Gaps**: What's wrong or missing? What assumptions might be incorrect?

2. **Alternative Approaches**: Are there better ways to accomplish these goals? What would you do differently?

3. **Edge Cases**: What scenarios does this plan not account for? What could go wrong?

4. **Risks**: What are the biggest risks with this approach? What could fail?

5. **Questions**: What clarifying questions would you ask before proceeding?

Be direct and critical. The goal is to catch blind spots and improve the plan before implementation begins.

Here is the plan to review:

---
`;

const COUNCIL_SPEC_PROMPT = `You are reviewing a SPECIFICATION document created by another AI model. Your job is to critique the requirements before architecture work begins.

IMPORTANT: You are a DIFFERENT model than the one that created this specification. Your unique perspective is valuable precisely because you think differently.

Please review this specification and provide:

1. **Unclear Requirements**: What requirements are ambiguous or could be interpreted multiple ways?

2. **Missing Requirements**: What obvious features or edge cases are not mentioned?

3. **Conflicting Requirements**: Do any requirements contradict each other?

4. **Scope Concerns**: Is the scope realistic? Too ambitious? Missing key constraints?

5. **User Story Gaps**: Are there user stories that don't make sense or are incomplete?

6. **Questions for Clarification**: What would you ask the user before proceeding to architecture?

Be direct and critical. The goal is to improve the specification before architecture work begins.

Here is the specification to review:

---
`;

/**
 * Run a council review on a plan document
 * Sends to multiple models in parallel for diverse perspectives
 */
export class Council {
  private router: ModelRouter;

  constructor() {
    this.router = new ModelRouter();
  }

  /**
   * Review a plan with multiple models
   */
  async review(planContent: string, workingDir?: string): Promise<CouncilResult> {
    await this.router.ensureInitialized();

    const reviews: CouncilReview[] = [];
    const available = this.router.getAvailableProviders();

    console.log(chalk.blue.bold('\n🏛️  COUNCIL REVIEW\n'));
    console.log(chalk.gray('Sending plan to multiple models for critique...\n'));

    // Determine which models to use for council
    // We want models DIFFERENT from Claude (which likely created the plan)
    const councilModels: Array<'codex' | 'gemini'> = [];

    if (available.includes('codex')) {
      councilModels.push('codex');
    }
    if (available.includes('gemini')) {
      councilModels.push('gemini');
    }

    if (councilModels.length === 0) {
      console.log(chalk.yellow('⚠️  No council members available.'));
      console.log(chalk.gray('Install codex or gemini CLI for multi-model review.\n'));
      return { planContent, reviews };
    }

    console.log(chalk.gray(`Council members: ${councilModels.join(', ')}\n`));

    // Run reviews in parallel for speed
    // Each review gets its own local spinner to avoid race conditions
    const reviewPromises = councilModels.map(async (model) => {
      const modelName = model === 'codex' ? 'GPT-5.2-Codex' : 'Gemini 3';
      const emoji = model === 'codex' ? '🔵' : '🟡';

      const spinner = ora({
        text: `${emoji} ${modelName} is reviewing...`,
        color: model === 'codex' ? 'blue' : 'yellow',
      }).start();

      try {
        const phase = model === 'codex' ? 'architect' : 'reviewer';
        const result = await this.router.complete(phase, {
          messages: [{ role: 'user', content: COUNCIL_PROMPT + planContent }],
          systemPrompt: 'You are an expert technical reviewer providing critical feedback on plans and designs.',
          workingDir,
        });

        spinner.stop();
        console.log(chalk.green(`${emoji} ${modelName} review complete`));

        return {
          model: modelName,
          critique: result.content,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        spinner.stop();
        console.log(chalk.red(`${emoji} ${modelName} review failed: ${error.message}`));
        return null;
      }
    });

    // Wait for all reviews
    const results = await Promise.all(reviewPromises);

    for (const result of results) {
      if (result) {
        reviews.push(result);
      }
    }

    return { planContent, reviews };
  }

  /**
   * Review a specification document with multiple models
   * Uses a prompt focused on requirements validation
   */
  async reviewSpec(specContent: string, workingDir?: string): Promise<CouncilResult> {
    await this.router.ensureInitialized();

    const reviews: CouncilReview[] = [];
    const available = this.router.getAvailableProviders();

    console.log(chalk.blue.bold('\n🏛️  SPECIFICATION REVIEW\n'));
    console.log(chalk.gray('Sending spec to multiple models for requirements critique...\n'));

    // Same council model selection as review()
    const councilModels: Array<'codex' | 'gemini'> = [];

    if (available.includes('codex')) {
      councilModels.push('codex');
    }
    if (available.includes('gemini')) {
      councilModels.push('gemini');
    }

    if (councilModels.length === 0) {
      console.log(chalk.yellow('⚠️  No council members available.'));
      console.log(chalk.gray('Install codex or gemini CLI for multi-model review.\n'));
      return { planContent: specContent, reviews };
    }

    console.log(chalk.gray(`Council members: ${councilModels.join(', ')}\n`));

    // Run reviews in parallel
    // Each review gets its own local spinner to avoid race conditions
    const reviewPromises = councilModels.map(async (model) => {
      const modelName = model === 'codex' ? 'GPT-5.2-Codex' : 'Gemini 3';
      const emoji = model === 'codex' ? '🔵' : '🟡';

      const spinner = ora({
        text: `${emoji} ${modelName} is reviewing specification...`,
        color: model === 'codex' ? 'blue' : 'yellow',
      }).start();

      try {
        const phase = model === 'codex' ? 'architect' : 'reviewer';
        const result = await this.router.complete(phase, {
          messages: [{ role: 'user', content: COUNCIL_SPEC_PROMPT + specContent }],
          systemPrompt: 'You are an expert requirements analyst providing critical feedback on specifications.',
          workingDir,
        });

        spinner.stop();
        console.log(chalk.green(`${emoji} ${modelName} spec review complete`));

        return {
          model: modelName,
          critique: result.content,
          timestamp: new Date().toISOString(),
        };
      } catch (error: any) {
        spinner.stop();
        console.log(chalk.red(`${emoji} ${modelName} spec review failed: ${error.message}`));
        return null;
      }
    });

    const results = await Promise.all(reviewPromises);

    for (const result of results) {
      if (result) {
        reviews.push(result);
      }
    }

    return { planContent: specContent, reviews };
  }

  /**
   * Display council results
   */
  displayResults(result: CouncilResult): void {
    console.log(chalk.blue.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(chalk.blue.bold('                    COUNCIL FEEDBACK'));
    console.log(chalk.blue.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    if (result.reviews.length === 0) {
      console.log(chalk.yellow('No reviews received.\n'));
      return;
    }

    for (const review of result.reviews) {
      const emoji = review.model.includes('Codex') ? '🔵' : '🟡';
      console.log(chalk.bold(`${emoji} ${review.model} says:\n`));
      console.log(chalk.white(review.critique));
      console.log(chalk.gray('\n─────────────────────────────────────────────────────────────\n'));
    }
  }

  /**
   * Save council results to file
   */
  saveResults(result: CouncilResult, outputPath: string): void {
    let content = `# Council Review\n\n`;
    content += `Generated: ${new Date().toISOString()}\n\n`;
    content += `---\n\n`;

    for (const review of result.reviews) {
      content += `## ${review.model} Review\n\n`;
      content += review.critique;
      content += `\n\n---\n\n`;
    }

    content += `## Original Plan\n\n`;
    content += '```\n' + result.planContent + '\n```\n';

    fs.writeFileSync(outputPath, content);
    console.log(chalk.green(`📄 Saved council feedback to ${outputPath}\n`));
  }

  /**
   * Find plan files in common locations
   */
  findPlanFile(projectPath: string): string | null {
    const searchPaths = [
      // Claude Code plan files
      path.join(projectPath, '.claude', 'plans'),
      // Skunkworks artifacts
      path.join(projectPath, '.skunkworks', 'ARCHITECTURE.md'),
      path.join(projectPath, '.skunkworks', 'SPEC.md'),
      path.join(projectPath, 'ARCHITECTURE.md'),
      path.join(projectPath, 'PLAN.md'),
    ];

    // Check for Claude Code plan files first
    const claudePlansDir = path.join(projectPath, '.claude', 'plans');
    if (fs.existsSync(claudePlansDir)) {
      const files = fs.readdirSync(claudePlansDir)
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(claudePlansDir, a));
          const statB = fs.statSync(path.join(claudePlansDir, b));
          return statB.mtime.getTime() - statA.mtime.getTime();
        });

      if (files.length > 0) {
        return path.join(claudePlansDir, files[0]);
      }
    }

    // Check other common locations
    for (const searchPath of searchPaths) {
      if (fs.existsSync(searchPath) && fs.statSync(searchPath).isFile()) {
        return searchPath;
      }
    }

    return null;
  }
}

// Singleton instance
export const council = new Council();
