/**
 * Chunk Context Management
 *
 * Manages the CHUNK_CONTEXT.md file that stores context between building phases.
 * This allows each phase to understand what was built before without needing
 * to replay the entire conversation history.
 */

import { ChunkPhase } from './state.js';

export interface CompletedPhaseInfo {
  name: string;
  goal: string;
  filesCreated: string[];
  filesModified: string[];
  keyDecisions: string[];
  designTokensUsed: string[];
}

export interface ChunkContext {
  completedPhases: CompletedPhaseInfo[];
  fileMap: Record<string, string>; // path -> purpose
  architecturalDecisions: Array<{ date: string; decision: string }>;
  knownIssues: string[];
}

/**
 * Generate the initial context for phase 1 (no previous phases)
 */
export function generateInitialContext(
  spec: string,
  architecture: string,
  designSpec: string | null,
  phase: ChunkPhase
): string {
  let context = `# Build Context

## Current Phase
**Phase 1 of N: ${phase.name}**
**Goal:** ${phase.goal}

## This is the first phase - no previous context.

## Reference Documents

### Spec Summary
${summarizeSpec(spec)}

### Architecture Overview
${summarizeArchitecture(architecture)}
`;

  if (designSpec) {
    context += `
### Design Tokens
\`\`\`yaml
${designSpec}
\`\`\`
`;
  }

  context += `
## Tasks for This Phase
${phase.tasks.map((t: string) => `- [ ] ${t}`).join('\n')}
`;

  return context;
}

/**
 * Generate context for subsequent phases based on what was built before
 */
export function generatePhaseContext(
  previousContext: ChunkContext,
  currentPhaseIndex: number,
  totalPhases: number,
  phase: ChunkPhase,
  spec: string,
  designSpec: string | null
): string {
  let context = `# Build Context

## Current Phase
**Phase ${currentPhaseIndex + 1} of ${totalPhases}: ${phase.name}**
**Goal:** ${phase.goal}

## Completed Phases
`;

  for (const completed of previousContext.completedPhases) {
    context += `
### ${completed.name}
**Goal:** ${completed.goal}
**Files created:** ${completed.filesCreated.length > 0 ? completed.filesCreated.join(', ') : 'None'}
**Files modified:** ${completed.filesModified.length > 0 ? completed.filesModified.join(', ') : 'None'}
**Key decisions:** ${completed.keyDecisions.length > 0 ? completed.keyDecisions.join('; ') : 'None'}
`;
  }

  if (Object.keys(previousContext.fileMap).length > 0) {
    context += `
## File Map (what exists and why)
`;
    for (const [filePath, purpose] of Object.entries(previousContext.fileMap)) {
      context += `- \`${filePath}\` - ${purpose}\n`;
    }
  }

  if (previousContext.architecturalDecisions.length > 0) {
    context += `
## Architectural Decisions Made
`;
    for (const decision of previousContext.architecturalDecisions) {
      context += `- ${decision.date}: ${decision.decision}\n`;
    }
  }

  if (previousContext.knownIssues.length > 0) {
    context += `
## Known Issues (do not address unless tasked)
`;
    for (const issue of previousContext.knownIssues) {
      context += `- ${issue}\n`;
    }
  }

  if (designSpec) {
    context += `
## Design Tokens (MANDATORY - use these, not hardcoded values)
\`\`\`yaml
${designSpec}
\`\`\`
`;
  }

  context += `
## Tasks for This Phase
${phase.tasks.map((t: string) => `- [ ] ${t}`).join('\n')}

## Rules for This Phase
1. Only implement the tasks listed above
2. Preserve existing code from previous phases
3. Use design tokens for all visual values
4. Document any architectural decisions you make
5. List files you create and their purpose
`;

  return context;
}

/**
 * Parse builder output to extract what was built
 */
export function parseBuilderOutput(output: string): Partial<CompletedPhaseInfo> {
  const filesCreated: string[] = [];
  const filesModified: string[] = [];
  const keyDecisions: string[] = [];
  const designTokensUsed: string[] = [];

  // Look for file creation patterns
  const filePatterns = [
    /(?:created?|wrote?|generated?)\s+(?:file\s+)?[`'"]*([^\s`'"]+\.[a-z]{2,4})[`'"']*/gi,
    /##\s+([^\s]+\.[a-z]{2,4})/gi,
    /```[a-z]*\s*\n\/\/\s*([^\s]+\.[a-z]{2,4})/gi,
  ];

  for (const pattern of filePatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1];
      if (!filesCreated.includes(file) && !file.includes('example')) {
        filesCreated.push(file);
      }
    }
  }

  // Look for modification patterns
  const modifyPatterns = [
    /(?:modified?|updated?|edited?|changed?)\s+(?:file\s+)?[`'"]*([^\s`'"]+\.[a-z]{2,4})[`'"']*/gi,
  ];

  for (const pattern of modifyPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const file = match[1];
      if (!filesModified.includes(file) && !filesCreated.includes(file)) {
        filesModified.push(file);
      }
    }
  }

  // Look for decision patterns
  const decisionPatterns = [
    /(?:decided?|chose?|selected?|using)\s+([^.]+(?:for|because|to)[^.]+)/gi,
    /architectural\s+(?:decision|choice):\s*([^.]+)/gi,
  ];

  for (const pattern of decisionPatterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      const decision = match[1].trim();
      if (decision.length > 10 && decision.length < 200) {
        keyDecisions.push(decision);
      }
    }
  }

  // Look for design token usage
  const tokenPattern = /--([a-z]+-[a-z]+(?:-[a-z]+)?)/gi;
  let tokenMatch;
  while ((tokenMatch = tokenPattern.exec(output)) !== null) {
    const token = `--${tokenMatch[1]}`;
    if (!designTokensUsed.includes(token)) {
      designTokensUsed.push(token);
    }
  }

  return {
    filesCreated,
    filesModified,
    keyDecisions: keyDecisions.slice(0, 5), // Limit to top 5
    designTokensUsed: designTokensUsed.slice(0, 20), // Limit tokens
  };
}

/**
 * Update context after a phase completes
 */
export function updateContextAfterPhase(
  existingContext: ChunkContext | null,
  completedPhase: ChunkPhase,
  builderOutput: string
): ChunkContext {
  const parsed = parseBuilderOutput(builderOutput);

  const completedInfo: CompletedPhaseInfo = {
    name: completedPhase.name,
    goal: completedPhase.goal,
    filesCreated: parsed.filesCreated ?? [],
    filesModified: parsed.filesModified ?? [],
    keyDecisions: parsed.keyDecisions ?? [],
    designTokensUsed: parsed.designTokensUsed ?? [],
  };

  const context: ChunkContext = existingContext ?? {
    completedPhases: [],
    fileMap: {},
    architecturalDecisions: [],
    knownIssues: [],
  };

  context.completedPhases.push(completedInfo);

  // Update file map
  for (const file of completedInfo.filesCreated) {
    if (!context.fileMap[file]) {
      context.fileMap[file] = `Created in ${completedPhase.name}`;
    }
  }

  // Add architectural decisions with date
  const today = new Date().toISOString().split('T')[0];
  for (const decision of completedInfo.keyDecisions) {
    context.architecturalDecisions.push({ date: today, decision });
  }

  return context;
}

/**
 * Serialize context to markdown for storage
 */
export function serializeContext(context: ChunkContext): string {
  return JSON.stringify(context, null, 2);
}

/**
 * Deserialize context from stored markdown/JSON
 */
export function deserializeContext(content: string): ChunkContext | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Format context for fix attempt - includes error info
 */
export function formatContextForFix(
  context: string,
  errorOutput: string,
  attemptNumber: number,
  previousAttempts: string[]
): string {
  let fixContext = context;

  fixContext += `

---

## FIX REQUIRED

**Attempt ${attemptNumber} of 2**

### Error Output
\`\`\`
${errorOutput.slice(0, 2000)}
\`\`\`
`;

  if (previousAttempts.length > 0) {
    fixContext += `
### Previous Fix Attempts
${previousAttempts.map((a, i) => `**Attempt ${i + 1}:** ${a.slice(0, 500)}`).join('\n\n')}
`;
  }

  fixContext += `
### Instructions
1. Identify the specific error(s) above
2. Fix ONLY what is broken - do not refactor other code
3. Verify your fix addresses the error
4. Do not introduce new features or changes
`;

  return fixContext;
}

// Helper functions

function summarizeSpec(spec: string): string {
  // Extract first 500 chars of the overview/summary section
  const overviewMatch = spec.match(/##\s*(?:Overview|Summary|Description)[\s\S]*?(?=##|$)/i);
  if (overviewMatch) {
    return overviewMatch[0].slice(0, 500) + (overviewMatch[0].length > 500 ? '...' : '');
  }
  return spec.slice(0, 500) + (spec.length > 500 ? '...' : '');
}

function summarizeArchitecture(architecture: string): string {
  // Extract overview and component diagram sections
  const sections: string[] = [];

  const overviewMatch = architecture.match(/##\s*Overview[\s\S]*?(?=##|$)/i);
  if (overviewMatch) {
    sections.push(overviewMatch[0].slice(0, 300));
  }

  const stackMatch = architecture.match(/##\s*Technology Stack[\s\S]*?(?=##|$)/i);
  if (stackMatch) {
    sections.push(stackMatch[0].slice(0, 300));
  }

  return sections.join('\n\n') || architecture.slice(0, 600);
}
