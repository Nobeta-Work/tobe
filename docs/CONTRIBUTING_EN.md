# Contributing to To Be

Thank you for your interest in contributing. To Be explores, at the architectural level, how an Agent can develop into a person-like presence or companion.

[**简体中文**](../CONTRIBUTING.md) · [**English**](./CONTRIBUTING_EN.md)

---

## Ways to Contribute

- **Report a bug:** Open a GitHub Issue and include the observed behavior, reproduction steps, and environment details.
- **Request a feature:** Describe the use case, expected behavior, and, when possible, a proposed approach in an Issue.
- **Improve documentation:** Fix typos, add examples, or clarify existing explanations.
- **Contribute code:** Fix bugs, implement features, or improve performance.

## Repository Structure

```text
tobe
├── awareness/          # Perception layer
│   ├── adapters/       # Channel adapters and the foundation of "multi"
│   └── engine/         # Unified Awareness engine
├── memory/             # Persistent memory layer
├── media/              # Media capability layer
├── live/               # Proactive behavior layer (Pending)
└── agents/             # Multi-Agent collaboration (Pending)
```

Development should begin with architectural considerations. Keep implementation concise, focused, and decoupled.

Awareness Adapters are the exception: because they normalize very different environments into a shared contract, some environment-specific coupling is acceptable. Document any such coupling and operational assumptions in the Adapter's README.

## Development Environment

```bash
git clone https://github.com/Nobeta-Work/tobe.git
cd tobe
npm install
```

Requirements:

- Node.js 22.19.0 or later
- npm or pnpm

Before submitting a change, run:

```bash
npm run check
```

This runs the TypeScript checks and the complete automated test suite.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<scope>): <subject>

<body>

Signed-off-by: Your Name <your-email@example.com>
```

You can add the `Signed-off-by` line automatically with `git commit -s`.

### Type

| Type | Purpose |
| ---- | ------- |
| `feat` | New functionality |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Internal restructuring without a functional change |
| `docs` | Documentation change |
| `test` | Test additions or changes |
| `chore` | Build, dependency, or tooling change |
| `style` | Formatting-only change with no effect on behavior |
| `revert` | Revert a previous change |

### Scope

Use the affected module or subsystem as the scope. Examples include `memory-core`, `panel`, `knowledge`, `proxy`, `sdk-ts`, `sdk-py`, `deploy`, and `docs`.

## License

By submitting a contribution, you agree that it will be licensed under the project's [MIT License](../LICENSE).
