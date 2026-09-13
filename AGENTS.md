## Project

Aranea is a Node.js CLI that provides an interactive R console backed by WebR.
Its primary target is the default GitHub Codespaces environment.

## Technical constraints

- Use TypeScript and ESM.
- Do not add native Node.js addons or dependencies that require local compilation.

## Working style

- Inspect the current repository before editing.
- For uncertain WebR behavior, inspect the installed package source and type definitions instead of guessing.
- Prefer small, reviewable changes.
- State assumptions and remaining limitations in the final report.
