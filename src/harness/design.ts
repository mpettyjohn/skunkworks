/**
 * Design System Initialization
 *
 * Analyzes an existing codebase to bootstrap a DESIGN_SPEC.yaml
 * that matches the current visual patterns.
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';

export interface DesignAnalysis {
  detectedFramework: string | null;
  hasExistingTokens: boolean;
  colorPatterns: string[];
  spacingPatterns: string[];
  suggestions: {
    platform: string;
    archetype: string;
    personality: string;
    density: string;
  };
}

/**
 * Analyze an existing codebase for design patterns
 */
export async function analyzeExistingDesign(projectPath: string): Promise<DesignAnalysis> {
  const analysis: DesignAnalysis = {
    detectedFramework: null,
    hasExistingTokens: false,
    colorPatterns: [],
    spacingPatterns: [],
    suggestions: {
      platform: 'web',
      archetype: 'saas_app',
      personality: 'professional',
      density: 'normal',
    },
  };

  // Check for package.json to detect framework
  const packageJsonPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps['next']) analysis.detectedFramework = 'Next.js';
      else if (deps['@remix-run/react']) analysis.detectedFramework = 'Remix';
      else if (deps['vue']) analysis.detectedFramework = 'Vue';
      else if (deps['@angular/core']) analysis.detectedFramework = 'Angular';
      else if (deps['react']) analysis.detectedFramework = 'React';
      else if (deps['svelte']) analysis.detectedFramework = 'Svelte';

      // Check for existing design systems
      if (deps['@chakra-ui/react']) analysis.hasExistingTokens = true;
      if (deps['@mui/material']) analysis.hasExistingTokens = true;
      if (deps['tailwindcss']) analysis.hasExistingTokens = true;
      if (deps['styled-components']) analysis.hasExistingTokens = true;
    } catch {
      // Ignore parse errors
    }
  }

  // Check for Tailwind config
  const tailwindConfigPath = path.join(projectPath, 'tailwind.config.js');
  const tailwindConfigTsPath = path.join(projectPath, 'tailwind.config.ts');
  if (fs.existsSync(tailwindConfigPath) || fs.existsSync(tailwindConfigTsPath)) {
    analysis.hasExistingTokens = true;
  }

  // Check for CSS variables file
  const possibleTokenFiles = [
    'src/styles/tokens.css',
    'src/styles/variables.css',
    'src/theme.ts',
    'src/theme/index.ts',
    'styles/globals.css',
  ];

  for (const tokenFile of possibleTokenFiles) {
    const fullPath = path.join(projectPath, tokenFile);
    if (fs.existsSync(fullPath)) {
      analysis.hasExistingTokens = true;
      break;
    }
  }

  return analysis;
}

/**
 * Generate a default DESIGN_SPEC.yaml based on analysis and user answers
 */
export function generateDesignSpec(options: {
  projectName: string;
  platform: string;
  archetype: string;
  personality: string;
  darkMode: boolean;
  brandColors?: string[];
  brandMood?: string;
}): string {
  const { projectName, platform, archetype, personality, darkMode, brandColors, brandMood } = options;

  // Derive settings from archetype
  const archetypeSettings: Record<string, { density: string; colorTemp: string; motion: string }> = {
    dashboard: { density: 'compact', colorTemp: 'cool', motion: 'minimal' },
    saas_app: { density: 'normal', colorTemp: 'cool', motion: 'functional' },
    marketing: { density: 'spacious', colorTemp: 'warm', motion: 'expressive' },
    devtool: { density: 'compact', colorTemp: 'neutral', motion: 'minimal' },
    mobile_consumer: { density: 'normal', colorTemp: 'warm', motion: 'functional' },
  };

  const settings = archetypeSettings[archetype] || archetypeSettings.saas_app;

  // Override color temp based on personality
  let colorTemp = settings.colorTemp;
  if (personality === 'playful') colorTemp = 'warm';
  if (personality === 'professional') colorTemp = 'cool';

  // Generate the YAML
  const spec = `version: 1
last_updated: "${new Date().toISOString().split('T')[0]}"

meta:
  project: "${projectName}"
  owner: "skunkworks"

product:
  platform: "${platform}"
  archetype: "${archetype}"
  baseline_system: "Material3"
  personality: "${personality}"
  density: "${settings.density}"
  modes: ${darkMode ? '["light", "dark"]' : '["light"]'}
  color_temperature: "${colorTemp}"
  motion_stance: "${settings.motion}"

branding:
  has_assets: ${brandColors ? 'true' : 'false'}
  logo_colors: ${brandColors ? JSON.stringify(brandColors) : '[]'}
  reference_sites: []
  mood: "${brandMood || ''}"

intent:
  purpose: ""
  audience: ""
  tone: "conversational, concise, respectful"

principles:
  - "Clarity beats decoration."
  - "Consistency beats cleverness."
  - "Show system status with timely feedback."
  - "Errors explain what happened and how to recover."
  - "Prefer reuse over invention."

accessibility:
  target: "WCAG_2_2_AA"
  keyboard_first: true
  visible_focus: true
  reduced_motion: true
  min_touch_target_px: 44
  min_touch_target_gap_px: 8

layout:
  container_max_width_px: 1280
  gutters_px: 24
  grid_columns: 12
  breakpoints_px:
    sm: 640
    md: 768
    lg: 1024
    xl: 1280
    xxl: 1536

tokens:
  spacing:
    base_px: 8
    aliases_px:
      none: 0
      xs: 4
      sm: 8
      md: 16
      lg: 24
      xl: 32
      xxl: 48

  typography:
    font_sans: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    font_mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    scale:
      display: { size_rem: 2.25, line: 1.15, weight: 700 }
      h1: { size_rem: 1.875, line: 1.20, weight: 700 }
      h2: { size_rem: 1.50, line: 1.25, weight: 650 }
      h3: { size_rem: 1.25, line: 1.30, weight: 650 }
      body: { size_rem: 1.00, line: 1.55, weight: 400 }
      small: { size_rem: 0.875, line: 1.50, weight: 400 }
      caption: { size_rem: 0.75, line: 1.40, weight: 400 }

  radius:
    sm_px: 6
    md_px: 10
    lg_px: 14
    pill_px: 9999

  color:
    semantic:
      light:
        bg/default: "#F8FAFC"
        bg/elevated: "#FFFFFF"
        surface/card: "#FFFFFF"
        text/primary: "#0F172A"
        text/secondary: "#475569"
        text/tertiary: "#94A3B8"
        border/subtle: "#E2E8F0"
        border/strong: "#CBD5E1"
        accent/primary: "#2563EB"
        accent/hover: "#1D4ED8"
        focus/ring: "#60A5FA"
        danger: "#DC2626"
        success: "#16A34A"
        warning: "#D97706"
      dark:
        bg/default: "#0B1220"
        bg/elevated: "#0F172A"
        surface/card: "#111B2E"
        text/primary: "#E2E8F0"
        text/secondary: "#94A3B8"
        text/tertiary: "#64748B"
        border/subtle: "#22314F"
        border/strong: "#334155"
        accent/primary: "#60A5FA"
        accent/hover: "#93C5FD"
        focus/ring: "#93C5FD"
        danger: "#F87171"
        success: "#4ADE80"
        warning: "#FBBF24"

  motion:
    duration_ms:
      fast: 150
      base: 220
      slow: 320
      deliberate: 500
    easing:
      standard: "cubic-bezier(0.2, 0, 0, 1)"
      enter: "cubic-bezier(0, 0, 0.2, 1)"
      exit: "cubic-bezier(0.4, 0, 1, 1)"

components:
  primitives:
    - Button
    - IconButton
    - Link
    - Badge
    - Input
    - Textarea
    - Select
    - Checkbox
    - Radio
    - Switch
    - Tooltip
  containers:
    - Card
    - SectionHeader
    - Tabs
    - Table
    - EmptyState
  feedback:
    - Toast
    - InlineAlert
    - ProgressBar
    - Skeleton

content:
  voice: "conversational, concise, respectful"
  rules:
    - "Use task-first labels (verbs)."
    - "Errors explain what happened and how to recover."
    - "Confirm destructive actions."
    - "Loading states show progress when possible."
`;

  return spec;
}

/**
 * Interactive CLI to bootstrap design spec for existing project
 */
export async function initDesignSpec(projectPath: string): Promise<void> {
  const readline = await import('readline');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  const askChoice = async (question: string, options: string[], defaultOption: number = 0): Promise<string> => {
    console.log(chalk.white(`\n${question}`));
    options.forEach((opt, i) => {
      const marker = i === defaultOption ? chalk.green('→') : ' ';
      console.log(chalk.gray(`  ${marker} ${i + 1}. ${opt}`));
    });
    const answer = await ask(chalk.gray(`Enter choice [${defaultOption + 1}]: `));
    const choice = parseInt(answer) - 1;
    if (isNaN(choice) || choice < 0 || choice >= options.length) {
      return options[defaultOption];
    }
    return options[choice];
  };

  try {
    console.log(chalk.blue.bold('\n🎨 Design System Setup\n'));

    // Analyze existing project
    console.log(chalk.gray('Analyzing project...\n'));
    const analysis = await analyzeExistingDesign(projectPath);

    if (analysis.detectedFramework) {
      console.log(chalk.green(`✓ Detected framework: ${analysis.detectedFramework}`));
    }
    if (analysis.hasExistingTokens) {
      console.log(chalk.green('✓ Found existing design tokens/system'));
    }

    // Ask questions
    const projectName = path.basename(projectPath);

    const platform = await askChoice(
      'What platform is this for?',
      ['Web (desktop browsers)', 'Mobile (phones/tablets)', 'Both (responsive)'],
      0
    );
    const platformValue = platform.includes('Mobile') ? 'ios' : 'web';

    const context = await askChoice(
      'What kind of application is this?',
      ['Dashboard (internal tool, data-heavy)', 'SaaS App (public product)', 'Marketing Site (landing pages)', 'Developer Tool (technical users)', 'Consumer App (general public)'],
      1
    );
    const archetypeMap: Record<string, string> = {
      'Dashboard': 'dashboard',
      'SaaS App': 'saas_app',
      'Marketing Site': 'marketing',
      'Developer Tool': 'devtool',
      'Consumer App': 'mobile_consumer',
    };
    const archetype = archetypeMap[context.split(' ')[0]] || 'saas_app';

    const personality = await askChoice(
      'What should the visual style feel like?',
      ['Professional (clean, corporate)', 'Friendly (warm, approachable)', 'Playful (fun, colorful)', 'Technical (minimal, functional)'],
      0
    );
    const personalityMap: Record<string, string> = {
      'Professional': 'professional',
      'Friendly': 'friendly',
      'Playful': 'playful',
      'Technical': 'technical',
    };
    const personalityValue = personalityMap[personality.split(' ')[0]] || 'professional';

    const darkModeAnswer = await askChoice(
      'Do you need dark mode support?',
      ['Yes, support both light and dark', 'No, light mode only'],
      0
    );
    const darkMode = darkModeAnswer.includes('Yes');

    // Optional branding
    console.log(chalk.white('\nDo you have existing brand colors to use?'));
    const brandAnswer = await ask(chalk.gray('Enter hex color (e.g., #2563EB) or press Enter to skip: '));
    const brandColors = brandAnswer.startsWith('#') ? [brandAnswer] : undefined;

    // Generate spec
    console.log(chalk.gray('\nGenerating design spec...\n'));

    const spec = generateDesignSpec({
      projectName,
      platform: platformValue,
      archetype,
      personality: personalityValue,
      darkMode,
      brandColors,
    });

    // Save it
    const skunkworksDir = path.join(projectPath, '.skunkworks');
    if (!fs.existsSync(skunkworksDir)) {
      fs.mkdirSync(skunkworksDir, { recursive: true });
    }

    const specPath = path.join(skunkworksDir, 'DESIGN_SPEC.yaml');
    fs.writeFileSync(specPath, spec);

    console.log(chalk.green('✓ Created .skunkworks/DESIGN_SPEC.yaml\n'));

    console.log(chalk.white.bold('Your design system is configured:'));
    console.log(chalk.gray(`  Platform: ${platformValue}`));
    console.log(chalk.gray(`  Archetype: ${archetype}`));
    console.log(chalk.gray(`  Personality: ${personalityValue}`));
    console.log(chalk.gray(`  Dark mode: ${darkMode ? 'yes' : 'no'}`));
    if (brandColors) {
      console.log(chalk.gray(`  Brand color: ${brandColors[0]}`));
    }

    console.log(chalk.white('\nNext steps:'));
    console.log(chalk.gray('  1. Review .skunkworks/DESIGN_SPEC.yaml'));
    console.log(chalk.gray('  2. The Builder will use these tokens for consistent UI'));
    console.log(chalk.gray('  3. The Reviewer will check compliance with this spec\n'));

  } finally {
    rl.close();
  }
}
