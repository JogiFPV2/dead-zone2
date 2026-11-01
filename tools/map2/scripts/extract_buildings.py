#!/usr/bin/env python3
"""OSM .pbf -> `deadzone-osm-bld-raw-2` JSON (WGS84): buildings and building parts 1:1, for map2
stage 3. Closed ways and multipolygon relations (outer + inner rings = courtyards), with the tags
map2 reads (type, levels, height, roof, colour, name). Same bbox as extract.py.

  extract_buildings.py <in.osm.pbf> <out.json> [W S E N]
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, sys
import osmium

src, out = sys.argv[1], sys.argv[2]
W, S, E, N = (float(v) for v in (sys.argv[3:7] or (21.80, 50.47, 22.25, 50.76)))
inb = lambda lon, lat: W <= lon <= E and S <= lat <= N
r7 = lambda v: round(v, 7)
KEEP = ('building', 'building:part', 'building:levels', 'building:min_level', 'levels', 'height',
        'min_height', 'roof:shape', 'roof:levels', 'roof:height', 'building:colour', 'roof:colour',
        'building:material', 'name', 'amenity', 'shop', 'location', 'layer', 'addr:housenumber')


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.items = []

    def area(self, a):
        t = a.tags
        b, p = t.get('building'), t.get('building:part')
        if not ((b and b != 'no') or (p and p != 'no')):
            return
        rings = []
        try:
            for outer in a.outer_rings():
                ring = [[r7(n.lon), r7(n.lat)] for n in outer]
                if any(inb(x, y) for x, y in ring):
                    rings.append({'outer': ring,
                                  'inner': [[[r7(n.lon), r7(n.lat)] for n in i] for i in a.inner_rings(outer)]})
        except osmium.InvalidLocationError:
            return
        if rings:
            self.items.append({'id': a.orig_id(), 'way': a.from_way(), 'part': not (b and b != 'no'),
                               't': {k: t[k] for k in KEEP if k in t}, 'rings': rings})


h = H()
h.apply_file(src, locations=True, idx='flex_mem')
h.items.sort(key=lambda x: (x['way'], x['id']))
json.dump({'format': 'deadzone-osm-bld-raw-2', 'bbox': [W, S, E, N],
           'source': 'OpenStreetMap (Geofabrik podkarpackie extract)', 'license': 'ODbL-1.0',
           'buildings': h.items}, open(out, 'w'), separators=(',', ':'))
print('buildings', sum(not x['part'] for x in h.items), 'parts', sum(x['part'] for x in h.items),
      'relations', sum(not x['way'] for x in h.items),
      'with inner', sum(any(r['inner'] for r in x['rings']) for x in h.items))
