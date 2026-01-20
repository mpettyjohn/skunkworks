/**
 * Learning Extractor Module
 *
 * Extracts learnings from project artifacts:
 * - Solutions from REVIEW.md (issues that were fixed)
 * - Patterns from ARCHITECTURE.md (recurring decisions)
 * - Design templates from DESIGN_SPEC.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import { Learning, LearningType, saveLearning } from './learning-registry.js';

export interface ExtractedLearning {
  type: LearningType;
  title: string;
  description: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  content: string;
  tags: string[];
  applyWhen?: string;
  example?: string;
}

export interface ExtractionResult {
  solutions: ExtractedLearning[];
  patterns: ExtractedLearning[];
  designTokens: ExtractedLearning[];
  projectName: string;
  totalExtracted: number;
}

/**
 * Extract all learnings from a project
 */
export function extractLearningsFromProject(projectPath: string): ExtractionResult {
  const skunkworksDir = path.join(projectPath, '.skunkworks');
  const projectName = path.basename(projectPath);

  const result: ExtractionResult = {
    solutions: [],
    patterns: [],
    designTokens: [],
    projectName,
    totalExtracted: 0,
  };

  // Extract from REVIEW.md
  const reviewPath = path.join(skunkworksDir, 'REVIEW.md');
  if (fs.existsSync(reviewPath)) {
    const reviewContent = fs.readFileSync(reviewPath, 'utf-8');
    result.solutions = extractSolutionsFromReview(reviewContent, projectName);
  }

  // Extract from ARCHITECTURE.md
  const archPath = path.join(skunkworksDir, 'ARCHITECTURE.md');
  if (fs.existsSync(archPath)) {
    const archContent = fs.readFileSync(archPath, 'utf-8');
    result.patterns = extractPatternsFromArchitecture(archContent, projectName);
  }

  // Extract from DESIGN_SPEC.yaml
  const designPath = path.join(skunkworksDir, 'DESIGN_SPEC.yaml');
  if (fs.existsSync(designPath)) {
    const designContent = fs.readFileSync(designPath, 'utf-8');
    result.designTokens = extractDesignTokens(designContent, projectName);
  }

  // Also try to extract from SPEC.md for additional context
  const specPath = path.join(skunkworksDir, 'SPEC.md');
  if (fs.existsSync(specPath)) {
    const specContent = fs.readFileSync(specPath, 'utf-8');
    const specPatterns = extractPatternsFromSpec(specContent, projectName);
    result.patterns.push(...specPatterns);
  }

  result.totalExtracted = result.solutions.length + result.patterns.length + result.designTokens.length;

  return result;
}

/**
 * Extract solutions from REVIEW.md
 * Looks for issues/recommendations that could help future projects
 */
function extractSolutionsFromReview(content: string, projectName: string): ExtractedLearning[] {
  const solutions: ExtractedLearning[] = [];

  // Look for issue sections
  const issuePatterns = [
    /##?\s*(?:Issue|Bug|Problem|Fix|Warning)[:\s]+([^\n]+)\n([\s\S]*?)(?=\n##|\n---|\n\*\*\*|$)/gi,
    /\*\*(?:Issue|Bug|Problem|Fix)[:\s]*\*\*\s*([^\n]+)\n([\s\S]*?)(?=\n\*\*|\n##|\n---|\n\*\*\*|$)/gi,
    /[-*]\s*(?:Fixed|Resolved|Issue|Bug)[:\s]+([^\n]+)/gi,
  ];

  for (const pattern of issuePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const title = match[1].trim();
      const description = match[2]?.trim() || title;

      // Skip if too short or generic
      if (title.length < 10) continue;

      // Detect category from content
      const category = detectCategory(title + ' ' + description);

      // Detect confidence
      const confidence = description.includes('fix') || description.includes('solution')
        ? 'high'
        : description.length > 100 ? 'medium' : 'low';

      solutions.push({
        type: 'solution',
        title: `Fix: ${title.slice(0, 100)}`,
        description: `Solution discovered in ${projectName}: ${description.slice(0, 300)}`,
        category,
        confidence,
        content: extractCodeBlock(description) || description.slice(0, 500),
        tags: extractTags(title + ' ' + description),
        applyWhen: `When encountering similar ${category} issues`,
      });
    }
  }

  // Look for recommendations
  const recPattern = /##?\s*Recommendations?\n([\s\S]*?)(?=\n##|$)/i;
  const recMatch = content.match(recPattern);
  if (recMatch) {
    const recommendations = recMatch[1];
    const bulletPoints = recommendations.match(/[-*]\s+([^\n]+)/g);

    if (bulletPoints) {
      for (const bullet of bulletPoints.slice(0, 5)) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text.length > 20) {
          const category = detectCategory(text);
          solutions.push({
            type: 'solution',
            title: `Recommendation: ${text.slice(0, 80)}`,
            description: text,
            category,
            confidence: 'medium',
            content: text,
            tags: extractTags(text),
          });
        }
      }
    }
  }

  // Deduplicate by title similarity
  return deduplicateLearnings(solutions);
}

/**
 * Extract patterns from ARCHITECTURE.md
 */
function extractPatternsFromArchitecture(content: string, projectName: string): ExtractedLearning[] {
  const patterns: ExtractedLearning[] = [];

  // Look for technology decisions
  const stackMatch = content.match(/##?\s*Tech(?:nology)?\s*Stack\n([\s\S]*?)(?=\n##|$)/i);
  if (stackMatch) {
    const stack = stackMatch[1];
    const techItems = stack.match(/[-*]\s*\*?\*?([^:*\n]+)\*?\*?[:\s]+([^\n]+)/g);

    if (techItems) {
      for (const item of techItems.slice(0, 5)) {
        const match = item.match(/[-*]\s*\*?\*?([^:*\n]+)\*?\*?[:\s]+(.+)/);
        if (match) {
          const tech = match[1].trim();
          const reason = match[2].trim();

          if (tech.length > 2 && reason.length > 10) {
            patterns.push({
              type: 'pattern',
              title: `Tech choice: ${tech}`,
              description: `${tech} chosen for: ${reason}`,
              category: detectCategory(tech + ' ' + reason),
              confidence: 'high',
              content: `Technology: ${tech}\nReason: ${reason}`,
              tags: [tech.toLowerCase(), ...extractTags(reason)],
              applyWhen: `When building ${detectProjectType(content)} projects`,
            });
          }
        }
      }
    }
  }

  // Look for component/module patterns
  const componentPattern = /##?\s*(?:Components?|Modules?|Structure)\n([\s\S]*?)(?=\n##|$)/i;
  const componentMatch = content.match(componentPattern);
  if (componentMatch) {
    const components = componentMatch[1];

    // Extract API structure
    if (components.includes('API') || components.includes('endpoint')) {
      const category = detectCategory(components);
      patterns.push({
        type: 'pattern',
        title: 'API route structure pattern',
        description: `API organization pattern from ${projectName}`,
        category,
        confidence: 'medium',
        content: components.slice(0, 800),
        tags: ['api', 'routes', 'backend'],
        applyWhen: 'When designing API routes',
      });
    }

    // Extract component structure
    if (components.includes('Component') || components.includes('component')) {
      patterns.push({
        type: 'pattern',
        title: 'Component architecture pattern',
        description: `Component organization from ${projectName}`,
        category: 'frontend',
        confidence: 'medium',
        content: components.slice(0, 800),
        tags: ['components', 'frontend', 'architecture'],
        applyWhen: 'When structuring frontend components',
      });
    }
  }

  // Look for design decisions
  const decisionsPattern = /##?\s*(?:Design\s*)?Decisions?\n([\s\S]*?)(?=\n##|$)/i;
  const decisionsMatch = content.match(decisionsPattern);
  if (decisionsMatch) {
    const decisions = decisionsMatch[1];
    const bulletPoints = decisions.match(/[-*]\s+([^\n]+)/g);

    if (bulletPoints) {
      for (const bullet of bulletPoints.slice(0, 3)) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text.length > 30) {
          patterns.push({
            type: 'pattern',
            title: `Decision: ${text.slice(0, 80)}`,
            description: text,
            category: detectCategory(text),
            confidence: 'medium',
            content: text,
            tags: extractTags(text),
          });
        }
      }
    }
  }

  return deduplicateLearnings(patterns);
}

/**
 * Extract patterns from SPEC.md
 */
function extractPatternsFromSpec(content: string, projectName: string): ExtractedLearning[] {
  const patterns: ExtractedLearning[] = [];

  // Look for technical notes section (things the architect inferred)
  const techNotesPattern = /##?\s*(?:Technical\s*)?Notes?\s*(?:for\s*Technical\s*Team)?\n([\s\S]*?)(?=\n##|$)/i;
  const techNotesMatch = content.match(techNotesPattern);

  if (techNotesMatch) {
    const notes = techNotesMatch[1];
    const bulletPoints = notes.match(/[-*]\s+([^\n]+)/g);

    if (bulletPoints) {
      for (const bullet of bulletPoints.slice(0, 3)) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text.length > 30) {
          patterns.push({
            type: 'pattern',
            title: `Requirement pattern: ${text.slice(0, 80)}`,
            description: `Requirement inference from ${projectName}: ${text}`,
            category: 'requirements',
            confidence: 'low',
            content: text,
            tags: extractTags(text),
          });
        }
      }
    }
  }

  return patterns;
}

/**
 * Extract design tokens as learnings
 */
function extractDesignTokens(content: string, projectName: string): ExtractedLearning[] {
  const tokens: ExtractedLearning[] = [];

  // Get overall design personality
  const personalityMatch = content.match(/personality:\s*"?([^"\n]+)"?/i);
  const platformMatch = content.match(/platform:\s*"?([^"\n]+)"?/i);
  const archetypeMatch = content.match(/archetype:\s*"?([^"\n]+)"?/i);

  const personality = personalityMatch?.[1] || 'professional';
  const platform = platformMatch?.[1] || 'web';
  const archetype = archetypeMatch?.[1] || 'saas';

  // Create a design token template
  tokens.push({
    type: 'design-token',
    title: `Design template: ${personality} ${archetype}`,
    description: `Design system configuration for ${personality} ${archetype} (${platform})`,
    category: archetype,
    confidence: 'high',
    content: content.slice(0, 1500),
    tags: [personality, archetype, platform, 'design-tokens'],
    applyWhen: `When building ${personality} ${archetype} applications`,
    example: extractColorPalette(content),
  });

  return tokens;
}

/**
 * Detect category from content
 */
function detectCategory(text: string): string {
  const lowerText = text.toLowerCase();

  const categoryPatterns: [string, string[]][] = [
    ['react', ['react', 'jsx', 'tsx', 'component', 'hook', 'usestate', 'useeffect']],
    ['nextjs', ['next', 'nextjs', 'app router', 'pages', 'getserverside', 'getstatic']],
    ['typescript', ['typescript', 'type', 'interface', 'generic']],
    ['api', ['api', 'endpoint', 'rest', 'graphql', 'fetch', 'axios']],
    ['database', ['database', 'sql', 'mongodb', 'postgres', 'mysql', 'prisma']],
    ['authentication', ['auth', 'login', 'jwt', 'oauth', 'session']],
    ['testing', ['test', 'jest', 'vitest', 'cypress', 'playwright']],
    ['css', ['css', 'tailwind', 'style', 'scss', 'sass', 'styled']],
    ['performance', ['performance', 'optimization', 'speed', 'cache', 'lazy']],
    ['security', ['security', 'xss', 'csrf', 'injection', 'sanitize']],
  ];

  for (const [category, keywords] of categoryPatterns) {
    if (keywords.some(kw => lowerText.includes(kw))) {
      return category;
    }
  }

  return 'general';
}

/**
 * Detect project type from architecture content
 */
function detectProjectType(content: string): string {
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('next.js') || lowerContent.includes('nextjs')) return 'Next.js';
  if (lowerContent.includes('react')) return 'React';
  if (lowerContent.includes('vue')) return 'Vue';
  if (lowerContent.includes('angular')) return 'Angular';
  if (lowerContent.includes('express') || lowerContent.includes('node')) return 'Node.js';

  return 'web';
}

/**
 * Extract relevant tags from text
 */
function extractTags(text: string): string[] {
  const lowerText = text.toLowerCase();
  const tags: string[] = [];

  const knownTags = [
    'react', 'nextjs', 'typescript', 'javascript', 'api', 'database',
    'authentication', 'testing', 'css', 'tailwind', 'performance',
    'security', 'frontend', 'backend', 'fullstack', 'mobile', 'web',
    'error', 'bug', 'fix', 'optimization', 'pattern', 'architecture',
  ];

  for (const tag of knownTags) {
    if (lowerText.includes(tag)) {
      tags.push(tag);
    }
  }

  return tags.slice(0, 5);
}

/**
 * Extract code block from text
 */
function extractCodeBlock(text: string): string | null {
  const codeMatch = text.match(/```[\w]*\n([\s\S]*?)```/);
  return codeMatch ? codeMatch[1].trim() : null;
}

/**
 * Extract color palette from design spec
 */
function extractColorPalette(content: string): string {
  const colorMatch = content.match(/colors?:\s*\n([\s\S]*?)(?=\n[a-z]+:|$)/i);
  if (colorMatch) {
    return colorMatch[0].slice(0, 500);
  }
  return '';
}

/**
 * Deduplicate learnings by title similarity
 */
function deduplicateLearnings(learnings: ExtractedLearning[]): ExtractedLearning[] {
  const unique: ExtractedLearning[] = [];

  for (const learning of learnings) {
    const isDuplicate = unique.some(existing => {
      const titleSimilarity = calculateSimilarity(existing.title, learning.title);
      return titleSimilarity > 0.7;
    });

    if (!isDuplicate) {
      unique.push(learning);
    }
  }

  return unique;
}

/**
 * Calculate simple string similarity (Jaccard index)
 */
function calculateSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}

/**
 * Save extracted learnings to the registry
 */
export function saveExtractedLearnings(
  learnings: ExtractedLearning[],
  sourceProject: string
): Learning[] {
  const saved: Learning[] = [];

  for (const extracted of learnings) {
    const learning = saveLearning({
      ...extracted,
      sourceProject,
    });
    saved.push(learning);
  }

  return saved;
}

/**
 * Format extraction result for display
 */
export function formatExtractionResult(result: ExtractionResult): string {
  let output = `\n📚 Extracted ${result.totalExtracted} learnings from ${result.projectName}:\n\n`;

  if (result.solutions.length > 0) {
    output += `  Solutions: ${result.solutions.length}\n`;
    for (const sol of result.solutions.slice(0, 3)) {
      output += `    - ${sol.title.slice(0, 60)}\n`;
    }
    if (result.solutions.length > 3) {
      output += `    ... and ${result.solutions.length - 3} more\n`;
    }
    output += '\n';
  }

  if (result.patterns.length > 0) {
    output += `  Patterns: ${result.patterns.length}\n`;
    for (const pat of result.patterns.slice(0, 3)) {
      output += `    - ${pat.title.slice(0, 60)}\n`;
    }
    if (result.patterns.length > 3) {
      output += `    ... and ${result.patterns.length - 3} more\n`;
    }
    output += '\n';
  }

  if (result.designTokens.length > 0) {
    output += `  Design tokens: ${result.designTokens.length}\n`;
    for (const tok of result.designTokens.slice(0, 3)) {
      output += `    - ${tok.title.slice(0, 60)}\n`;
    }
    output += '\n';
  }

  return output;
}
