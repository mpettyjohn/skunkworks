# Skunkworks Dev Tool - Session Handoff

**Last Updated:** January 20, 2026
**Project:** `/Users/mpj/Projects/agentic-dev-tool`

---

## What Is Skunkworks?

Skunkworks (Architect-Builder-Reviewer) is a **multi-model orchestration tool** that chains together different AI models, each chosen for what it's best at:

```
Interview (Claude Opus 4.5)
    ↓ creates SPEC.md
Council Review SPEC (Codex + Gemini)
    ↓ user: "Proceed?"
Architect (GPT-5.2-Codex)
    ↓ creates ARCHITECTURE.md
Council Review ARCHITECTURE (Codex + Gemini)
    ↓ user: "Proceed?"
Builder (Claude Opus 4.5)
    ↓ implements code
Test Verification (npm test)
Visual Verification (Playwright → Gemini)
Design Verification (/rams → accessibility + design score)
    ↓
Reviewer (Gemini 3)
    ↓ creates REVIEW.md
```

**Key insight:** Uses CLI tools with existing subscriptions (Claude Max, ChatGPT Pro, Gemini Pro) - **no API keys needed**.

---

## The User

- **Non-technical** but building technical projects with AI assistance
- Has existing technical assets (fine-tuned models, APIs) that need to be integrated
- Can follow explicit instructions but shouldn't be asked to make architectural decisions
- Has: Claude Max, ChatGPT Pro, Gemini Pro subscriptions

---

## Current State (What's Built)

### Core Pipeline
| Phase | Model | Mode | Purpose |
|-------|-------|------|---------|
| **Interview** | Claude Opus 4.5 | Interactive | Requirements gathering with AskUserQuestion |
| **Architect** | GPT-5.2-Codex | Non-interactive | System design, creates ARCHITECTURE.md |
| **Council** | Codex + Gemini | Parallel | Multi-model critique of the plan |
| **Builder** | Claude Opus 4.5 | Non-interactive | Implementation |
| **Reviewer** | Gemini 3 Flash | Non-interactive | Code review |

### Commands
```bash
skunknew "project idea"    # Start new project (runs full pipeline)
skunkcontinue              # Resume from last phase
skunkinterview             # Run just interview phase
skunkarchitect             # Run just architect phase
skunkbuild                 # Run just builder phase
skunkreview                # Run just reviewer phase
skunkcouncil [file]        # Multi-model plan review (standalone)
skunkdashboard             # CLI view of all projects
skunkdashboard --web       # Open web dashboard in browser
skunkdashboard --scan      # Scan current dir for projects
skunkdashboard --scan ~/Projects  # Scan specific path
skunkdashboard --prune     # Remove stale projects from registry
skunkgithub init           # Setup GitHub repo + project board
skunkgithub status         # Check GitHub integration
skunkgithub sync           # Push todos as GitHub issues
skunkdesign init           # Initialize design system for existing project
skunkdesign status         # Show design system configuration
skunkcontext-health        # Show context size and health
skunkcompound              # Capture learnings from current project
skunklearnings             # Browse all captured learnings
skunkmodels                # Show model config and CLI status
skunksetup                 # Installation instructions
```

### Key Files
```
src/
├── index.ts                 # CLI entry point, all commands
├── config/
│   └── models.ts            # Model configurations for each phase
├── dashboard/
│   ├── index.ts             # Dashboard module exports
│   ├── registry.ts          # Global project registry (~/.skunkworks/projects.json)
│   ├── scanner.ts           # Discover .skunkworks/ directories
│   ├── status.ts            # Read project state, derive status
│   ├── cli-renderer.ts      # CLI dashboard output (chalk)
│   └── web/
│       ├── server.ts        # Express server for web dashboard
│       ├── api.ts           # REST endpoints for project data
│       └── public/
│           └── index.html   # Single-page web dashboard
├── harness/
│   ├── orchestrator.ts      # Main pipeline logic
│   ├── router.ts            # Routes to CLI tools (codex, claude, gemini)
│   ├── state.ts             # Project state management (.skunkfolder)
│   ├── council.ts           # Multi-model plan review
│   ├── context-health.ts    # Context size monitoring
│   ├── context-compression.ts # Context compression logic
│   ├── learning-registry.ts # Cross-project learning storage
│   └── learning-extractor.ts # Learning extraction from artifacts
├── integrations/
│   └── github.ts            # GitHub CLI wrapper
prompts/
├── interviewer.md           # Interview phase prompt
├── architect.md             # Architect phase prompt
├── builder.md               # Builder phase prompt
├── reviewer.md              # Reviewer phase prompt
└── compound.md              # Learning refinement prompt
```

### Interview Phase Design
The interviewer is tuned for a non-technical user:
- **Does NOT ask:** "Should we use React or Vue?" or any architectural decisions
- **DOES ask:** About existing assets (APIs, models, data) that need integration
- **Makes recommendations** instead of asking user to choose
- **Follows up** on technical context the user provides

---

## Features Added This Session

### 1. GitHub Integration
- `skunkgithub init` creates repo + optional project board
- Artifacts (SPEC.md, ARCHITECTURE.md) auto-push to GitHub
- Todos can sync as GitHub issues
- Visual kanban board for progress tracking

### 2. Council (Multi-Model Plan Review)
Based on @tenobrus insight: "same model = same blind spots"

- Sends plan to Codex AND Gemini in parallel
- Each critiques for errors, gaps, alternatives, risks
- Integrated after Architect phase (before Builder)
- Also available standalone: `skunkcouncil path/to/plan.md`

---

## Features Added (January 12, 2026)

### 1. Council Review of SPEC.md
Multi-model review now happens TWICE in the pipeline:
- After Interview phase (reviews SPEC.md)
- After Architect phase (reviews ARCHITECTURE.md)

**Flow:**
```
Interview → SPEC.md created
    ↓
Council (Codex + Gemini) reviews spec for unclear/missing/conflicting requirements
    ↓
User: "Proceed to Architect? (Y/N)"
    ↓
Architect phase (if Y)
```

**Files:**
- `src/harness/council.ts` - Added `reviewSpec()` method with spec-focused prompt
- `src/harness/orchestrator.ts` - Added `runCouncilReviewSpec()`, modified `runInterviewPhase()`
- Feedback saved to `.skunkworks/COUNCIL_FEEDBACK_SPEC.md`

### 2. Test Verification
Runs `npm test` before Reviewer phase if tests exist.

**Flow:**
```
Builder writes code
    ↓
Skunkworks runs npm test (auto-detected from package.json)
    ↓
Test results (pass/fail, counts, output) sent to Reviewer
    ↓
Reviewer sees code + test results
```

**Files:**
- `src/harness/verification.ts` - New module with `runTests()`, `formatTestResultsForContext()`
- `src/harness/orchestrator.ts` - Modified `runReviewerPhase()` to run tests
- `prompts/reviewer.md` - Added Phase 4: Test Analysis

### 3. Visual Verification with Playwright
Captures screenshots of running app and analyzes with Gemini.

**Flow:**
```
Builder writes code
    ↓
Skunkworks starts dev server (auto-detected: npm run dev/start/serve)
    ↓
Playwright captures screenshots
    ↓
Gemini analyzes screenshots against spec
    ↓
Reviewer sees code + test results + visual analysis
```

**Files:**
- `src/harness/visual-verification.ts` - New module with Playwright integration
- `src/harness/orchestrator.ts` - Modified `runReviewerPhase()` for visual verification
- `prompts/reviewer.md` - Added Phase 5: Visual Analysis
- `package.json` - Added Playwright dependency
- Screenshots saved to `.skunkworks/screenshots/`

**Features:**
- Auto-detects dev server port (Vite: 5173, Next: 3000, Angular: 4200, etc.)
- Waits for server ready before capturing
- Gracefully handles missing dev server or Playwright

### 4. Design & Accessibility Verification (/rams)
Uses /rams CLI to check WCAG 2.1 accessibility and visual design consistency.

**Flow:**
```
Builder writes code
    ↓
Skunkworks runs /rams on frontend files (.tsx, .jsx, .vue, .svelte, .html)
    ↓
Gets design score (0-100) and list of issues
    ↓
Reviewer sees code + test results + visual analysis + accessibility report
```

**What it catches:**
- **Accessibility (WCAG 2.1):** Missing alt text, unlabeled buttons, poor focus handling, insufficient touch targets
- **Visual Design:** Inconsistent spacing, typography issues, contrast failures, missing component states

**Files:**
- `src/harness/design-verification.ts` - New module with /rams integration
- `src/harness/orchestrator.ts` - Modified `runReviewerPhase()` for design verification
- `prompts/reviewer.md` - Added Phase 6: Design & Accessibility

**Install /rams:**
```bash
curl -fsSL https://rams.ai/install | bash
```

---

## Key Decisions Made

1. **Subscriptions over API keys** - The whole tool is designed around CLI tools that use existing subscriptions
2. **Non-technical user focus** - Interview phase doesn't ask technical questions
3. **Council is both standalone AND integrated** - Can use `skunkcouncil` anytime, plus auto-runs after Architect
4. **GitHub integration is full-featured** - Repo + Issues + Project board (not incremental rollout)
5. **Different models for different tasks** - Deliberately using Codex, Claude, and Gemini for their different strengths/blind spots

---

## Technical Notes

### CLI Tools Used
- `claude` - Claude Code CLI (Claude Max subscription)
- `codex` - OpenAI Codex CLI (ChatGPT Pro subscription)
- `gemini` - Gemini CLI (Google subscription)

### How Interactive Mode Works
Interview phase spawns Claude Code with `stdio: 'inherit'` to pass terminal control, enabling AskUserQuestion. Other phases use stdin piping for non-interactive execution.

### State Management
- Project state stored in `.skunkworks/state.json`
- Artifacts: `.skunkworks/SPEC.md`, `.skunkworks/ARCHITECTURE.md`, `.skunkworks/REVIEW.md`
- Council feedback: `.skunkworks/COUNCIL_FEEDBACK.md`
- Checkpoints for recovery in `.skunkworks/checkpoints/`

---

## Features Added (January 13, 2026)

### Design System Integration

Skunkworks now enforces consistent, accessible UI through an integrated design system.

**The Problem:** AI agents produce "AI slop" - inconsistent spacing, random colors, missing states, inaccessible markup.

**The Solution:** A design system SSoT (Single Source of Truth) that flows through every phase:

```
Interview → gathers Look & Feel preferences (non-technical questions)
    ↓
Architect → generates DESIGN_SPEC.yaml with tokens
    ↓
Builder → uses ONLY tokens from the spec (no magic numbers)
    ↓
Reviewer → checks design compliance as part of review
```

**Key Files:**
- `prompts/design-system.md` - Reference doc for agents
- `.skunkworks/DESIGN_SPEC.yaml` - Generated design tokens (per project)
- `src/harness/design.ts` - Design initialization module

**Interview Phase Additions:**
- Phase 4: Look & Feel - asks about platform, context, personality, dark mode
- Phase 5: Existing Branding - captures logos, colors, reference sites
- SPEC.md now includes Design Direction section

**What Gets Captured (non-technical questions → design decisions):**
| User answers | Design system sets |
|--------------|-------------------|
| "Mostly phones" | `platform: mobile`, larger touch targets |
| "Internal dashboard" | `archetype: dashboard`, `density: compact` |
| "Should feel friendly" | `personality: friendly`, warmer colors |
| "I have this logo" | Extract colors, match personality to aesthetic |

**New Command: `skunkdesign init`**

For existing projects, bootstraps a DESIGN_SPEC.yaml:
```bash
skunkdesign init           # Interactive setup
skunkdesign status         # Show current design config
```

Asks simple questions:
1. What platform? (web/mobile/both)
2. What kind of app? (dashboard/SaaS/marketing/etc.)
3. What style? (professional/friendly/playful)
4. Dark mode? (yes/no)
5. Brand color? (optional hex)

**Design System Rules (enforced by Builder):**
- Token-only values (no `padding: 13px`, no `color: #1a2b3c`)
- Semantic HTML (`<button>` not `<div onClick>`)
- Complete states (hover/focus/active/disabled/loading)
- Spacing encodes relationships (closer = related)
- Color is semantic (accent for actions, danger for destructive)
- Motion supports reduced-motion
- Focus rings always visible

**Reviewer Design Compliance Checklist:**
- Token usage audit (flags hardcoded values)
- Semantic HTML check
- State completeness
- Spacing consistency
- Typography hierarchy
- Color semantics
- Motion & accessibility

---

## Features Added (January 20, 2026)

### 1. Fresh Subagent Contexts (Context Compression)

Prevents AI quality degradation by compressing context intelligently.

**The Problem:** As projects grow, context passed to AI can bloat with accumulated history, degrading output quality.

**The Solution:** Compress context so each phase gets only what it needs, not full history.

**New Files:**
- `src/harness/context-health.ts` - Monitors context size and reports health status
- `src/harness/context-compression.ts` - Compresses completed phases, extracts relevant files

**New Command:**
```bash
skunkcontext-health    # Show context size and health breakdown
```

**What You'll See During Builds:**
```
🟢 Context: 6200 tokens (78% of budget)
Building phase: Core Features...
```

If context gets large:
```
🟡 Context: 11000 tokens (138% of budget)
  ⚠ Completed phases history is large - using compression
```

**Compression Strategies:**
- Older phases get ultra-short summaries (just name + goal + file count)
- Recent phases keep full detail
- File map filtered to files relevant to current tasks
- Architecture compressed to relevant sections only
- Fix attempts compressed to prevent context bloat

### 2. Cross-Project Learning (Compound)

Remembers solutions, patterns, and design templates across projects.

**The Problem:** Each project is isolated. You solve a problem once, then solve it again in the next project.

**The Solution:** A global learning registry at `~/.skunkworks/learning/` that captures and reuses knowledge.

**New Files:**
- `src/harness/learning-registry.ts` - Storage layer for learnings
- `src/harness/learning-extractor.ts` - Extracts learnings from project artifacts
- `prompts/compound.md` - AI prompt for refining learnings

**New Commands:**
```bash
skunkcompound          # Capture learnings from current project
skunklearnings         # Browse all captured learnings
skunklearnings --stats # Show learning statistics
```

**Directory Structure Created:**
```
~/.skunkworks/
  learning/
    index.json              # Search index
    solutions/
      react/
        sol-001-*.yaml
      nextjs/
        sol-001-*.yaml
    patterns/
      pat-001-*.yaml
    design-tokens/
      tok-001-*.yaml
```

**Learning Types:**
- **Solutions**: Bug fixes and issues that were resolved (extracted from REVIEW.md)
- **Patterns**: Architectural decisions and tech choices (extracted from ARCHITECTURE.md)
- **Design Tokens**: Design system configurations (extracted from DESIGN_SPEC.yaml)

**Automatic Behavior:**
- When a project completes, learnings are automatically captured
- During Interview phase, relevant learnings from past projects are shown
- During Architect phase, relevant learnings are included in the prompt

**What You'll See:**

When a project completes:
```
✅ Project complete!

🎓 Captured 5 learnings for future projects
   3 solution(s)
   1 pattern(s)
   1 design token(s)
   ✓ Saved 4 high-confidence learnings

   Press [L] to review, [Enter] to continue
```

When starting a new project:
```
🎓 Found 2 relevant learnings from past projects:
  - Fix React controlled input warning (react)
  - API route structure pattern (nextjs)
```

### 3. Mission Control Dashboard

Multi-project dashboard with two viewing modes: CLI and web.

**The Problem:** When working on multiple projects, it's hard to track which ones need attention, which are blocked, and which are running.

**The Solution:** A centralized dashboard that shows all Skunkworks projects across the filesystem.

**Global Project Registry:**
- Location: `~/.skunkworks/projects.json`
- Auto-registers projects on `skunk new` and `skunk init`
- Manual scan via `skunk dashboard --scan [path]`
- Auto-prunes stale entries (missing `.skunkworks/state.json`)

**Status Derivation:**
```typescript
type ProjectStatus = 'BLOCKED' | 'NEEDS_YOU' | 'RUNNING' | 'COMPLETE';

// Derived from project state:
// COMPLETE - currentPhase === 'complete'
// BLOCKED - any todo has status === 'blocked'
// RUNNING - any todo has status === 'in_progress'
// NEEDS_YOU - ready for user input
```

**CLI Mode (`skunk dashboard`):**
```
SKUNKWORKS MISSION CONTROL

  recipe-app              INTERVIEW    ! BLOCKED
    Waiting for answer: "Should recipes be public or private?"

  invoice-tracker         REVIEW       ? NEEDS YOU
    Ready for your input

  crm-prototype           BUILD        > RUNNING    [████████░░] 80%
    Building: Contact list component

  landing-page            COMPLETE     ✓ DONE
    Shipped Jan 18

Commands:
  skunk continue --path <project>    Resume a project
  skunk dashboard --web              Open web dashboard
```

**Web Mode (`skunk dashboard --web`):**
- Express server on `http://localhost:3847`
- Auto-opens browser
- Polls for updates every 5 seconds
- Click projects to expand and view artifacts (SPEC.md, ARCHITECTURE.md, REVIEW.md)
- Shows command to continue each project

**New Files:**
- `src/dashboard/registry.ts` - Global project registry management
- `src/dashboard/scanner.ts` - Filesystem scanner for .skunkworks directories
- `src/dashboard/status.ts` - Status derivation logic
- `src/dashboard/cli-renderer.ts` - CLI output with chalk
- `src/dashboard/web/server.ts` - Express server
- `src/dashboard/web/api.ts` - REST endpoints
- `src/dashboard/web/public/index.html` - Single-page dashboard (vanilla JS)

**Commands:**
```bash
skunk dashboard              # CLI view
skunk dashboard --web        # Web dashboard
skunk dashboard --scan       # Scan current directory
skunk dashboard --scan ~/Projects  # Scan specific path
skunk dashboard --prune      # Remove stale projects
```

---

## Next Steps (Suggested)

1. **Test the full pipeline** - Run through the complete flow on a real project
2. **Install Playwright browsers** - Run `npx playwright install` before first visual verification
3. **Consider configuration options** - Allow users to skip test/visual verification via CLI flags or config
4. **Improve multimodal** - Send actual screenshots to Gemini API for true visual analysis (currently text-based)

---

## How to Build & Run

```bash
cd /Users/mpj/Projects/agentic-dev-tool
npm install
npm run build
node dist/index.js --help

# Or if installed globally:
npm link
skunk--help
```

---

## Related Files Outside This Project

- **Accomplishments doc:** `/Users/mpj/Desktop/MCT_PIPELINE_ACCOMPLISHMENTS.md` - Documents what was built across sessions
- **User's other project:** MCT (Math CoTeacher) Synthetic Pipeline - the user's main project that Skunkworks is meant to help build

---

## Session Context

The user found Skunkworks through wanting to build software with AI assistance but being non-technical. Key influences:
- Twitter consensus on best models for each task
- @tenobrus insight on multi-model "council" for catching blind spots
- Ramp's "Inspect" agent for visual verification
- Thariq's pattern of using AskUserQuestion for requirements gathering

The user values:
- Not being asked technical questions they can't answer
- Visual progress tracking (GitHub Projects)
- Multiple AI models catching each other's blind spots
- Verification that things actually work, not just code review

---

## Features Added (January 21, 2026)

### 1. Pipeline Bypass Prevention

**The Problem:** A session showed Claude (as Interviewer) building code when user said "build it", bypassing the entire pipeline.

**The Fix:** Added explicit guardrails to prompts:

**Interviewer (`prompts/interviewer.md`):**
```
CRITICAL: DO NOT BUILD CODE.
Your ONLY job is to create SPEC.md.
If the user says "build it", respond: "I've captured everything in the spec. The building happens automatically in the next phase."
```

**Architect (`prompts/architect.md`):**
```
CRITICAL: The User is Non-Technical
Do NOT ask: "SwiftUI or UIKit?", "React or Vue?", etc.
You are the expert. Make these decisions yourself.
```

### 2. Project Naming

Interview now asks for a project name:
- "What should we call this project?"
- Auto-generates from description if skipped
- Name extracted from SPEC.md title
- Stored in global registry

### 3. Project Selection Commands

```bash
skunkworks projects              # List all projects with status
skunkworks open 1                # Open project by number
skunkworks open "Heart Rate"     # Open by name (partial match)
skunkworks rename 1 "New Name"   # Rename a project
```

### 4. Project Type Detection

Interview asks what type of project:
- Website / web app → `web`
- Mobile app → `ios`, `android`
- Desktop app → `desktop`
- Command-line tool → `cli`
- Backend/API → `backend`

Supports composites: `['web', 'backend']` for full-stack apps.

**Used for:** Selecting appropriate verification tools per project type.

### 5. Registry Enhancements

New functions in `src/dashboard/registry.ts`:
- `findProjectByName(searchTerm)` - Case-insensitive partial match
- `findProjectByIndex(index)` - 1-based index for user-friendliness
- `updateProjectName(path, name)` - Update project name

---

## Remaining Work (In Progress)

### Phase Lock Enforcement
- State machine + tool whitelisting to prevent unauthorized actions
- Interview can only write SPEC.md
- Architect can only write ARCHITECTURE.md, DESIGN_SPEC.yaml
- Implementation location: `src/harness/router.ts`

### Dependency Detection & Installation
- Detect required runtimes from ARCHITECTURE.md
- Use version managers (nvm, pyenv) to avoid sudo
- Ask user consent before installing

### Recovery UX
- Categorize errors (missing dep, test failure, permission)
- Provide actionable options, never just "fix manually"

---

## Session Context File

For detailed implementation notes, see: `.skunkworks/SESSION_CONTEXT.md`
