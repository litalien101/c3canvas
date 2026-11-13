"""Validated semantic skin draft values and deterministic material parameters."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


DEFAULT_FRECKLES = {
    "enabled": False,
    "density": 0.18,
    "size": 0.45,
    "strength": 0.35,
    "color": "#80513F",
    "seed": 24301,
    "pattern": "natural",
}

FrecklePattern = Literal[
    "natural",
    "light_dusting",
    "dense_center",
    "cheek_clusters",
    "sun_kissed",
    "constellation",
    "mottled",
]


class SkinBaseDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tone: float = Field(default=0.62, ge=0, le=1)
    undertone: Literal["cool", "neutral", "warm", "olive"] = "neutral"


class SkinSurfaceDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roughness: float = Field(default=0.42, ge=0, le=1)


class SkinFrecklesDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    density: float = Field(default=0.18, ge=0, le=1)
    size: float = Field(default=0.45, ge=0, le=1)
    strength: float = Field(default=0.35, ge=0, le=1)
    color: str = Field(default="#80513F", pattern=r"^#[0-9A-Fa-f]{6}$")
    seed: int = Field(default=24301, ge=0, le=4294967295)
    pattern: FrecklePattern = "natural"


class SkinFeaturesDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    freckles: SkinFrecklesDefinition = Field(default_factory=SkinFrecklesDefinition)


class SkinFrecklesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    density: float | None = Field(default=None, ge=0, le=1)
    size: float | None = Field(default=None, ge=0, le=1)
    strength: float | None = Field(default=None, ge=0, le=1)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    pattern: FrecklePattern | None = None

    @model_validator(mode="after")
    def reject_explicit_nulls(self):
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Freckle patch values cannot be null.")
        return self


class SkinFeaturesPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    freckles: SkinFrecklesPatch | None = None

    @model_validator(mode="after")
    def require_feature_changes(self):
        if not self.model_fields_set or any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Skin feature patches must contain a supported feature.")
        if self.freckles is not None and not self.freckles.model_fields_set:
            raise ValueError("Freckle patches must contain at least one property.")
        return self


class SkinDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: Literal[2] = 2
    base: SkinBaseDefinition = Field(default_factory=SkinBaseDefinition)
    surface: SkinSurfaceDefinition = Field(default_factory=SkinSurfaceDefinition)
    features: SkinFeaturesDefinition = Field(default_factory=SkinFeaturesDefinition)

    @model_validator(mode="before")
    @classmethod
    def upgrade_v1_definition(cls, value):
        if isinstance(value, dict) and value.get("version") == 1:
            upgraded = dict(value)
            upgraded["version"] = 2
            upgraded.setdefault("features", {"freckles": dict(DEFAULT_FRECKLES)})
            return upgraded
        return value


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
    features: SkinFeaturesPatch | None = None

    @model_validator(mode="after")
    def require_supported_changes(self):
        if not self.model_fields_set:
            raise ValueError("The skin patch must change at least one supported property.")
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("Skin patch sections cannot be null.")
        if not any(
            section.model_fields_set
            for section in (self.base, self.surface, self.features)
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
        update = section_patch.model_dump(exclude_unset=True)
        if section_name == "features":
            for feature_name, feature_patch in update.items():
                merged[section_name][feature_name].update(feature_patch)
        else:
            merged[section_name].update(update)
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
