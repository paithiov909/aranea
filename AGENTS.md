# AGENTS.md

## Project

Aranea is a Node.js CLI that provides an interactive R console backed by WebR.
Its primary target is the default GitHub Codespaces environment.

## Technical constraints

- Use TypeScript and ESM.
- Support Node.js 20 or later.
- Use npm and commit package-lock.json.
- Do not require a system R installation.
- Do not invoke the external `R` or `Rscript` commands.
- Do not add native Node.js addons or dependencies that require local compilation.
- Pin the WebR dependency to an exact version while the project is experimental.
- Keep WebR-specific behavior behind a small adapter.
- Start with a conventional terminal interface. Do not introduce a full-screen TUI framework until the basic REPL behavior has been validated.
- Do not publish packages, create releases, or push remote branches unless explicitly requested.

## Verification

After changing code, run:

- npm run build
- npm run typecheck
- npm test

When terminal behavior changes, also report what still requires manual interactive verification.

## Working style

- Inspect the current repository before editing.
- For uncertain WebR behavior, inspect the installed package source and type definitions instead of guessing.
- Prefer small, reviewable changes.
- State assumptions and remaining limitations in the final report.
