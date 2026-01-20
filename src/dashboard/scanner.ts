/**
 * Project Scanner
 *
 * Discovers .skunkworks/ directories in the filesystem to find
 * unregistered Skunkworks projects.
 */

import * as fs from 'fs';
import * as path from 'path';
import { registerProject, type ProjectEntry } from './registry.js';

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.cache',
  '.tmp',
  'tmp',
  'temp',
  '.Trash',
  'Library',
  'Applications',
]);

// File patterns that indicate a non-project directory
const SKIP_IF_CONTAINS = [
  '.dmg',
  '.app',
  '.framework',
];

export interface ScanResult {
  discovered: ProjectEntry[];
  scanned: number;
  skipped: number;
}

/**
 * Scan for .skunkworks directories and register discovered projects
 */
export function scanForProjects(
  basePaths: string[],
  maxDepth: number = 4
): ScanResult {
  const discovered: ProjectEntry[] = [];
  let scanned = 0;
  let skipped = 0;

  const seen = new Set<string>();

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) return;

    // Normalize and check if already seen
    const normalizedDir = path.resolve(dir);
    if (seen.has(normalizedDir)) return;
    seen.add(normalizedDir);

    // Skip certain directory names
    const dirName = path.basename(dir);
    if (SKIP_DIRS.has(dirName) || dirName.startsWith('.')) {
      if (dirName !== '.skunkworks') {
        skipped++;
        return;
      }
    }

    // Check if this directory contains skip patterns
    if (SKIP_IF_CONTAINS.some(pattern => dir.includes(pattern))) {
      skipped++;
      return;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // Check if this is a skunkworks project
      const hasSkunkworks = entries.some(
        e => e.isDirectory() && e.name === '.skunkworks'
      );

      if (hasSkunkworks) {
        const stateFile = path.join(dir, '.skunkworks', 'state.json');
        if (fs.existsSync(stateFile)) {
          try {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            const entry = registerProject(dir, state.projectName);
            discovered.push(entry);
          } catch {
            // Corrupted state file, still register with directory name
            const entry = registerProject(dir);
            discovered.push(entry);
          }
        }
      }

      scanned++;

      // Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          scan(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // Permission denied or other error, skip
      skipped++;
    }
  }

  for (const basePath of basePaths) {
    const resolved = path.resolve(basePath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      scan(resolved, 0);
    }
  }

  return { discovered, scanned, skipped };
}

/**
 * Quick scan of common project locations
 */
export function scanCommonLocations(): ScanResult {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const commonPaths = [
    path.join(home, 'Projects'),
    path.join(home, 'projects'),
    path.join(home, 'Developer'),
    path.join(home, 'dev'),
    path.join(home, 'Code'),
    path.join(home, 'code'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
  ].filter(p => fs.existsSync(p));

  return scanForProjects(commonPaths, 3);
}
