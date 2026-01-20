/**
 * Status Derivation
 *
 * Reads project state and derives dashboard status information.
 */

import * as fs from 'fs';
import * as path from 'path';
import { listProjects, type ProjectEntry } from './registry.js';
import type { ProjectState, TodoItem } from '../harness/state.js';

export type ProjectStatus = 'BLOCKED' | 'NEEDS_YOU' | 'RUNNING' | 'COMPLETE';

export interface ProjectStatusInfo {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  phase: string;
  phaseLabel: string;
  progressPercent: number;
  blockingReason?: string;
  currentTask?: string;
  completedAt?: string;
  lastUpdated: string;
  error?: string;
}

// Phase labels for display
const PHASE_LABELS: Record<string, string> = {
  interviewer: 'INTERVIEW',
  architect: 'ARCHITECT',
  builder: 'BUILD',
  reviewer: 'REVIEW',
  complete: 'COMPLETE',
};

/**
 * Derive status from project state
 */
export function deriveStatus(state: ProjectState): ProjectStatus {
  if (state.currentPhase === 'complete') {
    return 'COMPLETE';
  }

  const blocked = state.todos.some(t => t.status === 'blocked');
  if (blocked) {
    return 'BLOCKED';
  }

  const running = state.todos.some(t => t.status === 'in_progress');
  if (running) {
    return 'RUNNING';
  }

  return 'NEEDS_YOU';
}

/**
 * Calculate progress percentage based on completed todos and phases
 */
export function getProgressPercent(state: ProjectState): number {
  const phaseOrder = ['interviewer', 'architect', 'builder', 'reviewer', 'complete'];
  const currentPhaseIndex = phaseOrder.indexOf(state.currentPhase);

  // Base progress from phase (0-80%)
  const phaseProgress = (currentPhaseIndex / (phaseOrder.length - 1)) * 80;

  // Additional progress from todos in current phase (0-20%)
  const currentPhaseTodos = state.todos.filter(t => t.phase === state.currentPhase);
  if (currentPhaseTodos.length === 0) {
    return Math.round(phaseProgress);
  }

  const completedTodos = currentPhaseTodos.filter(t => t.status === 'completed').length;
  const todoProgress = (completedTodos / currentPhaseTodos.length) * 20;

  return Math.round(phaseProgress + todoProgress);
}

/**
 * Extract the blocking reason from state
 */
export function getBlockingReason(state: ProjectState): string | undefined {
  const blockedTodo = state.todos.find(t => t.status === 'blocked');
  if (blockedTodo) {
    return blockedTodo.task;
  }

  // Check for recent history entries about questions
  const recentHistory = state.history.slice(-5);
  const questionEntry = recentHistory.find(h =>
    h.action === 'question' || h.details?.includes('Waiting for')
  );
  if (questionEntry?.details) {
    return questionEntry.details;
  }

  return undefined;
}

/**
 * Get the current task being worked on
 */
export function getCurrentTask(state: ProjectState): string | undefined {
  const inProgressTodo = state.todos.find(t => t.status === 'in_progress');
  if (inProgressTodo) {
    return inProgressTodo.task;
  }

  // Check chunks if in builder phase
  if (state.chunks && state.currentPhase === 'builder') {
    const currentPhase = state.chunks.phases[state.chunks.currentPhaseIndex];
    if (currentPhase) {
      return currentPhase.name;
    }
  }

  return undefined;
}

/**
 * Get status info for a single project
 */
export function getProjectStatus(projectPath: string): ProjectStatusInfo | null {
  const stateFile = path.join(projectPath, '.skunkworks', 'state.json');

  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(content) as ProjectState;

    const status = deriveStatus(state);
    const progressPercent = getProgressPercent(state);

    const info: ProjectStatusInfo = {
      id: '', // Will be filled by caller
      name: state.projectName,
      path: projectPath,
      status,
      phase: state.currentPhase,
      phaseLabel: PHASE_LABELS[state.currentPhase] || state.currentPhase.toUpperCase(),
      progressPercent,
      lastUpdated: state.lastUpdated,
    };

    if (status === 'BLOCKED') {
      info.blockingReason = getBlockingReason(state);
    }

    if (status === 'RUNNING') {
      info.currentTask = getCurrentTask(state);
    }

    if (status === 'COMPLETE') {
      // Find completion time from history
      const completeEntry = state.history.find(h =>
        h.action === 'phase_change' && h.details?.includes('complete')
      );
      info.completedAt = completeEntry?.timestamp;
    }

    return info;
  } catch (error) {
    return {
      id: '',
      name: path.basename(projectPath),
      path: projectPath,
      status: 'BLOCKED',
      phase: 'unknown',
      phaseLabel: 'ERROR',
      progressPercent: 0,
      lastUpdated: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Failed to read state',
    };
  }
}

/**
 * Get status info for all registered projects
 */
export function getAllProjectStatuses(): ProjectStatusInfo[] {
  const projects = listProjects();
  const statuses: ProjectStatusInfo[] = [];

  for (const project of projects) {
    const status = getProjectStatus(project.path);
    if (status) {
      status.id = project.id;
      statuses.push(status);
    }
  }

  // Sort: BLOCKED first, then NEEDS_YOU, then RUNNING, then COMPLETE
  const statusOrder: Record<ProjectStatus, number> = {
    BLOCKED: 0,
    NEEDS_YOU: 1,
    RUNNING: 2,
    COMPLETE: 3,
  };

  statuses.sort((a, b) => {
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    // Within same status, sort by last updated (most recent first)
    return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
  });

  return statuses;
}

/**
 * Get full project state (for web dashboard details)
 */
export function getFullProjectState(projectPath: string): ProjectState | null {
  const stateFile = path.join(projectPath, '.skunkworks', 'state.json');

  if (!fs.existsSync(stateFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(content) as ProjectState;
  } catch {
    return null;
  }
}

/**
 * Get artifact content (SPEC.md, ARCHITECTURE.md, REVIEW.md)
 */
export function getArtifactContent(
  projectPath: string,
  artifact: 'spec' | 'architecture' | 'review'
): string | null {
  const fileNames: Record<string, string> = {
    spec: 'SPEC.md',
    architecture: 'ARCHITECTURE.md',
    review: 'REVIEW.md',
  };

  const filePath = path.join(projectPath, '.skunkworks', fileNames[artifact]);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
