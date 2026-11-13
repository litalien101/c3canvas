import pytest

from cc5_proxy_textures import downscale_detail_textures


class FakeImage:
    def __init__(self, size):
        self.size = size

    def scale(self, width, height):
        self.size = (width, height)


def test_downscales_only_expected_detail_textures_and_preserves_aspect_ratio():
    images = {
        "Std_Nails_Normal": FakeImage((2048, 1024)),
        "Std_Eyelash_Normal": FakeImage((2048, 2048)),
        "Std_Skin_Head_Diffuse": FakeImage((2048, 2048)),
    }

    scaled = downscale_detail_textures(images)

    assert scaled == {
        "Std_Nails_Normal": (512, 256),
        "Std_Eyelash_Normal": (512, 512),
    }
    assert images["Std_Skin_Head_Diffuse"].size == (2048, 2048)


def test_leaves_already_small_detail_textures_unchanged():
    images = {
        "Std_Nails_Normal": FakeImage((512, 512)),
        "Std_Eyelash_Normal": FakeImage((256, 512)),
    }

    assert downscale_detail_textures(images) == {}
    assert images["Std_Nails_Normal"].size == (512, 512)
    assert images["Std_Eyelash_Normal"].size == (256, 512)


def test_rejects_missing_expected_detail_textures():
    with pytest.raises(ValueError, match="Std_Nails_Normal"):
        downscale_detail_textures({})
