"""Blender (bpy) scene + shot list for the 60 s Porus test episode.

Porus is an original character: a lumpy olive natural sea sponge on two pale,
thin human-like legs, living in a rusted tin can on the sea floor.

Usage: python3 scene.py [first_frame] [last_frame] [step]
Renders 12 fps frames 0..671 (56 s; the last 4 s are a title card in post).
"""
import math
import sys
from pathlib import Path

import bpy
import bmesh  # noqa: E402  (must come after bpy)
import numpy as np
from mathutils import Euler, Vector

FPS = 12
HERE = Path(__file__).resolve().parent
import os
FRAMES_DIR = Path(os.environ.get("FRAMES_DIR", HERE / "build" / "frames"))
FRAMES_DIR.mkdir(parents=True, exist_ok=True)
MOUTH = np.load(HERE / "build" / "mouth.npy")
rng = np.random.default_rng(5)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 6
scene.cycles.use_adaptive_sampling = True
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 3
scene.cycles.diffuse_bounces = 2
scene.cycles.glossy_bounces = 1
scene.cycles.transmission_bounces = 1
scene.render.use_persistent_data = True
scene.cycles.denoising_prefilter = "FAST"
if os.environ.get("THREADS"):
    scene.render.threads_mode = "FIXED"
    scene.render.threads = int(os.environ["THREADS"])
scene.render.resolution_x, scene.render.resolution_y = 1920, 1080
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"


# ------------------------------------------------------------------ helpers
def mat(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (*color, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = emit_strength
    return m


def textured_mat(name, dark, light, scale, bump=0.4, rough=0.85, metal=0.0, kind="voronoi"):
    """Two-tone material driven by a procedural texture, with matching bump."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if kind == "voronoi":
        tex = nt.nodes.new("ShaderNodeTexVoronoi")
        tex.inputs["Scale"].default_value = scale
        out = tex.outputs["Distance"]
    else:
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = scale
        tex.inputs["Detail"].default_value = 8
        out = tex.outputs["Fac"]
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*dark, 1)
    ramp.color_ramp.elements[1].color = (*light, 1)
    if kind == "voronoi":
        ramp.color_ramp.elements[0].position = 0.08
        ramp.color_ramp.elements[1].position = 0.32
    else:
        ramp.color_ramp.elements[0].position = 0.35
        ramp.color_ramp.elements[1].position = 0.7
    nt.links.new(out, ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], p.inputs["Base Color"])
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = bump
    nt.links.new(out, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], p.inputs["Normal"])
    return m


def link(obj, parent=None, material=None):
    if parent is not None:
        obj.parent = parent
    if material is not None:
        obj.data.materials.clear()
        obj.data.materials.append(material)
    return obj


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


def sphere(name, r, loc, scale=(1, 1, 1), sub=3, parent=None, material=None, smooth=True):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    link(o, parent, material)
    o.location, o.scale = loc, scale
    if smooth:
        bpy.ops.object.shade_smooth()
    return o


def cylinder(name, r, depth, loc, parent=None, material=None, verts=16, cuts=0, base_origin=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    if cuts or base_origin:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        if cuts:
            vert_edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > depth * 0.9]
            bmesh.ops.subdivide_edges(bm, edges=vert_edges, cuts=cuts, use_grid_fill=False)
        if base_origin:
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, depth / 2))
        bm.to_mesh(o.data)
        bm.free()
    link(o, parent, material)
    o.location = loc
    bpy.ops.object.shade_smooth()
    return o


def displace(obj, strength, size, subsurf=0):
    if subsurf:
        s = obj.modifiers.new("sub", "SUBSURF")
        s.levels = s.render_levels = subsurf
    tex = bpy.data.textures.new(obj.name + "_n", type="CLOUDS")
    tex.noise_scale = size
    d = obj.modifiers.new("disp", "DISPLACE")
    d.texture = tex
    d.strength = strength


# ------------------------------------------------------------------ world & lights
world = bpy.data.worlds.new("sea")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.angle = math.radians(8)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = Euler((math.radians(35), math.radians(15), math.radians(20)))

red_data = bpy.data.lights.new("red", "POINT")
red_data.color = (1.0, 0.08, 0.05)
red_data.shadow_soft_size = 0.3
red = bpy.data.objects.new("red", red_data)
scene.collection.objects.link(red)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
torch_data = bpy.data.lights.new("torch", "SPOT")
torch_data.spot_size = math.radians(55)
torch_data.spot_blend = 0.6
torch_data.color = (0.75, 0.85, 1.0)
torch = bpy.data.objects.new("torch", torch_data)
scene.collection.objects.link(torch)
torch.parent = cam

# ------------------------------------------------------------------ set
sand = textured_mat("sand", (0.42, 0.36, 0.25), (0.78, 0.7, 0.52), 6, bump=0.3, kind="noise")
bpy.ops.mesh.primitive_plane_add(size=70, location=(0, 0, 0))
ground = bpy.context.active_object
link(ground, material=sand)
sub = ground.modifiers.new("sub", "SUBSURF")
sub.subdivision_type = "SIMPLE"
sub.levels = sub.render_levels = 5
displace(ground, 0.5, 4)

rust = textured_mat("rust", (0.25, 0.09, 0.03), (0.55, 0.32, 0.18), 3.5, bump=0.6, rough=0.7, metal=0.5, kind="noise")
label = textured_mat("label", (0.35, 0.08, 0.06), (0.75, 0.62, 0.45), 2.0, bump=0.2, rough=0.8, kind="noise")
HOUSE = Vector((0, 6, 0))
can = cylinder("can", 1.7, 4.6, HOUSE, material=rust, verts=48, base_origin=True)
band = cylinder("band", 1.72, 2.0, HOUSE + Vector((0, 0, 1.4)), material=label, verts=48, base_origin=True)
lid = cylinder("lid", 1.78, 0.12, HOUSE + Vector((0, 0, 4.6)), material=rust, verts=48)
dark = mat("dark", (0.0, 0.0, 0.0), rough=1.0)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, HOUSE.y - 1.66, 0.95))
doorway = bpy.context.active_object
doorway.scale = (0.95, 0.12, 1.9)
link(doorway, material=dark)
door_wood = textured_mat("door", (0.18, 0.11, 0.06), (0.36, 0.24, 0.14), 4, kind="noise")
hinge = empty("hinge", (-0.48, HOUSE.y - 1.74, 0.0))
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
door = bpy.context.active_object
link(door, hinge, door_wood)
door.location, door.scale = (0.48, 0, 0.96), (0.96, 0.08, 1.92)
window = sphere("window", 0.32, HOUSE + Vector((0.7, -1.62, 3.0)), scale=(1, 0.2, 1), material=mat("win", (1, 0.8, 0.4), emit=(1, 0.75, 0.35), emit_strength=0))
win_mat = window.data.materials[0]

kelp_mat = textured_mat("kelp", (0.05, 0.22, 0.08), (0.22, 0.5, 0.18), 5, kind="noise", rough=0.5)
kelps = []
for i in range(16):
    while True:
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(5, 14)
        pos = (r * math.cos(a), 6 + r * math.sin(a), 0)
        if pos[1] > 4 or abs(pos[0]) > 9:
            break
    k = cylinder(f"kelp{i}", 0.09, rng.uniform(4, 8), pos, material=kelp_mat, verts=6, cuts=14, base_origin=True)
    bend = k.modifiers.new("bend", "SIMPLE_DEFORM")
    bend.deform_method = "BEND"
    bend.deform_axis = "X"
    kelps.append((k, bend, rng.uniform(0, 6), rng.uniform(0.6, 1.2)))

rock_mat = textured_mat("rock", (0.18, 0.18, 0.2), (0.4, 0.4, 0.42), 3, kind="noise")
for i in range(14):
    a, r = rng.uniform(0, 2 * math.pi), rng.uniform(3.5, 16)
    o = sphere(f"rock{i}", rng.uniform(0.3, 1.0), (r * math.cos(a), 4 + r * math.sin(a), 0), scale=(1, 1, 0.6), material=rock_mat)
    displace(o, 0.3, 0.6)
coral_cols = [(0.9, 0.35, 0.45), (0.95, 0.55, 0.2), (0.6, 0.3, 0.8)]
for i in range(9):
    a, r = rng.uniform(0, 2 * math.pi), rng.uniform(3, 10)
    o = sphere(f"coral{i}", rng.uniform(0.25, 0.55), (r * math.cos(a), 5 + r * math.sin(a), 0.2), material=mat(f"c{i}", coral_cols[i % 3], rough=0.7))
    displace(o, 0.35, 0.25)

bubble_mat = mat("bubble", (0.9, 0.95, 1.0), rough=0.05, emit=(0.8, 0.9, 1.0), emit_strength=0.6)
bubbles = []
for i in range(28):
    b = sphere(f"bub{i}", rng.uniform(0.03, 0.08), (0, 0, -10), material=bubble_mat, sub=2)
    bubbles.append((b, rng.uniform(-8, 8), rng.uniform(-2, 12), rng.uniform(0, 10), rng.uniform(0.5, 1.2)))

# ------------------------------------------------------------------ Porus
sponge = textured_mat("sponge", (0.12, 0.1, 0.03), (0.55, 0.5, 0.24), 9, bump=0.9, rough=0.95)
skin = mat("skin", (0.78, 0.6, 0.52), rough=0.45)
white = mat("eyewhite", (0.92, 0.9, 0.82), rough=0.25)
black = mat("pupil", (0.0, 0.0, 0.0), rough=0.1, emit=(1.0, 0.05, 0.02), emit_strength=0.0)
mouth_mat = mat("mouth", (0.035, 0.0, 0.0), rough=0.9)
tooth_mat = mat("tooth", (0.8, 0.76, 0.6), rough=0.4)

root = empty("porus")
HIP = 1.25
head = empty("head", (0, 0, HIP), root)
body = sphere("body", 0.95, (0, 0, 0.8), scale=(1.0, 0.85, 1.12), sub=4, parent=head, material=sponge)
displace(body, 0.18, 0.35)
eyes = []
for side in (-1, 1):
    ep = empty(f"eyepivot{side}", (0.3 * side, -0.84, 1.05), head)
    ew = sphere(f"eye{side}", 0.17, (0, 0, 0), parent=ep, material=white)
    pu = sphere(f"pupil{side}", 0.07, (0, -0.14, 0), parent=ep, material=black)
    eyes.append((ep, ew, pu, side))
mouth = sphere("mouth", 0.3, (0, -0.83, 0.5), scale=(1, 0.25, 0.12), parent=head, material=mouth_mat)
teeth = []
for i in range(16):
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.035, depth=0.12, location=(0, 0, 0))
    tooth = bpy.context.active_object
    link(tooth, head, tooth_mat)
    teeth.append((tooth, 2 * math.pi * i / 16))
legs = []
for side in (-1, 1):
    hip = empty(f"hip{side}", (0.33 * side, 0, HIP), root)
    cylinder(f"thigh{side}", 0.065, 0.64, (0, 0, -0.32), parent=hip, material=skin, verts=12)
    knee = empty(f"knee{side}", (0, 0, -0.63), hip)
    sphere(f"kneecap{side}", 0.08, (0, 0, 0), parent=knee, material=skin, sub=2)
    cylinder(f"shin{side}", 0.055, 0.62, (0, 0, -0.31), parent=knee, material=skin, verts=12)
    sphere(f"foot{side}", 0.12, (0, -0.07, -0.62), scale=(0.8, 1.5, 0.45), parent=knee, material=skin, sub=2)
    legs.append((hip, knee, side))


# bake modifiers on everything that never deforms, so frames don't re-evaluate them
for o in list(bpy.data.objects):
    if o.type == "MESH" and o.modifiers and not o.name.startswith("kelp"):
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)


# ------------------------------------------------------------------ animation state
def smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def lerp(a, b, u):
    return a + (b - a) * u


def look(cam_pos, target, lens=35, roll=0.0):
    cam.location = Vector(cam_pos)
    d = Vector(target) - Vector(cam_pos)
    q = d.to_track_quat("-Z", "Y")
    e = q.to_euler()
    cam.rotation_euler = e
    if roll:
        cam.rotation_mode = "XYZ"
        cam.rotation_euler.rotate_axis("Z", math.radians(roll))
    cam_data.lens = lens


def shake(t, amt, speed=7.0):
    return Vector((amt * math.sin(t * speed * 1.3 + 1) + amt * 0.5 * math.sin(t * speed * 2.9),
                  amt * 0.6 * math.sin(t * speed * 1.7 + 2),
                  amt * math.sin(t * speed * 2.1 + 4)))


def pose_porus(pos, facing_deg, walk_phase=None, head_turn=0.0, leg_scale=1.0, lean=0.0, t=0.0, creep=0.0, f=0):
    root.location = Vector(pos)
    root.rotation_euler = Euler((0, 0, math.radians(facing_deg)))
    for hip, knee, side in legs:
        hip.location.z = HIP * leg_scale
        hip.scale = (1, 1, leg_scale)
        if walk_phase is None:
            hip.rotation_euler.x = 0
            knee.rotation_euler.x = 0
        else:
            ph = walk_phase + (0 if side < 0 else math.pi)
            hip.rotation_euler.x = 0.45 * math.sin(ph)
            knee.rotation_euler.x = -0.7 * max(0.0, math.sin(ph + 1.2))
    bob = 0.06 * abs(math.sin(walk_phase)) if walk_phase is not None else 0.0
    head.location.z = HIP * leg_scale + bob
    head.rotation_euler = Euler((math.radians(lean), 0, math.radians(head_turn)))
    # breathing pores: body swells irregularly when creepy
    pulse = 1 + creep * 0.05 * math.sin(t * 9) + creep * 0.03 * math.sin(t * 23)
    body.scale = (1.0 * pulse, 0.85 * pulse, 1.12 * (2 - pulse))
    # eyes: happy = symmetric, creepy = bigger, tiny pupils, one sagging
    blink = 1.0
    for bt in (6.5, 9.6, 13.4):
        if abs(t - bt) < 0.09:
            blink = 0.1
    for ep, ew, pu, side in eyes:
        sag = creep * (0.18 if side > 0 else -0.03)
        ep.location = (0.3 * side * (1 + 0.15 * creep), -0.84, 1.05 - sag)
        ew.scale = (1 + 0.45 * creep, 1 + 0.45 * creep, (1 + 0.45 * creep) * blink)
        ps = 1 - 0.6 * creep
        pu.scale = (ps, ps, ps * blink)
        pu.location = (0.0, -(0.17 * (1 + 0.45 * creep) - 0.012), 0)
    m = MOUTH[min(f, len(MOUTH) - 1)]
    mouth.scale = (1 + 0.2 * creep, 0.25, 0.12 + 0.5 * m * (1 + creep))
    black.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 6.0 * max(0.0, creep - 0.3)
    place_teeth(creep)


def place_teeth(creep):
    """Needle teeth around the mouth rim, only once he has turned."""
    show = creep > 0.45
    sx, sz = mouth.scale.x * 0.3, mouth.scale.z * 0.3
    for tooth, a in teeth:
        if not show:
            tooth.scale = (0, 0, 0)
            continue
        x, z = math.cos(a) * sx * 0.92, math.sin(a) * sz * 0.92
        tooth.location = (x, -0.86, 0.5 + z)
        # point toward the mouth centre
        tooth.rotation_euler = Euler((0, math.atan2(x, z) + math.pi, 0))
        tooth.scale = (1, 1, 1.4)


HIDDEN = (0, 6, -30)


def state(f):
    """Set every animated property for render frame f. Returns nothing."""
    t = f / FPS
    # global mood: 0 = sunny, 1 = full horror
    mood = smooth((t - 16) / 16) * 0.6 + (0.4 if t >= 32 else 0.0)
    bg.inputs["Color"].default_value = (lerp(0.12, 0.004, mood), lerp(0.42, 0.01, mood), lerp(0.62, 0.02, mood), 1)
    bg.inputs["Strength"].default_value = lerp(1.0, 0.25, mood)
    sun_data.energy = lerp(4.0, 0.05, mood)
    sun_data.color = (1.0, lerp(0.95, 0.7, mood), lerp(0.85, 0.6, mood))
    red_data.energy = 0.0 if t < 32 else 220.0 * (0.85 + 0.15 * math.sin(t * 31) * math.sin(t * 7))
    torch_data.energy = 0.0 if t < 32 else 900.0
    win_mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 3.0 if t < 16 else (0.0 if t > 28 else 3.0 * (1 - smooth((t - 16) / 8)))
    for k, bend, ph, sp in kelps:
        bend.angle = (0.35 - 0.3 * mood) * math.sin(t * sp + ph)
    for b, x, y, ph, sp in bubbles:
        z = ((t * sp + ph) % 10) if mood < 0.5 else -10
        b.location = (x + 0.2 * math.sin(t * 2 + ph), y, z)
    # door: opens 4-5 s, shut after 8 s, creaks open 28-32 s, open after
    if t < 4:
        door_a = 0
    elif t < 8:
        door_a = 105 * smooth((t - 4) / 0.8)
    elif t < 28:
        door_a = 0
    else:
        door_a = 80 * smooth((t - 28) / 3.5)
    hinge.rotation_euler.z = math.radians(-door_a)
    red.location = (0, 0, -20)

    # ---------------- shots
    if t < 4:  # 1. establishing: slow dolly toward the can house
        u = t / 4
        pose_porus(HIDDEN, 0, t=t, f=f)
        look((lerp(-7, -4.5, u), lerp(-8, -5.5, u), lerp(3.5, 2.6, u)), (0, 5, 1.8), 28)
    elif t < 8:  # 2. Porus steps out of the door, tracking medium shot
        u = (t - 4) / 4
        walk = smooth((u - 0.2) / 0.8)
        y = lerp(4.1, 1.6, walk)
        pose_porus((0, y, 0), 0, walk_phase=(t * 7 if 0.2 < u < 1 else None), t=t, f=f)
        look((2.6, y - 5.2, 1.9), (0, y, 1.6), 32)
    elif t < 12:  # 3. close-up, says hi (mouth synced)
        u = (t - 8) / 4
        pose_porus((0, 1.6, 0), 0, t=t, f=f)
        look((0.15, 1.6 - lerp(3.4, 2.9, u), 2.2), (0, 1.6, 2.05), 45)
    elif t < 16:  # 4. hops along, low-angle tracking from the side
        u = (t - 12) / 4
        x = lerp(0, 4, u)
        pose_porus((x, 1.6, 0), 90 * smooth(u * 4), walk_phase=t * 8, t=t, f=f)
        look((x - 1.5, -2.6, 0.5), (x + 0.4, 1.6, 1.6), 24)
    elif t < 20:  # 5. stops. wide, static, too still
        pose_porus((4, 1.6, 0), 90, t=t, f=f)
        look((-1.5, -6.5, 2.2), (3.6, 2.2, 1.6), 30)
    elif t < 24:  # 6. slow push-in on his back; head turns 180 while the legs stay put
        u = (t - 20) / 4
        pose_porus((4, 1.6, 0), 90, head_turn=-180 * smooth((u - 0.25) / 0.75), t=t, creep=0.4 * u, f=f)
        look((lerp(-1.5, 0.2, u), lerp(1.0, 1.4, u), 2.1), (4, 1.6, 2.0), 35)
    elif t < 28:  # 7. extreme close-up on the eyes, creepy line
        u = (t - 24) / 4
        pose_porus((4, 1.6, 0), 90, head_turn=-180, t=t, creep=lerp(0.5, 1.0, u), f=f)
        look((4 - lerp(4.2, 3.3, u), 1.6 + 0.05, 2.3), (4 - 0.9, 1.6, 2.25), 70, roll=lerp(0, -6, u))
    elif t < 32:  # 8. dutch angle on the house as the door creaks open by itself
        u = (t - 28) / 4
        pose_porus(HIDDEN, 0, t=t, f=f)
        look((lerp(-2.6, -2.2, u), 0.6, 1.2), (0, 4.4, 1.6), 30, roll=14)
    elif t < 44:  # 9-11. same frame, he is closer on every cut
        stage = int((t - 32) // 4)
        y = [4.0, 0.0, -3.4][stage]
        x = [0.0, -1.6, -3.2][stage]
        pose_porus((x, y, 0), 0, t=t, creep=1.0, leg_scale=1 + 0.15 * stage, f=f)
        cpos = Vector((-5.5, -6.5, 1.6)) + shake(t, 0.015)
        look(cpos, (-1.0, 2.0, 1.7), 30)
        red.location = (x + 0.6, y - 1.2, 1.2)
    elif t < 49:  # 12. handheld, backing away; his legs keep stretching
        u = (t - 44) / 5
        ls = lerp(1.3, 2.7, smooth(u))
        y = lerp(-3.4, -6.0, u)
        pose_porus((-3.2, y, 0), 0, walk_phase=t * 3.5, leg_scale=ls, lean=lerp(0, 25, u), t=t, creep=1.0, f=f)
        cpos = Vector((-3.0, y - lerp(4.5, 3.2, u), 1.5)) + shake(t, 0.08, 9)
        look(cpos, (-3.2, y, HIP * ls + 0.6), 26, roll=6 * math.sin(t * 1.3))
        red.location = (-2.0, y - 0.5, 0.6)
    elif t < 54:  # 13. extreme close-up, mouth opens far too wide
        u = (t - 49) / 5
        pose_porus((0, 1.6, 0), 0, t=t, creep=1.0, f=f)
        mouth.scale = (1.3 + 0.4 * smooth(u), 0.3, 0.15 + 1.6 * smooth(u))
        place_teeth(1.0)
        cpos = Vector((0.05, 1.6 - lerp(3.4, 2.4, u), 1.75)) + shake(t, 0.01, 11)
        look(cpos, (0, 1.6, 1.85), 50, roll=-8)
        red.location = (0.9, 0.6, 1.6)
    else:  # 14. glitch shot: eyes, rolling camera (post adds the glitch)
        u = (t - 54) / 2
        pose_porus((0, 1.6, 0), 0, t=t, creep=1.0, f=f)
        look((0, 1.6 - 3.4, 2.25), (0, 1.6, 2.2), 42, roll=40 * u)
        red.location = (0.6, 0.8, 2.4)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    a = int(argv[0]) if len(argv) > 0 else 0
    b = int(argv[1]) if len(argv) > 1 else 56 * FPS - 1
    step = int(argv[2]) if len(argv) > 2 else 1
    import time
    for f in range(a, b + 1, step):
        out = FRAMES_DIR / f"f{f:04d}.png"
        if out.exists():
            continue
        t0 = time.time()
        state(f)
        scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        print(f"frame {f} {time.time() - t0:.1f}s", flush=True)
