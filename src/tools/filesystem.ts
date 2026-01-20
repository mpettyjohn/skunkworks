/**
 * Filesystem Tools
 *
 * Provides file operations for agents to read/write/list files.
 * "LLMs have been extensively trained on filesystems. Even if you're not
 * making a coding agent, it's the most effective way to manage context."
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface FileResult {
  success: boolean;
  path: string;
  content?: string;
  error?: string;
}

export interface ListResult {
  success: boolean;
  files: string[];
  error?: string;
}

/**
 * Read a file's contents
 */
export async function readFile(filePath: string): Promise<FileResult> {
  try {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        path: absolutePath,
        error: `File not found: ${absolutePath}`,
      };
    }

    const content = fs.readFileSync(absolutePath, 'utf-8');
    return {
      success: true,
      path: absolutePath,
      content,
    };
  } catch (error) {
    return {
      success: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Write content to a file (creates directories if needed)
 */
export async function writeFile(
  filePath: string,
  content: string
): Promise<FileResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content, 'utf-8');
    return {
      success: true,
      path: absolutePath,
    };
  } catch (error) {
    return {
      success: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Append content to a file
 */
export async function appendFile(
  filePath: string,
  content: string
): Promise<FileResult> {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(absolutePath, content, 'utf-8');
    return {
      success: true,
      path: absolutePath,
    };
  } catch (error) {
    return {
      success: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a file
 */
export async function deleteFile(filePath: string): Promise<FileResult> {
  try {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        path: absolutePath,
        error: `File not found: ${absolutePath}`,
      };
    }

    fs.unlinkSync(absolutePath);
    return {
      success: true,
      path: absolutePath,
    };
  } catch (error) {
    return {
      success: false,
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * List files matching a glob pattern
 */
export async function listFiles(pattern: string): Promise<ListResult> {
  try {
    const files = await glob(pattern, {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });

    return {
      success: true,
      files: files.sort(),
    };
  } catch (error) {
    return {
      success: false,
      files: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  const absolutePath = path.resolve(filePath);
  return fs.existsSync(absolutePath);
}

/**
 * Get file info (size, modified date, etc.)
 */
export async function getFileInfo(filePath: string): Promise<{
  exists: boolean;
  size?: number;
  modified?: Date;
  isDirectory?: boolean;
}> {
  try {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      return { exists: false };
    }

    const stats = fs.statSync(absolutePath);
    return {
      exists: true,
      size: stats.size,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Create a directory
 */
export async function createDirectory(dirPath: string): Promise<FileResult> {
  try {
    const absolutePath = path.resolve(dirPath);
    fs.mkdirSync(absolutePath, { recursive: true });
    return {
      success: true,
      path: absolutePath,
    };
  } catch (error) {
    return {
      success: false,
      path: dirPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Copy a file
 */
export async function copyFile(
  sourcePath: string,
  destPath: string
): Promise<FileResult> {
  try {
    const absoluteSource = path.resolve(sourcePath);
    const absoluteDest = path.resolve(destPath);

    if (!fs.existsSync(absoluteSource)) {
      return {
        success: false,
        path: absoluteSource,
        error: `Source file not found: ${absoluteSource}`,
      };
    }

    // Create destination directory if needed
    const destDir = path.dirname(absoluteDest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(absoluteSource, absoluteDest);
    return {
      success: true,
      path: absoluteDest,
    };
  } catch (error) {
    return {
      success: false,
      path: destPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
