"""Realistic characters (render.style='real') -> source GLBs for the `deadzone-char` pack.

Offline, numpy + Pillow (no Blender). Input: Designer's slimmed UBC bodies (`slim/out/*.gltf`,
Quaternius Universal Base Characters, CC0), UBC hair (CC0), Universal Animation Library 1+2
clips (CC0). Env SRC = assets-src/characters-real directory. Output: `<name>.full.glb` here,
then `simplify.mjs` decimates them to `<name>.glb` (what the pack builds).

- Bones renamed to the Quaternius names the client uses (Hips, Abdomen, Torso, Chest, Neck, Head,
  Shoulder/UpperArm/LowerArm/Wrist.L|R, UpperLeg/LowerLeg/Foot/Toes.L|R); fingers removed
  (weights folded into the wrist): 65 -> 23 joints.
- One mesh, one material: body (clothing = shell pushed out along the normal per bone zone),
  hair (rigid on Head), eyes. Look baked to COLOR_0: skin sampled from the UBC texture, clothes =
  outfit tint, zombies: decay, grime, blood and torn cloth from a seed (per template).
- Clips renamed to the Quaternius clip names (character-rig.ts CHARACTER_CLIPS).
"""
import json, os, struct, sys, math
import numpy as np
from PIL import Image

SRC = os.environ.get('SRC', '/workspace/assets-src/characters-real')
OUT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(SRC, 'slim'))
from gl import G, trs  # noqa: E402

RENAME = {'root': 'Root', 'pelvis': 'Hips', 'spine_01': 'Abdomen', 'spine_02': 'Torso', 'spine_03': 'Chest',
          'neck_01': 'Neck', 'Head': 'Head'}
for s, S in (('l', 'L'), ('r', 'R')):
    RENAME.update({f'clavicle_{s}': f'Shoulder.{S}', f'upperarm_{s}': f'UpperArm.{S}', f'lowerarm_{s}': f'LowerArm.{S}',
                   f'hand_{s}': f'Wrist.{S}', f'thigh_{s}': f'UpperLeg.{S}', f'calf_{s}': f'LowerLeg.{S}',
                   f'foot_{s}': f'Foot.{S}', f'ball_{s}': f'Toes.{S}'})

PLAYER_CLIPS = {'Idle': 'Idle_Loop', 'Walk': 'Walk_Loop', 'Run': 'Jog_Fwd_Loop', 'Run_Back': '-Jog_Fwd_Loop',
                'Run_Left': 'Jog_Fwd_Loop', 'Run_Right': 'Jog_Fwd_Loop', 'Punch_Right': 'Punch_Cross',
                'Punch_Left': 'Punch_Jab', 'Sword_Slash': 'Sword_Attack', 'Death': 'Death01', 'HitRecieve': 'Hit_Chest',
                'HitRecieve_2': 'Hit_Knockback', 'Idle_Gun': 'Pistol_Idle_Loop', 'Idle_Gun_Pointing': 'Pistol_Aim_Neutral',
                'Idle_Gun_Shoot': 'Pistol_Shoot'}
ZOMBIE_CLIPS = {'Idle': 'Zombie_Idle_Loop', 'Walk': 'Zombie_Walk_Fwd_Loop', 'Run': 'Jog_Fwd_Loop',
                'Punch_Right': 'Zombie_Scratch', 'Death': 'Death01', 'HitRecieve': 'Hit_Chest', 'HitRecieve_2': 'Hit_Knockback'}

COT, KNIT, LEATHER = 1, 2, 3
CHARS = [
    # name, sex, base, outfit
    ('survivor-m', 'm', 'Slim', dict(top=dict(layer=KNIT, col='#4a4f3c', sleeve='long', hem=0.47, off=0.022),
                                     pants=dict(layer=COT, col='#34435a', off=0.008), shoes=dict(layer=LEATHER, col='#2b2622', off=0.01),
                                     hair='Hair_SimpleParted', hairCol='#3b2a1e', grime=0.25)),
    ('survivor-f', 'f', 'Slim', dict(top=dict(layer=COT, col='#2f5a63', sleeve='long', hem=0.52, off=0.016),
                                     pants=dict(layer=COT, col='#5b6b82', off=0.007), shoes=dict(layer=LEATHER, col='#bdb8ac', off=0.01),
                                     hair='Hair_Long', hairCol='#6b4a2e', grime=0.2)),
    ('zombie-m-worker', 'm', 'Zombie', dict(seed=1, decay=0.75, blood=0.8, tear=0.55, top=dict(layer=COT, col='#4c5866', sleeve='long', hem=0.47, off=0.02),
                                            pants=dict(layer=COT, col='#3e4652', off=0.01), shoes=dict(layer=LEATHER, col='#3a2f27', off=0.01),
                                            hair='Hair_Buzzed', hairCol='#4a463e', grime=0.6)),
    ('zombie-f-coat', 'f', 'Zombie', dict(seed=2, decay=0.85, blood=1.0, tear=0.4, top=dict(layer=KNIT, col='#6e5a45', sleeve='long', hem=0.40, off=0.026),
                                          pants=dict(layer=COT, col='#3a3836', off=0.008), shoes=dict(layer=LEATHER, col='#241e1b', off=0.01),
                                          hair='Hair_Buns', hairCol='#5a5048', grime=0.5)),
    ('zombie-m-tracksuit', 'm', 'Zombie', dict(seed=3, decay=1.0, blood=0.6, tear=0.85, top=dict(layer=COT, col='#2c335e', sleeve='long', hem=0.5, off=0.014),
                                               pants=dict(layer=COT, col='#2a2f52', off=0.01), shoes=dict(layer=LEATHER, col='#cfcabe', off=0.01),
                                               hair=None, grime=0.7)),
    ('zombie-f-shirt', 'f', 'Zombie', dict(seed=4, decay=0.9, blood=0.7, tear=0.6, top=dict(layer=COT, col='#8a7f6a', sleeve='short', hem=0.5, off=0.014),
                                           pants=dict(layer=COT, col='#3f3a4a', off=0.008), shoes=dict(layer=LEATHER, col='#2b2420', off=0.01),
                                           hair='Hair_Long', hairCol='#2e2620', grime=0.55)),
]


def lin(h):
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb_img(path):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32) / 255
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def sample(img, uv):
    h, w, _ = img.shape
    x = np.clip((uv[:, 0] % 1) * (w - 1), 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1) * (h - 1), 0, h - 1).astype(int)
    return img[y, x]


def hash3(p, seed):
    """Deterministic value noise 0..1 per position (cell 4 cm) and seed."""
    q = np.floor(p / 0.04).astype(np.int64)
    h = (q[:, 0] * 73856093) ^ (q[:, 1] * 19349663) ^ (q[:, 2] * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def region(name):
    if name in ('Head', 'neck_01'): return 'head'
    if name.startswith(('hand', 'index', 'middle', 'ring', 'pinky', 'thumb')): return 'hand'
    if name.startswith('lowerarm'): return 'fore'
    if name.startswith(('spine', 'clavicle', 'upperarm')): return 'top'
    if name.startswith('pelvis'): return 'pelvis'
    if name.startswith(('thigh', 'calf')): return 'leg'
    if name.startswith(('foot', 'ball')): return 'foot'
    return 'top'


def prim(g, mi):
    p = g.j['meshes'][mi]['primitives'][0]
    A = p['attributes']
    get = lambda k: g.acc(A[k])[0].astype(np.float64) if k in A else None
    idx = g.acc(p['indices'])[0].reshape(-1).astype(np.uint32)
    return dict(pos=get('POSITION'), nor=get('NORMAL'), uv=get('TEXCOORD_0'),
                j=g.acc(A['JOINTS_0'])[0].astype(np.int64) if 'JOINTS_0' in A else None,
                w=get('WEIGHTS_0'), idx=idx)


def ual_clips():
    out = {}
    for f in ('src/ual1.glb', 'src/ual2.glb'):
        b = open(os.path.join(SRC, f), 'rb').read()
        n = struct.unpack('<I', b[12:16])[0]
        j = json.loads(b[20:20 + n])
        off = 20 + n
        bl = struct.unpack('<I', b[off:off + 4])[0]
        bin_ = b[off + 8:off + 8 + bl]
        def acc(i):
            a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]
            nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
            o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            return np.frombuffer(bin_, dtype=np.float32, count=a['count'] * nc, offset=o).reshape(a['count'], nc)
        for an in j['animations']:
            tracks = []
            for ch in an['channels']:
                node = j['nodes'][ch['target']['node']]['name']; path = ch['target']['path']
                s = an['samplers'][ch['sampler']]
                tracks.append((node, path, acc(s['input']).reshape(-1).copy(), acc(s['output']).copy()))
            out[an['name']] = tracks
    return out


class Writer:
    def __init__(self):
        self.bin = bytearray(); self.views = []; self.accs = []

    def add(self, arr, target=None, minmax=False, normalized=False):
        arr = np.ascontiguousarray(arr)
        while len(self.bin) % 4: self.bin.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.bin), 'byteLength': arr.nbytes}
        if target: v['target'] = target
        self.bin += arr.tobytes(); self.views.append(v)
        ct = {np.dtype('float32'): 5126, np.dtype('uint32'): 5125, np.dtype('uint16'): 5123, np.dtype('uint8'): 5121}[arr.dtype]
        nc = 1 if arr.ndim == 1 else arr.shape[1]
        a = {'bufferView': len(self.views) - 1, 'componentType': ct, 'count': arr.shape[0],
             'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4', 16: 'MAT4'}[nc]}
        if normalized: a['normalized'] = True
        if minmax: a['min'] = arr.min(0).tolist() if nc > 1 else [float(arr.min())]; a['max'] = arr.max(0).tolist() if nc > 1 else [float(arr.max())]
        self.accs.append(a); return len(self.accs) - 1


def build(name, sex, base, o, clips_src):
    S = 'Male' if sex == 'm' else 'Female'
    g = G(os.path.join(SRC, f'slim/out/{base}_{S}.gltf'))
    orig = G(os.path.join(SRC, f'src/ubc/Superhero_{S}_FullBody.gltf'))
    nodes = g.j['nodes']; names = [n['name'] for n in nodes]
    skin = g.j['skins'][0]; joints = skin['joints']; jnames = [names[i] for i in joints]
    ibm = g.acc(skin['inverseBindMatrices'])[0].reshape(-1, 4, 4).transpose(0, 2, 1)  # column-major -> rows
    keep = [k for k, n in enumerate(jnames) if n in RENAME]
    newidx = {k: i for i, k in enumerate(keep)}
    # joint remap: dropped joints fold into the nearest kept ancestor
    def kept_ancestor(k):
        ni = joints[k]
        while names[ni] not in RENAME: ni = g.parent[ni]
        return newidx[joints.index(ni)]
    remap = np.array([kept_ancestor(k) for k in range(len(joints))])
    h = 1.81 if sex == 'm' else 1.77
    body_i = max((i for i, n in enumerate(nodes) if n.get('mesh') is not None and n['name'] not in ('Eyes', 'Eyebrows')),
                 key=lambda i: g.j['accessors'][g.j['meshes'][nodes[i]['mesh']]['primitives'][0]['attributes']['POSITION']]['count'])
    eyes_i = [i for i, n in enumerate(nodes) if n.get('name') == 'Eyes'][0]
    B = prim(g, nodes[body_i]['mesh'])
    skin_img = srgb_img(os.path.join(SRC, 'src/ubc', 'T_Superhero_Male_Dark.png' if sex == 'm' else 'T_Superhero_Female_Dark_BaseColor.png'))
    n = len(B['pos']); P = B['pos'].copy(); N = B['nor']
    dom = B['j'][np.arange(n), B['w'].argmax(1)]
    col = sample(skin_img, B['uv'])
    seed = o.get('seed', 0); decay = o.get('decay', 0.0); blood = o.get('blood', 0.0); tear = o.get('tear', 0.0)
    noise = hash3(P, seed); noise2 = hash3(P * 1.7 + 3.1, seed + 11)
    if decay:  # sickly grey-green skin, darker blotches
        sick = np.array([0.20, 0.25, 0.15])
        col = col * (1 - 0.7 * decay) + sick * 0.7 * decay
        col *= (0.75 + 0.35 * noise)[:, None]
    for i in range(n):
        bn = jnames[dom[i]]; r = region(bn); v = P[i]
        if r in ('pelvis', 'top'): r = 'top' if v[1] > o['top']['hem'] * h else 'leg'
        if r == 'fore': r = 'top' if o['top']['sleeve'] == 'long' else 'hand'
        if r == 'top' and o['top']['sleeve'] == 'short' and bn.startswith('upperarm') and abs(v[0]) > 0.36 * h / 1.8: r = 'hand'
        part = o['top'] if r == 'top' else o['pants'] if r == 'leg' else o['shoes'] if r == 'foot' else None
        if part is not None and not (tear and r != 'foot' and noise2[i] < 0.12 * tear):
            c = lin(part['col'])
            # fabric grain + grime (dirt darkens towards the hem / feet)
            c = c * (0.88 + 0.2 * noise[i]) * (1 - o.get('grime', 0.3) * 0.35 * (1 - min(v[1] / h, 1)))
            col[i] = c; P[i] = v + N[i] * part.get('off', 0.012)
        if blood:
            bl = (1 if r == 'head' and v[1] < 1.62 * h / 1.8 and v[2] > 0.03 else 0.2) if r == 'head' else 0.8 if r == 'hand' else \
                 (0.6 + 0.4 * (v[1] > 1.2 * h / 1.8) if v[2] > 0 else 0.25) if r == 'top' else 0.2
            if noise2[i] * 1.4 < bl * blood: col[i] = col[i] * 0.35 + np.array([0.16, 0.012, 0.008]) * 0.65
    # hair (rigid on Head; moved by the slim Head offset), eyes
    parts = [(P, N, col, remap[B['j']], B['w'], B['idx'])]
    head_k = jnames.index('Head')
    if o.get('hair'):
        hg = G(os.path.join(SRC, f"src/hair/{o['hair']}.gltf"))
        H = prim(hg, 0)
        d = g.world(joints[head_k])[:3, 3] - orig.world(orig.j['nodes'].index(next(x for x in orig.j['nodes'] if x['name'] == 'Head')))[:3, 3]
        M = trs(hg.j['nodes'][0])  # some UBC hairs carry a cm-scale / Z-up node transform
        hp = H['pos'] @ M[:3, :3].T + M[:3, 3] + d
        hn = H['nor'] @ M[:3, :3].T
        hn /= np.linalg.norm(hn, axis=1, keepdims=True)
        hc = np.tile(lin(o['hairCol']), (len(hp), 1)) * (0.8 + 0.4 * hash3(hp, 7))[:, None]
        if decay: hc *= 0.8
        hj = np.zeros((len(hp), 4), np.int64); hj[:, 0] = newidx[head_k]
        hw = np.zeros((len(hp), 4)); hw[:, 0] = 1
        parts.append((hp, hn, hc, hj, hw, H['idx']))
    E = prim(g, nodes[eyes_i]['mesh'])
    ec = np.tile(lin('#b9b39a' if decay else '#2a211c'), (len(E['pos']), 1))
    parts.append((E['pos'], E['nor'], ec, remap[E['j']], E['w'], E['idx']))
    pos = []; nor = []; cols = []; js = []; ws = []; idx = []; off = 0
    for p, nn, c, j, w, ix in parts:
        pos.append(p); nor.append(nn); cols.append(c); js.append(j); ws.append(w); idx.append(ix + off); off += len(p)
    pos = np.vstack(pos).astype(np.float32); nor = np.vstack(nor).astype(np.float32); cols = np.vstack(cols).astype(np.float32)
    js = np.vstack(js); ws = np.vstack(ws)
    # merge duplicate joints within a vertex (fingers folded into the wrist)
    J = np.zeros_like(js); W = np.zeros_like(ws)
    for i in range(len(js)):
        acc = {}
        for k in range(4): acc[js[i, k]] = acc.get(js[i, k], 0) + ws[i, k]
        it = sorted(acc.items(), key=lambda t: -t[1])[:4]
        for k, (jj, ww) in enumerate(it): J[i, k] = jj; W[i, k] = ww
    W = (W / W.sum(1, keepdims=True)).astype(np.float32); J = J.astype(np.uint8)
    idx = np.concatenate(idx).astype(np.uint32)
    # nodes: kept joints with their slim local TRS (parents = nearest kept ancestor)
    out_nodes = []
    for k in keep:
        ni = joints[k]; src = nodes[ni]
        nd = {'name': RENAME[names[ni]]}
        for key in ('translation', 'rotation', 'scale'):
            if key in src: nd[key] = src[key]
        out_nodes.append(nd)
    kept_node = {joints[k]: i for i, k in enumerate(keep)}
    for i, k in enumerate(keep):
        ch = [kept_node[c] for c in nodes[joints[k]].get('children', []) if c in kept_node]
        if ch: out_nodes[i]['children'] = ch
    root_i = kept_node[[joints[k] for k in keep if names[joints[k]] == 'root'][0]]
    w = Writer()
    a_pos = w.add(pos, 34962, True); a_nor = w.add(nor, 34962); a_col = w.add(cols, 34962)
    a_j = w.add(J, 34962); a_w = w.add(W, 34962); a_i = w.add(idx, 34963)
    a_ibm = w.add(np.ascontiguousarray(ibm[keep].transpose(0, 2, 1)).reshape(-1, 16).astype(np.float32))
    mesh_node = len(out_nodes)
    out_nodes.append({'name': f'Char_{name}', 'mesh': 0, 'skin': 0})
    arm = len(out_nodes)
    out_nodes.append({'name': 'CharacterArmature', 'children': [root_i, mesh_node]})
    anims = []
    for dst, srcname in clips_src.items():
        rev = srcname.startswith('-'); tr = clips[srcname.lstrip('-')]
        samplers = []; channels = []
        for node, path, t, v in tr:
            if node not in RENAME or node == 'root': continue
            if path == 'translation' and node != 'pelvis': continue
            if path == 'scale': continue
            if rev: v = v[::-1].copy()
            si = len(samplers)
            samplers.append({'input': w.add(t.astype(np.float32), minmax=True), 'output': w.add(v.astype(np.float32)), 'interpolation': 'LINEAR'})
            channels.append({'sampler': si, 'target': {'node': kept_node[names.index(node)], 'path': path}})
        anims.append({'name': dst, 'samplers': samplers, 'channels': channels})
    gl = {'asset': {'version': '2.0', 'generator': 'deadzone build-real.py'},
          'scene': 0, 'scenes': [{'nodes': [arm]}], 'nodes': out_nodes,
          'meshes': [{'name': f'Char_{name}', 'primitives': [{'attributes': {'POSITION': a_pos, 'NORMAL': a_nor, 'COLOR_0': a_col, 'JOINTS_0': a_j, 'WEIGHTS_0': a_w}, 'indices': a_i, 'material': 0}]}],
          'materials': [{'name': 'Body', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0, 'roughnessFactor': 0.85}}],
          'skins': [{'joints': [kept_node[joints[k]] for k in keep], 'inverseBindMatrices': a_ibm, 'skeleton': root_i}],
          'animations': anims, 'accessors': w.accs, 'bufferViews': w.views, 'buffers': [{'byteLength': len(w.bin)}]}
    js_ = json.dumps(gl, separators=(',', ':')).encode()
    while len(js_) % 4: js_ += b' '
    while len(w.bin) % 4: w.bin.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js_) + 8 + len(w.bin)) + struct.pack('<II', len(js_), 0x4E4F534A) + js_ + struct.pack('<II', len(w.bin), 0x004E4942) + bytes(w.bin)
    open(os.path.join(OUT, f'{name}.full.glb'), 'wb').write(blob)
    print(name, 'verts', len(pos), 'tris', len(idx) // 3, 'joints', len(keep), 'clips', len(anims))


if __name__ == '__main__':
    clips = ual_clips()
    for name, sex, base, o in CHARS:
        build(name, sex, base, o, PLAYER_CLIPS if name.startswith('survivor') else ZOMBIE_CLIPS)
