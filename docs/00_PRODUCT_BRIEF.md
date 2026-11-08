# Product Brief

## Working title
C3Canvas (Code, Create, Collaborate). Check trademark and domain availability before public launch.

## One-sentence vision
A browser-based 3D workspace where people direct an AI to build a high-quality, editable 3D asset in visible stages, inspecting and approving meaningful components as they are constructed.

## The problem
Single-shot AI 3D generation can create visually compelling results that are difficult to edit, have fused or poorly named components, contain inconsistent geometry, and are not suitable for the user's downstream workflow. Post-generation cleanup can erase much of the time saved by AI.

## Product thesis
Treat the AI as a modeler and technical artist working inside a structured project, not as a black-box generator returning one mesh. Establish the intended object hierarchy and constraints early. Build the asset incrementally, validate changes, preserve checkpoints, and allow the user to direct work through a simplified viewport and chat.

## Target user
Primary: creators who know what they want visually but do not want to operate a full professional 3D package for every task. Secondary: experienced 3D artists who want to delegate repetitive construction, texturing, organization, and revision work while retaining control.

## Initial market/use case
Create humanoid characters from one or more reference images, beginning with a neutral unclothed base body, then adding materials, garments, footwear, armor, accessories, and optional rig/export steps.

## User promise
“I can build a 3D character with AI while seeing the work happen, correcting it early, and keeping the parts editable.”

## Differentiation
- Plan before modeling.
- Clear, gated phases with review and approval.
- Persistent component hierarchy and IDs.
- Scoped revisions that preserve unrelated approved work.
- Validation and rollback as normal parts of creation.
- A deliberately simple web interface over a real modeling backend.

## Product principles
1. **Visible work:** draft edits preview live in the browser; the initial Blender scene is compiled only when the user explicitly saves or exports. Subsequent scene changes require explicit, supported worker operations.
2. **Human agency:** users can pause, revise, approve, undo, and redirect.
3. **Structure first:** modularity is an explicit requirement, not after-the-fact mesh splitting.
4. **Reversibility:** risky edits have checkpoints and rollback.
5. **Honest confidence:** AI does not pretend to know hidden geometry from one image.
6. **Progressive disclosure:** novice experience stays simple; optional advanced controls can be introduced later.
7. **Useful output:** files and scene structure matter as much as the rendered look.
8. **Assist without taking control:** AI may propose supported draft edits and guide users to relevant controls, but the user applies edits and remains responsible for review and compile gates.

## Draft/compile boundary
During draft editing, the browser previews and the project persists all choices, including eyes, presets, and morph values. These actions must not import geometry or invoke Blender. A user-initiated final save/export is the initial compile boundary: Blender receives and compiles the saved draft choices together. After compilation, supported scene changes still require explicit user actions and validated worker operations. Plan approval remains a separate enforced gate and never starts compilation.

## Explicit non-goals for MVP
- Replacing every Blender feature.
- Supporting every asset category equally well.
- Guaranteeing perfect production topology for every prompt.
- Real-time collaboration between multiple users.
- Training a foundation model.
- Building a custom Blender fork before the web-first workflow is validated.

## Success metric
A user can complete the base-body → approval → separate garment → scoped garment revision loop without losing the approved body, and can reopen/export a project with the same component hierarchy.
