# Product Definition of Done

## Minimum shippable vertical slice
- User can create a project draft, upload a reference, get/edit a structured plan, and approve it without Blender.
- All editing is browser preview plus persisted draft data, including eye, preset, and morph choices; draft changes do not import Blender geometry.
- Approval does not start Blender or create geometry.
- A separate, approval-gated **Save / Compile** action imports the selected pinned character and compiles all saved draft choices in one Blender operation.
- The assembled component tree and phase history survive reload.
- A checkpoint can be restored, and later morph edits remain scoped and reversible.
- The Blender worker saves/reopens a `.blend` and produces a GLB preview; no mock geometry is used.
- Errors are understandable and failures do not silently corrupt the scene.
- Required tests pass and known limits are documented.

## MVP is not done when
- The app only has a chat panel that returns code.
- The model is one fused mesh with no semantic component manifest.
- Phases are visual labels but are not enforced by backend state.
- The AI can overwrite the whole scene for every edit.
- There is no checkpoint/recovery path.
- The browser shows a stale model while suggesting current work is complete.
- Arbitrary model-generated Python is executed in a public worker.
- The system makes unsupported claims about topology, riggability, or game readiness.

## First release quality bar
The first release can still be limited in geometry quality, but it must be honest about those limits. A reliable workflow using the pinned source asset is an acceptable foundation. A visually impressive but structurally unreliable demo is not.
