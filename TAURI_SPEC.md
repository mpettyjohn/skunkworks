# Skunkworks Desktop - Product Specification

## Overview

Convert Skunkworks from a CLI tool to a native Mac desktop application using Tauri. The app should feel snappy, lightweight, and native while preserving all existing functionality.

**Key Design Decision:** The app bundles all required CLI tools internally. Users never need to open Terminal, install packages, or configure PATH. Authentication happens through friendly in-app flows that open the browser.

## Goals

1. **Native Mac Experience** - Fast startup, low memory footprint, feels like a real Mac app
2. **Visual Clarity** - See the entire pipeline at a glance, understand progress without reading terminal output
3. **Same Power** - All existing features work identically (multi-model orchestration, council review, verification pipeline)
4. **No API Keys** - Uses existing subscriptions (Claude Max, ChatGPT Pro, Gemini Pro) via bundled CLI tools
5. **Zero Terminal Required** - User never needs to open Terminal or run commands

## Non-Goals

- Windows/Linux support (Mac only for v1)
- New features beyond desktop UI (no scope creep)
- Expecting users to install CLI tools themselves

## User Profile

- Non-technical user building software with AI assistance
- Has Claude Max, ChatGPT Pro, Gemini Pro subscriptions
- Wants visual feedback on progress, not terminal scrolling
- Should never be asked technical/architectural questions
- **Should never need to open Terminal or know what PATH means**

## Core Features

### 0. First-Run & Authentication

**What happens the first time the user opens the app:**

1. Welcome screen explains what the app does
2. Shows which AI services are needed (Claude, ChatGPT, Gemini)
3. User clicks "Connect Claude" → browser opens Claude login page
4. User logs in with existing Claude Max account
5. App detects successful auth, shows checkmark
6. Repeat for other services (can skip, will prompt later when needed)
7. User is ready to create first project

**Key UX principles:**
- Never show terminal commands or technical jargon
- "Connect your Claude account" not "Authenticate claude CLI"
- Browser-based login (familiar pattern from "Sign in with Google")
- Can skip services and connect later when first needed
- Clear indication of what's connected vs not

**Re-authentication:**
- If a token expires, show friendly prompt: "Your Claude session expired. Click to reconnect."
- Opens browser, user logs in, done
- Never show error codes or technical details

### 1. Project Dashboard

**What the user sees when opening the app:**
- List of recent/existing Skunkworks projects
- Each project shows: name, current phase, last activity, completion percentage
- "New Project" button prominently displayed
- Quick actions: Continue, View Artifacts, Open in Finder

### 2. Pipeline View

**Visual representation of the orchestration pipeline:**

```
[Interview] → [Council] → [Architect] → [Council] → [Builder] → [Verify] → [Review]
    ●            ●            ○            ○           ○          ○          ○
  complete    complete     current
```

- Each phase is a clickable node
- Current phase highlighted/animated
- Completed phases show green checkmark
- Can click any completed phase to review its artifacts
- Shows which model is being used for each phase

### 3. Interview Phase UI

**Replaces terminal-based AskUserQuestion:**
- Clean form-based interface for answering questions
- Questions appear one at a time (or grouped logically)
- User types responses in proper text inputs
- "Submit" button to send response
- Previous Q&A visible as conversation history
- Progress indicator showing interview completion

### 4. Agent Response Streaming

**While agents are working:**
- Real-time streaming of agent output (like watching them think)
- Collapsible/expandable response area
- Spinner/progress indicator showing activity
- "Agent is thinking..." status with elapsed time
- Ability to scroll through long responses

### 5. Artifact Viewer

**View and edit generated artifacts:**
- Side-by-side view: artifact content + council feedback
- Syntax highlighting for markdown/YAML
- Basic editing capability (for user tweaks)
- "Regenerate" button to ask agent to revise
- Export/copy buttons

**Artifacts displayed:**
- SPEC.md (from Interview)
- ARCHITECTURE.md (from Architect)
- DESIGN_SPEC.yaml (from Architect)
- TODO.md (task list)
- REVIEW.md (from Reviewer)
- COUNCIL_FEEDBACK.md

### 6. Council Review Panel

**Multi-model critique display:**
- Shows critiques from Codex and Gemini side-by-side
- Color-coded by severity (suggestions vs concerns vs blockers)
- "Proceed" / "Revise" buttons
- Expandable details for each critique point

### 7. Verification Dashboard

**Shows all verification results:**

| Verification | Status | Details |
|--------------|--------|---------|
| Tests | 12/12 passing | View output |
| Visual | 3 screenshots | View gallery |
| Accessibility | Score: 94 | View issues |

- Click each row to expand details
- Test output in scrollable panel
- Screenshot gallery with Gemini's analysis
- Accessibility issues listed with severity

### 8. Settings Panel

**Configuration options:**
- Model preferences per phase
- Connected accounts status (Claude, ChatGPT, Gemini, GitHub)
- "Reconnect" buttons for each service
- GitHub integration settings
- Project defaults (working directory, etc.)
- Theme (light/dark/system)

**No CLI tool installation UI** - everything is bundled, users just connect accounts.

### 9. GitHub Integration View

**If GitHub is enabled for project:**
- Embedded view of project board (or link to open in browser)
- Sync status indicator
- "Push to GitHub" button for manual sync
- Issue list showing todos synced as issues

## User Flows

### Flow 1: Start New Project

1. User clicks "New Project"
2. User enters project description (single text field)
3. App shows pipeline view with Interview phase active
4. Interview questions appear in form UI
5. User answers questions, submits
6. SPEC.md generated, shown in artifact viewer
7. Council review panel shows critiques
8. User clicks "Proceed" or "Revise"
9. Pipeline advances to Architect phase
10. (Continues through all phases...)

### Flow 2: Continue Existing Project

1. User selects project from dashboard
2. App loads project state, shows pipeline view
3. Current phase is highlighted
4. User clicks "Continue" or selects specific phase
5. Resumes from checkpoint

### Flow 3: Review Artifacts

1. User clicks completed phase in pipeline
2. Artifact viewer opens with that phase's output
3. User can read, edit, or request regeneration
4. Changes saved to .skunkworks/ folder

## Technical Constraints

### Bundled Components:
The app ships with these CLI tools bundled inside the .app package:
- `claude` (Claude Code CLI)
- `codex` (OpenAI Codex CLI)
- `gemini` (Gemini CLI)
- `gh` (GitHub CLI)
- Node.js runtime (for running the orchestration logic)

Users never see or interact with these directly. The app manages them internally.

### Must Preserve:
- Existing .skunkworks/ folder structure (for project portability)
- Existing prompt files behavior

### Performance Targets:
- App startup: < 3 seconds (slightly higher due to bundled tools)
- Memory usage: < 200MB typical
- Bundle size: < 150MB (includes Node.js + CLI tools for both architectures)

### Platform:
- macOS 12+ (Monterey and later)
- Apple Silicon and Intel support (universal binary)

## What Success Looks Like

A user can:
1. Open the app and immediately understand where their project is
2. Start a new project without touching the terminal
3. Answer interview questions in a clean form interface
4. Watch agents work with visual feedback
5. Review artifacts side-by-side with council feedback
6. See verification results at a glance
7. Complete an entire project without confusion about what's happening

The app should feel like a polished Mac app, not a web page in a window.
