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
- 00:05 take 3 started: deliverable grounding (duration/window/code/subtitles/show-clearly), temperature 0 + seed 7. take 2 failed: model said 60–90s.
- 00:08 take 3: contract extracted correctly (6 deliverables, 75/15/10, 30–90s, 2026-10-30); v1 verifying
- 00:15 take 3: v1 failed correctly, v2 passed → paid out; ask step running
- 00:20 take 3 main part saved (frames + timeline.json up to ask_start). keyboard.type is swallowed in headless → use fill(). Recording dashboard part separately: PART=dashboard → demo/build/framesB + build/timeline.json?? (see below)
- 00:25 take-3 timeline reconstructed from frame mtimes → demo/build/timeline_frames.json. Dashboard part re-recording → timeline_framesB.json
- 00:31 dashboard part recorded OK (timeline_framesB.json). Next: edit.
- 00:35 demo/wasl_demo.mp4 built (1:58)
- 00:42 final demo rebuilt (title Arabic fix, sped-up label). Video kept out of git (upload to YouTube).

## STATUS 00:45 MDT Oct 17 — build complete, NOT published/submitted
Deliverables:
- Repo: /workspace/bounty/paypal (git, 5+ commits, MIT LICENSE, README, Dockerfile, render.yaml, tests 5/5)
- Demo video (provisional, simulator mode): /workspace/bounty/paypal/demo/wasl_demo.mp4 (1:58, 1080p)
- Devpost text: /workspace/bounty/paypal/devpost_final.md
Remaining (needs nightmare):
1. PayPal sandbox creds: developer.paypal.com → Apps & Credentials → Sandbox → Create App → Client ID + Secret; plus a sandbox
   Personal account email/password (Testing Tools → Sandbox Accounts). Put in .env (PAYPAL_CLIENT_ID/SECRET).
2. Re-record in sandbox: start demo server on 8795 with creds, `SANDBOX_BUYER_EMAIL=.. SANDBOX_BUYER_PASSWORD=.. node demo/record.mjs http://localhost:8795 demo/build/frames`,
   then `PART=dashboard node demo/record.mjs ... demo/build/framesB`, then `sdenv python demo/edit.py`. (Sandbox login selectors untested.)
3. Create public GitHub repo (baroodstore1-ai/wasl), push, confirm License shows in About.
4. Upload video to YouTube PUBLIC (rule requires public, not unlisted) on Satr Tools channel.
5. Devpost: join PayPal AI Hackathon, paste devpost_final.md, links, submit before Nov 12 12:00 PM PST (1:00 PM MST).
Optional: Render deploy (render.yaml) for hosted URL + Render prize; a hosted LLM key (AI_BASE_URL/AI_API_KEY) for faster/better AI.

## 00:50 Oct 17 — sandbox
- OAuth against api-m.sandbox.paypal.com: OK (HTTP 200, app APP-8LH13775N8542541S, payouts scope present). Client ID starting 'BAAA' works.
- .gitignore now ignores .env* (except .env.example); .env/.env.sandbox chmod 600, never committed (checked git log).
- Real sandbox flow PASSED end to end (Oct 17 00:42 MDT): order 25K98187AL709210E created (AUTHORIZE) → headless login on www.sandbox.paypal.com with buyer test account → "Continue to Review Order" → returned → authorization CREATED (hold until Nov 14) → v2 verified → capture COMPLETED → Payouts batch 855/171/114 → items UNCLAIMED (example.com recipients have no sandbox PayPal account; PayPal holds them for claim) → deal PAID_OUT.
- Code: UNCLAIMED counts as sent ("Sent · to claim" pill); env pill says "Offline simulator" only in mock mode; authorizationStatus→CAPTURED on capture; demo/sandbox-creds.mjs reads .env.sandbox without shell; recorder blurs email/password and any '@' text on paypal.com.
- Next: re-record (demo server 8795, sandbox, fresh data) → edit → commit.
- 01:10 sandbox demo server 8795 (demo/data fresh; old mock data → demo/data_mock_take3, old frames → demo/build/mock_take3). Seeds funded/voided via real sandbox. TTS regenerated (s4 mentions real sandbox, total 111 s). Recording main part → /tmp/rec.log
- 01:12 take S1 failed: extract LLM call hit undici 5-min headers timeout (box load 150) + Chrome target crash. Fix: ai.js uses node:http with AI_TIMEOUT_MS only; recorder adds --disable-dev-shm-usage. Retrying take S2.
- 01:50 committed sandbox-mode code. Box OOM-kills llama-server (other agents' jobs use ~13/16 GB, load 50–150): a 40-token test took 6.6 min. Recorder now pauses the screencast during AI waits (timeouts 120 min). Next: retry take S3 when memory allows.
- 01:43 take S3 recording started (/tmp/rec.log)
- 02:07 take S3 failed: global OOM killer killed llama-server AND the recorder's Chrome (other agents' jobs: blender, whisper, SD, etc. hold ~13 GB of 16 GB). Not a Wasl bug. Recording blocked until the box has ~4 GB free.
- RESUME (when `free -m` shows >4000 available and load is lower):
  1. demo server: `PORT=8795 DATA_DIR=demo/data PUBLIC_URL=http://localhost:8795 node server/index.js` (sandbox seeds already in demo/data)
  2. `node demo/record.mjs http://localhost:8795 demo/build/frames` (reads buyer creds from .env.sandbox itself; blurs them on camera)
  3. `PART=dashboard node demo/record.mjs http://localhost:8795 demo/build/framesB`
  4. `cd demo && /workspace/bounty/tools/sdenv/bin/python edit.py` (VO already regenerated, 111 s) → check < 3 min → commit
  Fallback: old mock-mode video demo/wasl_demo.mp4 (1:58) + frames in demo/build/mock_take3 still exist.
