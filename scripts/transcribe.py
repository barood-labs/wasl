#!/usr/bin/env python3
"""Transcribe a video/audio file with faster-whisper (local, free). Prints JSON to stdout.
Usage: transcribe.py <media> [model]   (model: tiny|base|small|medium, default small)"""
import json, subprocess, sys
import numpy as np
from faster_whisper import WhisperModel

media = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
# Decode with ffmpeg (avoids PyAV version issues) -> 16 kHz mono float32
pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", media, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True, check=True).stdout
audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
model = WhisperModel(model_name, device="cpu", compute_type="int8", cpu_threads=int(__import__("os").environ.get("WHISPER_THREADS", "4")))
segments, info = model.transcribe(audio, beam_size=5, vad_filter=True, word_timestamps=False,
                                  multilingual=True, condition_on_previous_text=False)
out = {"language": info.language, "language_probability": round(info.language_probability, 3),
       "duration": round(info.duration, 2), "segments": []}
for s in segments:
    out["segments"].append({"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()})
print(json.dumps(out, ensure_ascii=False))
