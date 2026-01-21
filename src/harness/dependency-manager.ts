/**
 * Dependency Manager
 *
 * Detects required runtimes from ARCHITECTURE.md and offers to install them.
 * Uses version managers (nvm, pyenv) when possible to avoid sudo.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

export interface RuntimeRequirement {
  name: string;
  command: string;
  version?: string;
  installCmd: {
    darwin: string;
    linux: string;
    win32: string;
  };
  versionManager?: {
    name: string;
    installCmd: string;
    useCmd: string;
  };
}

const KNOWN_RUNTIMES: Record<string, RuntimeRequirement> = {
  node: {
    name: 'Node.js',
    command: 'node',
    installCmd: {
      darwin: 'brew install node',
      linux: 'curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs',
      win32: 'winget install OpenJS.NodeJS.LTS',
    },
    versionManager: {
      name: 'nvm',
      installCmd: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash',
      useCmd: 'nvm install --lts && nvm use --lts',
    },
  },
  python: {
    name: 'Python',
    command: 'python3',
    installCmd: {
      darwin: 'brew install python',
      linux: 'sudo apt-get install -y python3 python3-pip',
      win32: 'winget install Python.Python.3.11',
    },
    versionManager: {
      name: 'pyenv',
      installCmd: 'curl https://pyenv.run | bash',
      useCmd: 'pyenv install 3.11 && pyenv global 3.11',
    },
  },
  ruby: {
    name: 'Ruby',
    command: 'ruby',
    installCmd: {
      darwin: 'brew install ruby',
      linux: 'sudo apt-get install -y ruby-full',
      win32: 'winget install RubyInstallerTeam.Ruby.3.2',
    },
  },
  go: {
    name: 'Go',
    command: 'go',
    installCmd: {
      darwin: 'brew install go',
      linux: 'sudo apt-get install -y golang',
      win32: 'winget install GoLang.Go',
    },
  },
  rust: {
    name: 'Rust',
    command: 'cargo',
    installCmd: {
      darwin: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
      linux: 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
      win32: 'winget install Rustlang.Rustup',
    },
  },
  java: {
    name: 'Java',
    command: 'java',
    installCmd: {
      darwin: 'brew install openjdk',
      linux: 'sudo apt-get install -y openjdk-17-jdk',
      win32: 'winget install Microsoft.OpenJDK.17',
    },
  },
};

/**
 * Check if a command is available
 */
async function isCommandAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const child = spawn(which, [command]);
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

/**
 * Detect required runtimes from architecture content
 */
export function detectRequiredRuntimes(architectureContent: string): string[] {
  const content = architectureContent.toLowerCase();
  const required: string[] = [];

  // Node.js indicators
  if (
    content.includes('node.js') ||
    content.includes('nodejs') ||
    content.includes('npm') ||
    content.includes('react') ||
    content.includes('next.js') ||
    content.includes('express') ||
    content.includes('typescript') ||
    content.includes('javascript')
  ) {
    required.push('node');
  }

  // Python indicators
  if (
    content.includes('python') ||
    content.includes('django') ||
    content.includes('flask') ||
    content.includes('fastapi') ||
    content.includes('pip')
  ) {
    required.push('python');
  }

  // Ruby indicators
  if (
    content.includes('ruby') ||
    content.includes('rails') ||
    content.includes('bundler')
  ) {
    required.push('ruby');
  }

  // Go indicators
  if (
    content.includes('golang') ||
    content.includes('go mod') ||
    content.includes('go build')
  ) {
    required.push('go');
  }

  // Rust indicators
  if (
    content.includes('rust') ||
    content.includes('cargo') ||
    content.includes('rustup')
  ) {
    required.push('rust');
  }

  // Java indicators
  if (
    content.includes('java') ||
    content.includes('spring') ||
    content.includes('maven') ||
    content.includes('gradle')
  ) {
    required.push('java');
  }

  return [...new Set(required)];
}

/**
 * Check which required runtimes are missing
 */
export async function checkMissingRuntimes(required: string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const runtime of required) {
    const info = KNOWN_RUNTIMES[runtime];
    if (info) {
      const available = await isCommandAvailable(info.command);
      if (!available) {
        missing.push(runtime);
      }
    }
  }

  return missing;
}

/**
 * Get install instructions for a runtime
 */
export function getInstallInstructions(runtime: string): string | null {
  const info = KNOWN_RUNTIMES[runtime];
  if (!info) return null;

  const platform = process.platform as 'darwin' | 'linux' | 'win32';
  const platformCmd = info.installCmd[platform] || info.installCmd.linux;

  let instructions = `To install ${info.name}:\n`;

  if (info.versionManager && platform !== 'win32') {
    instructions += `\nOption 1 (Recommended - uses ${info.versionManager.name}, no sudo required):\n`;
    instructions += `  ${info.versionManager.installCmd}\n`;
    instructions += `  ${info.versionManager.useCmd}\n`;
    instructions += `\nOption 2 (System install):\n`;
    instructions += `  ${platformCmd}\n`;
  } else {
    instructions += `  ${platformCmd}\n`;
  }

  return instructions;
}

/**
 * Prompt user about missing dependencies and offer to install
 */
export async function promptForDependencies(
  missing: string[],
  readline: typeof import('readline')
): Promise<'install' | 'manual' | 'skip'> {
  if (missing.length === 0) return 'skip';

  const missingNames = missing.map(r => KNOWN_RUNTIMES[r]?.name || r).join(', ');

  console.log(chalk.yellow(`\n⚠️  Missing Dependencies\n`));
  console.log(chalk.white(`This project requires: ${missingNames}\n`));

  console.log(chalk.gray('Options:'));
  console.log(chalk.white('  [1] Show me how to install (recommended)'));
  console.log(chalk.white('  [2] Skip and continue anyway'));
  console.log(chalk.white('  [3] Pause and come back later\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(chalk.green('Your choice [1]: '), (answer) => {
      rl.close();
      const choice = answer.trim() || '1';
      if (choice === '1') resolve('manual');
      else if (choice === '2') resolve('skip');
      else resolve('manual');
    });
  });
}

/**
 * Show installation instructions for missing runtimes
 */
export function showInstallInstructions(missing: string[]): void {
  console.log(chalk.blue('\n📦 Installation Instructions\n'));

  for (const runtime of missing) {
    const instructions = getInstallInstructions(runtime);
    if (instructions) {
      console.log(chalk.white(instructions));
      console.log();
    }
  }

  console.log(chalk.gray('After installing, run "skunkcontinue" to resume.\n'));
}
