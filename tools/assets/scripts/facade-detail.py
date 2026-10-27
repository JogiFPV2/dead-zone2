#!/usr/bin/env python3
"""bld v2 facade detail atlas (offline, Designer look-spec.md B).

4x4 cells of 512 px, greyscale luminance of ambientCG CC0 1.0 materials (1K-JPG),
normalised to mean 128 so the shader can multiply `palette * detail * 2`.
Usage: facade-detail.py <dir with unzipped <Id>/<Id>_1K-JPG_Color.jpg> <out dir>
Downloads: https://ambientcg.com/get?file=<Id>_1K-JPG.zip
"""
import json, sys
import numpy as np
from PIL import Image

# (cell id, ambientCG id, metres per tile, contrast)
CELLS = [
    ('plaster', 'Plaster001', 2.0, 1.6),
    ('plaster-rough', 'Plaster003', 2.0, 1.4),
    ('panel', 'Concrete034', 3.0, 1.2),
    ('brick', 'Bricks059', 1.5, 1.0),
    ('brick-dark', 'Bricks066', 1.5, 1.0),
    ('corrugated', 'CorrugatedSteel002', 2.0, 1.0),
    ('sheet', 'SheetMetal001', 2.0, 1.0),
    ('metal-plates', 'MetalPlates006', 2.0, 1.0),
    ('planks', 'Wood026', 2.0, 1.0),
    ('concrete', 'Concrete031', 2.0, 1.2),
    ('tiles-plain', 'RoofingTiles006', 2.0, 1.0),
    ('tiles-s', 'RoofingTiles008', 2.0, 1.0),
    ('sheet-tile', 'SheetMetal004', 2.0, 1.0),
    ('felt', 'Asphalt010', 2.0, 1.2),
    ('shopfront', 'Tiles074', 2.0, 0.8),
    ('grime', 'Concrete046', 4.0, 1.0),
]
CELL = 512


def cell(path, contrast):
    im = Image.open(path).convert('RGB').resize((CELL, CELL), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255.0
    lum = (0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]) ** (1 / 2.2)
    lum = lum / max(lum.mean(), 1e-3)
    lum = 1 + (lum - 1) * contrast
    return np.clip(lum * 128, 0, 255).astype(np.uint8)


def main(src, out):
    atlas = np.zeros((CELL * 4, CELL * 4), np.uint8)
    meta = []
    for i, (name, aid, m, c) in enumerate(CELLS):
        x, y = (i % 4) * CELL, (i // 4) * CELL
        atlas[y:y + CELL, x:x + CELL] = cell(f'{src}/{aid}/{aid}_1K-JPG_Color.jpg', c)
        meta.append({'index': i, 'id': name, 'source': f'ambientCG {aid} (CC0 1.0)',
                     'url': f'https://ambientcg.com/view?id={aid}', 'tileMeters': m})
    Image.fromarray(atlas, 'L').save(f'{out}/facade-detail.webp', quality=80, method=6)
    with open(f'{out}/facade-detail.json', 'w') as f:
        json.dump({'size': CELL * 4, 'grid': 4, 'cells': meta}, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
