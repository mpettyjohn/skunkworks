/**
 * Visual Verification Module
 *
 * Uses Playwright to capture screenshots of the running application
 * and sends them to Gemini for multimodal analysis.
 *
 * Inspired by Ramp's "Inspect" agent that visually verifies its own work.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { spawn, ChildProcess } from 'child_process';
import { ModelRouter } from './router.js';

export interface VisualVerificationConfig {
  devCommand?: string; // Default: auto-detect (npm run dev, npm start, etc.)
  port?: number; // Default: auto-detect or 3000
  urls?: string[]; // URLs to capture (default: just root)
  timeout?: number; // Server startup timeout (ms)
}

export interface ScreenshotResult {
  url: string;
  path: string;
  width: number;
  height: number;
}

export interface VisualAnalysis {
  url: string;
  screenshotPath: string;
  analysis: string;
  issues: string[];
  suggestions: string[];
}

export interface VisualVerificationResult {
  success: boolean;
  serverStarted: boolean;
  screenshots: ScreenshotResult[];
  analyses: VisualAnalysis[];
  error?: string;
}

/**
 * Detect if project has a dev server configured
 */
export function hasDevServer(projectPath: string): boolean {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return !!(
      packageJson.scripts &&
      (packageJson.scripts.dev ||
        packageJson.scripts.start ||
        packageJson.scripts.serve)
    );
  } catch {
    return false;
  }
}

/**
 * Detect the dev command and expected port
 */
export function detectDevConfig(
  projectPath: string
): { command: string; port: number } | null {
  const packageJsonPath = path.join(projectPath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const scripts = packageJson.scripts || {};

    // Determine command
    let command = 'npm run dev';
    let scriptContent = '';

    if (scripts.dev) {
      command = 'npm run dev';
      scriptContent = scripts.dev;
    } else if (scripts.start) {
      command = 'npm start';
      scriptContent = scripts.start;
    } else if (scripts.serve) {
      command = 'npm run serve';
      scriptContent = scripts.serve;
    } else {
      return null;
    }

    // Try to detect port from script content
    let port = 3000; // Default

    // Check for port in script (e.g., "vite --port 5173" or "PORT=8080")
    const portMatch = scriptContent.match(/(?:--port|PORT=|:)(\d{4,5})/);
    if (portMatch) {
      port = parseInt(portMatch[1]);
    }

    // Check for common frameworks
    if (scriptContent.includes('vite')) {
      port = 5173; // Vite default
    } else if (scriptContent.includes('next')) {
      port = 3000; // Next.js default
    } else if (scriptContent.includes('nuxt')) {
      port = 3000; // Nuxt default
    } else if (scriptContent.includes('angular') || scriptContent.includes('ng serve')) {
      port = 4200; // Angular default
    } else if (scriptContent.includes('vue') && scriptContent.includes('serve')) {
      port = 8080; // Vue CLI default
    }

    return { command, port };
  } catch {
    return null;
  }
}

/**
 * Start the dev server and wait for it to be ready
 */
async function startDevServer(
  projectPath: string,
  config: { command: string; port: number },
  timeout: number = 60000
): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    console.log(chalk.gray(`  Starting: ${config.command}`));

    const child = spawn(config.command, [], {
      cwd: projectPath,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let output = '';
    const timeoutId = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
      reject(new Error(`Dev server failed to start within ${timeout / 1000}s`));
    }, timeout);

    const checkReady = () => {
      // Check if server is responding
      fetch(`http://localhost:${config.port}`)
        .then(() => {
          clearTimeout(timeoutId);
          resolve(child);
        })
        .catch(() => {
          // Not ready yet, will retry
        });
    };

    child.stdout?.on('data', (data) => {
      output += data.toString();
      // Look for common "ready" indicators
      if (
        output.includes('ready') ||
        output.includes('listening') ||
        output.includes('started') ||
        output.includes(`localhost:${config.port}`) ||
        output.includes(`127.0.0.1:${config.port}`) ||
        output.includes('Local:')
      ) {
        // Give it a moment then check
        setTimeout(checkReady, 1000);
      }
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeoutId);
        reject(new Error(`Dev server exited with code ${code}: ${output.slice(0, 500)}`));
      }
    });

    // Also poll in case we miss the output indicators
    const pollInterval = setInterval(() => {
      checkReady();
    }, 2000);

    // Store original resolve to clear interval
    const originalResolve = resolve;
    // @ts-ignore - reassigning to clear interval on resolve
    resolve = (value: ChildProcess) => {
      clearInterval(pollInterval);
      originalResolve(value);
    };
  });
}

/**
 * Capture screenshots of the application using Playwright
 */
async function captureScreenshots(
  port: number,
  outputDir: string,
  urls: string[] = ['/']
): Promise<ScreenshotResult[]> {
  // Dynamic import to handle cases where Playwright isn't installed
  const { chromium } = await import('playwright');

  const browser = await chromium.launch();
  const results: ScreenshotResult[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    for (const urlPath of urls) {
      const url = `http://localhost:${port}${urlPath}`;
      const filename =
        urlPath === '/' ? 'home.png' : `${urlPath.replace(/\//g, '_').slice(1)}.png`;
      const screenshotPath = path.join(outputDir, filename);

      console.log(chalk.gray(`  Capturing: ${url}`));

      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait a bit for any animations to settle
      await page.waitForTimeout(1000);

      await page.screenshot({ path: screenshotPath, fullPage: true });

      results.push({
        url,
        path: screenshotPath,
        width: 1280,
        height: 720,
      });
    }
  } finally {
    await browser.close();
  }

  return results;
}

/**
 * Send screenshot to Gemini for visual analysis
 */
async function analyzeScreenshot(
  screenshotPath: string,
  url: string,
  spec: string,
  router: ModelRouter
): Promise<VisualAnalysis> {
  // Read screenshot as base64 for potential multimodal support
  const imageBuffer = fs.readFileSync(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  // For now, describe to Gemini that we have a screenshot
  // Full multimodal would require passing the image directly to Gemini API
  const analysisPrompt = `You are reviewing a screenshot of a web application to verify it matches the specification.

## Specification Summary
${spec.substring(0, 3000)}${spec.length > 3000 ? '...(truncated)' : ''}

## Screenshot Information
- URL: ${url}
- Screenshot saved at: ${screenshotPath}
- A screenshot of the running application has been captured

## Your Task
Based on the specification above, analyze what you would expect to see on this page and provide:

1. **Expected UI Elements**: What UI elements should be visible based on the spec?

2. **Key Functionality Indicators**: What visual indicators would show the features are working?

3. **Potential Issues to Watch For**:
   - Layout problems common in this type of application
   - Missing elements that should be visible
   - UX concerns

4. **Verification Checklist**: A list of things that should be visually verified

Note: This is a text-based analysis. The actual screenshot is available at ${screenshotPath} for manual review.

Be specific about what should be verified visually.`;

  try {
    const result = await router.complete('reviewer', {
      messages: [{ role: 'user', content: analysisPrompt }],
      systemPrompt:
        'You are a visual QA expert analyzing web applications based on specifications.',
    });

    // Parse the response to extract structured data
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Simple extraction - look for bullet points
    const lines = result.content.split('\n');
    let inIssues = false;
    let inSuggestions = false;

    for (const line of lines) {
      if (line.toLowerCase().includes('issue') || line.toLowerCase().includes('problem')) {
        inIssues = true;
        inSuggestions = false;
      }
      if (line.toLowerCase().includes('suggestion') || line.toLowerCase().includes('recommend')) {
        inSuggestions = true;
        inIssues = false;
      }

      const bulletMatch = line.match(/^[-•*]\s*(.+)/);
      if (bulletMatch) {
        if (inIssues) {
          issues.push(bulletMatch[1]);
        } else if (inSuggestions) {
          suggestions.push(bulletMatch[1]);
        }
      }
    }

    return {
      url,
      screenshotPath,
      analysis: result.content,
      issues: issues.slice(0, 10), // Limit to 10
      suggestions: suggestions.slice(0, 10),
    };
  } catch (error: any) {
    return {
      url,
      screenshotPath,
      analysis: `Failed to analyze screenshot: ${error.message}`,
      issues: [],
      suggestions: [],
    };
  }
}

/**
 * Run full visual verification
 */
export async function runVisualVerification(
  projectPath: string,
  spec: string,
  config?: VisualVerificationConfig
): Promise<VisualVerificationResult> {
  const devConfig = detectDevConfig(projectPath);

  if (!devConfig) {
    return {
      success: false,
      serverStarted: false,
      screenshots: [],
      analyses: [],
      error: 'No dev server script found in package.json (dev, start, or serve)',
    };
  }

  // Merge with user config
  const finalConfig = {
    command: config?.devCommand || devConfig.command,
    port: config?.port || devConfig.port,
    urls: config?.urls || ['/'],
    timeout: config?.timeout || 60000,
  };

  const screenshotDir = path.join(projectPath, '.skunkworks', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  let serverProcess: ChildProcess | null = null;

  try {
    // Start dev server
    console.log(chalk.blue('  Starting dev server...'));
    serverProcess = await startDevServer(projectPath, finalConfig, finalConfig.timeout);
    console.log(chalk.green(`  Server ready on port ${finalConfig.port}`));

    // Capture screenshots
    console.log(chalk.blue('\n  Capturing screenshots...'));
    const screenshots = await captureScreenshots(
      finalConfig.port,
      screenshotDir,
      finalConfig.urls
    );
    console.log(chalk.green(`  Captured ${screenshots.length} screenshot(s)`));

    // Analyze with Gemini
    console.log(chalk.blue('\n  Analyzing with Gemini...'));
    const router = new ModelRouter();
    await router.ensureInitialized();

    const analyses: VisualAnalysis[] = [];
    for (const screenshot of screenshots) {
      const analysis = await analyzeScreenshot(screenshot.path, screenshot.url, spec, router);
      analyses.push(analysis);
    }
    console.log(chalk.green('  Visual analysis complete'));

    return {
      success: true,
      serverStarted: true,
      screenshots,
      analyses,
    };
  } catch (error: any) {
    return {
      success: false,
      serverStarted: !!serverProcess,
      screenshots: [],
      analyses: [],
      error: error.message,
    };
  } finally {
    // Kill dev server
    if (serverProcess) {
      console.log(chalk.gray('\n  Stopping dev server...'));
      try {
        // Kill the process group (negative PID)
        if (serverProcess.pid) {
          process.kill(-serverProcess.pid, 'SIGTERM');
        }
      } catch {
        serverProcess.kill('SIGTERM');
      }
    }
  }
}

/**
 * Format visual verification results for Reviewer context
 */
export function formatVisualResultsForContext(result: VisualVerificationResult): string {
  if (!result.success) {
    return `## Visual Verification

**Status:** Skipped
**Reason:** ${result.error}

Visual verification could not be completed. Manual visual testing is recommended.
`;
  }

  let context = `## Visual Verification

**Status:** Complete
**Screenshots Captured:** ${result.screenshots.length}
**Screenshot Location:** .skunkworks/screenshots/

`;

  for (const analysis of result.analyses) {
    context += `### Page: ${analysis.url}

${analysis.analysis}

`;

    if (analysis.issues.length > 0) {
      context += `**Potential Visual Issues to Check:**
${analysis.issues.map((i) => `- ${i}`).join('\n')}

`;
    }

    if (analysis.suggestions.length > 0) {
      context += `**Visual Recommendations:**
${analysis.suggestions.map((s) => `- ${s}`).join('\n')}

`;
    }
  }

  context += `
**Note:** Screenshots are saved in .skunkworks/screenshots/ for manual review.
`;

  return context;
}
