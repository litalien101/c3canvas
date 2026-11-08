"""Validated, draft-only actions and targeted guidance returned by Studio chat."""
from __future__ import annotations

import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class AssistantGuidance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_id: str = Field(min_length=1, max_length=180)
    title: str = Field(min_length=1, max_length=100)
    message: str = Field(min_length=1, max_length=700)


class AssistantProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    morph_updates: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(
        default_factory=dict,
        max_length=32,
    )
    appearance_updates: dict[
        Literal["eye_asset_id", "body_preset_id", "skin_asset_id"],
        str | None,
    ] = Field(default_factory=dict, max_length=3)


class AssistantTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=4000)
    morph_updates: dict[str, Annotated[float, Field(allow_inf_nan=False)]] = Field(
        default_factory=dict,
        max_length=32,
    )
    appearance_updates: dict[
        Literal["eye_asset_id", "body_preset_id", "skin_asset_id"],
        str | None,
    ] = Field(default_factory=dict, max_length=3)
    guidance: AssistantGuidance | None = None

    @field_validator("morph_updates", mode="before")
    @classmethod
    def reject_boolean_morph_values(cls, value: object) -> object:
        if isinstance(value, dict) and any(isinstance(item, bool) for item in value.values()):
            raise ValueError("Morph values must be finite numbers.")
        return value


class InvalidAssistantTurn(ValueError):
    """Raised when a structured model response does not match Studio's contract."""


def parse_assistant_turn(response: str) -> tuple[AssistantTurn, bool]:
    text = response.strip()
    candidate = text
    if candidate.startswith("```json") and candidate.endswith("```"):
        candidate = candidate[7:-3].strip()

    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as error:
        if candidate.startswith(("{", "[")):
            raise InvalidAssistantTurn("The assistant returned malformed structured output.") from error
        return AssistantTurn(message=text), False

    if not isinstance(payload, dict):
        raise InvalidAssistantTurn("The assistant response must be a JSON object.")
    try:
        return AssistantTurn.model_validate(payload), True
    except ValidationError as error:
        raise InvalidAssistantTurn("The assistant response did not match Studio's interaction contract.") from error
