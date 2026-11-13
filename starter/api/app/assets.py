"""Validated local reference image storage."""
from __future__ import annotations

import hashlib
import io
import os
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError


SUPPORTED_FORMATS = {
    "JPEG": ("image/jpeg", ".jpg"),
    "PNG": ("image/png", ".png"),
    "WEBP": ("image/webp", ".webp"),
}


class InvalidImageError(ValueError):
    pass


def validate_image(content: bytes) -> tuple[str, str, int, int, str]:
    max_bytes = int(os.getenv("MAX_UPLOAD_BYTES", "15728640"))
    max_pixels = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
    if not content:
        raise InvalidImageError("The uploaded image is empty.")
    if len(content) > max_bytes:
        raise InvalidImageError(f"Image exceeds the {max_bytes}-byte upload limit.")

    try:
        with Image.open(io.BytesIO(content)) as image:
            image_format = image.format
            width, height = image.size
            if width < 1 or height < 1 or width * height > max_pixels:
                raise InvalidImageError(f"Image dimensions exceed the {max_pixels}-pixel limit.")
            if getattr(image, "n_frames", 1) != 1:
                raise InvalidImageError("Animated images are not supported as references.")
            image.verify()
        if image_format not in SUPPORTED_FORMATS:
            raise InvalidImageError("Only JPEG, PNG, and WebP images are supported.")
        mime_type, extension = SUPPORTED_FORMATS[image_format]
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise InvalidImageError("The upload is not a valid supported image.") from error

    return mime_type, extension, width, height, hashlib.sha256(content).hexdigest()


class LocalAssetStore:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save_reference(self, content: bytes, extension: str) -> tuple[str, Path]:
        asset_id = str(uuid4())
        target = (self.root / f"{asset_id}{extension}").resolve()
        if self.root not in target.parents:
            raise ValueError("Resolved asset path is outside the configured asset store.")
        target.write_bytes(content)
        return asset_id, target

    def remove_reference(self, storage_key: str) -> None:
        if Path(storage_key).name != storage_key:
            raise ValueError("Resolved asset path is outside the configured asset store.")
        target = self.root / storage_key
        if target.is_symlink() or target.resolve().parent != self.root:
            raise ValueError("Resolved asset path is outside the configured asset store.")
        target.unlink(missing_ok=True)
