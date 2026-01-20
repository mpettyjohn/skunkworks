/**
 * Model Configuration
 *
 * Skunkworks v2 with 4 phases - uses the winning combination from frontier Twitter:
 * - Claude Opus 4.5 for Interviewer (interactive AskUserQuestion)
 * - GPT-5.2-Codex Extra High reasoning for Architect (planning/design)
 * - Claude Opus 4.5 for Builder (best coder, 80.9% SWE-bench)
 * - Gemini 3 Flash for Reviewer (fast, different perspective)
 *
 * Access is via CLI tools that work with SUBSCRIPTIONS (no API keys):
 * - OpenAI Codex CLI: `codex` (ChatGPT Pro subscription)
 * - Claude Code: `claude` (Claude Max subscription)
 * - Gemini CLI: `gemini` (Google subscription)
 */

export type AgentPhase = 'interviewer' | 'architect' | 'builder' | 'reviewer';

export type CLITool = 'codex' | 'claude-code' | 'gemini';

export interface ModelConfig {
  cli: CLITool;
  model: string;
  description: string;
  reasoningLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'extra-high';
}

export interface PhaseConfig {
  primary: ModelConfig;
  fallback: ModelConfig;
}

/**
 * Frontier-recommended model configurations (January 2026)
 *
 * Based on community consensus:
 * - GPT-5.2-Codex Extra High reasoning → Architect (best at planning)
 * - Opus 4.5 → Builder (best at coding, 80.9% SWE-bench)
 * - Gemini 3 Flash → Reviewer (fast, different model family)
 */
export const DEFAULT_CONFIGS: Record<AgentPhase, PhaseConfig> = {
  interviewer: {
    primary: {
      cli: 'claude-code',
      model: 'claude-opus-4-5',
      description: 'Claude Opus 4.5 - Interactive interview with AskUserQuestion',
    },
    fallback: {
      cli: 'gemini',
      model: 'gemini-3-flash',
      description: 'Gemini 3 Flash - Interview fallback',
    },
  },
  architect: {
    primary: {
      cli: 'codex',
      model: 'gpt-5.2-codex',
      description: 'GPT-5.2-Codex Extra High reasoning - Best for architectural planning',
      reasoningLevel: 'extra-high',
    },
    fallback: {
      cli: 'gemini',
      model: 'gemini-3-flash',
      description: 'Gemini 3 Flash - Strong reasoning fallback',
      reasoningLevel: 'high',
    },
  },
  builder: {
    primary: {
      cli: 'claude-code',
      model: 'claude-opus-4-5',
      description: 'Claude Opus 4.5 - Best coder (80.9% SWE-bench)',
    },
    fallback: {
      cli: 'gemini',
      model: 'gemini-3-flash',
      description: 'Gemini 3 Flash - Fast coding fallback (78% SWE-bench)',
    },
  },
  reviewer: {
    // Different model family to catch blind spots
    primary: {
      cli: 'gemini',
      model: 'gemini-3-flash',
      description: 'Gemini 3 Flash - Fast review, different perspective',
      reasoningLevel: 'high',
    },
    fallback: {
      cli: 'codex',
      model: 'gpt-5.2-codex',
      description: 'GPT-5.2-Codex - Alternative reviewer',
      reasoningLevel: 'medium',
    },
  },
};

/**
 * CLI tool commands and authentication info
 */
export const CLI_INFO: Record<CLITool, {
  command: string;
  installCmd: string;
  authMethod: string;
  checkCmd: string;
}> = {
  'codex': {
    command: 'codex',
    installCmd: 'npm i -g @openai/codex',
    authMethod: 'ChatGPT Pro subscription (browser login)',
    checkCmd: 'codex --version',
  },
  'claude-code': {
    command: 'claude',
    installCmd: 'npm i -g @anthropic-ai/claude-code',
    authMethod: 'Claude Max subscription (already authenticated)',
    checkCmd: 'claude --version',
  },
  'gemini': {
    command: 'gemini',
    installCmd: 'npm i -g @google/gemini-cli',
    authMethod: 'Google account login (browser)',
    checkCmd: 'gemini --version',
  },
};

/**
 * Get the model configuration for a specific phase
 */
export function getModelConfig(phase: AgentPhase, useFallback = false): ModelConfig {
  const phaseConfig = DEFAULT_CONFIGS[phase];
  return useFallback ? phaseConfig.fallback : phaseConfig.primary;
}

/**
 * Get CLI info for a tool
 */
export function getCLIInfo(cli: CLITool) {
  return CLI_INFO[cli];
}

/**
 * Override model for a specific phase
 */
export function createCustomConfig(
  cli: CLITool,
  model: string,
  reasoningLevel?: ModelConfig['reasoningLevel']
): ModelConfig {
  return {
    cli,
    model,
    description: `Custom ${cli} configuration`,
    reasoningLevel,
  };
}
