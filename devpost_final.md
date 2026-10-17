# Devpost submission — Wasl · وصل

> Paste each section into the matching Devpost field. Replace `<REPO_URL>` and `<YOUTUBE_URL>` once they're published. Contest rules: the video must be **public on YouTube**, under 3:00.

---

## Project name
Wasl · وصل

## Elevator pitch (≤200 chars)
AI-verified sponsorship escrow for bilingual creators. The brand's money is held with PayPal, the AI checks the video against the brief, and everyone on the team is paid the moment it delivers.

## Built with (tags)
paypal, paypal-orders-api, paypal-payouts, paypal-webhooks, node.js, express, javascript, ag-grid, ag-charts, whisper, faster-whisper, tesseract, ollama, qwen, llm, mcp, ffmpeg, docker, render

## Try it out
- Code: <REPO_URL>
- Demo video: <YOUTUBE_URL>

---

## About the project (main description)

### Inspiration
Creators in the Arab world and its diaspora close brand deals in WhatsApp and Instagram DMs, usually in a mix of Arabic dialect and English. After that, the same two problems keep coming up. The creator posts the video and waits 60–90 days to get paid, if payment comes at all. The brand has to check every video against the brief by hand: was the product named in the first 15 seconds, was the promo code on screen, were there English subtitles, did anyone make a health claim? While they argue about whether it was delivered, nobody gets paid, including the editor and translator the creator owes money to.

We wanted the brief itself to be the thing that releases the money.

### What it does
**Wasl** (وصل, Arabic for both "receipt" and "it arrived") is escrow for sponsored content. AI verifies the delivery, and PayPal moves the money.

1. **Chat → contract.** The creator pastes the raw negotiation chat in Arabic, English or both. An LLM turns it into a *machine-checkable* contract with deliverables (spoken brand mention within N seconds, on-screen promo code, duration, languages, plus subjective requirements), fee, deadline, and the team's money split. A deterministic parser then **cross-checks every money fact against the chat**. If the model swapped the brand and creator, invented an email, or dropped the translator's 10%, Wasl corrects it and shows the correction.
2. **Brand funds a hold.** One click creates a PayPal **Orders v2 order with `intent: AUTHORIZE`**. The brand approves in PayPal, Wasl authorizes, and the money is **held, not charged**. Creators never start work unfunded.
3. **Creator uploads the video.** Wasl transcribes it with **Whisper** (Arabic, English, code-switched), runs **OCR on every second** of footage (Tesseract, Arabic + English), and checks the hard requirements **in code, with timestamps**, using cross-script phonetic matching, because Whisper writes "Noor Cold Brew" as «نور كولد برو». An **LLM judge** decides only the subjective requirements ("show the can clearly", "no exaggerated health claims") and writes coaching notes. A deterministic Arabic/English **brand-safety guardrail** flags risky claims (weight loss, immunity, cures) with timestamps, so a small model can't miss them.
4. **Fail → fix list.** The money stays on hold. The creator gets a precise fix list in **Arabic and English** ("brand named at 0:18, must be within 0:15"). Every piece of evidence has a timestamp you can click to replay.
5. **Pass → paid.** The agent **captures the authorization** and sends **one PayPal Payouts batch** that splits the money to creator, editor and translator (with a 5% platform fee and cent-exact rounding). Payout status comes back via **webhooks** (signature-verified), with polling as a fallback.
6. **Dashboards.** **AG Grid** grids for deals, evidence and payouts, plus AG Charts. **Ask in plain English or Arabic** ("deals over $800 not paid out yet, biggest first") and the AI turns the question into an AG Grid filter and sort model. The whole UI switches to **Arabic right-to-left**, grids included.
7. **Agentic commerce.** An **MCP server** exposes Wasl as tools (`structure_deal`, `create_deal`, `fund_deal`, `get_deal`, `release_payment`, `void_hold`, `payouts`, …), so a brand's procurement agent or a creator's manager agent can run deals end to end.

The brand can always void the hold (refund) or release manually.

### How we built it
- **PayPal** (sandbox), using a dependency-free REST client: OAuth2 client-credentials, Orders v2 (create with `payment_source.paypal.experience_context`, authorize), Payments v2 (capture, void), Payouts v1 (batch create and status), Webhooks (`verify-webhook-signature`). Every mutating call sends a `PayPal-Request-Id`, so retries never double-capture or double-pay.
- **AI:** an LLM through any OpenAI-compatible endpoint. The default is free and local (Qwen2.5 via Ollama), and xAI, OpenAI or Groq work by changing `.env`. JSON-mode prompts are validated with zod and retried automatically if the output is invalid. faster-whisper handles speech and Tesseract (eng+ara) handles on-screen text. ffmpeg extracts frames, and identical frames are skipped so they aren't OCR'd twice.
- **Trust design:** the LLM never moves money on its own. Hard requirements are checked by deterministic code over Whisper and OCR output. The LLM judges only subjective criteria, and its contract output is grounded against the original chat.
- **Frontend:** vanilla JS single-page app with AG Grid Community (custom cell renderers, editable contract grids with select and number editors, pinned totals, CSV export, RTL, filter models driven by AI) and AG Charts Community.
- **Ops:** Express, a JSON store, Dockerfile, and a Render Blueprint (`render.yaml`). Unit tests cover grounding, cross-script matching and the verifiers.

### Challenges we ran into
- **Arabic + English speech.** Whisper writes English brand names in Arabic script and re-segments words ("نورك والدبرو"). We built an Arabic normalizer and a cross-script consonant-skeleton matcher, so "Noor Cold Brew" ≈ «نور كولد برو» without false positives inside ordinary words.
- **Small models get details wrong.** A 3B local model mixed up who was the brand and who was the creator. Instead of trusting it more, we added grounding: amounts, emails and split percentages must literally appear in the chat.
- **Holds vs. timelines.** PayPal authorizations have an honor period, so the deal state machine is built around authorize → capture/void, and we document re-authorization for long campaigns.

### Accomplishments that we're proud of
- An end-to-end loop where **a video file releases a PayPal payment and splits it across a team**, with evidence anyone can audit.
- Fully bilingual: contracts, evidence, feedback and the entire RTL interface.
- It runs **free and locally** (open-weights LLM, Whisper, Tesseract), so creators' unreleased videos never have to leave their machine.

### What we learned
Authorize-then-capture is a natural fit for "pay on verified delivery". AI is most useful in payments when its job is limited to the fuzzy part (reading a chat, judging tone) and deterministic code guards the money.

### What's next for Wasl
- Multi-deliverable campaigns with partial captures, and PayPal Invoicing for campaigns longer than the authorization window.
- Pulling published posts straight from platform links, plus view-count milestones.
- Venmo payouts for US collaborators, and more dialects (Gulf, Maghrebi) in the deal parser.

---

## How it's built: tools used (Devpost "Tools" field)
| Tool | Used for |
|---|---|
| PayPal Orders v2 (`AUTHORIZE`), Payments v2 (capture/void), Payouts v1, Webhooks, OAuth2 (sandbox) | holding the brand's funds, releasing them on verified delivery, splitting them to the team, tracking status |
| LLM: Qwen2.5 via Ollama (local, free); any OpenAI-compatible API (e.g. xAI Grok) supported | chat → contract, subjective delivery judging + bilingual coaching, natural-language → AG Grid filters |
| faster-whisper (local) | timestamped Arabic/English transcription |
| Tesseract OCR eng+ara (local) | per-second on-screen text (promo codes, subtitles) |
| AG Grid Community + AG Charts Community | deals, evidence, payouts, editable contract grids, RTL, AI-driven filtering |
| Model Context Protocol SDK | agent tools for agentic commerce |
| Render (Blueprint) + Docker | deployment |

## Testing instructions (for judges)
1. `git clone <REPO_URL> && cd wasl && npm install`
2. Install `ffmpeg`, `tesseract-ocr` + `tesseract-ocr-ara`, `pip install faster-whisper numpy`, and `ollama pull qwen2.5:7b` (or set `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` for a hosted model).
3. `cp .env.example .env`, then add PayPal **sandbox** Client ID/Secret. Leave them empty to use the built-in offline PayPal simulator.
4. `npm start` → http://localhost:8787 → **+ New deal** → **Load sample chat** → **Structure with AI** → **Create deal** → **Fund with PayPal** (log in with any sandbox personal account) → submit demo clip **v1** (fails, with evidence) → **v2** (passes → capture → payouts).
5. Optional: `npm run seed` (extra demo deals), `npm test`, and `node server/mcp.js` for the MCP server.

## "Was this built during the hackathon?"
Yes. Everything in the repository was created during the submission period (Oct 2026).

## Video script (≈2:20, synthetic narration)
See `demo/narration.json`. Scenes: problem → chat-to-contract with grounding → Fund with PayPal (authorization hold) → v1 fails with timestamped evidence and bilingual fix list → v2 passes → capture + Payouts split → AG Grid dashboards with AI questions → Arabic RTL + MCP → close.
