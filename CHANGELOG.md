# Changelog

All notable changes to Skunkworks will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-01-20

### Added

- **Context Compression** - Prevents AI quality degradation on long projects
  - New `context-health` command to inspect context size and breakdown
  - Automatic compression of completed phases (older phases get summarized)
  - Relevant file extraction (only files related to current tasks)
  - Architecture compression (only sections relevant to current phase)
  - Fix attempt compression to prevent context bloat

- **Cross-Project Learning** - Remember solutions across projects
  - New `compound` command to capture learnings from a project
  - New `learnings` command to browse all captured learnings
  - Automatic learning capture when projects complete
  - Automatic learning query during interview and architect phases
  - Learning types: solutions (bug fixes), patterns (architecture), design tokens
  - Learning storage at `~/.skunkworks/learning/`

### Changed

- Chunked builder now displays context health indicator during builds
- Fix attempts now use compressed context to stay within budget

## [2.0.0] - 2026-01-13

### Added

- **Design System Integration** - Consistent, accessible UI without "AI slop"
  - Design tokens generated from interview answers (DESIGN_SPEC.yaml)
  - Builder enforces token-only values (no hardcoded colors/spacing)
  - Reviewer checks design compliance
  - `design init` command for existing projects
  - `design status` command to show configuration

- **Design & Accessibility Verification** - Uses /rams CLI
  - WCAG 2.1 accessibility checking
  - Visual design consistency scoring
  - Integrated into reviewer phase

### Changed

- Interview phase now asks about look & feel (platform, personality, dark mode)
- Architect generates DESIGN_SPEC.yaml alongside ARCHITECTURE.md
- Builder prompt includes strict design system rules

## [1.2.0] - 2026-01-12

### Added

- **Council Review of SPEC.md** - Multi-model review now happens twice
  - After interview phase (reviews requirements)
  - After architect phase (reviews architecture)

- **Test Verification** - Runs `npm test` before reviewer phase
  - Auto-detects test script in package.json
  - Test results included in reviewer context

- **Visual Verification** - Screenshots with Playwright + Gemini analysis
  - Auto-detects dev server (Vite, Next, Angular, etc.)
  - Captures screenshots of running app
  - Gemini analyzes screenshots against spec

## [1.1.0] - 2026-01-11

### Added

- **GitHub Integration** - Visual progress tracking
  - `github init` creates repo and project board
  - `github status` shows integration status
  - `github sync` pushes todos as issues
  - Artifacts auto-push to GitHub

- **Council (Multi-Model Plan Review)** - Catches blind spots
  - Sends plans to Codex AND Gemini in parallel
  - Each critiques for errors, gaps, risks
  - `council` command for standalone use

## [1.0.0] - 2026-01-10

### Added

- Initial release
- **Interview Phase** - Claude Opus 4.5 with AskUserQuestion
  - Non-technical requirements gathering
  - Creates SPEC.md

- **Architect Phase** - GPT-5.2-Codex Extra High reasoning
  - System design and planning
  - Creates ARCHITECTURE.md and TODO.md

- **Builder Phase** - Claude Opus 4.5
  - Chunked implementation with verification between phases
  - Auto-fix attempts on verification failure

- **Reviewer Phase** - Gemini 3 Flash
  - Code review with fresh perspective
  - Creates REVIEW.md

- CLI commands: new, continue, interview, architect, build, review, status, models, setup
- State management with checkpoints for recovery
- Subscription-based (no API keys needed)
