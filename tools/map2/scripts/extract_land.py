#!/usr/bin/env python3
"""OSM .pbf -> `deadzone-osm-land-raw-2` JSON (WGS84): everything on the ground except roads and
buildings, 1:1, for map2 stage 4 (land): areas (water, forest, parks, fields, landuse…) as closed
ways and multipolygons with holes, hedges, waterways (rivers, streams, canals, ditches), railways
(all kinds), power lines, single trees, tree rows, rail nodes and POIs. Tags are kept (a subset);
classification happens in TypeScript (tools/map classify.ts). Same bbox as extract.py.

  extract_land.py <in.osm.pbf> <out.json> [W S E N]
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, sys
import osmium

src, out = sys.argv[1], sys.argv[2]
W, S, E, N = (float(v) for v in (sys.argv[3:7] or (21.80, 50.47, 22.25, 50.76)))
inb = lambda lon, lat: W <= lon <= E and S <= lat <= N
r7 = lambda v: round(v, 7)
# Keys that make a closed way / multipolygon a ground area (tools/map classifyArea reads these).
AREA_KEYS = ('natural', 'landuse', 'leisure', 'amenity', 'waterway', 'man_made', 'area:highway',
             'parking', 'water', 'wetland')
AREA_TAGS = AREA_KEYS + ('name', 'highway', 'building', 'intermittent', 'seasonal', 'leaf_type')
LINE_TAGS = ('waterway', 'railway', 'service', 'usage', 'electrified', 'bridge', 'tunnel', 'layer',
             'name', 'width', 'est_width', 'intermittent', 'power', 'voltage', 'cables', 'line',
             'natural', 'barrier', 'gauge', 'disused', 'abandoned')
NODE_KEYS = ('natural', 'railway', 'amenity', 'shop', 'highway', 'power')
NODE_TAGS = NODE_KEYS + ('name', 'leaf_type', 'genus', 'species', 'denotation')
WATERWAYS = {'river', 'stream', 'canal', 'ditch', 'drain', 'brook'}
RAILWAYS = {'rail', 'light_rail', 'tram', 'narrow_gauge', 'disused', 'preserved', 'abandoned'}
POWER_LINES = {'line', 'minor_line', 'cable'}


def pick(t, keys):
    return {k: t[k] for k in keys if k in t}


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.areas, self.lines, self.nodes = [], [], []

    def node(self, n):
        t = n.tags
        if not any(k in t for k in NODE_KEYS) or not inb(n.location.lon, n.location.lat):
            return
        keep = (t.get('natural') == 'tree' or t.get('railway') in ('switch', 'buffer_stop', 'level_crossing')
                or 'amenity' in t or 'shop' in t or t.get('highway') in ('bus_stop', 'street_lamp')
                or t.get('power') in ('tower', 'pole'))
        if keep:
            self.nodes.append({'id': n.id, 'p': [r7(n.location.lon), r7(n.location.lat)],
                               't': pick(t, NODE_TAGS)})

    def way(self, w):
        t = w.tags
        line = (t.get('waterway') in WATERWAYS or t.get('railway') in RAILWAYS
                or t.get('power') in POWER_LINES or t.get('natural') == 'tree_row'
                or t.get('barrier') == 'hedge')
        if not line:
            return
        try:
            g = [[r7(nd.lon), r7(nd.lat)] for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if any(inb(x, y) for x, y in g):
            self.lines.append({'id': w.id, 't': pick(t, LINE_TAGS), 'g': g})

    def area(self, a):
        t = a.tags
        if not any(k in t for k in AREA_KEYS) and t.get('highway') != 'pedestrian':
            return
        b = t.get('building')
        if b and b != 'no':
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
            self.areas.append({'id': a.orig_id(), 'way': a.from_way(), 't': pick(t, AREA_TAGS),
                               'rings': rings})


h = H()
h.apply_file(src, locations=True, idx='flex_mem')
h.areas.sort(key=lambda x: (x['way'], x['id'])); h.lines.sort(key=lambda x: x['id'])
h.nodes.sort(key=lambda x: x['id'])
json.dump({'format': 'deadzone-osm-land-raw-2', 'bbox': [W, S, E, N],
           'source': 'OpenStreetMap (Geofabrik podkarpackie extract)', 'license': 'ODbL-1.0',
           'areas': h.areas, 'lines': h.lines, 'nodes': h.nodes}, open(out, 'w'), separators=(',', ':'))
print('areas', len(h.areas), 'relations', sum(not x['way'] for x in h.areas),
      'with holes', sum(any(r['inner'] for r in x['rings']) for x in h.areas),
      'lines', len(h.lines), 'nodes', len(h.nodes))
