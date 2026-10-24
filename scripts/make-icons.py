"""Draws the app icon (map pin + route) and writes every size the manifest, iOS and the favicon need.
Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw

BG = (17, 24, 39)        # neutral-900, matches the app's dark buttons
PIN = (255, 255, 255)
DOT = (37, 99, 235)      # founder blue
ROUTE = (250, 204, 21)   # meeting gold
S = 1024                 # draw large, then downsample for smooth edges


def draw(scale: float) -> Image.Image:
    """scale < 1 shrinks the artwork toward the centre (maskable icons need an 80% safe zone)."""
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)

    def p(x, y):
        return (S / 2 + (x - S / 2) * scale, S / 2 + (y - S / 2) * scale)

    # dashed route curving up into the pin
    pts = [(250, 820), (330, 760), (420, 735), (500, 690)]
    d.line([p(x, y) for x, y in pts], fill=ROUTE, width=int(34 * scale), joint="curve")
    d.ellipse([*p(215, 785), *p(285, 855)], fill=ROUTE)

    # pin: circle head + pointed tail
    cx, cy, r = 560, 420, 210
    d.polygon([p(cx - r * 0.82, cy + r * 0.55), p(cx + r * 0.82, cy + r * 0.55), p(cx, 820)], fill=PIN)
    d.ellipse([*p(cx - r, cy - r), *p(cx + r, cy + r)], fill=PIN)
    d.ellipse([*p(cx - 88, cy - 88), *p(cx + 88, cy + 88)], fill=DOT)
    return img


def save(img: Image.Image, size: int, path: str):
    img.resize((size, size), Image.LANCZOS).save(path)


full = draw(1.0)
safe = draw(0.78)
save(full, 192, "public/icons/icon-192.png")
save(full, 512, "public/icons/icon-512.png")
save(safe, 512, "public/icons/icon-maskable-512.png")
save(full, 180, "src/app/apple-icon.png")
# Next.js decodes the .ico's embedded PNGs and requires RGBA.
full.convert("RGBA").resize((64, 64), Image.LANCZOS).save("src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
print("icons written")
