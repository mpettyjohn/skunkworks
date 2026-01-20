/**
 * State Manager
 *
 * Persists state to filesystem (markdown files) so work survives session restarts.
 * Key insight from community: "To have an agent work for long periods and stay
 * coherent, ask it to create a comprehensive todo list with checkpoints."
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  phase: 'interviewer' | 'architect' | 'builder' | 'reviewer';
  checkpoint?: string;
  createdAt: string;
  completedAt?: string;
}

export interface GitHubConfig {
  repoName: string;
  repoUrl: string;
  projectId?: string;
  projectUrl?: string;
  isEnabled: boolean;
}

export interface ChunkPhase {
  name: string;
  goal: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  tasks: string[];
  isMilestone: boolean;
  verificationLevel: 'tests' | 'full';
  fixAttempts: number;
  completedAt?: string;
}

export interface ChunkState {
  currentPhaseIndex: number;
  phases: ChunkPhase[];
}

export interface ProjectState {
  projectName: string;
  projectPath: string;
  currentPhase: 'interviewer' | 'architect' | 'builder' | 'reviewer' | 'complete';
  todos: TodoItem[];
  artifacts: {
    spec?: string;
    architecture?: string;
    review?: string;
  };
  github?: GitHubConfig;
  chunks?: ChunkState;
  history: Array<{
    timestamp: string;
    phase: string;
    action: string;
    details?: string;
  }>;
  createdAt: string;
  lastUpdated: string;
}

const STATE_FILE = '.skunkworks/state.json';
const SPEC_FILE = '.skunkworks/SPEC.md';
const ARCHITECTURE_FILE = '.skunkworks/ARCHITECTURE.md';
const DESIGN_SPEC_FILE = '.skunkworks/DESIGN_SPEC.yaml';
const TODO_FILE = '.skunkworks/TODO.md';
const REVIEW_FILE = '.skunkworks/REVIEW.md';
const CHUNK_CONTEXT_FILE = '.skunkworks/CHUNK_CONTEXT.md';

export class StateManager {
  private projectPath: string;
  private state: ProjectState;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.state = this.loadState();
  }

  private get statePath(): string {
    return path.join(this.projectPath, STATE_FILE);
  }

  private ensureDirectory(): void {
    const dir = path.join(this.projectPath, '.skunkworks');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private loadState(): ProjectState {
    this.ensureDirectory();

    if (fs.existsSync(this.statePath)) {
      const content = fs.readFileSync(this.statePath, 'utf-8');
      return JSON.parse(content);
    }

    // Initialize new state
    return {
      projectName: path.basename(this.projectPath),
      projectPath: this.projectPath,
      currentPhase: 'interviewer',
      todos: [],
      artifacts: {},
      history: [],
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  private saveState(): void {
    this.ensureDirectory();
    this.state.lastUpdated = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  // Phase management
  getCurrentPhase(): ProjectState['currentPhase'] {
    return this.state.currentPhase;
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  setPhase(phase: ProjectState['currentPhase']): void {
    this.addHistory('phase_change', `Changed to ${phase}`);
    this.state.currentPhase = phase;
    this.saveState();
  }

  // Todo management
  addTodo(task: string, phase: TodoItem['phase']): TodoItem {
    const todo: TodoItem = {
      id: `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      task,
      status: 'pending',
      phase,
      createdAt: new Date().toISOString(),
    };
    this.state.todos.push(todo);
    this.saveState();
    this.syncTodoFile();
    return todo;
  }

  updateTodo(id: string, updates: Partial<TodoItem>): void {
    const index = this.state.todos.findIndex(t => t.id === id);
    if (index !== -1) {
      this.state.todos[index] = { ...this.state.todos[index], ...updates };
      if (updates.status === 'completed') {
        this.state.todos[index].completedAt = new Date().toISOString();
      }
      this.saveState();
      this.syncTodoFile();
    }
  }

  getTodos(phase?: TodoItem['phase']): TodoItem[] {
    if (phase) {
      return this.state.todos.filter(t => t.phase === phase);
    }
    return this.state.todos;
  }

  getPendingTodos(phase?: TodoItem['phase']): TodoItem[] {
    return this.getTodos(phase).filter(t => t.status === 'pending' || t.status === 'in_progress');
  }

  // Sync todos to human-readable markdown file
  private syncTodoFile(): void {
    const todoPath = path.join(this.projectPath, TODO_FILE);
    let content = '# Implementation Todo List\n\n';
    content += `Last updated: ${new Date().toISOString()}\n\n`;

    const phases = ['interviewer', 'architect', 'builder', 'reviewer'] as const;
    for (const phase of phases) {
      const phaseTodos = this.getTodos(phase);
      if (phaseTodos.length > 0) {
        content += `## ${phase.charAt(0).toUpperCase() + phase.slice(1)} Phase\n\n`;
        for (const todo of phaseTodos) {
          const checkbox = todo.status === 'completed' ? '[x]' :
                          todo.status === 'in_progress' ? '[~]' : '[ ]';
          content += `- ${checkbox} ${todo.task}\n`;
          if (todo.checkpoint) {
            content += `  - Checkpoint: ${todo.checkpoint}\n`;
          }
        }
        content += '\n';
      }
    }

    fs.writeFileSync(todoPath, content);
  }

  // Artifact management
  saveSpec(content: string): void {
    const specPath = path.join(this.projectPath, SPEC_FILE);
    fs.writeFileSync(specPath, content);
    this.state.artifacts.spec = specPath;
    this.addHistory('artifact', 'Saved SPEC.md');
    this.saveState();
  }

  saveArchitecture(content: string): void {
    const archPath = path.join(this.projectPath, ARCHITECTURE_FILE);
    fs.writeFileSync(archPath, content);
    this.state.artifacts.architecture = archPath;
    this.addHistory('artifact', 'Saved ARCHITECTURE.md');
    this.saveState();
  }

  saveReview(content: string): void {
    const reviewPath = path.join(this.projectPath, REVIEW_FILE);
    fs.writeFileSync(reviewPath, content);
    this.state.artifacts.review = reviewPath;
    this.addHistory('artifact', 'Saved REVIEW.md');
    this.saveState();
  }

  getSpec(): string | null {
    const specPath = path.join(this.projectPath, SPEC_FILE);
    if (fs.existsSync(specPath)) {
      return fs.readFileSync(specPath, 'utf-8');
    }
    return null;
  }

  getArchitecture(): string | null {
    const archPath = path.join(this.projectPath, ARCHITECTURE_FILE);
    if (fs.existsSync(archPath)) {
      return fs.readFileSync(archPath, 'utf-8');
    }
    return null;
  }

  getDesignSpec(): string | null {
    const designPath = path.join(this.projectPath, DESIGN_SPEC_FILE);
    if (fs.existsSync(designPath)) {
      return fs.readFileSync(designPath, 'utf-8');
    }
    return null;
  }

  saveDesignSpec(content: string): void {
    const designPath = path.join(this.projectPath, DESIGN_SPEC_FILE);
    fs.writeFileSync(designPath, content);
    this.addHistory('artifact', 'Saved DESIGN_SPEC.yaml');
    this.saveState();
  }

  // History tracking
  addHistory(action: string, details?: string): void {
    this.state.history.push({
      timestamp: new Date().toISOString(),
      phase: this.state.currentPhase,
      action,
      details,
    });
    // Keep last 100 history items
    if (this.state.history.length > 100) {
      this.state.history = this.state.history.slice(-100);
    }
  }

  // Checkpoint for recovery
  createCheckpoint(name: string): string {
    const checkpoint = {
      name,
      timestamp: new Date().toISOString(),
      state: { ...this.state },
    };
    const checkpointPath = path.join(
      this.projectPath,
      '.skunkworks',
      'checkpoints',
      `${name}_${Date.now()}.json`
    );
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    this.addHistory('checkpoint', `Created checkpoint: ${name}`);
    return checkpointPath;
  }

  // Get full state for context
  getFullState(): ProjectState {
    return { ...this.state };
  }

  // GitHub integration
  setGitHubConfig(config: GitHubConfig): void {
    this.state.github = config;
    this.addHistory('github', `Configured GitHub: ${config.repoUrl}`);
    this.saveState();
  }

  getGitHubConfig(): GitHubConfig | undefined {
    return this.state.github;
  }

  isGitHubEnabled(): boolean {
    return this.state.github?.isEnabled ?? false;
  }

  updateGitHubProject(projectId: string, projectUrl: string): void {
    if (this.state.github) {
      this.state.github.projectId = projectId;
      this.state.github.projectUrl = projectUrl;
      this.addHistory('github', `Created project board: ${projectUrl}`);
      this.saveState();
    }
  }

  // Chunk management for phased building
  parsePhases(architecture: string): ChunkPhase[] {
    const phases: ChunkPhase[] = [];
    const phaseRegex = /### Phase (\d+): ([^\n(]+)(?:\s*\(Milestone\))?[\s\S]*?\*\*Goal:\*\* ([^\n]+)[\s\S]*?\*\*Verification:\*\* (Tests|Full)[\s\S]*?\*\*Tasks:\*\*([\s\S]*?)(?=### Phase \d+:|## |$)/gi;

    let match;
    while ((match = phaseRegex.exec(architecture)) !== null) {
      const [, , name, goal, verification, tasksBlock] = match;
      const isMilestone = match[0].includes('(Milestone)');
      const tasks = tasksBlock
        .split('\n')
        .filter(line => line.trim().startsWith('- [ ]'))
        .map(line => line.replace(/^[\s-]*\[ \]\s*/, '').trim())
        .filter(task => task.length > 0);

      phases.push({
        name: name.trim(),
        goal: goal.trim(),
        status: 'pending',
        tasks,
        isMilestone,
        verificationLevel: verification.toLowerCase() as 'tests' | 'full',
        fixAttempts: 0,
      });
    }

    return phases;
  }

  initializeChunks(phases: ChunkPhase[]): void {
    this.state.chunks = {
      currentPhaseIndex: 0,
      phases,
    };
    this.addHistory('chunks', `Initialized ${phases.length} implementation phases`);
    this.saveState();
  }

  getChunks(): ChunkState | undefined {
    return this.state.chunks;
  }

  getCurrentChunkPhase(): ChunkPhase | null {
    if (!this.state.chunks || this.state.chunks.currentPhaseIndex >= this.state.chunks.phases.length) {
      return null;
    }
    return this.state.chunks.phases[this.state.chunks.currentPhaseIndex];
  }

  getTotalChunkPhases(): number {
    return this.state.chunks?.phases.length ?? 0;
  }

  getCurrentChunkPhaseIndex(): number {
    return this.state.chunks?.currentPhaseIndex ?? 0;
  }

  setChunkPhaseStatus(status: ChunkPhase['status']): void {
    const phase = this.getCurrentChunkPhase();
    if (phase) {
      phase.status = status;
      if (status === 'completed') {
        phase.completedAt = new Date().toISOString();
      }
      this.addHistory('chunks', `Phase "${phase.name}" status: ${status}`);
      this.saveState();
    }
  }

  advanceChunkPhase(): void {
    if (this.state.chunks) {
      this.state.chunks.currentPhaseIndex++;
      this.addHistory('chunks', `Advanced to phase ${this.state.chunks.currentPhaseIndex + 1}`);
      this.saveState();
    }
  }

  markChunkPhaseFailed(): void {
    this.setChunkPhaseStatus('failed');
  }

  incrementFixAttempt(): number {
    const phase = this.getCurrentChunkPhase();
    if (phase) {
      phase.fixAttempts++;
      this.saveState();
      return phase.fixAttempts;
    }
    return 0;
  }

  resetFixAttempts(): void {
    const phase = this.getCurrentChunkPhase();
    if (phase) {
      phase.fixAttempts = 0;
      this.saveState();
    }
  }

  // Chunk context management
  saveChunkContext(content: string): void {
    const contextPath = path.join(this.projectPath, CHUNK_CONTEXT_FILE);
    fs.writeFileSync(contextPath, content);
    this.addHistory('chunks', 'Updated chunk context');
  }

  getChunkContext(): string | null {
    const contextPath = path.join(this.projectPath, CHUNK_CONTEXT_FILE);
    if (fs.existsSync(contextPath)) {
      return fs.readFileSync(contextPath, 'utf-8');
    }
    return null;
  }

  isChunkedBuildComplete(): boolean {
    if (!this.state.chunks) return true;
    return this.state.chunks.currentPhaseIndex >= this.state.chunks.phases.length;
  }
}
