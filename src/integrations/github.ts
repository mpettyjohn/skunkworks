/**
 * GitHub Integration
 *
 * Wrapper around the `gh` CLI for Skunkworks to interact with GitHub.
 * Creates repos, issues, and manages project boards.
 */

import { spawn } from 'child_process';
import chalk from 'chalk';

export interface GitHubConfig {
  repoName: string;
  repoUrl: string;
  projectId?: string;
  projectUrl?: string;
  isEnabled: boolean;
}

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
}

/**
 * GitHub CLI wrapper
 */
export class GitHubIntegration {
  private config: GitHubConfig | null = null;

  /**
   * Check if gh CLI is installed
   */
  async isGhInstalled(): Promise<boolean> {
    try {
      await this.runGh(['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if user is authenticated with gh
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      await this.runGh(['auth', 'status']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current GitHub username
   */
  async getUsername(): Promise<string> {
    const result = await this.runGh(['api', 'user', '-q', '.login']);
    return result.trim();
  }

  /**
   * Initialize a new GitHub repo from the current directory
   */
  async initRepo(
    name: string,
    description: string,
    isPrivate: boolean = true
  ): Promise<GitHubConfig> {
    // Check if already a git repo
    try {
      await this.runCommand('git', ['status']);
    } catch {
      // Initialize git if not already
      await this.runCommand('git', ['init']);
    }

    // Create the GitHub repo
    const visibility = isPrivate ? '--private' : '--public';
    const result = await this.runGh([
      'repo',
      'create',
      name,
      visibility,
      '--description',
      description,
      '--source',
      '.',
      '--push',
    ]);

    // Get the repo URL
    const repoUrl = await this.runGh(['repo', 'view', '--json', 'url', '-q', '.url']);

    this.config = {
      repoName: name,
      repoUrl: repoUrl.trim(),
      isEnabled: true,
    };

    return this.config;
  }

  /**
   * Create a GitHub Project board
   */
  async createProject(title: string): Promise<{ projectId: string; projectUrl: string }> {
    const username = await this.getUsername();

    // Create a new project (GitHub Projects v2)
    const createResult = await this.runGh([
      'project',
      'create',
      '--owner',
      username,
      '--title',
      title,
      '--format',
      'json',
    ]);

    const project = JSON.parse(createResult);
    const projectId = project.number.toString();

    // Get project URL
    const projectUrl = `https://github.com/users/${username}/projects/${projectId}`;

    if (this.config) {
      this.config.projectId = projectId;
      this.config.projectUrl = projectUrl;
    }

    return { projectId, projectUrl };
  }

  /**
   * Create a GitHub issue
   */
  async createIssue(
    title: string,
    body: string,
    labels: string[] = []
  ): Promise<GitHubIssue> {
    const args = ['issue', 'create', '--title', title, '--body', body];

    if (labels.length > 0) {
      args.push('--label', labels.join(','));
    }

    const result = await this.runGh(args);

    // Parse the issue URL to get the number
    const urlMatch = result.match(/\/issues\/(\d+)/);
    const number = urlMatch ? parseInt(urlMatch[1], 10) : 0;

    return {
      number,
      title,
      url: result.trim(),
    };
  }

  /**
   * Close a GitHub issue
   */
  async closeIssue(issueNumber: number, comment?: string): Promise<void> {
    if (comment) {
      await this.runGh(['issue', 'comment', issueNumber.toString(), '--body', comment]);
    }
    await this.runGh(['issue', 'close', issueNumber.toString()]);
  }

  /**
   * Add an issue to the project board
   */
  async addIssueToProject(issueNumber: number): Promise<void> {
    if (!this.config?.projectId) {
      return;
    }

    const username = await this.getUsername();
    const issueUrl = `${this.config.repoUrl}/issues/${issueNumber}`;

    await this.runGh([
      'project',
      'item-add',
      this.config.projectId,
      '--owner',
      username,
      '--url',
      issueUrl,
    ]);
  }

  /**
   * Update issue status on project board
   * Status: "Backlog", "In Progress", "Done"
   */
  async updateIssueStatus(issueNumber: number, status: string): Promise<void> {
    if (!this.config?.projectId) {
      return;
    }

    // Note: GitHub Projects v2 requires GraphQL for status updates
    // For now, we'll rely on issue close/open for status
    // Full status column support would require GraphQL mutations
    console.log(chalk.gray(`  → Issue #${issueNumber} status: ${status}`));
  }

  /**
   * Commit and push changes
   */
  async commitAndPush(message: string): Promise<void> {
    await this.runCommand('git', ['add', '.']);
    await this.runCommand('git', ['commit', '-m', message]);
    await this.runCommand('git', ['push']);
  }

  /**
   * Get list of open issues
   */
  async getOpenIssues(): Promise<GitHubIssue[]> {
    const result = await this.runGh([
      'issue',
      'list',
      '--state',
      'open',
      '--json',
      'number,title,url',
    ]);

    return JSON.parse(result);
  }

  /**
   * Load config from state
   */
  loadConfig(config: GitHubConfig | null): void {
    this.config = config;
  }

  /**
   * Get current config
   */
  getConfig(): GitHubConfig | null {
    return this.config;
  }

  /**
   * Check if GitHub is configured for current project
   */
  isConfigured(): boolean {
    return this.config?.isEnabled ?? false;
  }

  /**
   * Run a gh CLI command
   */
  private runGh(args: string[]): Promise<string> {
    return this.runCommand('gh', args);
  }

  /**
   * Run a command and return output
   */
  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }
}

// Singleton instance
export const github = new GitHubIntegration();
