# Data Model

The database schema may evolve, but these semantics must remain stable.

## Core records

### Project
- `id`: UUID
- `owner_id`: user or local-owner identifier
- `name`
- `status`: active/archived/deleted (soft delete)
- `target_profile`: static_render/general_purpose/game_asset (expandable enum)
- `base_model_asset_id`: selected allowlisted base model; defaults to `character_cc3_morphs_v1`
- `draft_morphs`: complete selected-manifest control map saved before final Blender compile
- `draft_revision`: optimistic concurrency counter for draft morph-map writes; independent of `scene_version`
- `draft_appearance`: selected eye, compatible body preset, and skin asset IDs; persisted without Blender geometry or `scene_version` changes
- `draft_skin_definition`: versioned semantic skin properties (`base.tone`, `base.undertone`, and `surface.roughness`) saved independently of paint strokes and applied during final compile
- `draft_skin_revision`: optimistic concurrency counter for semantic skin definition writes; independent of `scene_version`
- `draft_skin_paint_strokes`: bounded UV paint/erase operations associated with the selected skin
- `active_phase_id`
- `scene_version`: monotonic integer
- `manifest_version`
- `created_at`, `updated_at`
- `settings_json`: non-secret project settings

### ReferenceAsset
- `id`, `project_id`
- `storage_key`, `mime_type`, `file_size`, `width`, `height`, `sha256`
- `display_name`, `user_notes`
- `created_at`
- `analysis_json`: observations and confidence, not a claim of certainty

### Phase
- `id`, `project_id`, `phase_key`, `revision`
- `title`, `description`, `status`
- `dependencies`: list of phase IDs
- `scope_component_ids`
- `plan_json`, `validation_report_json`
- `started_at`, `finished_at`, `approved_at`, `approved_by`
- `created_scene_version`, `result_scene_version`

### Component
- `id`: stable UUID, not equal to Blender object name
- `project_id`
- `parent_id` nullable
- `display_name`, `semantic_type`, `description`
- `status`: planned/creating/needs_review/approved/modified/archived/failed
- `object_ids`: list of stable Blender object IDs linked to this semantic component
- `material_ids`, `attachment_targets`, `dependencies`
- `created_phase_id`, `last_modified_phase_id`
- `source_reference_ids`
- `current_revision`, `geometry_hash` where available
- `validation_state`, `validation_report_json`
- `created_at`, `updated_at`

### ModelingJob
- `id`, `project_id`, `phase_id`
- `status`: queued/running/awaiting_review/completed/failed/cancelled
- `requested_by`, `agent_run_id`
- `expected_scene_version`, `result_scene_version`
- `scope_component_ids`
- `operation_ids`, `progress_percent` nullable, `progress_message`
- `error_code`, `safe_error_summary`
- `created_at`, `started_at`, `finished_at`

### Operation
- `id`, `project_id`, `job_id`, `phase_id`
- `tool_name`, `validated_args_json`
- `scope_component_ids`, `expected_scene_version`
- `status`, `diff_summary_json`, `validation_report_json`
- `checkpoint_id` nullable
- `started_at`, `finished_at`, `duration_ms`

### Checkpoint
- `id`, `project_id`, `scene_version`
- `blend_storage_key`, `manifest_storage_key`, `preview_storage_key` nullable
- `reason`, `created_by`, `created_at`, `is_approved_checkpoint`

### Event
- `id`, `project_id`, `job_id`, `sequence_number`
- `event_type`, `payload_json`, `created_at`

### ChatMessage
- `id`, `project_id`, `role`, `content`, `attachments_json`
- `selected_component_id` nullable
- `intent_classification_json` nullable
- `created_at`

## Stable identity rules
- Blender object names are mutable labels, never primary keys.
- Persist component UUIDs in Blender custom properties and in the database manifest.
- A component may map to one or multiple Blender objects; a group can map to a hierarchy.
- Geometry hashes are regression helpers, not semantic IDs. Hashing must normalize relevant serialization to avoid false changes from non-semantic ordering where possible.
- Every scene save/export writes a manifest alongside the file.

## Example scene manifest
See `examples/project_manifest.json`.

## Consistency rules
- Manifest and `.blend` scene version must match on commit.
- Draft morph/appearance updates advance only draft state and use browser previews. The initial scene applies saved draft values and selected assets together only during explicit, approval-gated final Save / Compile or export. Later changes require explicit, supported scene operations.
- Semantic skin preview edits remain local until saved to the project draft; only the validated saved definition and selected skin are applied together during explicit final compile. AI interpretation returns a proposal and never saves it automatically.
- If an operation crashes after scene change but before database commit, discard/restore the uncommitted scene artifact.
- A checkpoint includes both Blender scene and manifest.
- A stale command is not executed against a newer scene without revalidation.
- Component deletion is soft-deleted in the manifest and can be restored from a checkpoint.
