# OpenSpec Workflow

This directory stores project-level OpenSpec planning artifacts.

- `changes/` contains active change proposals.
- `specs/` contains accepted capability specifications.

Use OpenSpec for non-documentation behavior changes before implementation:

```bash
pnpm exec openspec new change <change-name>
pnpm exec openspec status --change <change-name>
pnpm openspec:validate
```

Keep Codex-specific OpenSpec skills local. The `.codex/` directory is ignored by
this repository and should not be committed. Developers who want local Codex
slash-command support can initialize it in their own checkout:

```bash
OPENSPEC_TELEMETRY=0 pnpm exec openspec init --tools codex --profile core
```
