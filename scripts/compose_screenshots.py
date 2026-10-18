"""Composites raw window captures (screenshots/raw) onto a made-up XP-style desktop for sharing."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

RAW = 'screenshots/raw/'
OUT = 'screenshots/'
W, H = 2560, 1600
random.seed(7)

def font(size, bold=False):
    for p in (['/System/Library/Fonts/Supplemental/Tahoma Bold.ttf'] if bold else []) + ['/System/Library/Fonts/Supplemental/Tahoma.ttf']:
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()

def desktop(w, h):
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):  # sky
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(40 + 90 * t), int(105 + 95 * t), int(215 + 30 * t)))
    clouds = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(clouds)
    for _ in range(26):
        cx, cy = random.randint(0, w), random.randint(0, int(h * .45))
        for _ in range(7):
            r = random.randint(40, 110)
            dx, dy = random.randint(-90, 90), random.randint(-25, 25)
            cd.ellipse([cx - r + dx, cy - r // 2 + dy, cx + r + dx, cy + r // 2 + dy], fill=(255, 255, 255, 70))
    img.paste(clouds.filter(ImageFilter.GaussianBlur(28)), (0, 0), clouds.filter(ImageFilter.GaussianBlur(28)))
    hill = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hill)
    pts = [(x, int(h * .62 - 120 * math.sin(math.pi * x / w) - 40 * math.sin(2.3 * math.pi * x / w))) for x in range(0, w + 1, 8)]
    hd.polygon(pts + [(w, h), (0, h)], fill=(70, 150, 40, 255))
    shade = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(int(h * .45), h):  # darker toward the bottom
        sd.line([(0, y), (w, y)], fill=(20, 80, 10, int(120 * (y - h * .45) / (h * .55))))
    mask = hill.getchannel('A')
    hill = Image.alpha_composite(hill, Image.composite(shade, Image.new('RGBA', (w, h), (0, 0, 0, 0)), mask))
    img = img.convert('RGBA')
    img.alpha_composite(hill)
    return img.convert('RGB')

def shadow_paste(base, win, x, y, r=22, off=(10, 14)):
    sh = Image.new('RGBA', (win.width + r * 4, win.height + r * 4), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle([r * 2, r * 2, r * 2 + win.width, r * 2 + win.height], fill=(0, 0, 0, 120))
    sh = sh.filter(ImageFilter.GaussianBlur(r))
    base.paste(sh, (x - r * 2 + off[0], y - r * 2 + off[1]), sh)
    base.paste(win, (x, y), win.convert('RGBA'))

def taskbar(base, tabs, active):
    h = 60
    tb = Image.new('RGB', (base.width, h))
    d = ImageDraw.Draw(tb)
    for y in range(h):
        t = y / h
        d.line([(0, y), (base.width, y)], fill=(int(36 + 30 * (1 - abs(t - .2) * 2)), int(94 + 40 * (1 - abs(t - .2) * 2)), int(220 - 20 * t)))
    d.rounded_rectangle([0, 0, 200, h + 20], radius=26, fill=(60, 160, 60))
    d.text((52, 12), 'start', font=font(34, True), fill='white')
    d.ellipse([16, 18, 42, 44], fill=(240, 240, 240))
    x = 230
    for i, label in enumerate(tabs):
        d.rounded_rectangle([x, 7, x + 330, h - 7], radius=5, fill=(30, 70, 190) if i == active else (60, 130, 240))
        d.text((x + 46, 18), label[:24], font=font(22, i == active), fill='white')
        tb.paste(MAN, (x + 10, 12), MAN)
        x += 345
    d.rectangle([base.width - 190, 0, base.width, h], fill=(20, 140, 230))
    d.text((base.width - 140, 17), '4:20 PM', font=font(24), fill='white')
    base.paste(tb, (0, base.height - h))

def load(name): return Image.open(RAW + name).convert('RGBA')

# small running man for the taskbar buttons, cut from the Buddy List title bar icon
MAN = load('buddylist.png').crop((14, 10, 46, 46)).resize((30, 34))

# 1) hero: buddy list + three conversation windows
img = desktop(W, H).convert('RGBA')
shadow_paste(img, load('chat-warroom.png'), 700, 70)
shadow_paste(img, load('im-dave.png'), 1110, 600)
shadow_paste(img, load('buddylist.png'), W - 540, 90)
shadow_paste(img, load('active-priya.png'), 70, 560)
taskbar(img, ["Jordan's Buddy List", 'Priya Natarajan - IM', 'Dave Kowalski - IM', '#launch-war-room'], 1)
img.convert('RGB').save(OUT + 'aim-hero.png')

# 2) sign on + buddy list
img = desktop(1800, 1500).convert('RGBA')
shadow_paste(img, load('signon.png'), 260, 200)
shadow_paste(img, load('active-buddy-list.png'), 1000, 100)
img.convert('RGB').save(OUT + 'aim-signon.png')

# 3) preferences
img = desktop(1400, 1200).convert('RGBA')
shadow_paste(img, load('active-preferences.png'), 280, 130)
img.convert('RGB').save(OUT + 'aim-prefs.png')
print('ok')
