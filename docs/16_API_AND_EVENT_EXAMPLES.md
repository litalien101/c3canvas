# API and Event Examples

These are illustrative contracts for the coding agent. UUID values and asset URLs are examples.

## Example `component.created` event
```json
{
  "sequence": 12,
  "type": "component.created",
  "project_id": "e1c0c35f-03b3-4eab-8d9a-9d49ea5d7eb9",
  "job_id": "4bdf35b8-fbfb-470c-9f90-6b7f226c0ee1",
  "phase_id": "56e4f0f7-b2f6-4e28-a2f8-7fdbcf7359e8",
  "scene_version": 3,
  "timestamp": "2026-10-29T12:00:00Z",
  "payload": {
    "component": {
      "id": "6cf7d4b1-3ea8-4c1d-94e4-9d3d92f83d5c",
      "display_name": "Jacket",
      "semantic_type": "garment",
      "status": "needs_review",
      "dependencies": ["1d2f0b8b-7f4b-4d4e-a5f7-4cdd2c8a0111"]
    }
  }
}
```

## Example operation result
```json
{
  "operation_id": "68118aa6-1bd0-4e23-85cd-22f9426b80fb",
  "status": "completed",
  "changed_component_ids": ["6cf7d4b1-3ea8-4c1d-94e4-9d3d92f83d5c"],
  "unchanged_component_ids": ["1d2f0b8b-7f4b-4d4e-a5f7-4cdd2c8a0111"],
  "new_scene_version": 4,
  "preview_asset_id": "preview-4",
  "validation": [
    {"check_id": "component_id_present", "status": "pass", "summary": "Component identity persisted."},
    {"check_id": "scope_preserved", "status": "pass", "summary": "No out-of-scope components changed."},
    {"check_id": "garment_intersections", "status": "not_run", "summary": "No reliable intersection validator configured in this adapter."}
  ]
}
```

## Example user-facing change summary
“Updated the jacket hem and sleeve length. The base body, pants, boots, and accessories were not changed. The preview has been refreshed. Clothing fit checks are limited in this prototype; please review the underarm and shoulder areas.”

## Example assistant chat response
Chat actions are suggestions. The browser displays the proposal and waits for the user to apply it through the draft API; this response does not mutate project state or invoke Blender.

```json
{
  "assistant_message": "I can adjust the arm length in your draft.",
  "assistant_proposal": {
    "morph_updates": {"arm_length": 0.25},
    "appearance_updates": {}
  },
  "guidance": {
    "target_id": "morph:arm_length",
    "title": "Arm Length",
    "message": "Use this slider to adjust the character's arm length."
  },
  "interaction_warning": null
}
```

The API validates morph IDs/ranges and guidance target IDs before returning them. Appearance proposals are limited to installed compatible assets and are unavailable after compilation. Plain-text model output returns no proposal or guidance and includes an `interaction_warning`.
