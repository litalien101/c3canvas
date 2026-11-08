# Existing Project and Reuse Review

**Research date:** 2026-10-29. Re-check each repository before making a dependency or fork decision. This is technical research, not legal advice.

## Recommendation in brief
Use a clean browser/API architecture for your product. Borrow patterns and potentially code from permissively licensed libraries after auditing each dependency. Treat Mixar as a product/UX and Blender-integration reference; it is a custom Blender fork rather than a lightweight web app. Treat MCP for Blender as a reference or private-development bridge, not an internet-facing execution layer. A clean-room typed operation adapter may be safer for the hosted product.

## 1. CharacterCreator — highly relevant geometry pipeline to evaluate
- Repository: https://github.com/kblood/CharacterCreator
- What it offers according to its current README: Blender/MPFB/MakeHuman headless body generation, separate body/hair/clothing GLBs and JSON sidecars, a Three.js viewer, garment checks, clothing simulation experiments, and animation support.
- License caution: current README says the source was MIT until 2026-10-03 and has since changed to GPL-3.0-or-later; generated output is described separately as CC0 under stated asset-provenance assumptions. Review exact commit, `LICENSE`, `LICENSE-NOTES.md`, assets, generated output conditions, and dependency notices before adoption.
- Good use: evaluate as an existing body + outfit asset pipeline or as a reference for validating garment and export behavior. It is not a complete chat-driven staged modeling product.
- Risks: new/small project with low public adoption; verify the full pipeline on your target OS and Blender version, inspect known failing checks, and do a license review.

## 2. MPFB / MakeHuman for Blender
- Official extension: https://extensions.blender.org/add-ons/mpfb/
- Source: https://github.com/makehumancommunity/mpfb2
- Documentation: https://www.makehumancommunity.org/mpfb/docs/getting_started.html
- What it offers: parametric humanoid generation, body feature controls, skin/eye materials, rigging support, and an asset library. The extension listing shows version 2.0.18 in October 2026 and Blender 4.2 LTS or newer compatibility.
- License caution: MPFB source code is GPL-3.0-or-later; its project describes core assets as CC0. Review the license for each downloaded asset pack, and keep source-code and asset licensing separate in the compliance record.
- Good use: an adapter for starting the base body and potentially accessing existing character parameters/assets. Verify headless scripts, API stability, and output organization before selecting it.
- Risks: it is a character generator, not the whole web product; fitting custom garments and matching arbitrary image references still need work.

## 3. Mixar
- Repository: https://github.com/Mixar-AI/mixar-app
- Website: https://www.mixar.app/
- What it offers: an AI-assisted Blender desktop client, chat-driven multi-step scene tasks, AI 3D generation, texture tooling, and a custom Blender interface.
- Current repo notes observed during research: the public README identifies it as a custom fork of Blender 5.2 and says the hosted AI backend is separate/closed-source. It requires building Blender plus its overlay, so it is not a small front-end to drop into a web app.
- License notes: repository indicates GPL-3.0-or-later for Mixar-original code, Blender-derived code inherits Blender licensing, and Mixar brand assets have a separate brand license. Review notices and file-level SPDX metadata.
- Good use: benchmark the UX, inspect the open client implementation, learn how it integrates agent-driven Blender tasks.
- Risks: expensive native build; backend not fully included; license and trademark obligations; not browser-native.

## 4. MCP for Blender (ahujasid/blender-mcp)
- Repository: https://github.com/ahujasid/blender-mcp
- Project site: https://www.mcp-for-blender.com/
- What it offers: MCP server plus Blender add-on for scene inspection, object/material operations, asset retrieval, and code execution.
- Good use: local experiments and understanding LLM-to-Blender integration.
- Risks: README explicitly lists execution of arbitrary Python in Blender, and its add-on uses a socket connection. Do not expose this pattern to untrusted users or the public internet. Build a server-validated, allowlisted tool registry and an isolated worker for the product. Review repository license and terms/telemetry document directly before adoption.

## 5. Pascal Editor
- Repository: https://github.com/pascalorg/editor
- Website: https://editor.pascal.app/
- What it offers: open-source browser-based 3D architectural editor, React Three Fiber/WebGPU scene editor, MCP support, and reusable viewer/editor packages. The repo describes it as architecture-oriented.
- License notes: the website/repo describe MIT licensing; verify the exact license for any package/version used.
- Good use: study or potentially reuse generic scene-tree/editor patterns and local-first agent integration.
- Risks: architecture-specific data model and geometry workflow are not the character modeling system you need; migration/adaptation may be more work than using the viewer layer only.

## 6. Threepipe
- Repository: https://github.com/repalash/threepipe
- Documentation: https://threepipe.org/
- What it offers: web 3D toolkit that can be used with HTML/JS and common web frameworks, with viewer/editor plugins and GLB/glTF model support.
- License notes: the repository says core framework and plugins without separate licenses use Apache-2.0; inspect each plugin for separate terms.
- Good use: candidate browser rendering/asset viewer layer.
- Risks: it is a visualization toolkit, not the Blender execution engine or phased modeling agent; evaluate long-term API fit and plugin licenses.

## 7. Blender Python API
- Documentation: https://docs.blender.org/api/current/
- What it offers: native scene, object, mesh, material, export, and scripting control from Python. Version-specific API documentation matters.
- Good use: actual modeling backend where supported operations manipulate native Blender scene data.
- Risks: running Blender as a worker requires headless compatibility testing, isolation, version management, and robust recovery; API-level power does not provide semantic component planning automatically.

## Suggested decision
- **Frontend:** custom React/R3F interface, optionally compare Threepipe and Pascal's embeddable viewer approach.
- **Backend:** custom FastAPI service and safe Blender worker.
- **Agent protocol:** use internal typed JSON tool contracts; MCP can be an optional development adapter, not the core public API.
- **Base character geometry:** evaluate MPFB and CharacterCreator in a time-boxed spike, using a swappable adapter. Do not hard-wire either into the phase manager. Record asset/model licenses and generation limitations.

## Before adopting any code
1. Pin a commit/release and archive its license/NOTICE files.
2. Inspect transitive dependencies and bundled assets.
3. Verify commercial-use rights for code, images, base meshes, textures, weights, and output generation services.
4. Check trademarks/branding separately from code licensing.
5. Keep an SBOM and third-party notices file.
6. Re-check API/provider terms and data-handling policies before launch.
