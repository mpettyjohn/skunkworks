/**
 * Context Compression Module
 *
 * Compresses context intelligently so each phase gets only what it needs.
 * Prevents AI quality degradation from bloated contexts.
 */

import { ChunkContext, CompletedPhaseInfo } from './chunk-context.js';
import { ChunkPhase } from './state.js';
import { estimateTokens, analyzeContextHealth } from './context-health.js';

export interface CompressionConfig {
  /** Maximum tokens to target */
  targetTokens: number;
  /** How many recent phases to keep full detail */
  recentPhasesFullDetail: number;
  /** Whether to extract only relevant files */
  extractRelevantFiles: boolean;
  /** Whether to summarize architecture */
  summarizeArchitecture: boolean;
}

const DEFAULT_CONFIG: CompressionConfig = {
  targetTokens: 8000,
  recentPhasesFullDetail: 2,
  extractRelevantFiles: true,
  summarizeArchitecture: true,
};

/**
 * Compress completed phases based on recency
 * Recent phases get full detail, older phases get ultra-short summaries
 */
export function compressCompletedPhases(
  completedPhases: CompletedPhaseInfo[],
  recentCount: number = 2
): { compressed: string; savedTokens: number } {
  if (completedPhases.length === 0) {
    return { compressed: '', savedTokens: 0 };
  }

  let compressed = '## Completed Phases\n\n';
  let originalEstimate = 0;

  // Calculate original size
  for (const phase of completedPhases) {
    originalEstimate += estimateTokens(JSON.stringify(phase));
  }

  // Older phases get ultra-short summaries
  const olderPhases = completedPhases.slice(0, -recentCount);
  const recentPhases = completedPhases.slice(-recentCount);

  if (olderPhases.length > 0) {
    compressed += '### Earlier Phases (summary)\n';
    for (const phase of olderPhases) {
      // Ultra-short: just name, goal snippet, and file count
      const fileCount = phase.filesCreated.length + phase.filesModified.length;
      const goalSnippet = phase.goal.length > 50 ? phase.goal.slice(0, 50) + '...' : phase.goal;
      compressed += `- **${phase.name}**: ${goalSnippet} (${fileCount} files)\n`;
    }
    compressed += '\n';
  }

  // Recent phases get full detail
  if (recentPhases.length > 0) {
    compressed += '### Recent Phases (full detail)\n\n';
    for (const phase of recentPhases) {
      compressed += `#### ${phase.name}\n`;
      compressed += `**Goal:** ${phase.goal}\n`;

      if (phase.filesCreated.length > 0) {
        compressed += `**Created:** ${phase.filesCreated.join(', ')}\n`;
      }
      if (phase.filesModified.length > 0) {
        compressed += `**Modified:** ${phase.filesModified.join(', ')}\n`;
      }
      if (phase.keyDecisions.length > 0) {
        compressed += `**Decisions:** ${phase.keyDecisions.join('; ')}\n`;
      }
      if (phase.designTokensUsed.length > 0) {
        compressed += `**Tokens used:** ${phase.designTokensUsed.slice(0, 10).join(', ')}${phase.designTokensUsed.length > 10 ? '...' : ''}\n`;
      }
      compressed += '\n';
    }
  }

  const compressedEstimate = estimateTokens(compressed);
  const savedTokens = Math.max(0, originalEstimate - compressedEstimate);

  return { compressed, savedTokens };
}

/**
 * Extract only files relevant to current phase tasks
 */
export function extractRelevantFiles(
  fileMap: Record<string, string>,
  currentPhaseTasks: string[]
): { relevant: Record<string, string>; excluded: number } {
  const relevant: Record<string, string> = {};
  let excluded = 0;

  // Extract keywords from current phase tasks
  const taskKeywords = new Set<string>();
  for (const task of currentPhaseTasks) {
    // Extract likely file/component names from task descriptions
    const words = task.toLowerCase().split(/[\s,.\-_()[\]]+/);
    for (const word of words) {
      if (word.length > 2) {
        taskKeywords.add(word);
      }
    }
  }

  for (const [filePath, purpose] of Object.entries(fileMap)) {
    // Check if file is relevant to current tasks
    const filePathLower = filePath.toLowerCase();
    const purposeLower = purpose.toLowerCase();

    let isRelevant = false;

    // Always include config files, package.json, layout files
    const alwaysInclude = ['package.json', 'tsconfig', 'tailwind', 'layout', 'app.', 'index.'];
    if (alwaysInclude.some(pattern => filePathLower.includes(pattern))) {
      isRelevant = true;
    }

    // Check if any task keyword matches
    if (!isRelevant) {
      for (const keyword of taskKeywords) {
        if (filePathLower.includes(keyword) || purposeLower.includes(keyword)) {
          isRelevant = true;
          break;
        }
      }
    }

    if (isRelevant) {
      relevant[filePath] = purpose;
    } else {
      excluded++;
    }
  }

  return { relevant, excluded };
}

/**
 * Compress architecture to only needed sections
 */
export function compressArchitecture(
  architecture: string,
  currentPhase: ChunkPhase
): { compressed: string; savedTokens: number } {
  const originalTokens = estimateTokens(architecture);

  // Extract key sections
  const sections: string[] = [];

  // Always keep overview
  const overviewMatch = architecture.match(/##?\s*Overview[\s\S]*?(?=\n##|\n---|\n\*\*\*|$)/i);
  if (overviewMatch) {
    const overview = overviewMatch[0].slice(0, 500);
    sections.push(overview + (overviewMatch[0].length > 500 ? '...' : ''));
  }

  // Always keep tech stack
  const stackMatch = architecture.match(/##?\s*Tech(?:nology)?\s*Stack[\s\S]*?(?=\n##|\n---|\n\*\*\*|$)/i);
  if (stackMatch) {
    sections.push(stackMatch[0].slice(0, 400));
  }

  // Extract component/section relevant to current phase
  const phaseKeywords = [
    ...currentPhase.tasks.map(t => t.toLowerCase()),
    currentPhase.name.toLowerCase(),
    currentPhase.goal.toLowerCase(),
  ].join(' ').split(/[\s,.\-_()[\]]+/).filter(w => w.length > 3);

  // Find sections that mention phase keywords
  const sectionMatches = architecture.match(/##\s*[^\n]+[\s\S]*?(?=\n##|$)/g);
  if (sectionMatches) {
    for (const section of sectionMatches) {
      const sectionLower = section.toLowerCase();
      for (const keyword of phaseKeywords) {
        if (sectionLower.includes(keyword) && !sections.includes(section)) {
          sections.push(section.slice(0, 600) + (section.length > 600 ? '...' : ''));
          break;
        }
      }
    }
  }

  let compressed = '### Architecture (compressed for this phase)\n\n';
  compressed += sections.join('\n\n');

  const compressedTokens = estimateTokens(compressed);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);

  return { compressed, savedTokens };
}

/**
 * Compress spec to essential sections
 */
export function compressSpec(spec: string): { compressed: string; savedTokens: number } {
  const originalTokens = estimateTokens(spec);

  // Extract key sections only
  const sections: string[] = [];

  // Overview/Summary
  const overviewMatch = spec.match(/##?\s*(?:Overview|Summary|Description)[\s\S]*?(?=\n##|\n---|\n\*\*\*|$)/i);
  if (overviewMatch) {
    sections.push(overviewMatch[0].slice(0, 400));
  }

  // User Stories (abbreviated)
  const storiesMatch = spec.match(/##?\s*(?:User Stories|Features|Requirements)[\s\S]*?(?=\n##|\n---|\n\*\*\*|$)/i);
  if (storiesMatch) {
    // Only keep first few stories
    const stories = storiesMatch[0].split('\n').filter(l => l.match(/^[-*]\s/)).slice(0, 5);
    if (stories.length > 0) {
      sections.push('## Key User Stories\n' + stories.join('\n'));
    }
  }

  // Success Criteria
  const criteriaMatch = spec.match(/##?\s*Success\s*Criteria[\s\S]*?(?=\n##|\n---|\n\*\*\*|$)/i);
  if (criteriaMatch) {
    sections.push(criteriaMatch[0].slice(0, 300));
  }

  let compressed = '### Spec Summary\n\n';
  compressed += sections.join('\n\n');

  const compressedTokens = estimateTokens(compressed);
  const savedTokens = Math.max(0, originalTokens - compressedTokens);

  return { compressed, savedTokens };
}

/**
 * Generate compressed context for a phase
 */
export function generateCompressedPhaseContext(
  previousContext: ChunkContext | null,
  currentPhaseIndex: number,
  totalPhases: number,
  phase: ChunkPhase,
  spec: string,
  architecture: string,
  designSpec: string | null,
  config: Partial<CompressionConfig> = {}
): { context: string; compressionStats: CompressionStats } {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const stats: CompressionStats = {
    originalTokens: 0,
    compressedTokens: 0,
    savedTokens: 0,
    sectionsCompressed: [],
  };

  let context = `# Build Context

## Current Phase
**Phase ${currentPhaseIndex + 1} of ${totalPhases}: ${phase.name}**
**Goal:** ${phase.goal}

`;

  // Compressed completed phases
  if (previousContext && previousContext.completedPhases.length > 0) {
    const { compressed, savedTokens } = compressCompletedPhases(
      previousContext.completedPhases,
      cfg.recentPhasesFullDetail
    );
    context += compressed;
    if (savedTokens > 0) {
      stats.savedTokens += savedTokens;
      stats.sectionsCompressed.push(`Completed phases: saved ~${savedTokens} tokens`);
    }
  }

  // File map (filtered to relevant files)
  if (previousContext && Object.keys(previousContext.fileMap).length > 0) {
    if (cfg.extractRelevantFiles) {
      const { relevant, excluded } = extractRelevantFiles(previousContext.fileMap, phase.tasks);
      if (Object.keys(relevant).length > 0) {
        context += '## File Map (relevant to this phase)\n';
        for (const [filePath, purpose] of Object.entries(relevant)) {
          context += `- \`${filePath}\` - ${purpose}\n`;
        }
        if (excluded > 0) {
          context += `\n*${excluded} other files not shown (not relevant to current tasks)*\n`;
          stats.sectionsCompressed.push(`File map: excluded ${excluded} irrelevant files`);
        }
        context += '\n';
      }
    } else {
      context += '## File Map\n';
      for (const [filePath, purpose] of Object.entries(previousContext.fileMap)) {
        context += `- \`${filePath}\` - ${purpose}\n`;
      }
      context += '\n';
    }
  }

  // Architectural decisions (recent only)
  if (previousContext && previousContext.architecturalDecisions.length > 0) {
    const recentDecisions = previousContext.architecturalDecisions.slice(-5);
    context += '## Recent Architectural Decisions\n';
    for (const decision of recentDecisions) {
      context += `- ${decision.date}: ${decision.decision}\n`;
    }
    context += '\n';
  }

  // Known issues
  if (previousContext && previousContext.knownIssues.length > 0) {
    context += '## Known Issues (do not address unless tasked)\n';
    for (const issue of previousContext.knownIssues) {
      context += `- ${issue}\n`;
    }
    context += '\n';
  }

  // Compressed spec reference
  if (spec && cfg.summarizeArchitecture) {
    const { compressed: compressedSpec, savedTokens } = compressSpec(spec);
    context += compressedSpec + '\n\n';
    if (savedTokens > 100) {
      stats.savedTokens += savedTokens;
      stats.sectionsCompressed.push(`Spec: saved ~${savedTokens} tokens`);
    }
  }

  // Compressed architecture
  if (architecture && cfg.summarizeArchitecture) {
    const { compressed: compressedArch, savedTokens } = compressArchitecture(architecture, phase);
    context += compressedArch + '\n\n';
    if (savedTokens > 100) {
      stats.savedTokens += savedTokens;
      stats.sectionsCompressed.push(`Architecture: saved ~${savedTokens} tokens`);
    }
  }

  // Design tokens (always include full - they're essential)
  if (designSpec) {
    context += `## Design Tokens (MANDATORY - use these, not hardcoded values)
\`\`\`yaml
${designSpec}
\`\`\`

`;
  }

  // Current phase tasks
  context += `## Tasks for This Phase
${phase.tasks.map(t => `- [ ] ${t}`).join('\n')}

## Rules for This Phase
1. Only implement the tasks listed above
2. Preserve existing code from previous phases
3. Use design tokens for all visual values
4. Document any architectural decisions you make
5. List files you create and their purpose
`;

  stats.compressedTokens = estimateTokens(context);
  stats.originalTokens = stats.compressedTokens + stats.savedTokens;

  return { context, compressionStats: stats };
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
  sectionsCompressed: string[];
}

/**
 * Compress fix attempt context to reduce bloat
 */
export function compressFixContext(
  originalContext: string,
  errorOutput: string,
  attemptNumber: number,
  previousAttempts: string[]
): string {
  // For fix attempts, we need:
  // 1. The specific error details (most important)
  // 2. A brief reminder of what we're building
  // 3. Previous attempt summaries (not full output)

  let fixContext = `# Fix Required - Attempt ${attemptNumber} of 2

## Error to Fix
\`\`\`
${errorOutput.slice(0, 2000)}
\`\`\`

`;

  // Compress previous attempts to just the approach taken
  if (previousAttempts.length > 0) {
    fixContext += '## Previous Attempts Summary\n';
    for (let i = 0; i < previousAttempts.length; i++) {
      const attempt = previousAttempts[i];
      // Extract just the first few lines or file changes
      const summary = extractAttemptSummary(attempt);
      fixContext += `**Attempt ${i + 1}:** ${summary}\n\n`;
    }
  }

  // Extract only relevant context (current phase tasks, recent files)
  const tasksMatch = originalContext.match(/## Tasks for This Phase[\s\S]*?(?=\n##|$)/);
  if (tasksMatch) {
    fixContext += tasksMatch[0] + '\n\n';
  }

  fixContext += `## Fix Instructions
1. Review the error above carefully
2. Fix ONLY what is broken
3. Do not refactor or add features
4. Make the minimal change needed
`;

  return fixContext;
}

/**
 * Extract a brief summary from a fix attempt output
 */
function extractAttemptSummary(attemptOutput: string): string {
  // Look for files modified
  const filesPattern = /(?:modified?|edited?|changed?|fixed?)\s+[`'"]?([^\s`'"]+\.[a-z]+)/gi;
  const files: string[] = [];
  let match;
  while ((match = filesPattern.exec(attemptOutput)) !== null) {
    if (!files.includes(match[1])) {
      files.push(match[1]);
    }
  }

  if (files.length > 0) {
    return `Modified ${files.slice(0, 3).join(', ')}${files.length > 3 ? '...' : ''}`;
  }

  // Fall back to first meaningful line
  const lines = attemptOutput.split('\n').filter(l => l.trim().length > 10);
  if (lines.length > 0) {
    return lines[0].slice(0, 100) + (lines[0].length > 100 ? '...' : '');
  }

  return 'Attempted fix (details truncated)';
}

/**
 * Determine if compression should be applied based on context health
 */
export function shouldCompress(context: string, budgetTokens: number = 8000): boolean {
  const health = analyzeContextHealth(context, undefined, budgetTokens);
  return health.status !== 'healthy' || health.percentageUsed > 70;
}
