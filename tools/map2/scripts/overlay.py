#!/usr/bin/env python3
"""Dev check: map2 roads (cli-roads output) drawn over the real OSM map (tile.openstreetmap.org,
cached in $DEADZONE_OSM_CACHE/tiles; a handful of tiles per view, OSM tile usage policy) and next
to it, with main streets and districts labelled. Output: JPEG (reference | map2 | overlay).

  overlay.py <roads2.json> <out.jpg> <lon> <lat> <zoom> [px]
"""
import json, math, os, sys, urllib.request
from PIL import Image, ImageDraw, ImageFont
from pyproj import Transformer

roads_f, out, lon, lat, z = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
PX = int(sys.argv[6]) if len(sys.argv) > 6 else 900
CACHE = os.path.join(os.environ.get('DEADZONE_OSM_CACHE', os.path.expanduser('~/.cache/deadzone-osm')), 'tiles')
d = json.load(open(roads_f))
o = d['origin']
inv = Transformer.from_crs(f"+proj=tmerc +lat_0={o['lat']} +lon_0={o['lon']} +k=1 +ellps=WGS84", 4326, always_xy=True)
n = 2 ** z
def wm(lo, la):
    x = (lo + 180) / 360 * n * 256
    y = (1 - math.asinh(math.tan(math.radians(la))) / math.pi) / 2 * n * 256
    return x, y
cx, cy = wm(lon, lat); X0, Y0 = cx - PX / 2, cy - PX / 2
def tile(tx, ty):
    p = os.path.join(CACHE, str(z), str(tx), f'{ty}.png')
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        req = urllib.request.Request(f'https://tile.openstreetmap.org/{z}/{tx}/{ty}.png',
                                     headers={'User-Agent': 'deadzone-map2-dev-check/0.1'})
        open(p, 'wb').write(urllib.request.urlopen(req, timeout=30).read())
    return Image.open(p).convert('RGB')
ref = Image.new('RGB', (PX, PX))
for tx in range(int(X0 // 256), int((X0 + PX) // 256) + 1):
    for ty in range(int(Y0 // 256), int((Y0 + PX) // 256) + 1):
        ref.paste(tile(tx, ty), (int(tx * 256 - X0), int(ty * 256 - Y0)))
# metres per pixel at this latitude (for widths)
mpp = 156543.03392 * math.cos(math.radians(lat)) / n
def P(pts):
    xs = [p[0] for p in pts]; ys = [-p[1] for p in pts]
    lo, la = inv.transform(xs, ys)
    return [(a - X0, b - Y0) for a, b in (wm(*q) for q in zip(lo, la))]
inview = lambda pts: any(-200 < x < PX + 200 and -200 < y < PX + 200 for x, y in pts)
COL = {'motorway': (226, 122, 143), 'trunk': (249, 178, 156), 'primary': (252, 214, 164), 'secondary': (247, 250, 191),
       'tertiary': (255, 255, 255), 'residential': (255, 255, 255), 'living': (237, 237, 237), 'service': (230, 230, 230)}
def draw_net(im, alpha_over=False):
    lay = Image.new('RGBA', im.size, (0, 0, 0, 0)); g = ImageDraw.Draw(lay)
    for w in d['water']:
        for r in w['rings']:
            q = P(r)
            if len(q) > 2 and inview(q): g.polygon(q, fill=(110, 160, 230, 200 if not alpha_over else 90))
    for w in d['rivers']:
        q = P(w['pts'])
        if inview(q): g.line(q, fill=(70, 130, 220, 255), width=2)
    for r in d['rails']:
        q = P(r['pts'])
        if inview(q): g.line(q, fill=(60, 60, 60, 255), width=2)
    es = [e for e in d['edges'] if e['p']['cls'] in COL]
    es = [(e, P(e['pts'])) for e in es]
    es = [(e, q) for e, q in es if inview(q)]
    for e, q in es:  # sidewalks
        sw = max(e['p']['sidewalk'])
        if sw: g.line(q, fill=(190, 185, 175, 255), width=max(1, round((e['p']['width'] + 2 * sw) / mpp)))
    for e, q in es:
        g.line(q, fill=(90, 90, 95, 255), width=max(1, round(e['p']['width'] / mpp) + 2))
    for e, q in es:
        c = COL[e['p']['cls']]
        if alpha_over: c = (220, 30, 30)
        g.line(q, fill=c + (255 if not alpha_over else 170,), width=max(1, round(e['p']['width'] / mpp)), joint='curve')
    if not alpha_over and mpp < 1.2:
        for j in d['junctions']:
            for f in j['fillets']:
                q = P(f)
                if inview(q): g.line(q, fill=(20, 160, 60, 255), width=2)
    if not alpha_over:
        for e, q in es:
            if e.get('dual') is not None and len(q) > 1:
                g.line(q, fill=(40, 90, 230, 255), width=1)
    im.paste(lay, (0, 0), lay)
    return im
F = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', s)
def labels(im):
    g = ImageDraw.Draw(im); best = {}
    for e in d['edges']:
        if e.get('name') and e['p']['cls'] in ('trunk', 'primary', 'secondary', 'tertiary'):
            q = P(e['pts']); L = sum(math.dist(q[i], q[i + 1]) for i in range(len(q) - 1))
            if inview(q) and L > best.get(e['name'], (0,))[0]: best[e['name']] = (L, q)
    for name, (L, q) in sorted(best.items(), key=lambda x: -x[1][0])[:12]:
        p = min(q, key=lambda p: math.dist(p, (PX / 2, PX / 2)))
        if 0 < p[0] < PX and 0 < p[1] < PX: g.text(p, name, fill=(160, 20, 20), font=F(13), stroke_width=2, stroke_fill='white')
    for pl in d['places']:
        if pl['kind'] in ('town', 'city', 'suburb', 'village', 'quarter') or (z >= 14 and pl['kind'] == 'neighbourhood'):
            q = P([pl['xy']])[0]
            if 20 < q[0] < PX - 20 and 40 < q[1] < PX - 20:
                g.text(q, pl['name'], fill=(20, 20, 130), font=F(17 if pl['kind'] in ('town', 'city') else 13), anchor='mm', stroke_width=3, stroke_fill='white')
    return im
def title(im, t):
    g = ImageDraw.Draw(im); g.rectangle([0, 0, PX, 26], fill=(25, 25, 25)); g.text((8, 5), t, fill='white', font=F(14)); return im
a = title(labels(ref.copy()), f'REFERENCJA: OpenStreetMap (z{z})')
b = title(labels(draw_net(Image.new('RGB', (PX, PX), (236, 232, 222)))), 'MAP2: drogi z OSM (szer. z tagow, zielone = luki promieni)')
c = title(draw_net(ref.copy(), True), 'NAKLADKA: map2 (czerwony) na OSM')
im = Image.new('RGB', (PX * 3 + 20, PX), 'black')
for i, x in enumerate((a, b, c)): im.paste(x, (i * (PX + 10), 0))
im.save(out, quality=80)
print(out, os.path.getsize(out))
