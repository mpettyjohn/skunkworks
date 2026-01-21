/**
 * Global Project Registry
 *
 * Manages ~/.skunkworks/projects.json - a central registry of all
 * Skunkworks projects across the filesystem.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface ProjectEntry {
  id: string;
  path: string;
  name: string;
  registeredAt: string;
  lastAccessedAt: string;
}

export interface GlobalProjectRegistry {
  version: 1;
  lastUpdated: string;
  projects: ProjectEntry[];
}

const REGISTRY_DIR = path.join(os.homedir(), '.skunkworks');
const REGISTRY_FILE = path.join(REGISTRY_DIR, 'projects.json');

/**
 * Generate a unique ID for a project based on its path
 */
function generateProjectId(projectPath: string): string {
  return crypto.createHash('md5').update(projectPath).digest('hex').slice(0, 12);
}

/**
 * Initialize the registry if it doesn't exist
 */
export function initRegistry(): GlobalProjectRegistry {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }

  if (fs.existsSync(REGISTRY_FILE)) {
    try {
      const content = fs.readFileSync(REGISTRY_FILE, 'utf-8');
      return JSON.parse(content) as GlobalProjectRegistry;
    } catch {
      // Corrupted file, create new
    }
  }

  const registry: GlobalProjectRegistry = {
    version: 1,
    lastUpdated: new Date().toISOString(),
    projects: [],
  };

  saveRegistry(registry);
  return registry;
}

/**
 * Save the registry to disk
 */
function saveRegistry(registry: GlobalProjectRegistry): void {
  registry.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Register a project in the global registry
 */
export function registerProject(projectPath: string, name?: string): ProjectEntry {
  const registry = initRegistry();
  const absolutePath = path.resolve(projectPath);
  const id = generateProjectId(absolutePath);

  // Check if already registered
  const existingIndex = registry.projects.findIndex(p => p.id === id);
  const now = new Date().toISOString();

  const entry: ProjectEntry = {
    id,
    path: absolutePath,
    name: name || path.basename(absolutePath),
    registeredAt: existingIndex >= 0 ? registry.projects[existingIndex].registeredAt : now,
    lastAccessedAt: now,
  };

  if (existingIndex >= 0) {
    // Update existing entry
    registry.projects[existingIndex] = entry;
  } else {
    // Add new entry
    registry.projects.push(entry);
  }

  saveRegistry(registry);
  return entry;
}

/**
 * Unregister a project from the global registry
 */
export function unregisterProject(projectPath: string): boolean {
  const registry = initRegistry();
  const absolutePath = path.resolve(projectPath);
  const id = generateProjectId(absolutePath);

  const initialLength = registry.projects.length;
  registry.projects = registry.projects.filter(p => p.id !== id);

  if (registry.projects.length < initialLength) {
    saveRegistry(registry);
    return true;
  }

  return false;
}

/**
 * List all registered projects
 */
export function listProjects(): ProjectEntry[] {
  const registry = initRegistry();
  return registry.projects;
}

/**
 * Get a project by ID
 */
export function getProject(id: string): ProjectEntry | undefined {
  const registry = initRegistry();
  return registry.projects.find(p => p.id === id);
}

/**
 * Get a project by path
 */
export function getProjectByPath(projectPath: string): ProjectEntry | undefined {
  const registry = initRegistry();
  const absolutePath = path.resolve(projectPath);
  const id = generateProjectId(absolutePath);
  return registry.projects.find(p => p.id === id);
}

/**
 * Find a project by name (case-insensitive, partial match)
 */
export function findProjectByName(searchTerm: string): ProjectEntry | undefined {
  const registry = initRegistry();
  const term = searchTerm.toLowerCase();

  // Try exact match first
  const exact = registry.projects.find(p => p.name.toLowerCase() === term);
  if (exact) return exact;

  // Try partial match
  return registry.projects.find(p => p.name.toLowerCase().includes(term));
}

/**
 * Find a project by index (1-based for user-friendliness)
 */
export function findProjectByIndex(index: number): ProjectEntry | undefined {
  const registry = initRegistry();
  // Sort by lastAccessedAt descending to match display order
  const sorted = [...registry.projects].sort((a, b) =>
    new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
  );
  return sorted[index - 1]; // Convert to 0-based
}

/**
 * Update a project's name
 */
export function updateProjectName(projectPath: string, newName: string): boolean {
  const registry = initRegistry();
  const absolutePath = path.resolve(projectPath);
  const id = generateProjectId(absolutePath);

  const project = registry.projects.find(p => p.id === id);
  if (project) {
    project.name = newName;
    saveRegistry(registry);
    return true;
  }
  return false;
}

/**
 * Update the last accessed time for a project
 */
export function touchProject(projectPath: string): void {
  const registry = initRegistry();
  const absolutePath = path.resolve(projectPath);
  const id = generateProjectId(absolutePath);

  const project = registry.projects.find(p => p.id === id);
  if (project) {
    project.lastAccessedAt = new Date().toISOString();
    saveRegistry(registry);
  }
}

/**
 * Remove entries where the project's state.json no longer exists
 */
export function pruneStale(): { removed: ProjectEntry[]; remaining: ProjectEntry[] } {
  const registry = initRegistry();
  const removed: ProjectEntry[] = [];
  const remaining: ProjectEntry[] = [];

  for (const project of registry.projects) {
    const stateFile = path.join(project.path, '.skunkworks', 'state.json');
    if (fs.existsSync(stateFile)) {
      remaining.push(project);
    } else {
      removed.push(project);
    }
  }

  if (removed.length > 0) {
    registry.projects = remaining;
    saveRegistry(registry);
  }

  return { removed, remaining };
}

/**
 * Get the path to the registry file
 */
export function getRegistryPath(): string {
  return REGISTRY_FILE;
}
