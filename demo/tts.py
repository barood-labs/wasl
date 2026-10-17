import json, numpy as np, soundfile as sf, sys
from kokoro_onnx import Kokoro
k = Kokoro("/workspace/bounty/tools/kokoro/kokoro-v1.0.onnx", "/workspace/bounty/tools/kokoro/voices-v1.0.bin")
segs = json.load(open("narration.json"))
for s in segs:
    a, sr = k.create(s["text"], voice="af_heart", speed=1.05, lang="en-us")
    a = np.asarray(a, dtype=np.float32); idx = np.where(np.abs(a) > 0.01)[0]; a = a[max(0, idx[0]-240):idx[-1]+2400]
    a = a / (np.abs(a).max() + 1e-9) * 0.85
    sf.write(f"build/vo/{s['id']}.wav", a, sr); s["dur"] = round(len(a) / sr, 2); print(s["id"], s["dur"], flush=True)
json.dump(segs, open("build/vo/durations.json", "w"), indent=1)
print("total", sum(s["dur"] for s in segs))
