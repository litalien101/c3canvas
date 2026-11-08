"""Validated semantic skin draft values and deterministic material parameters."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SkinBaseDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone: float = Field(default=0.62, ge=0, le=1)
    undertone: Literal["cool", "neutral", "warm", "olive"] = "neutral"


class SkinSurfaceDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roughness: float = Field(default=0.42, ge=0, le=1)


class SkinDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[1] = 1
    base: SkinBaseDefinition = Field(default_factory=SkinBaseDefinition)
    surface: SkinSurfaceDefinition = Field(default_factory=SkinSurfaceDefinition)


class SkinBasePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone: float | None = Field(default=None, ge=0, le=1)
    undertone: Literal["cool", "neutral", "warm", "olive"] | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self):
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Skin patch values cannot be null.")
        return self


class SkinSurfacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roughness: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode="after")
    def reject_explicit_nulls(self):
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Skin patch values cannot be null.")
        return self


class SkinDefinitionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base: SkinBasePatch | None = None
    surface: SkinSurfacePatch | None = None

    @model_validator(mode="after")
    def require_supported_changes(self):
        if not self.model_fields_set:
            raise ValueError("The skin patch must change at least one supported property.")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Skin patch sections cannot be null.")
        if not any(
            section.model_fields_set
            for section in (self.base, self.surface)
            if section is not None
        ):
            raise ValueError("The skin patch must change at least one supported property.")
        return self


def apply_skin_patch(
    current: SkinDefinition,
    patch: SkinDefinitionPatch,
) -> SkinDefinition:
    merged = current.model_dump(mode="json")
    for section_name, section_patch in patch:
        if section_patch is None:
            continue
        merged[section_name].update(section_patch.model_dump(exclude_unset=True))
    return SkinDefinition.model_validate(merged)


def skin_material_parameters(definition: SkinDefinition) -> dict[str, object]:
    tone_factor = 0.7 + definition.base.tone * 0.5
    roughness_scale = definition.surface.roughness / SkinDefinition().surface.roughness
    undertone = {
        "cool": (0.97, 0.99, 1.04),
        "neutral": (1.0, 1.0, 1.0),
        "warm": (1.04, 1.0, 0.96),
        "olive": (0.99, 1.02, 0.96),
    }[definition.base.undertone]
    return {
        "color_multiplier": [round(tone_factor * channel, 6) for channel in undertone],
        "roughness_scale": round(roughness_scale, 6),
    }
