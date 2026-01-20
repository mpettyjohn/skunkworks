# Skunkworks

> **Build software with AI - without needing to be technical.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

Skunkworks chains together multiple AI models to build software for you. Each AI is picked for what it's best at, and they check each other's work.

```
You: "I want to build a task tracker for my team"
     ↓
Skunkworks interviews you, designs it, builds it, and reviews it
     ↓
You: Working software with professional UI
```

## Why Multiple AIs?

Different AI models have different blind spots. If you use the same AI to build and review, it won't catch its own mistakes.

| Phase | Model | Why This Model |
|-------|-------|----------------|
| **Interview** | Claude Opus 4.5 | Best at understanding intent and asking good questions |
| **Architect** | GPT-5.2-Codex | Strongest at system design and planning |
| **Council** | Codex + Gemini | Multiple perspectives catch more issues |
| **Builder** | Claude Opus 4.5 | Top coding benchmark scores |
| **Reviewer** | Gemini 3 Flash | Fresh eyes, different blind spots |

## Installation

### Prerequisites

You need these AI CLI tools (uses your existing subscriptions - no API keys):

```bash
# Claude Code CLI (requires Claude Max subscription)
npm install -g @anthropic-ai/claude-code

# OpenAI Codex CLI (requires ChatGPT Pro subscription)
npm install -g @openai/codex

# Gemini CLI (requires Google account)
npm install -g @google/gemini-cli
```

### Install Skunkworks

```bash
# Clone the repo
git clone https://github.com/mpettyjohn/skunkworks.git
cd skunkworks

# Install dependencies
npm install

# Build
npm run build

# Link globally
npm link
```

Verify installation:
```bash
skunk models
```

## Quick Start

### Start a New Project

```bash
skunk new "I want to build a todo app for my team"
```

Skunkworks will:
1. **Interview you** about what you need (no technical questions)
2. **Design the architecture** and create a plan
3. **Get the plan reviewed** by multiple AIs
4. **Build the software** following the plan
5. **Run tests and visual checks**
6. **Review the code** for bugs and issues

### Continue Where You Left Off

```bash
skunk continue
```

### Check Status

```bash
skunk status
```

## The Pipeline

```
You describe your idea
        ↓
   Interview Phase (Claude asks clarifying questions)
        ↓
   Creates SPEC.md (what you want)
        ↓
   Council reviews the spec (Codex + Gemini check for gaps)
        ↓
   Architect Phase (Codex designs the system)
        ↓
   Creates ARCHITECTURE.md + DESIGN_SPEC.yaml
        ↓
   Council reviews the architecture (catches blind spots)
        ↓
   Builder Phase (Claude writes the code in phases)
        ↓
   Verification after each phase (tests + visual + accessibility)
        ↓
   Reviewer Phase (Gemini reviews everything)
        ↓
   Creates REVIEW.md (what's good, what needs work)
        ↓
   Learnings captured for future projects
```

## Features

### Design System Integration

AI-generated UIs often look inconsistent. Skunkworks fixes this with a built-in design system.

During interview, you answer simple questions:
- "Will people use this on phones or computers?"
- "Should it feel professional or casual?"
- "Do you have brand colors?"

These become strict design rules the Builder follows. Result: consistent, accessible UI.

### Cross-Project Learning

Skunkworks remembers solutions across projects. Fix a bug once, never solve it again.

```bash
# Capture learnings from current project
skunk compound

# Browse all learnings
skunk learnings
```

When you start a new project, relevant learnings appear automatically.

### Context Compression

Long projects can degrade AI quality. Skunkworks compresses context intelligently so each phase gets only what it needs.

```bash
# Check context health
skunk context-health
```

### Design & Accessibility Verification

Every build gets checked by [/rams](https://www.rams.ai/) for:
- WCAG 2.1 accessibility compliance
- Visual design consistency
- Missing component states
- Contrast and spacing issues

No more "AI slop" with random colors and inaccessible markup.

### GitHub Integration

Track progress visually with GitHub Projects:

```bash
skunk github init
```

## Commands

| Command | What It Does |
|---------|--------------|
| `skunk new "idea"` | Start a new project |
| `skunk continue` | Resume from where you left off |
| `skunk status` | Show project progress |
| `skunk interview` | Run just the interview phase |
| `skunk architect` | Run just the architect phase |
| `skunk build` | Run just the builder phase |
| `skunk review` | Run just the reviewer phase |
| `skunk council [file]` | Get a plan reviewed by multiple AIs |
| `skunk design init` | Set up design system for existing project |
| `skunk design status` | Show design configuration |
| `skunk context-health` | Show context size and health |
| `skunk compound` | Capture learnings from project |
| `skunk learnings` | Browse captured learnings |
| `skunk github init` | Connect to GitHub |
| `skunk github status` | Check GitHub integration |
| `skunk github sync` | Sync todos to GitHub issues |
| `skunk models` | Check which AI tools are installed |
| `skunk setup` | Show installation instructions |

## Project Structure

```
your-project/
├── .skunkworks/
│   ├── SPEC.md              # Requirements (from interview)
│   ├── ARCHITECTURE.md      # System design (from architect)
│   ├── DESIGN_SPEC.yaml     # Design tokens
│   ├── TODO.md              # Task checklist
│   ├── REVIEW.md            # Code review findings
│   ├── COUNCIL_FEEDBACK.md  # Multi-AI review notes
│   └── checkpoints/         # Recovery points
└── ... your code ...
```

Global learnings stored in `~/.skunkworks/learning/`.

## FAQ

**Do I need to know how to code?**
No. Skunkworks handles the technical decisions.

**What if I don't like what it builds?**
You can ask for changes at any point. The interview phase understands what you want before building.

**Can I use it for existing projects?**
Yes. Run `skunk design init` to add the design system, or `skunk build` to work on existing code.

**What if one of the AI services is down?**
Skunkworks tells you which tool isn't available. Run again later.

**How much does it cost?**
Skunkworks is free. You pay for your existing AI subscriptions.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js --help

# Type check
npx tsc --noEmit
```

## Inspired By

Skunkworks stands on the shoulders of these ideas and projects:

- **[GSD (Get Shit Done)](https://github.com/glittercowboy/get-shit-done)** by glittercowboy — The context compression and "fresh subagent contexts" approach. GSD's insight: "Context stays fresh. Quality stays high."

- **Multi-model "Council" review** — [@tenobrus](https://x.com/tenobrus/status/2010428123310129487) on why same model = same blind spots, and [Andrej Karpathy's LLM Council](https://github.com/karpathy/llm-council) for the implementation. Having models critique each other catches errors a single model would miss.

- **[Ramp's Inspect Agent](https://builders.ramp.com/post/why-we-built-our-background-agent)** — Visual verification with screenshots. For frontend work, Inspect "visually verifies its work and gives users screenshots and live previews." [Eric Glyman's thread](https://x.com/eglyman/status/2010776124037743088) on why feedback loops matter.

- **[Thariq Shihipar](https://x.com/trq212/status/2005315275026260309)** — The spec-based development pattern using AskUserQuestion. "Start with a minimal spec and ask Claude to interview you... then make a new session to execute the spec."

- **[/rams](https://www.rams.ai/)** — Design and accessibility verification. Catches WCAG issues, visual inconsistencies, and missing component states.

- **Compounding Engineering** — [Kieran Klaassen](https://x.com/kieranklaassen/status/1976399877098831997) on cross-project learning, via [Flavio Copes](https://x.com/flaviocopes/status/2013281081735118889) who put it on our radar.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

**Built for people who have ideas but aren't developers.**
