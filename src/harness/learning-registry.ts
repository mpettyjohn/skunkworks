/**
 * Learning Registry Module
 *
 * Manages ~/.skunkworks/learning/ directory for cross-project learnings.
 * Stores solutions, patterns, and design templates that can be reused.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Registry root directory
const LEARNING_DIR = path.join(os.homedir(), '.skunkworks', 'learning');

export type LearningType = 'solution' | 'pattern' | 'design-token';

export interface Learning {
  id: string;
  type: LearningType;
  title: string;
  description: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  sourceProject?: string;
  sourceFile?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  content: string;
  applyWhen?: string;
  example?: string;
}

export interface LearningIndex {
  version: number;
  lastUpdated: string;
  learnings: LearningIndexEntry[];
}

export interface LearningIndexEntry {
  id: string;
  type: LearningType;
  title: string;
  category: string;
  tags: string[];
  filePath: string;
}

/**
 * Initialize the learning registry directory structure
 */
export function initLearningRegistry(): void {
  const dirs = [
    LEARNING_DIR,
    path.join(LEARNING_DIR, 'solutions'),
    path.join(LEARNING_DIR, 'patterns'),
    path.join(LEARNING_DIR, 'design-tokens'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Initialize index if it doesn't exist
  const indexPath = path.join(LEARNING_DIR, 'index.json');
  if (!fs.existsSync(indexPath)) {
    const initialIndex: LearningIndex = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      learnings: [],
    };
    fs.writeFileSync(indexPath, JSON.stringify(initialIndex, null, 2));
  }
}

/**
 * Get the learning registry directory path
 */
export function getLearningDir(): string {
  return LEARNING_DIR;
}

/**
 * Load the learning index
 */
export function loadIndex(): LearningIndex {
  initLearningRegistry();

  const indexPath = path.join(LEARNING_DIR, 'index.json');
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      learnings: [],
    };
  }
}

/**
 * Save the learning index
 */
export function saveIndex(index: LearningIndex): void {
  initLearningRegistry();
  index.lastUpdated = new Date().toISOString();

  const indexPath = path.join(LEARNING_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Generate a unique ID for a learning
 */
function generateId(type: LearningType, category: string): string {
  const prefix = type === 'solution' ? 'sol' : type === 'pattern' ? 'pat' : 'tok';
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}-${category.slice(0, 3)}-${timestamp}-${random}`;
}

/**
 * Get the directory for a learning type
 */
function getTypeDir(type: LearningType): string {
  const dirMap: Record<LearningType, string> = {
    solution: 'solutions',
    pattern: 'patterns',
    'design-token': 'design-tokens',
  };
  return path.join(LEARNING_DIR, dirMap[type]);
}

/**
 * Save a learning to the registry
 */
export function saveLearning(learning: Omit<Learning, 'id' | 'createdAt' | 'updatedAt'>): Learning {
  initLearningRegistry();

  const id = generateId(learning.type, learning.category);
  const now = new Date().toISOString();

  const fullLearning: Learning = {
    ...learning,
    id,
    createdAt: now,
    updatedAt: now,
  };

  // Ensure category subdirectory exists
  const categoryDir = path.join(getTypeDir(learning.type), learning.category);
  if (!fs.existsSync(categoryDir)) {
    fs.mkdirSync(categoryDir, { recursive: true });
  }

  // Save as YAML file
  const filePath = path.join(categoryDir, `${id}.yaml`);
  const yamlContent = formatLearningAsYaml(fullLearning);
  fs.writeFileSync(filePath, yamlContent);

  // Update index
  const index = loadIndex();
  index.learnings.push({
    id,
    type: learning.type,
    title: learning.title,
    category: learning.category,
    tags: learning.tags,
    filePath: path.relative(LEARNING_DIR, filePath),
  });
  saveIndex(index);

  return fullLearning;
}

/**
 * Load a learning by ID
 */
export function loadLearning(id: string): Learning | null {
  const index = loadIndex();
  const entry = index.learnings.find(l => l.id === id);

  if (!entry) return null;

  const fullPath = path.join(LEARNING_DIR, entry.filePath);
  if (!fs.existsSync(fullPath)) return null;

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    return parseLearningFromYaml(content, id);
  } catch {
    return null;
  }
}

/**
 * Delete a learning by ID
 */
export function deleteLearning(id: string): boolean {
  const index = loadIndex();
  const entryIndex = index.learnings.findIndex(l => l.id === id);

  if (entryIndex === -1) return false;

  const entry = index.learnings[entryIndex];
  const fullPath = path.join(LEARNING_DIR, entry.filePath);

  // Remove from index
  index.learnings.splice(entryIndex, 1);
  saveIndex(index);

  // Delete file
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  return true;
}

/**
 * Search for relevant learnings based on keywords
 */
export function searchLearnings(keywords: string[], options?: {
  type?: LearningType;
  category?: string;
  limit?: number;
}): LearningIndexEntry[] {
  const index = loadIndex();
  let results = index.learnings;

  // Filter by type
  if (options?.type) {
    results = results.filter(l => l.type === options.type);
  }

  // Filter by category
  if (options?.category) {
    results = results.filter(l => l.category === options.category);
  }

  // Score by keyword matches
  const scored = results.map(entry => {
    let score = 0;
    const lowerTitle = entry.title.toLowerCase();
    const lowerTags = entry.tags.map(t => t.toLowerCase());
    const lowerCategory = entry.category.toLowerCase();

    for (const keyword of keywords) {
      const lowerKeyword = keyword.toLowerCase();

      // Title match is worth more
      if (lowerTitle.includes(lowerKeyword)) score += 3;

      // Tag match
      if (lowerTags.some(t => t.includes(lowerKeyword))) score += 2;

      // Category match
      if (lowerCategory.includes(lowerKeyword)) score += 1;
    }

    return { entry, score };
  });

  // Filter to entries with at least one match
  const matches = scored.filter(s => s.score > 0);

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  // Apply limit
  const limit = options?.limit ?? 10;
  return matches.slice(0, limit).map(s => s.entry);
}

/**
 * Get all learnings of a specific type
 */
export function getLearningsByType(type: LearningType): LearningIndexEntry[] {
  const index = loadIndex();
  return index.learnings.filter(l => l.type === type);
}

/**
 * Get all categories that have learnings
 */
export function getCategories(): { category: string; count: number }[] {
  const index = loadIndex();
  const categories = new Map<string, number>();

  for (const learning of index.learnings) {
    const count = categories.get(learning.category) ?? 0;
    categories.set(learning.category, count + 1);
  }

  return Array.from(categories.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get learning statistics
 */
export function getLearningStats(): {
  total: number;
  byType: Record<LearningType, number>;
  byCategory: Record<string, number>;
  lastUpdated: string;
} {
  const index = loadIndex();

  const byType: Record<LearningType, number> = {
    solution: 0,
    pattern: 0,
    'design-token': 0,
  };

  const byCategory: Record<string, number> = {};

  for (const learning of index.learnings) {
    byType[learning.type]++;
    byCategory[learning.category] = (byCategory[learning.category] ?? 0) + 1;
  }

  return {
    total: index.learnings.length,
    byType,
    byCategory,
    lastUpdated: index.lastUpdated,
  };
}

/**
 * Format a learning as YAML for storage
 */
function formatLearningAsYaml(learning: Learning): string {
  const lines: string[] = [
    `# ${learning.title}`,
    `# Type: ${learning.type}`,
    `# Category: ${learning.category}`,
    '',
    `id: "${learning.id}"`,
    `type: "${learning.type}"`,
    `title: "${escapeYamlString(learning.title)}"`,
    `description: "${escapeYamlString(learning.description)}"`,
    `category: "${learning.category}"`,
    `confidence: "${learning.confidence}"`,
  ];

  if (learning.sourceProject) {
    lines.push(`sourceProject: "${escapeYamlString(learning.sourceProject)}"`);
  }

  if (learning.sourceFile) {
    lines.push(`sourceFile: "${escapeYamlString(learning.sourceFile)}"`);
  }

  lines.push(`createdAt: "${learning.createdAt}"`);
  lines.push(`updatedAt: "${learning.updatedAt}"`);

  lines.push('tags:');
  for (const tag of learning.tags) {
    lines.push(`  - "${tag}"`);
  }

  if (learning.applyWhen) {
    lines.push(`applyWhen: "${escapeYamlString(learning.applyWhen)}"`);
  }

  lines.push('');
  lines.push('content: |');
  for (const line of learning.content.split('\n')) {
    lines.push(`  ${line}`);
  }

  if (learning.example) {
    lines.push('');
    lines.push('example: |');
    for (const line of learning.example.split('\n')) {
      lines.push(`  ${line}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse a learning from YAML content
 */
function parseLearningFromYaml(content: string, id: string): Learning | null {
  try {
    // Simple YAML parsing (not using a full YAML library to avoid dependencies)
    const getValue = (key: string): string => {
      const match = content.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?`, 'm'));
      return match ? match[1] : '';
    };

    const getMultilineValue = (key: string): string => {
      const match = content.match(new RegExp(`^${key}:\\s*\\|\\n([\\s\\S]*?)(?=\\n[a-z]+:|$)`, 'm'));
      if (!match) return '';

      // Remove leading 2-space indentation from each line
      return match[1]
        .split('\n')
        .map(line => line.replace(/^  /, ''))
        .join('\n')
        .trim();
    };

    const getTags = (): string[] => {
      const tagsMatch = content.match(/tags:\n((?:\s+-\s+"[^"]+"\n?)+)/);
      if (!tagsMatch) return [];

      const tagMatches = tagsMatch[1].matchAll(/\s+-\s+"([^"]+)"/g);
      return Array.from(tagMatches).map(m => m[1]);
    };

    return {
      id,
      type: getValue('type') as LearningType,
      title: getValue('title'),
      description: getValue('description'),
      category: getValue('category'),
      confidence: getValue('confidence') as 'high' | 'medium' | 'low',
      sourceProject: getValue('sourceProject') || undefined,
      sourceFile: getValue('sourceFile') || undefined,
      createdAt: getValue('createdAt'),
      updatedAt: getValue('updatedAt'),
      tags: getTags(),
      content: getMultilineValue('content'),
      applyWhen: getValue('applyWhen') || undefined,
      example: getMultilineValue('example') || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Escape special characters for YAML string
 */
function escapeYamlString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Query learnings relevant to a project context
 */
export function queryRelevantLearnings(
  techStack: string[],
  projectDescription: string,
  limit: number = 5
): Learning[] {
  // Build keywords from tech stack and project description
  const keywords = [
    ...techStack,
    ...projectDescription.toLowerCase().split(/[\s,.\-_()[\]]+/).filter(w => w.length > 3),
  ];

  // Search index
  const matches = searchLearnings(keywords, { limit: limit * 2 });

  // Load full learnings
  const learnings: Learning[] = [];
  for (const match of matches) {
    const learning = loadLearning(match.id);
    if (learning) {
      learnings.push(learning);
    }
  }

  return learnings.slice(0, limit);
}

/**
 * Format learnings for inclusion in a prompt
 */
export function formatLearningsForPrompt(learnings: Learning[]): string {
  if (learnings.length === 0) return '';

  let output = '## Relevant Learnings from Past Projects\n\n';
  output += 'The following learnings from previous projects may be helpful:\n\n';

  for (const learning of learnings) {
    output += `### [${learning.type.toUpperCase()}] ${learning.title}\n`;
    output += `**Category:** ${learning.category} | **Confidence:** ${learning.confidence}\n`;

    if (learning.applyWhen) {
      output += `**Apply when:** ${learning.applyWhen}\n`;
    }

    output += `\n${learning.description}\n`;

    if (learning.content) {
      output += '\n```\n' + learning.content.slice(0, 500) + '\n```\n';
    }

    output += '\n---\n\n';
  }

  return output;
}
