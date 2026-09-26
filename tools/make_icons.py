"""Draw the home-screen icons in icons/ from the design's own colours.

A house in the board's dark ink with a terracotta door, on the page background.
Drawn at 1024px and scaled down, so the edges are smooth at every size.

    uv run --with pillow python tools/make_icons.py

  icon-192.png, icon-512.png  - browsers and Android ("any")
  maskable-512.png            - Android launchers that crop to a circle or
                                squircle; the house shrinks into the safe zone
  apple-touch-icon.png        - iPhone and iPad home screen, 180px
"""
from pathlib import Path
from PIL import Image, ImageDraw

BG = "#F1EDE6"      # --bg
INK = "#2F2A24"     # --dark
DOOR = "#B4603C"    # --terracotta
BIG = 1024
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(scale):
    """The house, sized so `scale` = 1 fills the middle of the square."""
    img = Image.new("RGB", (BIG, BIG), BG)
    d = ImageDraw.Draw(img)

    def p(x, y):  # unit coordinates, scaled about the centre
        return (BIG * (0.5 + (x - 0.5) * scale), BIG * (0.5 + (y - 0.5) * scale))

    house = [p(0.5, 0.22), p(0.78, 0.44), p(0.78, 0.78), p(0.22, 0.78), p(0.22, 0.44)]
    d.polygon(house, fill=INK)
    # The same outline drawn thick with curved joins rounds every corner. It
    # starts and ends mid-floor: a line's own ends get no join, so starting at
    # a corner would leave that corner notched.
    floor_mid = p(0.5, 0.78)
    outline = [floor_mid, house[3], house[4], house[0], house[1], house[2], floor_mid]
    d.line(outline, fill=INK, width=int(BIG * 0.05 * scale), joint="curve")

    # The door: a rectangle under a semicircle, standing on the floor line.
    left, right = p(0.435, 0)[0], p(0.565, 0)[0]
    top, floor = p(0, 0.60)[1], p(0, 0.78)[1] + BIG * 0.025 * scale
    r = (right - left) / 2
    d.rectangle([left, top, right, floor], fill=DOOR)
    d.ellipse([left, top - r, right, top + r], fill=DOOR)
    return img


def save(img, name, size):
    img.resize((size, size), Image.LANCZOS).save(OUT / name, optimize=True)
    print(f"  {name:<22} {size}px")


OUT.mkdir(exist_ok=True)
plain = draw(1.0)
save(plain, "icon-192.png", 192)
save(plain, "icon-512.png", 512)
save(plain, "apple-touch-icon.png", 180)
# A maskable icon may be cropped to a circle of 80% width; keep the house inside it.
save(draw(0.78), "maskable-512.png", 512)
