# Phased Implementation Prompt

Use this after the master prompt, or at the start of each milestone.

You are implementing milestone **[INSERT MILESTONE NUMBER AND NAME]** from `docs/10_BUILD_ROADMAP.md`.

1. Read the roadmap's deliverables and exit criteria, the relevant PRD requirements, and `AGENTS.md`.
2. Inspect the existing code. Do not rebuild already-working features without a specific reason.
3. Write a concise implementation plan with files likely to change and the tests to add.
4. Implement only this milestone and the minimum prerequisites.
5. Add tests for normal, invalid, stale-version, and failure paths relevant to the slice.
6. Run the exact test/format/type-check commands supported by the repo.
7. Fix failures you introduced. If a tool/dependency is unavailable, state that clearly and provide a deterministic alternative for local/CI testing.
8. Update `docs/10_BUILD_ROADMAP.md`, setup docs, and contracts when behavior changes.
9. Report: features completed, tests and exact results, known gaps, and next milestone.

Do not declare the milestone complete unless its exit criteria are met. If a prerequisite is blocked by a major geometry problem, complete the workflow with a clearly labeled mock adapter rather than pretending the geometry implementation exists.
