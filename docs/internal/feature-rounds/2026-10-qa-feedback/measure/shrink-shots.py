"""Quantize every PNG in ../shots to a 128-colour palette (and halve very tall ones) until it is under 300 KB."""
import os, sys
from PIL import Image
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots')
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f)
    if not f.endswith('.png') or os.path.getsize(p) < 290_000:
        continue
    im = Image.open(p).convert('RGB')
    for colors in (128, 64, 32):
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
        q.save(p, optimize=True)
        if os.path.getsize(p) < 290_000:
            break
    print(f, os.path.getsize(p))
