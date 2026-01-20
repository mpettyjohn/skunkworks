# ABR v2 Plan: Interview + Architect + Builder + Reviewer

## Problem

The current ABR tool has a conflict:
- **GPT-5.2-Codex** is best for architectural planning (per Twitter consensus)
- **Claude Code's AskUserQuestion** is a game-changer for requirements gathering
- But Codex doesn't have AskUserQuestion - it's designed for execution, not interactive interviewing

## Solution: Split into 4 Phases

Based on Thariq's pattern: *"start with a minimal spec or prompt and ask Claude to interview you using the AskUserQuestionTool then make a new session to execute the spec"*

**New 4-Phase Flow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                         ABR v2 FLOW                             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  INTERVIEWER    │  ← Claude Code (interactive, AskUserQuestion)
│  (New Phase)    │
├─────────────────┤
│ - Scope/goals   │
│ - Constraints   │
│ - Success critr │
│ OUTPUT: SPEC.md │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   ARCHITECT     │  ← GPT-5.2-Codex Extra High reasoning
│   (Planning)    │
├─────────────────┤
│ - Read SPEC.md  │
│ - Design arch   │
│ - Create plan   │
│ OUTPUT: ARCH.md │
│ OUTPUT: TODO.md │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    BUILDER      │  ← Claude Opus 4.5 (best coder)
│ (Implementation)│
├─────────────────┤
│ - Execute todos │
│ - Write code    │
│ OUTPUT: Code    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   REVIEWER      │  ← Gemini 3 Flash (different perspective)
│  (Validation)   │
├─────────────────┤
│ - Verify spec   │
│ - Run tests     │
│ OUTPUT: REVIEW  │
└─────────────────┘
```

## Key Insight

The interview phase must be **interactive** (user answers questions). The other phases can be **non-interactive** (autonomous execution).

- **Interview**: Runs in Claude Code's interactive mode with AskUserQuestion
- **Architect/Builder/Reviewer**: Run via CLI in non-interactive mode

---

## Phase Configuration

| Phase | Tool | Model | Mode | Key Feature |
|-------|------|-------|------|-------------|
| **Interview** | Claude Code | Opus 4.5 | **Interactive** | **AskUserQuestion** |
| **Architect** | Codex | GPT-5.2-Codex Extra High | Non-interactive | Best reasoning |
| **Builder** | Claude Code | Opus 4.5 | Non-interactive | Best coder (80.9% SWE-bench) |
| **Reviewer** | Gemini | 3 Flash | Non-interactive | Different model family |

**Critical**: Only the Interview phase runs interactively (so AskUserQuestion works). All other phases run autonomously via CLI.

---

## Implementation Changes

### 1. Update `src/config/models.ts`
- Add `'interviewer'` to `AgentPhase` type
- Add interviewer config using `claude-code` CLI

### 2. Update `src/harness/state.ts`
- Add `'interviewer'` to phase types
- Update phase progression: `interviewer → architect → builder → reviewer → complete`

### 3. Update `src/harness/router.ts`
- Add interactive mode method for interviewer phase
- Uses `spawn` with `stdio: 'inherit'` to pass terminal control to Claude Code

### 4. Update `src/harness/orchestrator.ts`
- Add `runInterviewPhase()` method
- This phase runs Claude Code **interactively** (no `-p` flag) so AskUserQuestion works
- Outputs SPEC.md to `.abr/SPEC.md`

### 5. Update `src/index.ts`
- Add `abr interview` command to run just the interview phase
- Update `abr new` to start with interview phase

### 6. Create `prompts/interviewer.md`
- New prompt based on Danny Aziz's interview pattern

---

## How Interactive Interview Works

When user runs `abr new "project idea"`:

1. ABR spawns Claude Code **without** the `-p` flag (interactive mode)
2. Claude Code launches in the terminal with full interactive capability
3. User sees Claude's AskUserQuestion prompts and answers them
4. When interview is complete, Claude outputs SPEC.md
5. User exits Claude Code (types "exit" or similar)
6. ABR detects SPEC.md was created and continues to Architect phase
7. Remaining phases run non-interactively

**Technical approach**: Use Node's `spawn` with `stdio: 'inherit'` to pass terminal control to Claude Code during interview.

---

## Files to Modify

1. `src/config/models.ts` - Add interviewer phase, update types
2. `src/harness/orchestrator.ts` - Add `runInterviewPhase()`, update flow
3. `src/harness/state.ts` - Add interviewer to phase types
4. `src/harness/router.ts` - Add interactive mode for interviewer
5. `src/index.ts` - Add `interview` command
6. `prompts/interviewer.md` - New file with interview prompt

---

## Verification

1. Run `abr new "project idea"` - should start with interactive interview
2. Answer questions via AskUserQuestion prompts
3. Verify SPEC.md is created
4. Verify Architect phase runs with Codex and produces ARCHITECTURE.md
5. Verify full pipeline completes
