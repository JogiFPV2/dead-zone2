"""Blender (4.2) export of the CC0 pigeon by mujtaba-io (opengameart.org) to glTF.

Run by `assets animal-sources` (env BLENDER):
  blender -b genuinely-my-pigeon-extended-furthur.blend --python pigeon-export.py -- out.glb

The source only has flight poses (wings spread even in `idle-animation`), so a perched clip is
added: `perch-animation` = the idle clip with both wings folded back along the body and
lowered over the flanks, and the tail fan closed (narrowed sideways).
"""

import sys

import bpy
from mathutils import Matrix

out = sys.argv[sys.argv.index("--") + 1]
for o in list(bpy.data.objects):
    if o.name not in {"pigeon-model", "pigeon-armature"}:
        bpy.data.objects.remove(o, do_unlink=True)

arm = bpy.data.objects["pigeon-armature"]
perch = bpy.data.actions["idle-animation"].copy()
perch.name = "perch-animation"
for fc in list(perch.fcurves):
    if "wing" in fc.data_path:
        perch.fcurves.remove(fc)
arm.animation_data_create()
arm.animation_data.action = perch
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()

YAW, DROOP, TIP = 1.5, 0.9, 0.25  # rad: back along the body, down over the flank, tip inwards


def about(head, rot):
    return Matrix.Translation(head) @ rot @ Matrix.Translation(-head)


for side, s in (("right", 1), ("left", -1)):
    upper = arm.pose.bones[f"{side}-wing-1"]
    upper.matrix = (
        about(upper.head.copy(), Matrix.Rotation(-s * YAW, 4, "Z") @ Matrix.Rotation(s * DROOP, 4, "Y"))
        @ upper.matrix
    )
    bpy.context.view_layer.update()
    lower = arm.pose.bones[f"{side}-wing-2"]
    lower.matrix = about(lower.head.copy(), Matrix.Rotation(-s * TIP, 4, "Z")) @ lower.matrix
    bpy.context.view_layer.update()
    for pb in (upper, lower):
        pb.rotation_mode = "QUATERNION"
        for f in (0, 12):
            pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
            pb.keyframe_insert("location", frame=f, group=pb.name)

tail = arm.pose.bones["tail-bone-1"]
tail.scale = (0.4, 1.0, 0.7)
for f in (0, 12):
    tail.keyframe_insert("scale", frame=f, group=tail.name)

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_yup=True,
    export_force_sampling=True,
)
