# AI Code Review Prompt

Review this repository against `AGENTS.md` and the product requirements. Prioritize correctness and security over style-only feedback.

Check specifically:
- Can approval gates be bypassed by direct API calls?
- Can an AI tool call execute arbitrary Python/shell or access arbitrary file paths?
- Are project and component IDs checked against the authenticated project owner?
- Can a stale scene version overwrite newer work?
- Is the component manifest committed atomically with the Blender scene and version record?
- Can a garment revision mutate the base body without explicit declaration and user approval?
- Do failures restore or preserve the last committed scene?
- Are user/provider secrets leaked through logs or browser bundles?
- Can malicious file names, oversized images, or symlinks escape storage boundaries?
- Are unsupported quality checks incorrectly reported as passing?
- Does the UI label mock mode and stale previews accurately?
- Are tests asserting observable behavior, including the garment-edit/body-preservation regression?

For every finding, provide severity, file/line, exploit or failure scenario, recommended fix, and a regression test. Do not report speculative style preferences as defects. Finish with a prioritized list of blockers for shipping.
