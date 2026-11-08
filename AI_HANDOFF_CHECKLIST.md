# AI Handoff Checklist

Before telling the user the application is built, verify all of the following against the acceptance tests:

- [ ] The coding agent read `AGENTS.md` and the architecture/product docs.
- [ ] The browser viewport is the primary interface; no Blender desktop menus are exposed to the user.
- [ ] Project, phase, component, operation, and checkpoint state persist after restart.
- [ ] The user can upload reference images and the app records them safely.
- [ ] The plan is created before major modeling and can be reviewed/edited.
- [ ] Phase approval is enforced server-side.
- [ ] The system creates independently editable body/garment/accessory components.
- [ ] Changing one garment does not alter the base body unless explicitly approved and declared.
- [ ] Meaningful operations stream visible progress and refresh the preview.
- [ ] Checkpoints and rollback recover from a failed operation.
- [ ] The real Blender worker is isolated and accepts only allowlisted validated tools.
- [ ] Native `.blend` and GLB export work, with a matching component manifest.
- [ ] Every quality claim is backed by a validator; missing checks are `not_run`.
- [ ] All automated tests pass, and test commands/results are in the build report.
- [ ] Current licenses and asset provenance are reviewed and recorded.
- [ ] Known limitations are clearly listed; mock features are not represented as production functionality.
