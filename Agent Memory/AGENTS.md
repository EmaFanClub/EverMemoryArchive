# Repository Guidelines

## Project Structure & Module Organization
- `mini_agent/`: Core package — `agent.py` (loop), `cli.py` (entrypoint), `llm/` (model clients), `tools/` (file, shell, MCP, skills), `config/` (config templates), `acp/` (ACP server bindings).
- `tests/`: Pytest suites mirroring core modules; prefer adding new tests alongside related code.
- `docs/`: Development and production guides; sync updates here when changing behavior.
- `examples/` and `scripts/`: Usage samples and setup helpers (config bootstrap, submodule init).
- `workspace/`: Local scratch/cache folder created at runtime; keep it out of commits.

## Build, Test, and Development Commands
- Install deps: `uv sync` (preferred) or `pip install -e .` for editable installs.
- Run the agent: `uv run mini-agent --workspace ./workspace` or `uv run python -m mini_agent.cli` for debug logging.
- ACP server: `uv run mini-agent-acp` (requires config matching your editor).
- Tests: `uv run pytest tests -v` or target modules, e.g., `uv run pytest tests/test_agent.py -k tool`.
- Update skills submodule (optional): `git submodule update --init --recursive`.

## Coding Style & Naming Conventions
- Python 3.10+; follow PEP 8 with 4-space indents and type hints. Keep functions/methods `snake_case`, classes `PascalCase`, modules/files `snake_case`.
- Use pydantic models for request/response schemas; prefer explicit dataclasses for structured data.
- Keep tools subclassing `Tool` small and declarative; document side effects in docstrings.
- Logging: use `mini_agent.logger` helpers; avoid print statements.

## Testing Guidelines
- Framework: pytest (async supported via `pytest-asyncio`). Place tests as `test_*.py` under `tests/`.
- Aim for fast unit coverage of tools/LLM clients plus integration paths through `agent.py` and CLI.
- When adding async tools, include `@pytest.mark.asyncio` and cover error branches. Mock network/API calls; do not hit real endpoints in CI.
- Run `uv run pytest tests -v` before submitting; keep fixtures lightweight to avoid flakiness.

## Commit & Pull Request Guidelines
- Commit messages: follow the existing `type(scope): message` pattern (`feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `style`). Example: `feat(tools): add csv summarizer`.
- Branches: `feature/<name>` or `fix/<name>` as in CONTRIBUTING.
- PRs should include: short description of behavior change, linked issues, config/compat notes, and test evidence (`pytest -v` output or summary). Add screenshots/GIFs when CLI UX changes.
- Keep PRs focused; avoid bundling unrelated refactors with feature work.

## Security & Configuration Tips
- Never commit API keys; store runtime config in `mini_agent/config/config.yaml` (copy from `config-example.yaml`) or `~/.mini-agent/config/`. Add placeholders in examples.
- Review scripts for hardcoded paths before running; prefer `uv run` to ensure isolated environments.
