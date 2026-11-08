# Security, Privacy, and Abuse Resistance

## Threat model
The application accepts user text and images, invokes an AI, and runs geometry software that can execute Python internally. Treat user input, reference metadata, generated code-like text, imported files, and model decisions as untrusted. A compromised or manipulated request must not gain arbitrary shell, Python, filesystem, network, or cross-project access.

## Critical rules
1. Never expose the Blender worker's control socket directly to the public internet.
2. Do not use an unrestricted “execute Python code” tool for a public product. Use an allowlisted operation registry with Pydantic/JSON Schema validation.
3. Run Blender under a non-root user in a dedicated process/container with restricted filesystem mounts, quotas, CPU/RAM limits, wall-clock timeout, and network egress disabled by default.
4. Pass opaque asset/component IDs, not arbitrary absolute paths.
5. Provider keys are server-side secrets. Never place them in frontend source, local storage, emitted events, prompts logged in plaintext, or error messages.
6. Authenticate and authorize every project/resource lookup. Use per-project ownership checks.
7. Enforce upload size, MIME-by-content, pixel/dimension, decompression, and retention limits. Consider malware scanning for uploads in hosted deployments.
8. Sanitize names for file paths and exports. Derive paths on server. Prevent path traversal and symlink attacks.
9. Do not fetch arbitrary URLs from user prompts or model plans. Use an explicit allowlist for external asset providers.
10. Use CSRF protection as needed for cookie auth, secure cookie flags, CORS allowlist, rate limits, and request size limits.

## Worker transaction model
- Each job is tied to a project, expected scene version, and component scope.
- Save a temporary copy/checkpoint before destructive operations.
- Execute one validated operation in isolation.
- Run validators and scope checks.
- Commit only when checks pass.
- If the worker crashes, restore the last committed scene and mark the job failed.
- Delete temporary files and expire abandoned worker directories.
- The API can launch the local Blender worker through a bounded subprocess when `COMODEL_BLENDER_EXECUTABLE` is configured. This remains a local prototype, not a security sandbox. Its JSON allowlist, path checks, and scope checks are defense-in-depth; run Blender under a restricted non-root account/container with resource limits before any untrusted or hosted use.

## External asset licensing
If importing assets from external sources, capture source URL, asset ID, author, license, download date, and any attribution requirements. Keep asset-source metadata in the project. Do not assume “free download” means unrestricted commercial use.

The supplied CC3 Male source has no accompanying redistribution license. Keep its consolidated GLB available only in the local development asset directory unless and until the owner confirms the required rights. The API and worker must use its fixed asset ID/path and matching SHA-256 manifest; never accept an asset path from a request.

## Privacy defaults
- Do not send prompts, reference images, generated meshes, or project files to analytics by default.
- Clearly disclose which data is sent to each configured AI/image service.
- Allow local planning without a cloud model; never substitute simulated geometry when Blender is unavailable.
- Provide project deletion and documented retention policy for hosted deployments.
- Do not include user content in crash reports without explicit opt-in.

## Model/provider policy
- Validate provider output before use.
- Set token, request, and spend limits.
- Do not expose raw tool errors to the model if they include secrets or paths.
- Store enough operation metadata to debug without storing more user content than needed.
- Treat assistant-generated chat actions as untrusted proposals. Validate every morph ID/range, appearance asset ID/compatibility, editability state, and guidance target server-side before returning an actionable response.
- Chat proposals are never direct tool calls. The browser requires explicit user application through draft APIs; chat has no route to Blender, approval, compilation, arbitrary selectors, HTML injection, filesystem access, or provider credentials.

## Local development versus production
The starter may omit authentication only for loopback-only development. The app must refuse a non-local bind unless auth/security configuration is explicitly enabled. Production readiness requires a security review; a Docker container alone is not a complete sandbox.

## License obligations
Before distributing a fork or service, review each adopted repository's license, notices, assets, dependencies, model weights, and provider terms. GPL-derived desktop code can impose obligations that do not apply to a clean-room browser/API implementation. This document is not legal advice.
