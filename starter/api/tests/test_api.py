from io import BytesIO
import hashlib
import json
import shutil
import struct
import subprocess
import zipfile
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from app import main
from app import copilot
from app import blender_adapter
from app.copilot import CopilotBridge, CopilotBridgeError
from app.main import app
from app.repository import SQLiteProjectRepository

client = TestClient(app)


def test_eye_assets_manifest_exposes_integrity_verified_attachable_assets():
    response = client.get("/api/v1/assets/eyes")

    assert response.status_code == 200
    assets = response.json()
    assert len(assets) == 14
    assert {asset["variant"] for asset in assets} == {"normal", "game_multi_uv", "game_one_uv"}
    assert all(asset["attachment_status"] == "attachable" for asset in assets)
    assert all(asset["generated_sha256"] for asset in assets)
    assert all(asset["file_count"] == len(main.EYE_ASSETS_MANIFEST["assets"][index]["files"])
               for index, asset in enumerate(assets))
    selected = assets[0]
    preview = client.get(
        f"/api/v1/assets/eyes/{selected['id']}/preview",
        params={"sha256": selected["generated_sha256"]},
    )
    assert preview.status_code == 200
    assert preview.headers["etag"] == f'"{selected["generated_sha256"]}"'
    assert preview.content[:4] == b"glTF"

    stale_preview = client.get(
        f"/api/v1/assets/eyes/{selected['id']}/preview",
        params={"sha256": "0" * 64},
    )
    assert stale_preview.status_code == 409


def test_eye_draft_selection_persists_without_invoking_blender(monkeypatch):
    project = client.post(
        "/api/v1/projects",
        json={"name": "Eye Draft Test", "base_model_asset_id": "character_cc3_morphs_v1"},
    ).json()

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Draft eye selection must not invoke Blender")

    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)
    response = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={"eye_asset_id": "eye-normal-1", "body_preset_id": None},
    )

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["draft_appearance"] == {
        "eye_asset_id": "eye-normal-1",
        "body_preset_id": None,
        "skin_asset_id": None,
    }
    assert saved["scene_version"] == 0
    assert saved["components"] == []


def test_skin_assets_are_integrity_checked_and_persist_on_compatible_drafts(monkeypatch):
    assets_response = client.get("/api/v1/assets/skins")
    assert assets_response.status_code == 200
    assets = assets_response.json()
    assert [asset["id"] for asset in assets] == ["skin_cc3plus_female_1"]
    asset = assets[0]
    assert asset["compatible_asset_ids"] == ["character_cc5_rlcc3plus_all_morphs_v1"]
    assert set(asset["materials"]) == {
        "Std_Skin_Head",
        "Std_Skin_Body",
        "Std_Skin_Arm",
        "Std_Skin_Leg",
    }

    preview = client.get(
        f"/api/v1/assets/skins/{asset['id']}/preview",
        params={"sha256": asset["preview_sha256"]},
    )
    assert preview.status_code == 200
    assert preview.headers["etag"] == f'"{asset["preview_sha256"]}"'
    assert preview.headers["content-type"] == "image/webp"
    assert preview.content[:4] == b"RIFF" and preview.content[8:12] == b"WEBP"
    from PIL import Image

    with Image.open(BytesIO(preview.content)) as card_image:
        assert card_image.format == "WEBP"
        assert max(card_image.size) <= 256
    installed_asset = main.skin_asset_by_id(asset["id"])
    full_map_paths = [
        main.PROJECT_ROOT / image["path"]
        for maps in installed_asset["materials"].values()
        for image in maps.values()
    ]
    preview_paths = [
        main.PROJECT_ROOT / image["preview_path"]
        for maps in installed_asset["materials"].values()
        for image in maps.values()
    ]
    assert sum(path.stat().st_size for path in preview_paths) < sum(
        path.stat().st_size for path in full_map_paths
    )
    stale = client.get(
        f"/api/v1/assets/skins/{asset['id']}/preview",
        params={"sha256": "0" * 64},
    )
    assert stale.status_code == 409
    texture = client.get(
        f"/api/v1/assets/skins/{asset['id']}/textures/Std_Skin_Head/normal",
        params={"sha256": asset["materials"]["Std_Skin_Head"]["normal"]},
    )
    assert texture.status_code == 200
    assert texture.headers["content-type"] == "image/png"
    assert texture.content.startswith(b"\x89PNG\r\n\x1a\n")
    with Image.open(BytesIO(texture.content)) as normal_preview:
        assert normal_preview.format == "PNG"
        assert max(normal_preview.size) <= 1024
    unknown_material = client.get(
        f"/api/v1/assets/skins/{asset['id']}/textures/Std_Skin_Head/../../outside",
        params={"sha256": "0" * 64},
    )
    assert unknown_material.status_code in {404, 422}

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Draft skin selection must not invoke Blender")

    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)
    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Skin Draft",
            "base_model_asset_id": "character_cc5_rlcc3plus_all_morphs_v1",
        },
    ).json()
    saved = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={"eye_asset_id": None, "body_preset_id": None, "skin_asset_id": asset["id"]},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft_appearance"]["skin_asset_id"] == asset["id"]
    assert saved.json()["scene_version"] == 0
    paint_stroke = {
        "material": "Std_Skin_Head",
        "tool": "paint",
        "color": "#c84051",
        "radius": 0.01,
        "opacity": 0.75,
        "points": [{"u": 0.25, "v": 0.4}, {"u": 0.3, "v": 0.45}],
    }
    painted = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={
            "eye_asset_id": None,
            "body_preset_id": None,
            "skin_asset_id": asset["id"],
            "skin_paint_strokes": [paint_stroke],
        },
    )
    assert painted.status_code == 200, painted.text
    assert painted.json()["draft_skin_paint_strokes"] == [paint_stroke]
    reopened = client.get(f"/api/v1/projects/{project['id']}")
    assert reopened.status_code == 200
    assert reopened.json()["draft_appearance"]["skin_asset_id"] == asset["id"]
    assert reopened.json()["draft_skin_paint_strokes"] == [paint_stroke]
    legacy_update = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={"eye_asset_id": None, "body_preset_id": None},
    )
    assert legacy_update.status_code == 200
    assert legacy_update.json()["draft_appearance"]["skin_asset_id"] == asset["id"]
    assert legacy_update.json()["draft_skin_paint_strokes"] == [paint_stroke]
    invalid_stroke = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={
            "eye_asset_id": None,
            "body_preset_id": None,
            "skin_asset_id": asset["id"],
            "skin_paint_strokes": [{**paint_stroke, "points": [{"u": 1.1, "v": 0.5}]}],
        },
    )
    assert invalid_stroke.status_code == 422
    invalid_tool = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={
            "eye_asset_id": None,
            "body_preset_id": None,
            "skin_asset_id": asset["id"],
            "skin_paint_strokes": [{**paint_stroke, "tool": "smudge"}],
        },
    )
    assert invalid_tool.status_code == 422
    cleared_skin = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={"eye_asset_id": None, "body_preset_id": None, "skin_asset_id": None},
    )
    assert cleared_skin.status_code == 200
    assert cleared_skin.json()["draft_skin_paint_strokes"] == []

    incompatible = client.post(
        "/api/v1/projects",
        json={"name": "Incompatible Skin", "base_model_asset_id": "character_cc3_morphs_v1"},
    ).json()
    rejected = client.patch(
        f"/api/v1/projects/{incompatible['id']}/draft-appearance",
        json={"eye_asset_id": None, "body_preset_id": None, "skin_asset_id": asset["id"]},
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "SKIN_ASSET_UNAVAILABLE"


def test_semantic_skin_draft_is_versioned_and_ai_interpretation_requires_apply(monkeypatch):
    project = client.post(
        "/api/v1/projects",
        json={
            "name": "Semantic Skin Draft",
            "base_model_asset_id": "character_cc5_rlcc3plus_all_morphs_v1",
        },
    ).json()
    appearance = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={"eye_asset_id": None, "body_preset_id": None, "skin_asset_id": "skin_cc3plus_female_1"},
    )
    assert appearance.status_code == 200, appearance.text
    initial = appearance.json()["draft_skin_definition"]

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Semantic skin draft edits must not invoke Blender")

    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)
    edited = client.patch(
        f"/api/v1/projects/{project['id']}/draft-skin",
        json={
            "expected_draft_skin_revision": appearance.json()["draft_skin_revision"],
            "skin_definition": {
                "version": 1,
                "base": {"tone": 0.8, "undertone": "olive"},
                "surface": {"roughness": 0.3},
            },
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["draft_skin_revision"] == appearance.json()["draft_skin_revision"] + 1
    assert edited.json()["draft_skin_definition"]["base"] == {"tone": 0.8, "undertone": "olive"}
    assert edited.json()["draft_skin_definition"]["surface"] == {"roughness": 0.3}
    reopened = client.get(f"/api/v1/projects/{project['id']}").json()
    assert reopened["draft_skin_definition"] == edited.json()["draft_skin_definition"]
    stale = client.patch(
        f"/api/v1/projects/{project['id']}/draft-skin",
        json={
            "expected_draft_skin_revision": appearance.json()["draft_skin_revision"],
            "skin_definition": initial,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "STALE_SKIN_DRAFT"
    invalid = client.patch(
        f"/api/v1/projects/{project['id']}/draft-skin",
        json={
            "expected_draft_skin_revision": edited.json()["draft_skin_revision"],
            "skin_definition": {
                "version": 1,
                "base": {"tone": 1.1, "undertone": "neutral"},
                "surface": {"roughness": 0.3},
            },
        },
    )
    assert invalid.status_code == 422

    async def interpret(**_kwargs):
        return json.dumps({
            "patch": {"base": {"tone": 0.7}},
            "explanation": "A modest tone adjustment is supported.",
        })

    monkeypatch.setattr(main, "generate_copilot_reply", interpret)
    proposal = client.post(
        f"/api/v1/projects/{project['id']}/skin/interpret",
        json={"prompt": "Make the skin a little lighter"},
    )
    assert proposal.status_code == 200, proposal.text
    assert proposal.json()["changed_properties"] == ["base.tone"]
    assert proposal.json()["preview"]["base"] == {"tone": 0.7, "undertone": "olive"}
    assert client.get(f"/api/v1/projects/{project['id']}").json()["draft_skin_definition"] == edited.json()["draft_skin_definition"]

    async def malformed(**_kwargs):
        return '{"patch":{"base":{"freckles":true}},"explanation":"Unsupported."}'

    monkeypatch.setattr(main, "generate_copilot_reply", malformed)
    rejected = client.post(
        f"/api/v1/projects/{project['id']}/skin/interpret",
        json={"prompt": "Add freckles"},
    )
    assert rejected.status_code == 502
    assert rejected.json()["detail"]["code"] == "INVALID_SKIN_INTERPRETATION"


def test_standalone_eye_modeling_operation_is_rejected(monkeypatch):
    project = client.post(
        "/api/v1/projects",
        json={"name": "No Eye Import", "base_model_asset_id": "character_cc3_morphs_v1"},
    ).json()

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Standalone eye import must not invoke Blender")

    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)
    response = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "attach_eye_asset",
            "operation_id": str(uuid4()),
            "expected_scene_version": 0,
            "scope_component_ids": [],
            "dependency_component_ids": [str(uuid4())],
            "arguments": {"component_id": str(uuid4()), "asset_id": "eye-normal-1"},
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "DRAFT_PREVIEW_ONLY"


@pytest.fixture(autouse=True)
def isolate_database(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "REPOSITORY", SQLiteProjectRepository(tmp_path / "test.sqlite"))
    monkeypatch.setattr(main, "ASSET_STORE", main.LocalAssetStore(tmp_path / "assets"))
    monkeypatch.setenv("COMODEL_COPILOT_BRIDGE_CONFIG", str(tmp_path / "missing-copilot-bridge.json"))
    blender = shutil.which("blender")
    if blender:
        monkeypatch.setenv("COMODEL_BLENDER_EXECUTABLE", blender)
    else:
        monkeypatch.delenv("COMODEL_BLENDER_EXECUTABLE", raising=False)


def test_health_explicitly_reports_blender_and_sqlite_persistence():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["blender_available"] is (shutil.which("blender") is not None)
    assert response.json()["modeling_adapter"] == (
        "blender" if shutil.which("blender") else "unavailable"
    )
    if shutil.which("blender"):
        assert response.json()["blender_error"] is None
    else:
        assert response.json()["blender_error"]
    assert response.json()["persistence"] == "sqlite"


def test_modeling_operation_retry_is_idempotent_only_for_matching_request():
    operation_id = uuid4()
    payload = main.ImportBaseModelTool(
        tool_name="import_base_model",
        operation_id=operation_id,
        expected_scene_version=0,
        scope_component_ids=[],
        dependency_component_ids=[],
        arguments={"asset_id": "character_cc3_morphs_v1"},
    )
    serialized_request = json.dumps(
        payload.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    )
    operation = {
        "operation_id": str(operation_id),
        "request_hash": hashlib.sha256(serialized_request.encode("utf-8")).hexdigest(),
        "status": "completed",
        "tool_name": "import_base_model",
        "scene_version": 1,
    }
    project = main.Project(
        name="Idempotent operation retry",
        target_profile="general_purpose",
        scene_version=1,
        operations=[operation],
    )

    retry = main.execute_modeling_tool(project, payload)

    assert retry == {"operation": operation, "project": project}
    different_request = payload.model_copy(
        update={
            "arguments": payload.arguments.model_copy(
                update={"asset_id": "character_cc3_male_morphs_v1"}
            )
        }
    )
    with pytest.raises(main.HTTPException) as error:
        main.execute_modeling_tool(project, different_request)
    assert error.value.status_code == 409
    assert error.value.detail["code"] == "OPERATION_ID_REUSED"


def test_model_catalog_lists_installed_approval_gated_character_assets():
    response = client.get("/api/v1/models")

    assert response.status_code == 200
    assert response.json() == [
        {
            "asset_id": asset_id,
            "name": main.ASSET_CONFIG[asset_id]["name"],
            "detail": manifest.get(
                "detail",
                f"Rigged character base · {len(manifest['controls'])} editable morph controls",
            ),
            "category": "character",
            "morph_control_count": len(manifest["controls"]),
            "glb_sha256": manifest["glb_sha256"],
            "preview_sha256": main.asset_preview_sha256(asset_id),
            "startup_preview_sha256": (
                main.asset_startup_preview_sha256(asset_id)
                if main.asset_startup_preview_is_installed(asset_id)
                else None
            ),
            "morph_preview_mode": main.effective_morph_preview_mode(asset_id),
            "morph_proxy_sha256": (
                main.cc5_morph_proxy_info()["proxy_glb_sha256"]
                if asset_id == "character_cc5_rlcc3plus_all_morphs_v1"
                and main.cc5_morph_proxy_info() is not None
                else None
            ),
            "morph_delta_sha256": (
                main.cc5_morph_proxy_info()["morph_deltas_sha256"]
                if asset_id == "character_cc5_rlcc3plus_all_morphs_v1"
                and main.cc5_morph_proxy_info() is not None
                else None
            ),
            "morph_presets": (
                main.available_cc5_body_presets()
                if asset_id == "character_cc5_rlcc3plus_all_morphs_v1"
                else []
            ),
            "requires_approval": True,
        }
        for asset_id, manifest in main.CC3_MORPH_MANIFESTS.items()
    ]
    assert all("morph_control_specs" not in model for model in response.json())


def test_cc5_preset_manifest_covers_every_extracted_preset_fbx():
    preset_root = main.PROJECT_ROOT / "source_archive" / "presets"
    extracted_paths = {
        path.relative_to(main.PROJECT_ROOT).as_posix()
        for path in preset_root.glob("**/*.Fbx")
        if "_preset_" in path.name
    }
    manifest_paths = {
        preset["source_path"]
        for preset in main.CC5_BODY_PRESETS_MANIFEST["presets"]
    }

    assert len(set(Path(path).stem for path in extracted_paths)) == 27
    assert {Path(path).stem for path in manifest_paths} == {
        Path(path).stem for path in extracted_paths
    }
    assert len(main.CC5_BODY_PRESETS_BY_ID) == len(manifest_paths)


def test_model_morph_controls_are_loaded_separately_from_catalog():
    asset_id = "character_cc3_morphs_v1"

    response = client.get(f"/api/v1/models/{asset_id}/morph-controls")

    assert response.status_code == 200
    assert len(response.json()) == len(main.CC3_MORPH_MANIFESTS[asset_id]["controls"])
    assert response.json()[0] == main.MorphControlSpec.model_validate(
        main.CC3_MORPH_MANIFESTS[asset_id]["controls"][0]
    ).model_dump(mode="json")


def test_model_morph_controls_report_unavailable_assets(monkeypatch):
    monkeypatch.setattr(main, "asset_source_is_available", lambda _asset_id: False)

    response = client.get("/api/v1/models/character_cc3_morphs_v1/morph-controls")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "BASE_MODEL_ASSET_UNAVAILABLE"


def test_model_catalog_defers_full_source_hashing_until_import(monkeypatch):
    def reject_large_source_hash(_asset_id):
        pytest.fail("The model catalog must not hash full source assets.")

    monkeypatch.setattr(main, "asset_is_installed", reject_large_source_hash)

    response = client.get("/api/v1/models")

    assert response.status_code == 200


def test_morph_preview_serves_only_integrity_checked_allowlisted_assets(monkeypatch, tmp_path):
    source_asset = tmp_path / "pinned-female.glb"
    source_asset.write_bytes(b"glTF" + b"morph-preview" * 100)
    preview_asset = tmp_path / "compressed-female.glb"
    preview_asset.write_bytes(b"glTF" + b"meshopt-preview" * 10)
    preview_hash = hashlib.sha256(preview_asset.read_bytes()).hexdigest()
    monkeypatch.setattr(main, "asset_preview_path", lambda _asset_id: preview_asset)
    monkeypatch.setattr(main, "asset_preview_sha256", lambda _asset_id: preview_hash)
    monkeypatch.setattr(main, "asset_source_is_available", lambda _asset_id: True)
    monkeypatch.setattr(main, "asset_preview_is_installed", lambda _asset_id: True)

    digest = main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]["glb_sha256"]
    response = client.get(
        f"/api/v1/models/character_cc3_morphs_v1/morph-preview",
        params={"sha256": digest, "preview_sha256": preview_hash},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.headers["etag"] == f'"{preview_hash}"'
    assert response.content == preview_asset.read_bytes()


def test_cc5_morph_proxy_and_deltas_are_hash_pinned_and_allowlisted(monkeypatch, tmp_path):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    proxy_asset = tmp_path / main.CC5_MORPH_PROXY_FILENAME
    proxy_asset.write_bytes(b"glTF local CC5 proxy")
    delta_archive = tmp_path / main.CC5_MORPH_DELTAS_FILENAME
    control_id = main.CC3_MORPH_MANIFESTS[asset_id]["controls"][0]["id"]
    nested_control_id = next(
        control["id"]
        for control in main.CC3_MORPH_MANIFESTS[asset_id]["controls"]
        if "/" in control["id"]
    )
    preset_ids = set(main.CC5_BODY_PRESETS_BY_ID)
    with zipfile.ZipFile(delta_archive, "w") as archive:
        archive.writestr(f"controls/{control_id}.bin", b"CMMD delta")
        archive.writestr(f"controls/{nested_control_id}.bin", b"CMMD nested delta")
        archive.writestr("controls/not-allowlisted.bin", b"rejected")
        for preset_id in preset_ids:
            archive.writestr(f"presets/{preset_id}.bin", f"CMMD {preset_id}".encode())
    proxy_hash = hashlib.sha256(proxy_asset.read_bytes()).hexdigest()
    delta_hash = hashlib.sha256(delta_archive.read_bytes()).hexdigest()
    proxy_metadata = {
        "proxy_glb_sha256": proxy_hash,
        "morph_deltas_sha256": delta_hash,
    }
    monkeypatch.setattr(main, "ASSET_ROOT", tmp_path)
    monkeypatch.setattr(main, "cc5_morph_proxy_info", lambda: proxy_metadata)
    monkeypatch.setattr(
        main,
        "cc5_body_preset_info",
        lambda preset_id: {
            "id": preset_id,
            "delta_entry": f"presets/{preset_id}.bin",
            "morph_deltas_sha256": delta_hash,
        } if preset_id in preset_ids else None,
    )
    source_hash = main.CC3_MORPH_MANIFESTS[asset_id]["glb_sha256"]

    proxy_response = client.get(
        f"/api/v1/models/{asset_id}/morph-proxy",
        params={"sha256": source_hash, "proxy_sha256": proxy_hash},
    )
    assert proxy_response.status_code == 200
    assert proxy_response.content == proxy_asset.read_bytes()
    assert proxy_response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert proxy_response.headers["etag"] == f'"{proxy_hash}"'

    delta_response = client.get(
        f"/api/v1/models/{asset_id}/morph-deltas/{control_id}",
        params={"delta_sha256": delta_hash},
    )
    assert delta_response.status_code == 200
    assert delta_response.content == b"CMMD delta"
    assert delta_response.headers["etag"] == f'"{delta_hash}:{control_id}"'

    nested_delta = client.get(
        f"/api/v1/models/{asset_id}/morph-deltas/{nested_control_id}",
        params={"delta_sha256": delta_hash},
    )
    assert nested_delta.status_code == 200
    assert nested_delta.content == b"CMMD nested delta"
    assert nested_delta.headers["etag"] == f'"{delta_hash}:{nested_control_id}"'

    for preset_id in preset_ids:
        preset_delta = client.get(
            f"/api/v1/models/{asset_id}/morph-presets/{preset_id}/delta",
            params={"delta_sha256": delta_hash},
        )
        assert preset_delta.status_code == 200
        assert preset_delta.content == f"CMMD {preset_id}".encode()
        assert preset_delta.headers["etag"] == f'"{delta_hash}:{preset_id}"'

    unavailable_preset = client.get(
        f"/api/v1/models/{asset_id}/morph-presets/not-allowlisted/delta",
        params={"delta_sha256": delta_hash},
    )
    assert unavailable_preset.status_code == 404

    unlisted_response = client.get(
        f"/api/v1/models/{asset_id}/morph-deltas/not-allowlisted",
        params={"delta_sha256": delta_hash},
    )
    assert unlisted_response.status_code == 404
    stale_delta = client.get(
        f"/api/v1/models/{asset_id}/morph-deltas/{control_id}",
        params={"delta_sha256": "0" * 64},
    )
    assert stale_delta.status_code == 409
    stale_proxy = client.get(
        f"/api/v1/models/{asset_id}/morph-proxy",
        params={"sha256": source_hash, "proxy_sha256": "0" * 64},
    )
    assert stale_proxy.status_code == 409


def test_startup_preview_serves_only_its_integrity_checked_asset(monkeypatch, tmp_path):
    preview_asset = tmp_path / "static-female.glb"
    preview_asset.write_bytes(b"glTF static preview")
    preview_hash = hashlib.sha256(preview_asset.read_bytes()).hexdigest()
    monkeypatch.setattr(main, "asset_startup_preview_path", lambda _asset_id: preview_asset)
    monkeypatch.setattr(main, "asset_startup_preview_sha256", lambda _asset_id: preview_hash)
    monkeypatch.setattr(main, "asset_source_is_available", lambda _asset_id: True)
    monkeypatch.setattr(main, "asset_startup_preview_is_installed", lambda _asset_id: True)
    source_hash = main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]["glb_sha256"]

    response = client.get(
        "/api/v1/models/character_cc3_morphs_v1/startup-preview",
        params={"sha256": source_hash, "preview_sha256": preview_hash},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert response.headers["etag"] == f'"{preview_hash}"'
    assert response.content == preview_asset.read_bytes()

    stale_response = client.get(
        "/api/v1/models/character_cc3_morphs_v1/startup-preview",
        params={"sha256": source_hash, "preview_sha256": "0" * 64},
    )
    assert stale_response.status_code == 409


def test_installed_female_startup_preview_is_pinned_static_and_smaller():
    asset_id = "character_cc3_morphs_v1"
    preview_path = main.asset_startup_preview_path(asset_id)

    assert preview_path is not None
    assert main.asset_startup_preview_is_installed(asset_id)
    assert preview_path.stat().st_size < main.asset_preview_path(asset_id).stat().st_size * 0.6

    content = preview_path.read_bytes()
    json_length, json_type = struct.unpack_from("<II", content, 12)
    assert json_type == 0x4E4F534A
    gltf = json.loads(content[20 : 20 + json_length].decode("utf-8").rstrip(" \0"))
    assert len(gltf["meshes"]) == 4
    assert all(
        "targets" not in primitive
        for mesh in gltf["meshes"]
        for primitive in mesh["primitives"]
    )


def test_cc5_api_import_and_save_accepts_all_manifest_controls(monkeypatch):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    manifest = main.CC3_MORPH_MANIFESTS[asset_id]
    preset_id = "female_neutral_head_preset_9"
    monkeypatch.setattr(
        main,
        "cc5_body_preset_info",
        lambda candidate: {"id": candidate} if candidate == preset_id else None,
    )

    def fake_blender_operation(*, operation, arguments, **_kwargs):
        if operation == "import_base_model":
            mesh_results = [
                {"name": name, "vertex_count": 1, "polygon_count": 1}
                for name in manifest["mesh_names"]
            ]
            result = {
                "component_id": arguments["component_id"],
                "asset_id": asset_id,
                "source_glb_sha256": manifest["glb_sha256"],
                "source_blend_sha256": manifest["blend_sha256"],
                "mesh_count": manifest["mesh_count"],
                "source_mesh_polygon_count": 6,
                "mesh_polygon_count": 6,
                "armature_name": manifest["armature_name"],
                "bone_count": manifest["bone_count"],
                "body_vertex_count": manifest["body_vertex_count"],
                "source_body_vertex_count": manifest["source_body_vertex_count"],
                "body_shape_key_count": manifest["body_shape_key_count"],
                "component_vertex_count": manifest["component_vertex_count"],
                "component_shape_key_count": (
                    manifest["component_shape_key_count"]
                    + (manifest["mesh_count"] if arguments.get("preset_id") else 0)
                ),
                "neutralized_morph_key_count": manifest["shape_key_operations"],
                "morph_control_names": [control["id"] for control in manifest["controls"]],
                "initial_morphs": arguments["morphs"],
                "meshes": mesh_results,
                "groups": mesh_results,
                "material_names": manifest["material_names"],
                "object_count": manifest["object_count"],
                "object_ids": [f"object-{index}" for index in range(manifest["object_count"])],
                "geometry_hash": "a" * 64,
                "warning": "CC5 source loaded",
                "scene_structure_validation": {"status": "pass"},
            }
            if arguments.get("preset_id") is not None:
                result["body_preset"] = {
                    "component_id": arguments["component_id"],
                    "preset_id": arguments["preset_id"],
                    "preset_mesh_name": "CC_Base_Body",
                    "preset_vertex_count": manifest["body_vertex_count"],
                    "preset_following_mesh_names": sorted(
                        set(manifest["mesh_names"]) - {"CC_Base_Body"}
                    ),
                }
            if arguments.get("eye_attachment") is not None:
                eye = arguments["eye_attachment"]
                result["eye_attachment"] = {
                    "asset_id": eye["asset_id"],
                    "component_id": eye["component_id"],
                    "generated_sha256": main.eye_asset_by_id(eye["asset_id"])["generated_sha256"],
                    "geometry_hash": "b" * 64,
                    "object_ids": ["eye-object-1"],
                    "material_names": ["EyeMaterial"],
                }
            if arguments.get("skin_asset_id") is not None:
                skin = main.skin_asset_by_id(arguments["skin_asset_id"])
                result["skin_asset"] = {
                    "asset_id": skin["id"],
                    "material_library_sha256": skin["material_library_sha256"],
                    "material_names": sorted(
                        f"{name}_CC3PlusFemaleSkin" for name in skin["materials"]
                    ),
                }
                if arguments.get("skin_paint_strokes"):
                    result["skin_paint"] = {
                        "stroke_count": len(arguments["skin_paint_strokes"]),
                        "painted_materials": sorted({
                            stroke["material"] for stroke in arguments["skin_paint_strokes"]
                        }),
                    }
        elif operation == "apply_cc3_body_preset":
            result = {
                "component_id": arguments["component_id"],
                "morphs": arguments["morphs"],
                "preset_id": arguments["preset_id"],
                "preset_mesh_name": "CC_Base_Body" if arguments["preset_id"] else None,
                "preset_following_mesh_names": (
                    sorted(set(manifest["mesh_names"]) - {"CC_Base_Body"})
                    if arguments["preset_id"]
                    else []
                ),
                "preset_vertex_count": manifest["body_vertex_count"],
                "shape_key_count": (
                    manifest["body_shape_key_count"] - 1
                    + int(arguments["preset_id"] is not None)
                ),
                "component_shape_key_count": (
                    manifest["component_shape_key_count"] - manifest["mesh_count"]
                    + manifest["mesh_count"] * int(arguments["preset_id"] is not None)
                ),
                "scene_structure_validation": {"status": "pass"},
            }
        else:
            result = {
                "component_id": arguments["component_id"],
                "morphs": arguments["morphs"],
                "shape_key_count": manifest["body_shape_key_count"] - 1,
                "component_shape_key_count": (
                    manifest["component_shape_key_count"] - manifest["mesh_count"]
                ),
                "scene_structure_validation": {"status": "pass"},
            }
        return {"result": result}

    monkeypatch.setattr(main, "run_blender_operation", fake_blender_operation)
    project = client.post(
        "/api/v1/projects",
        json={"name": "Full CC5 morph map", "base_model_asset_id": asset_id},
    ).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    appearance = client.patch(
        f"/api/v1/projects/{project['id']}/draft-appearance",
        json={
            "eye_asset_id": "eye-normal-1",
            "body_preset_id": None,
            "skin_asset_id": "skin_cc3plus_female_1",
            "skin_paint_strokes": [{
                "material": "Std_Skin_Body",
                "tool": "paint",
                "color": "#b87357",
                "radius": 0.008,
                "opacity": 0.6,
                "points": [{"u": 0.2, "v": 0.5}, {"u": 0.25, "v": 0.55}],
            }],
        },
    )
    assert appearance.status_code == 200, appearance.text
    initial_morphs = {control["id"]: 0.0 for control in manifest["controls"]}
    head_scale = next(control for control in manifest["controls"] if control["label"] == "Head Scale")
    initial_morphs[head_scale["id"]] = 0.35
    draft = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 0, "morphs": initial_morphs},
    )
    assert draft.status_code == 200, draft.text
    reference_phase = next(phase for phase in planned["phases"] if phase["phase_key"] == "reference_plan")
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{reference_phase['id']}/approve",
        json={"expected_scene_version": draft.json()["scene_version"]},
    ).json()
    imported = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "import_base_model",
            "operation_id": str(uuid4()),
            "expected_scene_version": approved["scene_version"],
            "scope_component_ids": [],
            "dependency_component_ids": [],
            "arguments": {
                "asset_id": asset_id,
                "preset_id": preset_id,
                "skin_asset_id": "skin_cc3plus_female_1",
                "skin_paint_strokes": appearance.json()["draft_skin_paint_strokes"],
            },
        },
    )
    assert imported.status_code == 200, imported.text
    component = imported.json()["project"]["components"][0]
    assert component["source_asset"]["morph_preview_mode"] == main.effective_morph_preview_mode(asset_id)
    assert component["source_asset"]["blend_sha256"] == manifest["blend_sha256"]
    assert len(component["source_asset"]["morph_control_specs"]) == 2042
    assert component["cc3_morphs"] == initial_morphs
    assert component["cc3_preset_id"] == preset_id
    assert component["source_asset"]["skin_asset_id"] == "skin_cc3plus_female_1"
    assert "Std_Skin_Head_CC3PlusFemaleSkin" in component["material_references"]
    eyes = next(
        item for item in imported.json()["project"]["components"]
        if item["semantic_type"] == "eyes"
    )
    assert eyes["source_asset"]["asset_id"] == "eye-normal-1"
    assert eyes["object_ids"] == ["eye-object-1"]

    undone = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_body_preset",
            "operation_id": str(uuid4()),
            "expected_scene_version": imported.json()["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": asset_id,
                "morphs": initial_morphs,
                "preset_id": None,
            },
        },
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["project"]["components"][0]["cc3_preset_id"] is None
    assert undone.json()["operation"]["tool_name"] == "apply_cc3_body_preset"

    morphs = {control["id"]: 0.0 for control in manifest["controls"]}
    morphs[head_scale["id"]] = 0.5
    changed = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": undone.json()["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": asset_id,
                "morphs": morphs,
            },
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["project"]["components"][0]["cc3_morphs"] == morphs


def test_cc5_morph_preview_exports_from_isolated_scene_without_saving(tmp_path, monkeypatch):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    manifest = main.CC3_MORPH_MANIFESTS[asset_id]
    project = main.Project(
        name="Preview-only morphs",
        target_profile="general_purpose",
        base_model_asset_id=asset_id,
        scene_version=4,
        components=[{
            "id": "cc5-character",
            "source_asset": {"asset_id": asset_id, "morph_preview_mode": "server"},
            "cc3_morphs": {control["id"]: 0.0 for control in manifest["controls"]},
            "morphs_baked": False,
        }],
    )
    main.REPOSITORY.create(project)
    scene_path = (
        tmp_path
        / "blender-projects"
        / str(project.id)
        / "output"
        / "scene.blend"
    )
    scene_path.parent.mkdir(parents=True)
    scene_path.write_bytes(b"unchanged scene")
    seen: dict[str, object] = {}

    def fake_blender_operation(**kwargs):
        seen.update(kwargs)
        output = kwargs["data_directory"] / "blender-projects" / str(project.id) / "output"
        assert (output / "scene.blend").read_bytes() == b"unchanged scene"
        (output / "preview.glb").write_bytes(b"glTF preview")
        seen["temporary_root"] = kwargs["data_directory"]
        return {
            "preview_export_status": "pass",
            "preview_file": "output/preview.glb",
        }

    monkeypatch.setattr(main, "run_blender_operation", fake_blender_operation)
    morphs = {control["id"]: 0.0 for control in manifest["controls"]}
    head_scale = next(control for control in manifest["controls"] if control["label"] == "Head Scale")
    morphs[head_scale["id"]] = 0.5

    invalid = client.post(
        f"/api/v1/projects/{project.id}/morph-preview",
        json={"morphs": {head_scale["id"]: 0.5}},
    )
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "INVALID_MORPH_MAP"
    assert "operation" not in seen

    response = client.post(
        f"/api/v1/projects/{project.id}/morph-preview",
        json={"morphs": morphs},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"glTF preview"
    assert seen["operation"] == "preview_cc3_morph_controls"
    assert seen["expected_scene_version"] == 4
    assert seen["arguments"]["morphs"] == morphs
    assert scene_path.read_bytes() == b"unchanged scene"
    persisted = main.REPOSITORY.get(project.id)
    assert persisted is not None
    assert persisted.scene_version == 4
    assert persisted.components[0]["cc3_morphs"] == project.components[0]["cc3_morphs"]
    assert not (seen["temporary_root"]).exists()


def test_morph_preview_rejects_unavailable_assets(monkeypatch):
    monkeypatch.setattr(main, "asset_source_is_available", lambda _asset_id: False)
    digest = main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]["glb_sha256"]

    response = client.get(
        "/api/v1/models/character_cc3_morphs_v1/morph-preview",
        params={"sha256": digest},
    )

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "BASE_MODEL_ASSET_UNAVAILABLE"


def test_morph_preview_rejects_stale_asset_hash(monkeypatch):
    monkeypatch.setattr(main, "asset_is_installed", lambda _asset_id: True)

    response = client.get(
        "/api/v1/models/character_cc3_morphs_v1/morph-preview",
        params={"sha256": "0" * 64},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BASE_MODEL_ASSET_UNAVAILABLE"


def test_morph_preview_rejects_stale_preview_hash(monkeypatch):
    monkeypatch.setattr(main, "asset_is_installed", lambda _asset_id: True)
    digest = main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]["glb_sha256"]

    response = client.get(
        "/api/v1/models/character_cc3_morphs_v1/morph-preview",
        params={"sha256": digest, "preview_sha256": "0" * 64},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BASE_MODEL_ASSET_UNAVAILABLE"


def test_cc5_asset_installation_requires_both_pinned_files(monkeypatch, tmp_path):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    preview_path = tmp_path / main.ASSET_CONFIG[asset_id]["filename"]
    blend_path = tmp_path / main.ASSET_CONFIG[asset_id]["source_filename"]
    preview_path.write_bytes(b"glTF static preview")
    blend_path.write_bytes(b"pinned blend source")
    manifest = dict(main.CC3_MORPH_MANIFESTS[asset_id])
    manifest["glb_sha256"] = hashlib.sha256(preview_path.read_bytes()).hexdigest()
    manifest["blend_sha256"] = hashlib.sha256(blend_path.read_bytes()).hexdigest()
    monkeypatch.setattr(main, "ASSET_ROOT", tmp_path)
    monkeypatch.setitem(main.CC3_MORPH_MANIFESTS, asset_id, manifest)

    assert main.asset_is_installed(asset_id)
    blend_path.unlink()
    assert not main.asset_is_installed(asset_id)


def test_project_persists_selected_base_model_across_plan_creation(monkeypatch):
    models = [
        main.AvailableBaseModel(
            asset_id=asset_id,
            name=main.ASSET_CONFIG[asset_id]["name"],
            detail=f"Rigged character base · {len(manifest['controls'])} editable morph controls",
            category="character",
            morph_control_count=len(manifest["controls"]),
            glb_sha256=manifest["glb_sha256"],
            preview_sha256=main.asset_preview_sha256(asset_id),
            morph_control_specs=manifest["controls"],
        )
        for asset_id, manifest in main.CC3_MORPH_MANIFESTS.items()
    ]
    if not any(model.asset_id == "character_cc3_male_morphs_v1" for model in models):
        models.append(main.AvailableBaseModel(
            asset_id="character_cc3_male_morphs_v1",
            name=main.ASSET_CONFIG["character_cc3_male_morphs_v1"]["name"],
            detail="Rigged character base · 143 editable morph controls",
            category="character",
            morph_control_count=143,
            glb_sha256=main.CC3_MORPH_MANIFESTS["character_cc3_male_morphs_v1"]["glb_sha256"],
            preview_sha256=main.asset_preview_sha256("character_cc3_male_morphs_v1"),
            morph_control_specs=main.CC3_MORPH_MANIFESTS["character_cc3_male_morphs_v1"]["controls"],
        ))
    monkeypatch.setattr(main, "available_base_models", lambda: models)
    created = client.post(
        "/api/v1/projects",
        json={
            "name": "Male character",
            "base_model_asset_id": "character_cc3_male_morphs_v1",
        },
    )

    assert created.status_code == 201
    project_id = created.json()["id"]
    planned = client.post(f"/api/v1/projects/{project_id}/plan")
    reopened = client.get(f"/api/v1/projects/{project_id}")

    assert planned.status_code == 200
    assert planned.json()["base_model_asset_id"] == "character_cc3_male_morphs_v1"
    assert planned.json()["phases"][1]["title"] == "CC3 Base Male"
    assert reopened.json()["base_model_asset_id"] == "character_cc3_male_morphs_v1"


def test_project_draft_morphs_save_without_blender_and_before_approval(monkeypatch):
    monkeypatch.delenv("COMODEL_BLENDER_EXECUTABLE", raising=False)
    project_response = client.post(
        "/api/v1/projects",
        json={"name": "Preview-first draft", "base_model_asset_id": "character_cc3_morphs_v1"},
    )

    assert project_response.status_code == 201
    project = project_response.json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    manifest = main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]
    morphs = {control["id"]: 0.0 for control in manifest["controls"]}
    morphs["ear_length"] = 0.45
    saved = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 0, "morphs": morphs},
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["scene_version"] == 0
    assert saved.json()["draft_revision"] == 1
    assert saved.json()["draft_morphs"] == morphs
    assert next(item for item in planned["phases"] if item["phase_key"] == "reference_plan")["status"] == "awaiting_review"
    reopened = client.get(f"/api/v1/projects/{project['id']}").json()
    assert reopened["draft_morphs"] == morphs
    assert reopened["components"] == []

    stale = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 0, "morphs": morphs},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "STALE_DRAFT_REVISION"
    incomplete = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 1, "morphs": {"ear_length": 0.25}},
    )
    assert incomplete.status_code == 422
    monkeypatch.setattr(
        main,
        "run_blender_operation",
        lambda **_kwargs: pytest.fail("Plan approval must not start Blender assembly."),
    )
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{reopened['phases'][0]['id']}/approve",
        json={"expected_scene_version": reopened["scene_version"]},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["components"] == []
    assert approved.json()["draft_morphs"] == morphs


def test_health_reports_invalid_blender_executable_without_blocking_drafts(monkeypatch):
    monkeypatch.setenv("COMODEL_BLENDER_EXECUTABLE", "/missing/comodel-blender")
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["blender_available"] is False
    assert response.json()["blender_error"]
    project = client.post("/api/v1/projects", json={"name": "Draft without worker"})
    assert project.status_code == 201


@pytest.mark.parametrize("symlink_target", ["project", "output"])
def test_blender_adapter_rejects_symlinked_workspace_paths(tmp_path, monkeypatch, symlink_target):
    project_id = uuid4()
    projects_directory = tmp_path / "blender-projects"
    workspace = projects_directory / str(project_id)
    outside_directory = tmp_path / "outside"
    outside_directory.mkdir()
    if symlink_target == "project":
        projects_directory.mkdir()
        workspace.symlink_to(outside_directory, target_is_directory=True)
    else:
        workspace.mkdir(parents=True)
        (workspace / "output").symlink_to(outside_directory, target_is_directory=True)
    monkeypatch.setattr(blender_adapter, "configured_blender_executable", lambda: outside_directory / "blender")

    with pytest.raises(blender_adapter.BlenderAdapterError, match="symbolic links"):
        blender_adapter.run_blender_operation(
            data_directory=tmp_path,
            project_id=project_id,
            operation_id=uuid4(),
            expected_scene_version=0,
            operation="validate_scene_structure",
            arguments={},
            scope_component_ids=[],
            dependency_component_ids=[],
        )


def test_blender_adapter_accepts_preview_result_without_scene_output(tmp_path):
    workspace = tmp_path / "workspace"
    output = workspace / "output"
    output.mkdir(parents=True)
    (output / "preview.glb").write_bytes(b"glTF preview")
    job_id = str(uuid4())
    project_id = str(uuid4())
    operation_id = str(uuid4())
    result = {
        "job_id": job_id,
        "project_id": project_id,
        "operation_id": operation_id,
        "operation": "preview_cc3_morph_controls",
        "status": "completed",
        "mode": "blender",
        "expected_scene_version": 4,
        "scene_version": 4,
        "scene_file": None,
        "preview_file": "output/preview.glb",
        "preview_export_status": "pass",
    }
    (output / "result.json").write_text(json.dumps(result), encoding="utf-8")

    parsed = blender_adapter._read_worker_result(
        workspace=workspace,
        job_id=job_id,
        project_id=project_id,
        operation_id=operation_id,
        operation="preview_cc3_morph_controls",
        expected_scene_version=4,
    )

    assert parsed == result


def test_create_project_and_plan():
    if not shutil.which("blender"):
        pytest.skip("Blender executable is not installed")
    response = client.post("/api/v1/projects", json={"name": "Test Character"})
    assert response.status_code == 201
    project = response.json()
    plan = client.post(f"/api/v1/projects/{project['id']}/plan")
    assert plan.status_code == 200
    assert [p["phase_key"] for p in plan.json()["phases"]] == ["reference_plan", "body_blockout"]


def test_project_summary_lists_only_menu_fields_and_character_state():
    created = client.post("/api/v1/projects", json={"name": "Summary test"})
    assert created.status_code == 201
    project = main.REPOSITORY.get(UUID(created.json()["id"]))
    assert project is not None
    project.components = [{"source_asset": {"asset_id": project.base_model_asset_id}}]
    project.operations = [{"large_result": "x" * 10000}]
    main.REPOSITORY.save(project)

    response = client.get("/api/v1/projects/summary")

    assert response.status_code == 200
    assert response.json() == [{
        "id": created.json()["id"],
        "name": "Summary test",
        "base_model_asset_id": "character_cc3_morphs_v1",
        "has_character": True,
    }]


def test_project_routes_require_token_or_loopback(monkeypatch):
    monkeypatch.delenv("COMODEL_API_TOKEN", raising=False)
    remote_client = TestClient(app, base_url="http://example.com")
    response = remote_client.get("/api/v1/projects")
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "ACCESS_DENIED"

    monkeypatch.setenv("COMODEL_API_TOKEN", "test-secret")
    authed_client = TestClient(app, base_url="http://example.com")
    response = authed_client.get("/api/v1/projects", headers={"Authorization": "Bearer test-secret"})
    assert response.status_code == 200


def test_unknown_project_is_404():
    response = client.get("/api/v1/projects/00000000-0000-0000-0000-000000000001")
    assert response.status_code == 404


def test_character_preview_is_gzip_compressed_when_supported(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Compressed preview"}).json()
    project_record = main.REPOSITORY.get(UUID(project["id"]))
    project_record.mode = "blender"
    project_record.components = [{"source_asset": {"asset_id": "character_cc3_morphs_v1"}}]
    main.REPOSITORY.save(project_record)

    output_directory = tmp_path / "blender-projects" / project["id"] / "output"
    output_directory.mkdir(parents=True)
    (output_directory / "preview.glb").write_bytes(b"glTF" + b"preview-data" * 1000)
    (output_directory / "result.json").write_text(
        json.dumps({"result": {"preview_compression": "meshopt-static"}}),
        encoding="utf-8",
    )

    response = client.get(
        f"/api/v1/projects/{project['id']}/preview",
        headers={"Accept-Encoding": "gzip"},
    )

    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.content.startswith(b"glTF")


def test_legacy_character_preview_is_migrated_without_changing_scene_version(monkeypatch, tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Legacy preview"}).json()
    project_record = main.REPOSITORY.get(UUID(project["id"]))
    project_record.mode = "blender"
    project_record.scene_version = 3
    project_record.components = [{"source_asset": {"asset_id": "character_cc3_morphs_v1"}}]
    main.REPOSITORY.save(project_record)

    output_directory = tmp_path / "blender-projects" / project["id"] / "output"
    output_directory.mkdir(parents=True)
    preview_path = output_directory / "preview.glb"
    preview_path.write_bytes(b"glTF" + b"legacy-morph-preview")
    (output_directory / "result.json").write_text(
        json.dumps({"result": {"preview_compression": "meshopt-morphs"}}),
        encoding="utf-8",
    )
    calls = []

    def regenerate_preview(**kwargs):
        calls.append(kwargs)
        preview_path.write_bytes(b"glTF" + b"lightweight-preview")
        (output_directory / "result.json").write_text(
            json.dumps({"result": {"preview_compression": "meshopt-static"}}),
            encoding="utf-8",
        )
        return {"scene_version": 3}

    monkeypatch.setattr(main, "run_blender_operation", regenerate_preview)

    response = client.get(f"/api/v1/projects/{project['id']}/preview")

    assert response.status_code == 200
    assert response.content == b"glTF" + b"lightweight-preview"
    assert len(calls) == 1
    assert calls[0]["operation"] == "validate_scene_structure"
    assert calls[0]["expected_scene_version"] == 3
    assert main.REPOSITORY.get(UUID(project["id"])).scene_version == 3


def test_preview_migration_records_unsupported_morph_export_once(monkeypatch, tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Unsupported preview export"}).json()
    project_record = main.REPOSITORY.get(UUID(project["id"]))
    project_record.mode = "blender"
    project_record.components = [{"source_asset": {"asset_id": "character_cc3_morphs_v1"}}]
    main.REPOSITORY.save(project_record)

    output_directory = tmp_path / "blender-projects" / project["id"] / "output"
    output_directory.mkdir(parents=True)
    preview_path = output_directory / "preview.glb"
    preview_path.write_bytes(b"glTF" + b"legacy-preview")
    (output_directory / "result.json").write_text(
        json.dumps({"result": {"preview_compression": "meshopt-morphs"}}),
        encoding="utf-8",
    )
    calls = []

    def regenerate_preview(**kwargs):
        calls.append(kwargs)
        preview_path.write_bytes(b"glTF" + b"morph-preview")
        (output_directory / "result.json").write_text(
            json.dumps({"result": {"preview_compression": "meshopt-morphs"}}),
            encoding="utf-8",
        )
        return {"scene_version": 0}

    monkeypatch.setattr(main, "run_blender_operation", regenerate_preview)

    first_response = client.get(f"/api/v1/projects/{project['id']}/preview")
    second_response = client.get(f"/api/v1/projects/{project['id']}/preview")

    assert first_response.status_code == second_response.status_code == 200
    assert first_response.content == second_response.content == b"glTF" + b"morph-preview"
    assert len(calls) == 1
    assert json.loads((output_directory / "preview-migration.json").read_text()) == {
        "morph_export_unsupported": True,
    }


def test_mock_body_and_garment_routes_are_removed():
    response = client.post("/api/v1/projects", json={"name": "Approval test"})
    project = response.json()
    assert project.get("id")
    for path in ("/demo-body", "/garment"):
        response = client.post(f"/api/v1/projects/{project['id']}{path}", json={})
        assert response.status_code == 404
    response = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "create_body_blockout",
            "operation_id": str(uuid4()),
            "expected_scene_version": 0,
            "scope_component_ids": [],
            "dependency_component_ids": [],
            "arguments": {},
        },
    )
    assert response.status_code == 422




def test_project_state_survives_repository_reopen(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Persistent character"}).json()
    project_id = project["id"]
    client.post(f"/api/v1/projects/{project_id}/plan")
    saved = main.REPOSITORY.get(project_id)
    assert saved is not None
    reference_phase = next(phase for phase in saved.phases if phase.phase_key == "reference_plan")
    client.post(
        f"/api/v1/projects/{project_id}/phases/{reference_phase.id}/approve",
        json={"expected_scene_version": 0},
    )

    reopened = SQLiteProjectRepository(tmp_path / "test.sqlite")
    restored = reopened.get(project_id)

    assert restored is not None
    assert restored.name == "Persistent character"
    assert restored.scene_version == 0
    assert any(phase.status == "approved" for phase in restored.phases)
    assert restored.components == []
    assert len(restored.checkpoints) == 1


def test_reference_upload_validates_content_and_persists_metadata(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Reference project"}).json()
    image = BytesIO()
    from PIL import Image

    Image.new("RGB", (4, 3), color=(120, 80, 40)).save(image, format="PNG")

    uploaded = client.post(
        f"/api/v1/projects/{project['id']}/references",
        data={"user_notes": "Front view"},
        files={"file": ("front.jpg", image.getvalue(), "text/plain")},
    )
    assert uploaded.status_code == 201
    reference = uploaded.json()["reference"]
    assert reference["mime_type"] == "image/png"
    assert (reference["width"], reference["height"]) == (4, 3)
    assert reference["display_name"] == "front.jpg"
    assert len(reference["sha256"]) == 64
    assert (tmp_path / "assets" / reference["storage_key"]).is_file()

    reopened = SQLiteProjectRepository(tmp_path / "test.sqlite").get(project["id"])
    assert reopened is not None
    assert reopened.references == [reference]


def test_reference_upload_rejects_non_image_and_oversized_content(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Upload validation"}).json()
    invalid = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("not-image.png", b"not an image", "image/png")},
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"]["code"] == "INVALID_UPLOAD"

    monkeypatch.setenv("MAX_UPLOAD_BYTES", "10")
    image = BytesIO()
    from PIL import Image

    Image.new("RGB", (4, 3)).save(image, format="PNG")
    oversized = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("large.png", image.getvalue(), "image/png")},
    )
    assert oversized.status_code == 413

    multipart_too_large = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("oversized.png", b"x" * (128 * 1024 + 50), "image/png")},
    )
    assert multipart_too_large.status_code == 413


def test_reference_upload_enforces_pixel_limit(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Image dimension validation"}).json()
    monkeypatch.setenv("MAX_IMAGE_PIXELS", "8")
    image = BytesIO()
    from PIL import Image

    Image.new("RGB", (4, 3)).save(image, format="PNG")
    response = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("large-dimensions.png", image.getvalue(), "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INVALID_UPLOAD"


def test_chat_messages_and_deterministic_plan_persist(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Chat plan"}).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Please make a component plan from these references."},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "plan_request"
    assert payload["job_id"] is None
    assert payload["ai_provider"] == "template"
    assert payload["model"] is None
    assert "CC3 Base Female" in payload["assistant_message"]
    assert len(payload["project"]["component_plan"]) == 1
    assert payload["project"]["component_plan"][0]["display_name"] == "CC3 Base Female"
    assert payload["project"]["planning_metadata"]["provider"] == "template"
    assert payload["project"]["planning_metadata"]["reference_images_analyzed"] is False

    messages = client.get(f"/api/v1/projects/{project['id']}/chat").json()
    assert [message["role"] for message in messages] == ["user", "assistant"]

    reopened = SQLiteProjectRepository(tmp_path / "test.sqlite").get(project["id"])
    assert reopened is not None
    assert reopened.messages == messages
    assert reopened.component_plan == payload["project"]["component_plan"]
    assert reopened.planning_metadata == payload["project"]["planning_metadata"]


def test_clear_chat_removes_persisted_messages_and_keeps_project(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Clear chat"}).json()
    chat_response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Please make a character plan."},
    )
    assert chat_response.status_code == 200
    assert len(client.get(f"/api/v1/projects/{project['id']}/chat").json()) == 2

    response = client.delete(f"/api/v1/projects/{project['id']}/chat")

    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/api/v1/projects/{project['id']}/chat").json() == []
    assert client.get(f"/api/v1/projects/{project['id']}").status_code == 200
    reopened = SQLiteProjectRepository(tmp_path / "test.sqlite").get(project["id"])
    assert reopened is not None
    assert reopened.messages == []


def test_clear_chat_returns_not_found_for_unknown_project():
    response = client.delete("/api/v1/projects/00000000-0000-0000-0000-000000000001/chat")
    assert response.status_code == 404


def test_copilot_generates_validated_structured_plan_without_sending_reference_pixels(tmp_path, monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Structured plan"}).json()
    image = BytesIO()
    from PIL import Image

    Image.new("RGB", (2, 2)).save(image, format="PNG")
    uploaded = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("reference.png", image.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 201
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="b" * 64,
        model_id="model",
        model_name="Copilot Plan Model",
    )
    received = {}
    model_plan = {
        "summary": "A simple layered character plan.",
        "components": [
            {
                "display_name": "Base Body",
                "semantic_type": "body",
                "phase_key": "body_blockout",
                "optional": False,
                "dependencies": [],
                "assumptions": ["Use a neutral pose until proportions are approved."],
            },
            {
                "display_name": "Travel Coat",
                "semantic_type": "garment",
                "phase_key": "garment_jacket",
                "optional": False,
                "dependencies": ["body_refinement"],
                "assumptions": ["Keep the coat as a separate component."],
            },
        ],
    }

    async def fake_generate_copilot_reply(*, system_prompt, project_context, messages):
        received.update(
            system_prompt=system_prompt,
            project_context=project_context,
            messages=messages,
        )
        return json.dumps(model_plan)

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", fake_generate_copilot_reply)
    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Plan a simple travel character with a coat."},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ai_provider"] == "vscode_copilot"
    assert payload["model"] == "Copilot Plan Model"
    assert [item["display_name"] for item in payload["project"]["component_plan"]] == ["Base Body", "Travel Coat"]
    assert payload["project"]["planning_metadata"] == {
        "provider": "vscode_copilot",
        "model": "Copilot Plan Model",
        "summary": "A simple layered character plan.",
        "reference_images_analyzed": False,
        "warnings": ["Reference images were not analyzed; only their metadata was provided to the planner."],
    }
    project_context = json.loads(received["project_context"])
    assert project_context["references"][0]["display_name"] == "reference.png"
    assert "storage_key" not in received["project_context"]
    assert "reference_content_included" not in received["project_context"]
    reopened = SQLiteProjectRepository(tmp_path / "test.sqlite").get(project["id"])
    assert reopened is not None
    assert reopened.planning_metadata == payload["project"]["planning_metadata"]


def test_invalid_copilot_plan_is_rejected_without_persisting_partial_state(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Invalid structured plan"}).json()
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="c" * 64,
        model_id="model",
        model_name="Copilot Plan Model",
    )

    async def invalid_plan(*, system_prompt, project_context, messages):
        return '{"summary":"Invalid plan","components":[{"display_name":"Python tool","semantic_type":"shell","phase_key":"body_blockout","extra":"rejected"}]}'

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", invalid_plan)
    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Plan this character."},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "INVALID_AI_PLAN"
    persisted = client.get(f"/api/v1/projects/{project['id']}").json()
    assert persisted["component_plan"] == []
    assert persisted["planning_metadata"] == {}
    assert persisted["messages"] == []


def test_plan_can_be_edited_and_saved_before_approval():
    project = client.post("/api/v1/projects", json={"name": "Editable plan"}).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    original_plan = planned["component_plan"]
    body = next(item for item in original_plan if item["semantic_type"] == "body")
    updated_components = [{
        "id": body["id"],
        "display_name": "CC3 Character",
        "semantic_type": body["semantic_type"],
        "phase_key": body["phase_key"],
        "optional": body["optional"],
        "dependencies": body["dependencies"],
        "assumptions": body["assumptions"],
    }]

    response = client.patch(
        f"/api/v1/projects/{project['id']}/plan",
        json={
            "expected_scene_version": planned["scene_version"],
            "expected_plan_revision": planned["planning_metadata"].get("revision", 0),
            "components": updated_components,
        },
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert next(item for item in result["component_plan"] if item["semantic_type"] == "body")["id"] == body["id"]
    assert next(item for item in result["component_plan"] if item["semantic_type"] == "body")["display_name"] == "CC3 Character"
    assert [item["display_name"] for item in result["component_plan"]] == ["CC3 Character"]
    assert result["planning_metadata"]["revision"] == 1
    assert result["planning_metadata"]["user_edited"] is True
    assert next(item for item in result["phases"] if item["phase_key"] == "reference_plan")["status"] == "awaiting_review"
    stale_plan = client.patch(
        f"/api/v1/projects/{project['id']}/plan",
        json={
            "expected_scene_version": result["scene_version"],
            "expected_plan_revision": 0,
            "components": updated_components,
        },
    )
    assert stale_plan.status_code == 409
    assert stale_plan.json()["detail"]["code"] == "STALE_PLAN_REVISION"
    reopened = SQLiteProjectRepository(
        main.REPOSITORY.path,
    ).get(project["id"])
    assert reopened is not None
    assert reopened.component_plan == result["component_plan"]


def test_plan_edit_rejects_stale_version_invalid_body_and_edits_after_approval():
    project = client.post("/api/v1/projects", json={"name": "Plan edit gates"}).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    components = [
        {
            "id": item["id"],
            "display_name": item["display_name"],
            "semantic_type": item["semantic_type"],
            "phase_key": item["phase_key"],
            "optional": item["optional"],
            "dependencies": item["dependencies"],
            "assumptions": item["assumptions"],
        }
        for item in planned["component_plan"]
    ]
    stale = client.patch(
        f"/api/v1/projects/{project['id']}/plan",
        json={        "expected_scene_version": planned["scene_version"] + 1,
        "expected_plan_revision": 0, "components": components},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "STALE_SCENE_VERSION"

    no_body = client.patch(
        f"/api/v1/projects/{project['id']}/plan",
        json={
            "expected_scene_version": planned["scene_version"],
            "expected_plan_revision": 0,
            "components": [item for item in components if item["semantic_type"] != "body"],
        },
    )
    assert no_body.status_code == 422

    plan_phase = next(item for item in planned["phases"] if item["phase_key"] == "reference_plan")
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{plan_phase['id']}/approve",
        json={"expected_scene_version": planned["scene_version"]},
    )
    assert approved.status_code == 200
    closed = client.patch(
        f"/api/v1/projects/{project['id']}/plan",
        json={
            "expected_scene_version": approved.json()["scene_version"],
            "expected_plan_revision": 0,
            "components": components,
        },
    )
    assert closed.status_code == 409
    assert closed.json()["detail"]["code"] == "PLAN_NOT_EDITABLE"


def test_reference_delete_removes_file_and_metadata(tmp_path):
    project = client.post("/api/v1/projects", json={"name": "Delete reference"}).json()
    image = BytesIO()
    from PIL import Image

    Image.new("RGB", (2, 2)).save(image, format="PNG")
    uploaded = client.post(
        f"/api/v1/projects/{project['id']}/references",
        files={"file": ("image.png", image.getvalue(), "image/png")},
    )
    reference = uploaded.json()["reference"]

    deleted = client.delete(f"/api/v1/projects/{project['id']}/references/{reference['id']}")

    assert deleted.status_code == 204
    assert not (tmp_path / "assets" / reference["storage_key"]).exists()
    assert client.get(f"/api/v1/projects/{project['id']}/references").json() == []




def test_base_model_import_tool_is_strict_and_requires_approval(monkeypatch):
    monkeypatch.setattr(main, "configured_project_mode", lambda: "blender")
    project = client.post("/api/v1/projects", json={"name": "Source model import"}).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    import_tool = {
        "tool_name": "import_base_model",
        "operation_id": str(uuid4()),
        "expected_scene_version": planned["scene_version"],
        "scope_component_ids": [],
        "dependency_component_ids": [],
        "arguments": {"asset_id": "character_cc3_morphs_v1"},
    }

    blocked = client.post(f"/api/v1/projects/{project['id']}/modeling-tools", json=import_tool)
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "APPROVAL_REQUIRED"

    reference_phase = next(phase for phase in planned["phases"] if phase["phase_key"] == "reference_plan")
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{reference_phase['id']}/approve",
        json={"expected_scene_version": planned["scene_version"]},
    )
    assert approved.status_code == 200

    arbitrary_asset = {
        **import_tool,
        "operation_id": str(uuid4()),
        "arguments": {"asset_id": "../../outside.obj"},
    }
    rejected_asset = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json=arbitrary_asset,
    )
    assert rejected_asset.status_code == 422

    arbitrary_path = {
        **import_tool,
        "operation_id": str(uuid4()),
        "arguments": {"asset_id": "base_model_v1", "path": "/etc/passwd"},
    }
    rejected_path = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json=arbitrary_path,
    )
    assert rejected_path.status_code == 422


def test_project_creation_does_not_require_blender(monkeypatch):
    monkeypatch.delenv("COMODEL_BLENDER_EXECUTABLE", raising=False)
    project = client.post("/api/v1/projects", json={"name": "Preview-first project"})
    assert project.status_code == 201
    assert project.json()["components"] == []
    assert project.json()["mode"] == "blender"










def test_modeling_tool_registry_rejects_unknown_tools_and_arbitrary_code_fields():
    project = client.post("/api/v1/projects", json={"name": "Tool allowlist"}).json()

    unapproved_body = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "create_body_blockout",
            "operation_id": "64eddbab-b21b-4c72-8641-f8f594a6ba75",
            "expected_scene_version": 0,
            "arguments": {},
        },
    )
    assert unapproved_body.status_code == 422

    unknown_tool = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "execute_python",
            "operation_id": "a0d4c843-f4ee-45d0-babc-5397a36f6dfd",
            "expected_scene_version": 0,
            "arguments": {"code": "import os"},
        },
    )
    assert unknown_tool.status_code == 422

    extra_field = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "create_body_blockout",
            "operation_id": "a0d4c843-f4ee-45d0-babc-5397a36f6dfd",
            "expected_scene_version": 0,
            "arguments": {"code": "import os"},
        },
    )
    assert extra_field.status_code == 422
    assert client.get(f"/api/v1/projects/{project['id']}/operations").json() == []
    assert client.get(f"/api/v1/projects/{project['id']}").json()["scene_version"] == 0




def test_copilot_chat_uses_vscode_model_and_persists_provider(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Copilot chat"}).json()
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="a" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )
    received = {}

    async def fake_generate_copilot_reply(*, system_prompt, project_context, messages):
        received["system_prompt"] = system_prompt
        received["project_context"] = project_context
        received["messages"] = messages
        return "Copilot response from the VS Code language model."

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", fake_generate_copilot_reply)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "What is in this character project?"},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["ai_provider"] == "vscode_copilot"
    assert result["model"] == "Copilot Test Model"
    assert result["assistant_message"] == "Copilot response from the VS Code language model."
    assert result["assistant_proposal"] is None
    assert result["guidance"] is None
    assert result["interaction_warning"]
    assert received["messages"][-1] == {"role": "user", "content": "What is in this character project?"}
    assert "Blender is never started by chat" in received["system_prompt"]
    assert len(client.get(f"/api/v1/projects/{project['id']}/chat").json()) == 2


def test_copilot_chat_guides_slider_location_question_even_for_text_only_reply(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Slider guidance"}).json()
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="h" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )

    async def plain_text_reply(*, system_prompt, project_context, messages):
        return "The morph sliders are in the character editor."

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", plain_text_reply)
    monkeypatch.setattr(
        main,
        "run_blender_operation",
        lambda **_kwargs: pytest.fail("Slider location guidance must not invoke Blender"),
    )

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Where are the sliders?"},
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["assistant_message"] == "The morph sliders are in the character editor."
    assert result["assistant_proposal"] is None
    assert result["guidance"]["target_id"] == "morph-library"
    assert result["guidance"]["title"] == "Find the morph sliders"
    assert "selected a control" in result["guidance"]["message"]
    assert result["interaction_warning"] is None
    assert result["project"]["draft_morphs"] == project["draft_morphs"]
    assert result["project"]["scene_version"] == 0


def test_copilot_chat_returns_validated_draft_proposal_and_guidance(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Assistant draft proposal"}).json()
    control = main.CC3_MORPH_MANIFESTS[project["base_model_asset_id"]]["controls"][0]
    proposed_value = (control["minimum"] + control["maximum"]) / 2
    target_id = f"morph:{control['id']}"
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="d" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )

    async def structured_reply(*, system_prompt, project_context, messages):
        context = json.loads(project_context)
        assert context["assistant_controls"]["draft_only"] is True
        assert len(project_context) <= 32000
        assert target_id in context["assistant_controls"]["guidance_targets"]
        assert target_id.removeprefix("morph:") in {
            control["id"] for control in context["assistant_controls"]["morph_controls"]
        }
        assert "No dedicated age, aging, or wrinkle morph is installed." in (
            context["assistant_controls"]["known_capability_limits"]
        )
        assert "No aging skin effect is installed." in context["assistant_controls"]["known_capability_limits"]
        return json.dumps({
            "message": "I can adjust that control in your draft.",
            "morph_updates": {control["id"]: proposed_value},
            "appearance_updates": {},
            "guidance": {
                "target_id": target_id,
                "title": "Adjust this morph",
                "message": "Use this slider to tune the selected shape.",
            },
        })

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Chat proposals must not invoke Blender")

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", structured_reply)
    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": f"Show me how the {control['label']} control works."},
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["assistant_proposal"] == {
        "morph_updates": {control["id"]: proposed_value},
        "appearance_updates": {},
    }
    assert result["guidance"] == {
        "target_id": target_id,
        "title": "Adjust this morph",
        "message": "Use this slider to tune the selected shape.",
    }
    assert result["interaction_warning"] is None
    assert result["project"]["draft_morphs"].get(control["id"], 0) == 0
    assert result["project"]["scene_version"] == 0


def test_copilot_chat_returns_compatible_appearance_proposal_without_applying_it(monkeypatch):
    asset_id = "character_cc5_rlcc3plus_all_morphs_v1"
    project = client.post(
        "/api/v1/projects",
        json={"name": "Assistant appearance proposal", "base_model_asset_id": asset_id},
    ).json()
    eye = main.available_eye_assets()[0]
    skin = next(
        asset for asset in main.available_skin_assets()
        if asset_id in asset.compatible_asset_ids
    )
    preset = main.available_cc5_body_presets()[0]
    appearance_updates = {
        "eye_asset_id": eye.id,
        "skin_asset_id": skin.id,
        "body_preset_id": preset["id"],
    }
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="g" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )

    async def structured_reply(*, system_prompt, project_context, messages):
        return json.dumps({
            "message": "I can update those appearance choices in your draft.",
            "morph_updates": {},
            "appearance_updates": appearance_updates,
            "guidance": {
                "target_id": f"skin:{skin.id}",
                "title": "Skin choice",
                "message": "Review the selected skin in this card.",
            },
        })

    def unexpected_blender_call(**_kwargs):
        pytest.fail("Appearance proposals must not invoke Blender")

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", structured_reply)
    monkeypatch.setattr(main, "run_blender_operation", unexpected_blender_call)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Select these eyes, skin, and body preset."},
    )

    assert response.status_code == 200, response.text
    result = response.json()
    assert result["assistant_proposal"] == {
        "morph_updates": {},
        "appearance_updates": appearance_updates,
    }
    assert result["guidance"]["target_id"] == f"skin:{skin.id}"
    assert result["project"]["draft_appearance"] == {
        "eye_asset_id": None,
        "body_preset_id": None,
        "skin_asset_id": None,
    }
    assert result["project"]["scene_version"] == 0


@pytest.mark.parametrize(
    "response_factory",
    [
        lambda control: {
            "message": "Unsupported range.",
            "morph_updates": {control["id"]: control["maximum"] + 1},
            "appearance_updates": {},
            "guidance": None,
        },
        lambda _control: {
            "message": "Unsupported control.",
            "morph_updates": {"not-a-manifest-control": 0.5},
            "appearance_updates": {},
            "guidance": None,
        },
        lambda _control: {
            "message": "Unavailable appearance.",
            "morph_updates": {},
            "appearance_updates": {"eye_asset_id": "not-an-installed-eye"},
            "guidance": None,
        },
        lambda _control: {
            "message": "Unsupported UI target.",
            "morph_updates": {},
            "appearance_updates": {},
            "guidance": {"target_id": "arbitrary-selector", "title": "No", "message": "No"},
        },
    ],
)
def test_copilot_chat_rejects_unsupported_draft_actions_without_saving(response_factory, monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Invalid assistant proposal"}).json()
    control = main.CC3_MORPH_MANIFESTS[project["base_model_asset_id"]]["controls"][0]
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="e" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )

    async def invalid_reply(*, system_prompt, project_context, messages):
        return json.dumps(response_factory(control))

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", invalid_reply)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Adjust the draft."},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "INVALID_AI_INTERACTION"
    assert client.get(f"/api/v1/projects/{project['id']}/chat").json() == []
    saved = client.get(f"/api/v1/projects/{project['id']}").json()
    assert saved["draft_morphs"] == project["draft_morphs"]
    assert saved["scene_version"] == 0


def test_copilot_chat_rejects_malformed_structured_output_without_saving(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Malformed assistant response"}).json()
    bridge = CopilotBridge(
        url="http://127.0.0.1:49152",
        token="f" * 64,
        model_id="copilot-model-id",
        model_name="Copilot Test Model",
    )

    async def malformed_reply(*, system_prompt, project_context, messages):
        return '{"message":'

    monkeypatch.setattr(main, "load_bridge_config", lambda: bridge)
    monkeypatch.setattr(main, "generate_copilot_reply", malformed_reply)
    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Please adjust this character."},
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "INVALID_AI_INTERACTION"
    assert client.get(f"/api/v1/projects/{project['id']}/chat").json() == []


def test_copilot_action_validation_blocks_appearance_changes_after_compile():
    from app.assistant import AssistantTurn

    turn = AssistantTurn.model_validate({
        "message": "Change the eyes.",
        "morph_updates": {},
        "appearance_updates": {"eye_asset_id": "eye-normal-1"},
        "guidance": None,
    })
    with pytest.raises(ValueError, match="uncompiled draft"):
        main._validate_assistant_turn(
            turn,
            controls=main.CC3_MORPH_MANIFESTS["character_cc3_morphs_v1"]["controls"],
            guidance_control_ids=set(),
            available_eyes=main.available_eye_assets(),
            available_skins=[],
            available_presets=[],
            morph_controls_editable=True,
            is_compiled=True,
        )


def test_assistant_context_filters_large_morph_catalog_to_relevant_candidates():
    controls = main.CC3_MORPH_MANIFESTS["character_cc5_rlcc3plus_all_morphs_v1"]["controls"]
    candidates = main._assistant_morph_candidates(controls, "Make the character taller", {})

    assert 0 < len(candidates) <= 64
    assert any("height" in f"{control['id']} {control['label']}".lower() for control in candidates)
    assert len(json.dumps(candidates)) < 32000


def test_copilot_bridge_failure_is_explicit_and_does_not_fake_reply(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "Copilot unavailable"}).json()

    async def unavailable(*, system_prompt, project_context, messages):
        raise CopilotBridgeError("The VS Code Copilot request failed.")

    monkeypatch.setattr(main, "load_bridge_config", lambda: CopilotBridge(
        url="http://127.0.0.1:49152",
        token="b" * 64,
        model_id="model",
        model_name="Copilot Model",
    ))
    monkeypatch.setattr(main, "generate_copilot_reply", unavailable)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Answer using Copilot"},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "COPILOT_UNAVAILABLE"
    assert client.get(f"/api/v1/projects/{project['id']}/chat").json() == []


def test_missing_copilot_bridge_reply_does_not_point_to_one_extension(monkeypatch):
    project = client.post("/api/v1/projects", json={"name": "No Copilot bridge"}).json()
    monkeypatch.setattr(main, "load_bridge_config", lambda: None)

    response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Hello."},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "COPILOT_UNAVAILABLE"


def test_copilot_bridge_config_must_be_private_and_loopback_only(tmp_path, monkeypatch):
    config_path = tmp_path / "bridge.json"
    monkeypatch.setattr(copilot, "bridge_config_path", lambda: config_path)
    config_path.write_text(
        '{"version":1,"url":"http://192.168.1.4:49152","token":"' + ("c" * 64)
        + '","model_id":"model","model_name":"Copilot"}',
        encoding="utf-8",
    )
    config_path.chmod(0o600)

    with pytest.raises(CopilotBridgeError, match="loopback"):
        copilot.load_bridge_config()

    config_path.write_text(
        '{"version":1,"url":"http://127.0.0.1:49152","token":"' + ("c" * 64)
        + '","model_id":"model","model_name":"Copilot"}',
        encoding="utf-8",
    )
    config_path.chmod(0o644)
    with pytest.raises(CopilotBridgeError, match="current user"):
        copilot.load_bridge_config()


def test_universal_messages_copilot_bridge_status_and_chat(tmp_path, monkeypatch):
    token = "e" * 64
    token_path = tmp_path / "universal-messages-worker" / "copilot-bridge.token"
    token_path.parent.mkdir()
    token_path.write_text(token, encoding="utf-8")
    token_path.chmod(0o600)
    monkeypatch.delenv("COMODEL_COPILOT_BRIDGE_CONFIG")
    monkeypatch.setenv("COMODEL_COPILOT_TOKEN_FILE", str(token_path))
    monkeypatch.setenv("COMODEL_COPILOT_BRIDGE_URL", "http://127.0.0.1:49153")
    monkeypatch.setenv("COMODEL_COPILOT_MODEL_ID", "gpt-4o-mini")
    token_path.chmod(0o644)
    with pytest.raises(CopilotBridgeError, match="readable only by the current user"):
        copilot.load_bridge_config()
    token_path.chmod(0o600)
    monkeypatch.setenv("COMODEL_COPILOT_BRIDGE_URL", "http://192.168.1.4:49153")
    with pytest.raises(CopilotBridgeError, match="loopback"):
        copilot.load_bridge_config()
    monkeypatch.setenv("COMODEL_COPILOT_BRIDGE_URL", "http://127.0.0.1:49153")
    requests = []

    def handle_request(request):
        requests.append(request)
        assert request.headers["authorization"] == f"Bearer {token}"
        if request.url.path == "/v1/status":
            return copilot.httpx.Response(
                200,
                json={"running": True, "connected": True, "models": []},
            )
        if request.url.path == "/v1/models":
            return copilot.httpx.Response(
                200,
                json={
                    "connected": True,
                    "models": [{"id": "gpt-4o-mini", "name": "GPT-4o mini"}],
                },
            )
        assert request.url.path == "/v1/chat"
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-4o-mini"
        if "Create a concise component plan" in payload["prompt"]:
            assert "Please plan a simple character." in payload["prompt"]
            return copilot.httpx.Response(
                200,
                json={
                    "response": json.dumps(
                        {
                            "summary": "A simple staged character plan.",
                            "components": [
                                {
                                    "display_name": "Base Body",
                                    "semantic_type": "body",
                                    "phase_key": "body_blockout",
                                }
                            ],
                        }
                    )
                },
            )
        assert "You are C3Canvas" in payload["prompt"]
        assert "Universal Messages Copilot" in payload["prompt"]
        assert payload["prompt"].endswith(
            "<user_message>\nDescribe the workspace.\n</user_message>"
        )
        assert "messages" not in payload
        return copilot.httpx.Response(200, json={"response": "Response from existing Copilot."})

    original_async_client = copilot.httpx.AsyncClient

    def mock_async_client(*args, **kwargs):
        kwargs["transport"] = copilot.httpx.MockTransport(handle_request)
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr(copilot.httpx, "AsyncClient", mock_async_client)

    status = client.get("/api/v1/copilot/status")
    project = client.post("/api/v1/projects", json={"name": "Universal Messages Copilot"}).json()
    chat = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Describe the workspace."},
    )
    plan = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Please plan a simple character."},
    )

    assert status.json() == {
        "connected": True,
        "provider": "vscode_copilot",
        "model": "GPT-4o mini",
        "message": "Connected through the VS Code Copilot bridge.",
    }
    assert chat.status_code == 200
    assert chat.json()["assistant_message"] == "Response from existing Copilot."
    assert plan.status_code == 200
    assert plan.json()["ai_provider"] == "vscode_copilot"
    assert plan.json()["project"]["planning_metadata"]["provider"] == "vscode_copilot"
    assert plan.json()["project"]["component_plan"][0]["display_name"] == "Base Body"
    assert [request.url.path for request in requests] == ["/v1/status", "/v1/models", "/v1/chat", "/v1/chat"]


def test_universal_messages_prompt_prioritizes_latest_message_over_project_context():
    prompt = copilot._universal_prompt(
        system_prompt="Be concise.",
        project_context='{"project":{"name":"Live milestone check"}}',
        messages=[
            {"role": "user", "content": "Please describe the project."},
            {"role": "assistant", "content": "The plan is awaiting approval."},
            {"role": "user", "content": "testing"},
        ],
    )

    assert "Do not give an unsolicited project summary" in prompt
    assert "Earlier conversation (context only):" in prompt
    assert "Please describe the project." in prompt
    assert prompt.endswith("<user_message>\ntesting\n</user_message>")


def test_copilot_bridge_status_and_chat_use_authenticated_local_requests(tmp_path, monkeypatch):
    config_path = tmp_path / "bridge.json"
    config_path.write_text(
        '{"version":1,"url":"http://127.0.0.1:49152","token":"' + ("d" * 64)
        + '","model_id":"model","model_name":"Copilot Test"}',
        encoding="utf-8",
    )
    config_path.chmod(0o600)
    monkeypatch.setattr(copilot, "bridge_config_path", lambda: config_path)
    requests = []

    def handle_request(request):
        requests.append(request)
        assert request.headers["authorization"] == f"Bearer {'d' * 64}"
        if request.url.path == "/v1/status":
            return copilot.httpx.Response(200, json={"connected": True})
        return copilot.httpx.Response(200, json={"text": "Response from connected Copilot."})

    original_async_client = copilot.httpx.AsyncClient

    def mock_async_client(*args, **kwargs):
        kwargs["transport"] = copilot.httpx.MockTransport(handle_request)
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr(copilot.httpx, "AsyncClient", mock_async_client)
    monkeypatch.setattr(main, "generate_copilot_reply", copilot.generate_copilot_reply)

    status_response = client.get("/api/v1/copilot/status")
    project = client.post("/api/v1/projects", json={"name": "Connected Copilot"}).json()
    chat_response = client.post(
        f"/api/v1/projects/{project['id']}/chat",
        json={"message": "Describe this project."},
    )

    assert status_response.json() == {
        "connected": True,
        "provider": "vscode_copilot",
        "model": "Copilot Test",
        "message": "Connected through the VS Code Copilot extension.",
    }
    assert chat_response.status_code == 200
    assert chat_response.json()["assistant_message"] == "Response from connected Copilot."
    assert [request.url.path for request in requests] == ["/v1/status", "/v1/chat"]


@pytest.mark.skipif(shutil.which("blender") is None, reason="Blender executable is not installed")
def test_cc3_morph_model_import_and_signed_controls_persist(monkeypatch):
    monkeypatch.setattr(main, "configured_project_mode", lambda: "blender")
    monkeypatch.setenv("COMODEL_BLENDER_EXECUTABLE", shutil.which("blender") or "")
    project = client.post("/api/v1/projects", json={"name": "CC3 morph controls"}).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    morphs = {control_id: 0.0 for control_id in main.CC3_MORPH_SPECS_BY_ID}
    morphs["ear_angle_top"] = 0.35
    morphs["ear_length"] = -0.6
    saved_draft = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 0, "morphs": morphs},
    )
    assert saved_draft.status_code == 200, saved_draft.text
    reference_phase = next(phase for phase in planned["phases"] if phase["phase_key"] == "reference_plan")
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{reference_phase['id']}/approve",
        json={"expected_scene_version": saved_draft.json()["scene_version"]},
    ).json()

    imported = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "import_base_model",
            "operation_id": str(uuid4()),
            "expected_scene_version": approved["scene_version"],
            "scope_component_ids": [],
            "dependency_component_ids": [],
            "arguments": {"asset_id": "character_cc3_morphs_v1"},
        },
    )
    assert imported.status_code == 200, imported.text
    imported_result = imported.json()
    component = imported_result["project"]["components"][0]
    assert component["source_asset"]["asset_id"] == "character_cc3_morphs_v1"
    assert component["source_asset"]["bone_count"] == 101
    assert component["source_asset"]["body_shape_key_count"] == main.CC3_MORPH_MANIFEST[
        "body_shape_key_count"
    ]
    assert set(component["source_asset"]["morph_control_names"]) == set(main.CC3_MORPH_SPECS_BY_ID)
    assert len(component["source_asset"]["morph_control_specs"]) == 137
    assert component["cc3_morphs"] == morphs
    late_draft_save = client.patch(
        f"/api/v1/projects/{project['id']}/draft-morphs",
        json={"expected_draft_revision": 1, "morphs": morphs},
    )
    assert late_draft_save.status_code == 409
    assert late_draft_save.json()["detail"]["code"] == "PROJECT_ALREADY_ASSEMBLED"
    changed_morphs = dict(morphs)
    changed_morphs["ear_angle_top"] = 0.5
    changed = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": imported_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": "character_cc3_morphs_v1",
                "morphs": changed_morphs,
            },
        },
    )
    assert changed.status_code == 200, changed.text
    changed_result = changed.json()
    updated = changed_result["project"]["components"][0]
    assert updated["cc3_morphs"] == changed_morphs
    assert changed_result["operation"]["tool_name"] == "apply_cc3_morph_controls"
    assert any(
        result["check_id"] == "cc3_morph_controls_persisted" and result["status"] == "pass"
        for result in changed_result["operation"]["validation_results"]
    )
    positive_only = next(
        spec["id"] for spec in main.CC3_MORPH_SPECS
        if spec["minimum"] == 0
    )
    invalid_morphs = dict(changed_morphs)
    invalid_morphs[positive_only] = -0.01
    invalid_direction = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": changed_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": "character_cc3_morphs_v1",
                "morphs": invalid_morphs,
            },
        },
    )
    assert invalid_direction.status_code == 422
    neutral_bake = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "bake_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": changed_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": "character_cc3_morphs_v1",
                "morphs": {control_id: 0.0 for control_id in morphs},
            },
        },
    )
    assert neutral_bake.status_code == 422
    assert neutral_bake.json()["detail"]["code"] == "NOTHING_TO_BAKE"
    baked = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "bake_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": changed_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": "character_cc3_morphs_v1",
                "morphs": changed_morphs,
            },
        },
    )
    assert baked.status_code == 200, baked.text
    baked_result = baked.json()
    baked_component = baked_result["project"]["components"][0]
    assert baked_result["operation"]["tool_name"] == "bake_cc3_morph_controls"
    assert baked_component["morphs_baked"] is True
    assert baked_component["cc3_morphs"] == {control_id: 0.0 for control_id in morphs}
    assert baked_component["source_asset"]["body_shape_key_count"] == main.CC3_MORPH_MANIFEST["body_shape_key_count"]
    assert baked_component["baked_shape_key_count"] == 0
    assert baked_component["bake_checkpoint_id"] == baked_result["operation"]["rollback_checkpoint_id"]
    assert any(
        result["check_id"] == "cc3_morphs_baked" and result["status"] == "pass"
        for result in baked_result["operation"]["validation_results"]
    )
    edit_baked = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": baked_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": "character_cc3_morphs_v1",
                "morphs": changed_morphs,
            },
        },
    )
    assert edit_baked.status_code == 409
    assert edit_baked.json()["detail"]["code"] == "MORPHS_ALREADY_BAKED"

    restored = client.post(
        f"/api/v1/projects/{project['id']}/checkpoints/{baked_component['bake_checkpoint_id']}/restore",
    )
    assert restored.status_code == 200, restored.text
    restored_project = restored.json()
    assert restored_project["scene_version"] == baked_result["project"]["scene_version"] + 1
    assert restored_project["components"][0].get("morphs_baked", False) is False
    assert restored_project["components"][0]["cc3_morphs"] == changed_morphs
    preview = client.get(
        f"/api/v1/projects/{project['id']}/preview",
        params={"scene_version": restored_project["scene_version"]},
    )
    assert preview.status_code == 200
    assert preview.content[:4] == b"glTF"


@pytest.mark.skipif(
    "character_cc3_male_morphs_v1" not in main.CC3_MORPH_MANIFESTS,
    reason="The owner-supplied Male asset is local-only and is not installed in every environment",
)
@pytest.mark.skipif(not shutil.which("blender"), reason="Blender executable is not installed")
def test_api_imports_selected_male_asset_and_saves_its_complete_morph_map():
    asset_id = "character_cc3_male_morphs_v1"
    manifest = main.CC3_MORPH_MANIFESTS[asset_id]
    project = client.post(
        "/api/v1/projects",
        json={"name": "Male morph controls", "base_model_asset_id": asset_id},
    ).json()
    planned = client.post(f"/api/v1/projects/{project['id']}/plan").json()
    reference_phase = next(phase for phase in planned["phases"] if phase["phase_key"] == "reference_plan")
    approved = client.post(
        f"/api/v1/projects/{project['id']}/phases/{reference_phase['id']}/approve",
        json={"expected_scene_version": planned["scene_version"]},
    ).json()

    wrong_asset = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "import_base_model",
            "operation_id": str(uuid4()),
            "expected_scene_version": approved["scene_version"],
            "scope_component_ids": [],
            "dependency_component_ids": [],
            "arguments": {"asset_id": "character_cc3_morphs_v1"},
        },
    )
    assert wrong_asset.status_code == 409
    assert wrong_asset.json()["detail"]["code"] == "BASE_MODEL_SELECTION_MISMATCH"

    imported = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "import_base_model",
            "operation_id": str(uuid4()),
            "expected_scene_version": approved["scene_version"],
            "scope_component_ids": [],
            "dependency_component_ids": [],
            "arguments": {"asset_id": asset_id},
        },
    )
    assert imported.status_code == 200, imported.text
    import_result = imported.json()
    component = import_result["project"]["components"][0]
    assert import_result["project"]["base_model_asset_id"] == asset_id
    assert component["source_asset"]["asset_id"] == asset_id
    assert component["source_asset"]["body_vertex_count"] == 14647
    assert component["source_asset"]["source_body_vertex_count"] == 13286
    assert component["source_asset"]["body_shape_key_count"] == 323
    assert component["source_asset"]["bone_count"] == 101
    assert len(component["source_asset"]["morph_control_specs"]) == 143

    morphs = {control["id"]: 0.0 for control in manifest["controls"]}
    morphs["shoulder_depth"] = -0.5
    morphs["bust_size"] = 0.75
    changed = client.post(
        f"/api/v1/projects/{project['id']}/modeling-tools",
        json={
            "tool_name": "apply_cc3_morph_controls",
            "operation_id": str(uuid4()),
            "expected_scene_version": import_result["project"]["scene_version"],
            "scope_component_ids": [component["id"]],
            "dependency_component_ids": [],
            "arguments": {
                "component_id": component["id"],
                "asset_id": asset_id,
                "morphs": morphs,
            },
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["project"]["components"][0]["cc3_morphs"] == morphs
