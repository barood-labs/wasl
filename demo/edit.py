#!/usr/bin/env python3
"""Cuts the screencast (build/frames + build/timeline.json) into the final demo video with narration,
captions, title/end cards and an original synthesized music bed. Long waits are sped up and labelled."""
import json, math, os, subprocess, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(HERE, "build")
W, H, FPS = 1920, 1080, 30
EN = "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf"
AR = "/usr/share/fonts/truetype/sand-box/google/Noto Sans Arabic/NotoSansArabic-VariableFont_wdth,wght.ttf"
def font(p, s, w="Bold"):
    f = ImageFont.truetype(p, s)
    try: f.set_variation_by_name(w)
    except Exception: pass
    return f

tl = json.load(open(os.path.join(B, "timeline.json")))
frames = tl["frames"]; M = {m["name"]: m["t"] for m in tl["marks"]}
ftimes = np.array([f["t"] for f in frames])
vo = {s["id"]: s for s in json.load(open(os.path.join(B, "vo", "durations.json")))}

def m(name, d=0): return M[name] + d
# segment: (voice id, [(src_a, src_b, seconds|None)])  None = share the remaining time
SEGS = [
    ("s1", "TITLE"),
    ("s2", [(m("dashboard"), m("new"), None)]),
    ("s3", [(m("new"), m("extract_start", 1.5), None), (m("extract_start", 1.5), m("extract_done"), 2.5), (m("extract_done"), m("deal_created"), None)]),
    ("s4", [(m("deal_created", -1), m("funded", 2.5), None)]),
    ("s5", [(m("v1_start", -0.5), m("v1_start", 2), None), (m("v1_start", 2), m("v1_done"), 3.0), (m("v1_done"), m("feedback", 1), None)]),
    ("s6", [(m("v2_start", -0.5), m("v2_start", 2), None), (m("v2_start", 2), m("v2_done"), 2.5), (m("v2_done"), m("dashboard2"), None)]),
    ("s7", [(m("dashboard2"), m("ask_start", 0.5), None), (m("ask_start", 0.5), m("ask_done"), 1.5), (m("ask_done"), m("arabic", -1), None)]),
    ("s8", [(m("arabic", -1), m("end"), None)]),
    ("s9", "END"),
]

def card(kind):
    img = Image.new("RGB", (W, H)); d = ImageDraw.Draw(img)
    for y in range(H):
        a = y / H; d.line([(0, y), (W, y)], fill=(int(13 + 14 * a), int(29 + 30 * a), int(77 + 60 * a)))
    d.rounded_rectangle([W//2 - 70, 250, W//2 + 70, 390], radius=36, fill=(242, 193, 78))
    d.text((W//2, 318), "و", font=font(AR, 96), fill=(20, 43, 111), anchor="mm")
    d.text((W//2, 480), "Wasl  ·  وصل", font=font(EN, 110, "ExtraBold"), fill="white", anchor="mm")
    d.text((W//2, 590), "Get paid the moment your video delivers", font=font(EN, 46, "Medium"), fill=(201, 213, 255), anchor="mm")
    sub = "AI-verified sponsorship escrow for bilingual creators  ·  built on PayPal" if kind == "TITLE" else "PayPal Orders · Payments · Payouts · Webhooks   |   Whisper · OCR · LLM   |   AG Grid · MCP"
    d.text((W//2, 680), sub, font=font(EN, 32, "Regular"), fill=(170, 185, 230), anchor="mm")
    if kind == "END": d.text((W//2, 800), "Open source (MIT) · PayPal sandbox · no real money moved", font=font(EN, 28, "Regular"), fill=(150, 165, 210), anchor="mm")
    return img

def src_frame(t):
    i = int(np.searchsorted(ftimes, t, side="right")) - 1
    return os.path.join(B, "frames", frames[max(0, i)]["file"])

capf = font(EN, 34, "SemiBold"); tagf = font(EN, 28, "Bold")
def caption_chunks(text, dur):
    words = text.split(); chunks, cur = [], []
    for w in words:
        cur.append(w)
        if len(" ".join(cur)) > 62 or w.endswith((".", ",", ":", "?")) and len(" ".join(cur)) > 30: chunks.append(" ".join(cur)); cur = []
    if cur: chunks.append(" ".join(cur))
    tot = sum(len(c) for c in chunks); out, t = [], 0.0
    for c in chunks: d = dur * len(c) / tot; out.append((t, t + d, c)); t += d
    return out

def overlay(img, cap, speed):
    d = ImageDraw.Draw(img, "RGBA")
    if cap:
        tw = d.textlength(cap, font=capf)
        d.rounded_rectangle([W/2 - tw/2 - 28, H - 120, W/2 + tw/2 + 28, H - 52], radius=18, fill=(10, 18, 45, 215))
        d.text((W/2, H - 86), cap, font=capf, fill="white", anchor="mm")
    if speed > 1.6:
        label = f"⏩ sped up ×{round(speed)}"
        d.rounded_rectangle([W - 330, 110, W - 40, 166], radius=14, fill=(242, 193, 78, 235))
        d.text((W - 185, 138), label, font=tagf, fill=(20, 43, 111), anchor="mm")
    return img

proc = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p", os.path.join(B, "video.mp4")], stdin=subprocess.PIPE)
audio_events, T = [], 0.0
cache = {}
for vid, spec in SEGS:
    nar = vo[vid]["dur"]; seg_dur = nar + (1.2 if vid not in ("s1", "s9") else 1.6)
    audio_events.append((T + 0.35, os.path.join(B, "vo", f"{vid}.wav")))
    caps = caption_chunks(next(s["text"] for s in json.load(open(os.path.join(HERE, "narration.json"))) if s["id"] == vid), nar)
    n = int(round(seg_dur * FPS))
    if isinstance(spec, str):
        base = card(spec)
        for k in range(n):
            t = k / FPS - 0.35; cap = next((c for a, b, c in caps if a <= t < b), "")
            proc.stdin.write(overlay(base.copy(), cap if spec == "TITLE" else "", 1).tobytes())
    else:
        fixed = sum(s for _, _, s in spec if s); free = [b - a for a, b, s in spec if not s]
        remaining = max(1.0, seg_dur - fixed)
        plan = [(a, b, s if s else remaining * (b - a) / max(1e-6, sum(free))) for a, b, s in spec]
        for k in range(n):
            t = k / FPS; acc = 0.0
            for a, b, dd in plan:
                if t < acc + dd or (a, b, dd) == plan[-1]:
                    u = min(1.0, (t - acc) / dd); src = a + u * (b - a); speed = (b - a) / dd; break
                acc += dd
            f = src_frame(src)
            if f not in cache:
                cache.clear(); cache[f] = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS)
            tc = t - 0.35; cap = next((c for a_, b_, c in caps if a_ <= tc < b_), "")
            proc.stdin.write(overlay(cache[f].copy(), cap, speed).tobytes())
    T += n / FPS
proc.stdin.close(); proc.wait()

# audio: narration + quiet original pad
sr = 24000; mix = np.zeros(int((T + 1) * sr), np.float32)
for start, path in audio_events:
    with wave.open(path) as w: a = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768 if w.getsampwidth() == 2 else None
    if a is None:
        import soundfile as sf; a, _ = sf.read(path, dtype="float32")
    i = int(start * sr); mix[i:i + len(a)] += a[: len(mix) - i]
t = np.arange(len(mix)) / sr
chords = [[220.0, 277.18, 329.63], [196.0, 246.94, 293.66], [174.61, 220.0, 261.63], [196.0, 246.94, 329.63]]
pad = np.zeros_like(mix)
for ci, ch in enumerate(chords * int(T // 32 + 2)):
    a0, a1 = ci * 8.0, ci * 8.0 + 8.6
    sel = (t >= a0) & (t < a1)
    if not sel.any(): continue
    tt = t[sel] - a0; env = np.minimum(1, tt / 1.5) * np.minimum(1, (8.6 - tt) / 1.5)
    pad[sel] += env * sum(np.sin(2 * np.pi * f * t[sel]) * 0.33 + 0.12 * np.sin(2 * np.pi * f * 2 * t[sel]) for f in ch)
pad *= 0.035 / (np.abs(pad).max() + 1e-9) * 1.0
fade = np.minimum(1, np.minimum(t / 2, (T + 1 - t) / 2)).astype(np.float32)
mix = (mix + pad * fade); mix = mix / max(1.0, np.abs(mix).max() / 0.95)
import soundfile as sf
sf.write(os.path.join(B, "audio.wav"), mix, sr)
out = os.path.join(HERE, "wasl_demo.mp4")
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", os.path.join(B, "video.mp4"), "-i", os.path.join(B, "audio.wav"), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out], check=True)
print(out, round(T, 1), "s")
