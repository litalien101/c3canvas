DETAIL_TEXTURE_MAX_DIMENSION = 512
DETAIL_TEXTURE_NAMES = ("Std_Nails_Normal", "Std_Eyelash_Normal")


def downscale_detail_textures(images):
    scaled_dimensions = {}
    for name in DETAIL_TEXTURE_NAMES:
        image = images.get(name)
        if image is None:
            raise ValueError(f"CC5 proxy is missing the expected detail texture: {name}")

        width, height = (int(dimension) for dimension in image.size)
        if width <= 0 or height <= 0:
            raise ValueError(f"CC5 proxy detail texture has invalid dimensions: {name}")
        longest_side = max(width, height)
        if longest_side <= DETAIL_TEXTURE_MAX_DIMENSION:
            continue

        scale = DETAIL_TEXTURE_MAX_DIMENSION / longest_side
        dimensions = (max(1, round(width * scale)), max(1, round(height * scale)))
        image.scale(*dimensions)
        scaled_dimensions[name] = dimensions

    return scaled_dimensions
