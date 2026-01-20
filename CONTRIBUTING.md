# Contributing to Skunkworks

Thanks for your interest in contributing to Skunkworks! This document provides guidelines for contributions.

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/skunkworks.git
   cd skunkworks
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build:
   ```bash
   npm run build
   ```

## Development Workflow

### Making Changes

1. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes

3. Ensure TypeScript compiles:
   ```bash
   npx tsc --noEmit
   ```

4. Test your changes locally:
   ```bash
   node dist/index.js [command]
   ```

### Code Style

- Use TypeScript for all source files
- Follow existing code patterns
- Add JSDoc comments for public functions
- Keep functions focused and small

### Commit Messages

Use clear, descriptive commit messages:

```
feat: Add context compression for long projects
fix: Handle missing SPEC.md gracefully
docs: Update README with new commands
```

Prefixes:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Project Structure

```
src/
├── index.ts              # CLI entry point
├── config/
│   └── models.ts         # Model configurations
├── harness/
│   ├── orchestrator.ts   # Main pipeline logic
│   ├── router.ts         # Routes to CLI tools
│   ├── state.ts          # Project state management
│   ├── council.ts        # Multi-model review
│   ├── context-health.ts # Context monitoring
│   └── ...               # Other modules
├── integrations/
│   └── github.ts         # GitHub integration
prompts/
├── interviewer.md        # Interview phase prompt
├── architect.md          # Architect phase prompt
├── builder.md            # Builder phase prompt
├── reviewer.md           # Reviewer phase prompt
└── compound.md           # Learning refinement prompt
```

## Adding a New Command

1. Add the command in `src/index.ts`
2. Implement the logic (either in orchestrator.ts or a new module)
3. Update the README with the new command
4. Add to CHANGELOG.md

## Adding a New Phase

1. Add the phase type in `src/config/models.ts`
2. Create a prompt file in `prompts/`
3. Add routing in `src/harness/router.ts`
4. Add the phase handler in `src/harness/orchestrator.ts`
5. Wire it up in `src/index.ts`

## Pull Requests

1. Update documentation if needed
2. Add entry to CHANGELOG.md under "Unreleased"
3. Ensure TypeScript compiles without errors
4. Write a clear PR description explaining:
   - What the change does
   - Why it's needed
   - How to test it

## Reporting Issues

When reporting issues, please include:

- What you were trying to do
- What happened instead
- Steps to reproduce
- Your environment (OS, Node version, etc.)
- Relevant error messages

## Questions?

Feel free to open an issue for questions or discussion about potential changes.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
