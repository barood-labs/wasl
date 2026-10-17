# Wasl · وصل — PayPal AI Hackathon progress log
Deadline: Nov 12 2026 12:00 PM PST = 1:00 PM MST (Denver). Judging Dec 1–15, winners ~Dec 21.

## Strategy (decided)
- Idea: AI-verified sponsorship escrow for bilingual (Arabic/English) creators. Brand funds PayPal hold (Orders v2 AUTHORIZE),
  creator uploads video, Whisper + OCR + deterministic checks + LLM judge verify the brief, agent captures + splits via Payouts.
- Prize stacking rule: max 1 Grand OR 1 Honorable + 1 Sponsor. Considered for every sponsor tool used (FAQ).
- Targets: Grand (12k/8k/5k) → honorables (Most Impactful / Most Creative / Best Use of PayPal+AI / Agentic Commerce / Best Demo, $5k each)
  + AG Grid sponsor prize (5k/2k/3×1k = 5 slots; we use AG Grid Community + AG Charts Community) ; Render credits secondary (render.yaml + Dockerfile).
- Skipped: Bryntum (commercial license), Channel3 (product catalog, off-theme), APIMatic (dev-time plugin, hard to show).

## Status
- [x] Rules/prizes/judging read (see top of this file)
- [x] Server: Express, PayPal REST client (OAuth, Orders AUTHORIZE, capture, void, Payouts, webhook verify), offline simulator
- [x] AI: OpenAI-compatible LLM (Ollama local default), chat→contract + grounding (ground.js), judge, NL→AG Grid filter
- [x] Verify pipeline: ffprobe, faster-whisper, tesseract eng+ara per-second OCR (OMP_THREAD_LIMIT=1!), deterministic checks
- [x] Frontend SPA EN/AR RTL, AG Grid dashboards, evidence grid w/ click-to-seek
- [x] MCP server, README, LICENSE (MIT, "nightmare"), Dockerfile, render.yaml, .env.example, unit tests (4 pass)
- [x] Sample chat + 2 sample videos (samples/make_samples.py, edge-tts ar-LB-LaylaNeural voice)
- [x] v1 verified end-to-end on box: correctly FAILS (brand @0:18 > 15s, no NOOR20 on screen, health claim)
- [ ] v2 pass → capture → payouts (running)
- [ ] seed + demo recording (demo/record.mjs) + narration (kokoro) + edit < 3 min
- [ ] devpost_final.md
- [ ] git commit

## Box notes
- Ollama: ~/.local/ollama/bin/ollama serve (127.0.0.1:11434); models built from GGUF in ~/.local/models (pull blocked by proxy).
  qwen2.5:7b gets OOM-killed on shared box; use qwen2.5:3b (num_thread 4). Box is heavily loaded by other agents → slow (minutes per LLM call).
- Server: `cd /workspace/bounty/paypal && node server/index.js` (port 8787, PayPal simulator mode since no creds).

## 23:25 MDT update
- Fixed cross-script matching for Whisper re-segmentation ("نورك والدبرو" ≈ Noor Cold Brew); coach text template on failure.
- Demo server: PORT=8795 DATA_DIR=demo/data (8790 is taken by the box). Seeded 4 fictional deals.
- Recording running: `node demo/record.mjs http://localhost:8795 demo/build/frames` → demo/build/timeline.json (marks). Log /tmp/rec.log

## 23:30 MDT
- devpost_final.md written. demo/narration.json + demo/tts.py (kokoro af_heart, Apache-2.0) → demo/build/vo (106 s total).
- demo/edit.py (run with /workspace/bounty/tools/sdenv/bin/python) cuts frames+timeline → demo/wasl_demo.mp4.
- Grounding now fixes the deadline year (model said 2023). Take 1 recording uses the old code → shows 2023-10-30 in the grid.
- 23:45 take 2 recording started (judge guardrail + deadline fix + ask fix)
