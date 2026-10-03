"""Pre-render a satellite photo per hole, registered to the hole frame (u along the hole, v to the right),
from the free Esri World Imagery tiles. Output: JPEGs in <outdir>/h<N>.jpg and a photos.json with their extents."""
import json, math, os, sys, time, urllib.request
from PIL import Image
course_file, outdir, photos_json = sys.argv[1:4]
course = json.load(open(course_file))
os.makedirs(outdir, exist_ok=True)
cache = os.path.join(os.path.dirname(photos_json), "tiles"); os.makedirs(cache, exist_ok=True)
Z, PX_PER_YD, YPM = 19, 2.2, 1.09361
TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ATTRIB = "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community"

def to_ll(h, u, v):
    g = h["geo"]; mu, mv = u / YPM, v / YPM
    x, y = mu * g["fx"] + mv * g["fy"], mu * g["fy"] - mv * g["fx"]
    return g["lat"] + y / 110540, g["lon"] + x / (111320 * math.cos(math.radians(g["lat"])))
def merc_px(lat, lon):  # global pixel coords at zoom Z
    n = 2 ** Z * 256
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
def tile(x, y):
    p = os.path.join(cache, f"{Z}_{x}_{y}.jpg")
    if not os.path.exists(p):
        for t in range(5):
            try:
                req = urllib.request.Request(TILE.format(z=Z, x=x, y=y), headers={"User-Agent": "GolfTripOS-prototype/0.1"})
                with urllib.request.urlopen(req, timeout=30) as r: open(p, "wb").write(r.read())
                break
            except Exception as e:
                time.sleep(1.5)
                if t == 4: raise
    return Image.open(p).convert("RGB")

photos = {}
for num, h in sorted(course["holes"].items(), key=lambda kv: int(kv[0])):
    if "geo" not in h: continue
    u0, u1, v0, v1 = -30.0, h["length"] + 50.0, -110.0, 110.0
    W, H = int((u1 - u0) * PX_PER_YD), int((v1 - v0) * PX_PER_YD)
    corners = [(u0, v0), (u1, v0), (u0, v1), (u1, v1)]
    mp = [merc_px(*to_ll(h, u, v)) for u, v in corners]
    xs, ys = [p[0] for p in mp], [p[1] for p in mp]
    tx0, tx1, ty0, ty1 = int(min(xs) // 256), int(max(xs) // 256), int(min(ys) // 256), int(max(ys) // 256)
    mosaic = Image.new("RGB", ((tx1 - tx0 + 1) * 256, (ty1 - ty0 + 1) * 256))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            mosaic.paste(tile(tx, ty), ((tx - tx0) * 256, (ty - ty0) * 256))
    ox, oy = tx0 * 256, ty0 * 256
    # output pixel (X right = +u, Y down = +v) -> mosaic pixel, as an affine fit through three corners
    def src(X, Y):
        u, v = u0 + X / PX_PER_YD, v0 + Y / PX_PER_YD
        px, py = merc_px(*to_ll(h, u, v)); return px - ox, py - oy
    (ax, ay), (bx, by), (cx, cy) = src(0, 0), src(W, 0), src(0, H)
    a, b, c = (bx - ax) / W, (cx - ax) / H, ax
    d, e, f = (by - ay) / W, (cy - ay) / H, ay
    img = mosaic.transform((W, H), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BILINEAR)
    # the hole picture draws u upward on screen, so store the photo with u along X and v along Y as computed (renderer rotates)
    name = f"h{num}.jpg"; img.save(os.path.join(outdir, name), "JPEG", quality=80, optimize=True)
    photos[num] = {"src": f"courses/pinehurst-4/{name}", "u0": u0, "u1": u1, "v0": v0, "v1": v1, "attribution": ATTRIB}
    print(f"hole {num}: {W}x{H}px from {(tx1-tx0+1)*(ty1-ty0+1)} tiles → {os.path.getsize(os.path.join(outdir, name))//1024} KB")
json.dump(photos, open(photos_json, "w"))
