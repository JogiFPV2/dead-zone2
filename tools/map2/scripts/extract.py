#!/usr/bin/env python3
"""OSM .pbf -> `deadzone-osm-raw-2` JSON (WGS84, node ids kept, so junctions are shared nodes,
not coordinate guesses). Only what map2 needs: highways, railways, waterways, water areas, places.
Coordinates are projected later in TypeScript (src/project.ts, one origin for the whole map).

  extract.py <in.osm.pbf> <out.json> [W S E N]     (default: Stalowa Wola, Rozwadów, Nisko,
                                                   the lower San down to the Vistula)
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json, sys
import osmium

src, out = sys.argv[1], sys.argv[2]
W, S, E, N = (float(v) for v in (sys.argv[3:7] or (21.80, 50.47, 22.25, 50.76)))
WAY_KEYS = ('highway', 'railway', 'waterway')
inb = lambda lon, lat: W <= lon <= E and S <= lat <= N
r7 = lambda v: round(v, 7)


class H(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.nodes, self.ways, self.areas, self.places = {}, [], [], []

    def node(self, n):
        if 'place' in n.tags and inb(n.location.lon, n.location.lat):
            self.places.append({'id': n.id, 'lon': r7(n.location.lon), 'lat': r7(n.location.lat),
                                'place': n.tags['place'], 'name': n.tags.get('name', '')})

    def way(self, w):
        if not any(k in w.tags for k in WAY_KEYS) or w.tags.get('area') == 'yes':
            return
        try:
            locs = [(nd.ref, nd.lon, nd.lat) for nd in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(inb(x, y) for _, x, y in locs):
            return
        for ref, x, y in locs:
            self.nodes[ref] = [r7(x), r7(y)]
        self.ways.append({'id': w.id, 'nodes': [r for r, _, _ in locs], 't': dict(w.tags)})

    def area(self, a):
        t = a.tags
        water = t.get('natural') == 'water' or t.get('waterway') == 'riverbank' or t.get('landuse') == 'reservoir'
        if not water:
            return
        rings = []
        for outer in a.outer_rings():
            ring = [[r7(n.lon), r7(n.lat)] for n in outer]
            if any(inb(x, y) for x, y in ring):
                rings.append({'outer': ring, 'inner': [[[r7(n.lon), r7(n.lat)] for n in i] for i in a.inner_rings(outer)]})
        if rings:
            self.areas.append({'id': a.id, 'kind': 'water', 'name': t.get('name', ''), 'rings': rings})


h = H()
h.apply_file(src, locations=True, idx='flex_mem')
h.ways.sort(key=lambda w: w['id']); h.areas.sort(key=lambda a: a['id']); h.places.sort(key=lambda p: p['id'])
json.dump({'format': 'deadzone-osm-raw-2', 'bbox': [W, S, E, N],
           'source': 'OpenStreetMap (Geofabrik podkarpackie extract)', 'license': 'ODbL-1.0',
           'nodes': {str(k): v for k, v in sorted(h.nodes.items())}, 'ways': h.ways,
           'areas': h.areas, 'places': h.places}, open(out, 'w'), separators=(',', ':'))
print('nodes', len(h.nodes), 'ways', len(h.ways), 'areas', len(h.areas), 'places', len(h.places))
