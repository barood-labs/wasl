#!/usr/bin/env python3
"""Generates the two demo creator videos (fictional brand "Noor Cold Brew").
v1 breaks the contract (brand named too late, promo code never on screen, health claim);
v2 fulfils it. Voice: edge-tts (synthetic). Visuals: drawn with Pillow. Requires ffmpeg."""
import asyncio, json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import edge_tts

W, H, FPS = 720, 1280, 24
AR = "/usr/share/fonts/truetype/sand-box/google/Noto Sans Arabic/NotoSansArabic-VariableFont_wdth,wght.ttf"
EN = "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf"
VOICE = "ar-LB-LaylaNeural"

def font(path, size, weight="Bold"):
    f = ImageFont.truetype(path, size)
    try: f.set_variation_by_name(weight)
    except Exception: pass
    return f

V2 = [
    ("مرحبا يا جماعة! اليوم جربت Noor Cold Brew الجديدة.", "Hi everyone! Today I tried the new Noor Cold Brew.", "can"),
    ("قهوة باردة جاهزة، طعمها ناعم، وبدون سكر مضاف.", "Ready-to-drink cold brew. Smooth, with no added sugar.", "can"),
    ("بشربها الصبح قبل الشغل، وبعد التمرين.", "I drink it in the morning before work, and after training.", "morning"),
    ("شوفوا العلبة، تصميمها حلو كتير.", "Look at the can, the design is so nice.", "can_big"),
    ("استخدموا كود NOOR20 وخذوا خصم عشرين بالمية.", "Use code NOOR20 for 20% off.", "code"),
    ("هذا الفيديو إعلان برعاية Noor Coffee. جربوها وقولولي رأيكم!", "#ad — sponsored by Noor Coffee. Try it and tell me what you think!", "code"),
]
V1 = [
    ("صباح الخير! خلوني أحكيلكم عن روتيني الصباحي.", "Good morning! Let me tell you about my morning routine.", "morning"),
    ("بصحى بكير، بفتح الشباك، وبرتب مكتبي قبل ما أبلش الشغل.", "I wake up early, open the window, and tidy my desk before work.", "morning"),
    ("وبعدين بحضر فطور خفيف، وبقرأ شوي.", "Then I make a light breakfast and read a little.", "morning"),
    ("وأهم شي، Noor Cold Brew الجديدة.", "And most importantly, the new Noor Cold Brew.", "can"),
    ("هاي القهوة بتخليك تخسر وزن بسرعة وبتقوي المناعة!", "This coffee makes you lose weight fast and boosts your immunity!", "can_big"),
    ("استخدموا كود NOOR20 للخصم.", "Use my code for a discount — link in bio.", "can", "استخدموا الكود تبعي للخصم"),
]

def bg(kind, t):
    top, bot = {"morning": ((250, 214, 165), (196, 120, 70)), "code": ((24, 33, 74), (52, 28, 18))}.get(kind, ((60, 36, 24), (16, 10, 8)))
    img = Image.new("RGB", (W, H)); d = ImageDraw.Draw(img)
    for y in range(H):
        a = y / H; d.line([(0, y), (W, y)], fill=tuple(int(top[i] * (1 - a) + bot[i] * a) for i in range(3)))
    return img

def draw_can(img, cx, cy, scale, t):
    d = ImageDraw.Draw(img, "RGBA")
    w, h = int(220 * scale), int(400 * scale)
    x0, y0 = cx - w // 2, cy - h // 2
    d.ellipse([x0 - 20, y0 + h - 30, x0 + w + 20, y0 + h + 40], fill=(0, 0, 0, 90))
    d.rounded_rectangle([x0, y0, x0 + w, y0 + h], radius=int(40 * scale), fill=(18, 30, 80, 255))
    d.rectangle([x0 + 8, y0 + int(h * .28), x0 + w - 8, y0 + int(h * .72)], fill=(242, 193, 78, 255))
    d.rounded_rectangle([x0 + 10, y0 - 10, x0 + w - 10, y0 + 24], radius=12, fill=(200, 205, 215, 255))
    d.text((cx, y0 + int(h * .42)), "NOOR", font=font(EN, int(58 * scale), "Black"), fill=(18, 30, 80), anchor="mm")
    d.text((cx, y0 + int(h * .58)), "نور", font=font(AR, int(52 * scale)), fill=(18, 30, 80), anchor="mm")
    d.text((cx, y0 + int(h * .82)), "COLD BREW", font=font(EN, int(24 * scale), "SemiBold"), fill=(242, 193, 78), anchor="mm")
    hl = int(w * .18); d.rounded_rectangle([x0 + hl, y0 + 30, x0 + hl + 14, y0 + h - 40], radius=7, fill=(255, 255, 255, 50))

def frame(scene, ar, en, t, show_code):
    img = bg(scene, t)
    d = ImageDraw.Draw(img, "RGBA")
    if scene == "morning":
        d.ellipse([W - 260, 120, W - 60, 320], fill=(255, 240, 200, 220))
        d.rounded_rectangle([90, 640, W - 90, 700], radius=12, fill=(120, 70, 40, 200))
        draw_can(img, W // 2 + 150, 560, .45, t)
    elif scene in ("can", "can_big", "code"):
        s = .95 if scene == "can_big" else .75
        bob = int(8 * __import__("math").sin(t * 2.2))
        draw_can(img, W // 2, 520 + bob if scene != "code" else 470 + bob, s if scene != "code" else .6, t)
    if show_code:
        d.rounded_rectangle([110, 770, W - 110, 900], radius=26, fill=(255, 255, 255, 240))
        d.text((W // 2, 805), "PROMO CODE", font=font(EN, 26, "SemiBold"), fill=(90, 90, 110), anchor="mm")
        d.text((W // 2, 858), "NOOR20", font=font(EN, 64, "Black"), fill=(20, 32, 90), anchor="mm")
    d.text((40, 50), "@layla.creates", font=font(EN, 26, "SemiBold"), fill=(255, 255, 255, 230))
    # Arabic line + English subtitle
    d.rounded_rectangle([30, 960, W - 30, 1210], radius=22, fill=(0, 0, 0, 150))
    d.text((W // 2, 1015), ar, font=font(AR, 30), fill=(255, 255, 255), anchor="mm", direction="rtl", language="ar") if len(ar) < 38 else None
    if len(ar) >= 38:
        words = ar.split(); half = len(words) // 2
        for i, line in enumerate([" ".join(words[:half]), " ".join(words[half:])]):
            d.text((W // 2, 995 + i * 44), line, font=font(AR, 30), fill=(255, 255, 255), anchor="mm", direction="rtl", language="ar")
    # wrap English
    f = font(EN, 28, "SemiBold"); words = en.split(); lines = [""]
    for w_ in words:
        if d.textlength((lines[-1] + " " + w_).strip(), font=f) > W - 110: lines.append(w_)
        else: lines[-1] = (lines[-1] + " " + w_).strip()
    for i, line in enumerate(lines[:3]):
        d.text((W // 2, 1100 + i * 38), line, font=f, fill=(255, 226, 140), anchor="mm")
    return img

async def tts(text, path):
    await edge_tts.Communicate(text, VOICE, rate="+4%").save(path)

def dur(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).decode())

def build(lines, out, code_from):
    tmp = tempfile.mkdtemp()
    clips, t0, timeline = [], 0.0, []
    for i, (ar, en, scene, *disp) in enumerate(lines):
        mp3 = os.path.join(tmp, f"l{i}.mp3"); asyncio.run(tts(ar, mp3))
        d = dur(mp3) + 0.45
        timeline.append((t0, d, disp[0] if disp else ar, en, scene, i >= code_from)); clips.append((mp3, d)); t0 += d
    # audio: concat with padding
    filt = "".join(f"[{i}:a]apad=whole_dur={d:.3f}[a{i}];" for i, (_, d) in enumerate(clips)) + "".join(f"[a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=0:a=1[out]"
    wav = os.path.join(tmp, "a.wav")
    subprocess.run(["ffmpeg", "-y", "-v", "error", *sum([["-i", c] for c, _ in clips], []), "-filter_complex", filt, "-map", "[out]", "-ar", "44100", wav], check=True)
    p = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-i", wav,
                          "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    n = int(t0 * FPS)
    cache = {}
    for k in range(n):
        t = k / FPS
        seg = next(s for s in timeline if s[0] <= t < s[0] + s[1] or s is timeline[-1])
        key = (timeline.index(seg), int(t * 6))  # re-render 6x/s for the bob animation
        if key not in cache:
            cache.clear(); cache[key] = frame(seg[4], seg[2], seg[3], t, seg[5]).tobytes()
        p.stdin.write(cache[key])
    p.stdin.close(); p.wait()
    print(out, f"{t0:.1f}s", json.dumps([(round(s[0], 1), s[3]) for s in timeline]))

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    build(V1, os.path.join(here, "noor_v1.mp4"), code_from=99)
    build(V2, os.path.join(here, "noor_v2.mp4"), code_from=4)
