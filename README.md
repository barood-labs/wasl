<div align="center">

# Wasl · وصل

**AI-verified sponsorship escrow for bilingual creators, built on PayPal.**
*Get paid the moment your video delivers.*

`PayPal Orders v2 (AUTHORIZE → capture / void)` · `PayPal Payouts` · `Webhooks` · `Whisper` · `Tesseract OCR` · `LLM (any OpenAI-compatible, local Ollama by default)` · `AG Grid` · `MCP`

</div>

---

## The problem

Creators in the Arab world and its diaspora close brand deals in WhatsApp and Instagram DMs, usually in a mix of Arabic dialect and English. Then two things go wrong:

1. **The creator works before getting paid.** Net-60 to net-90 terms are normal, and some brands never pay.
2. **The brand pays before checking the work.** Checking a video against the brief is manual and slow: was the brand named in the first 15 seconds, was the promo code on screen, were English subtitles there, was there a risky health claim? Arguments about "did they deliver?" hold up payment for everyone, including the editor and translator the creator owes money to.

## What Wasl does

| Step | Who | What happens | PayPal / AI |
|---|---|---|---|
| 1. Structure | creator | Paste the raw chat (Arabic, English or both). AI turns it into a **machine-checkable contract** with deliverables, fee, deadline and the team's money split. Every money fact is then **cross-checked against the chat**, and anything the model mixed up gets corrected and shown. | LLM + deterministic grounding |
| 2. Fund | brand | One click on **Fund with PayPal** creates an order with `intent: AUTHORIZE`. The brand's money is **held, not charged**. | Orders v2 create + authorize |
| 3. Deliver | creator | Upload the video. | – |
| 4. Verify | agent | Wasl transcribes the speech (Whisper, AR/EN), reads on-screen text frame by frame (Tesseract, eng+ara), and checks every hard requirement **deterministically with a timestamp**. An LLM judges the subjective ones ("show the can clearly", "no exaggerated health claims") and writes **bilingual feedback**, backed by a deterministic Arabic/English brand-safety guardrail for risky claims. | Whisper, OCR, LLM |
| 5a. Fix | agent → creator | If something fails, the money **stays on hold** and the creator gets a precise fix list in Arabic and English, e.g. "brand named at 0:18, must be within 0:15". | – |
| 5b. Release | agent | When everything passes, the agent **captures** the authorization and **pays everyone in one Payouts batch**: creator, editor and translator, minus a 5% platform fee. | Payments v2 capture, Payouts v1 |
| 6. Track | everyone | Live AG Grid dashboards for deals, evidence and payouts. Ask questions in plain English or Arabic ("which deals need revisions over $500?") and the AI turns them into grid filters. | AG Grid + LLM |

The brand can **void** the hold (refund) or **release manually** at any time. If a brand-safety risk is flagged, the agent pauses auto-release instead of paying out.

> **Money never moves on an LLM's say-so.** Hard requirements like timing, on-screen code, duration and language are checked by deterministic code over Whisper and OCR output, with timestamped evidence you can click to replay. The LLM decides only the subjective criteria, and its contract output is grounded against the original chat.

## Demo flow (2 minutes)

1. `#/new` → **Load sample chat** → **Structure with AI**. You get 6 deliverables, $1,200, and a split of Layla 75% / Karim (editor) 15% / Rana (translator) 10%.
2. **Create deal** → **Fund with PayPal**, approve the hold in the PayPal sandbox, and you're back to "Funds held".
3. Submit **v1.mp4**. It fails: the brand is named at 0:18 (needs ≤ 0:15), there's no NOOR20 on screen, and there's a weight-loss health claim. Funds stay held, and the creator gets the fix list in Arabic and English.
4. Submit **v2.mp4**. Every check passes, the agent captures the payment, and one PayPal Payouts batch pays $855 / $171 / $114. Status goes to **Paid out**.

## Run it locally (about 5 minutes)

**Requirements:** Node 20+, `ffmpeg`, `tesseract-ocr` + `tesseract-ocr-ara`, Python 3 with `faster-whisper`, and an LLM (local [Ollama](https://ollama.com) or any OpenAI-compatible API).

```bash
# macOS:  brew install ffmpeg tesseract tesseract-lang ollama
# Ubuntu: sudo apt install ffmpeg tesseract-ocr tesseract-ocr-ara python3-pip
pip install faster-whisper numpy
ollama pull qwen2.5:7b            # or set AI_BASE_URL / AI_API_KEY / AI_MODEL for a hosted model

git clone <this repo> wasl && cd wasl
npm install
cp .env.example .env              # add your PayPal sandbox Client ID/Secret (optional, see below)
npm start                         # → http://localhost:8787
npm test                          # unit tests: grounding, cross-script matching, verifiers
```

Or with Docker: `docker build -t wasl . && docker run -p 8787:8787 --env-file .env wasl`, or deploy the included `render.yaml` Blueprint to Render.

### PayPal sandbox setup

1. Log in at <https://developer.paypal.com> → **Apps & Credentials** → **Sandbox** → **Create App** (Merchant). Copy the **Client ID** and **Secret** into `.env`.
2. Under **Testing Tools → Sandbox Accounts** you get a sandbox **Personal** account (the "brand" that approves the hold) and a **Business** account (the Wasl platform). Payouts are enabled on sandbox business accounts by default.
3. Optional: add a webhook for `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.*`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.PAYOUTS-ITEM.*` pointing to `https://<your-host>/api/webhooks/paypal`, and put its id in `PAYPAL_WEBHOOK_ID`. Signatures are verified with `/v1/notifications/verify-webhook-signature`. Without webhooks, a background agent loop polls payout status.

**No credentials?** Wasl starts with a built-in **PayPal simulator** (`PAYPAL_ENV=mock`) that copies the request and response shapes of every sandbox endpoint it uses, so judges can click through the whole flow offline. The header pill shows which mode is running.

## Architecture

```
public/            Vanilla JS SPA (EN/AR + RTL), AG Grid Community + AG Charts Community
server/index.js    Express API, PayPal return/cancel, webhooks, background payout sync
server/paypal.js   Dependency-free PayPal REST client: OAuth2, Orders v2, Payments v2, Payouts v1, Webhooks
server/deals.js    Deal state machine + split math (cents-exact, remainder to creator)
server/ai.js       LLM calls: chat→contract, delivery judge, natural-language→AG Grid filter model
server/ground.js   Deterministic chat parser that grounds/corrects the LLM's money facts
server/verify.js   ffprobe + Whisper + per-second OCR (dedup) + deterministic verifiers + LLM judge
server/text.js     Arabic normalization, fuzzy + cross-script phonetic matching ("Noor" ≈ "نور")
server/mcp.js      MCP server so other AI agents can create, fund, verify and release deals
server/mock-paypal.js  Offline PayPal simulator (only when no sandbox credentials)
samples/           Sample bilingual chat + the two demo videos (and the script that generates them)
```

**Deal states:** `AWAITING_FUNDS → FUNDED (hold) → IN_REVIEW → NEEDS_REVISION ↺ → VERIFIED → RELEASED → PAID_OUT`, or `VOIDED`.

### PayPal APIs used

| API | Endpoint | Why |
|---|---|---|
| OAuth2 | `POST /v1/oauth2/token` | client-credentials token, cached |
| Orders v2 | `POST /v2/checkout/orders` (`intent: AUTHORIZE`, `payment_source.paypal.experience_context`) | brand funds a hold for the deal |
| Orders v2 | `POST /v2/checkout/orders/{id}/authorize` | create the authorization after approval |
| Payments v2 | `POST /v2/payments/authorizations/{id}/capture` | release on verified delivery |
| Payments v2 | `POST /v2/payments/authorizations/{id}/void` | refund the hold to the brand |
| Payouts v1 | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{batch}` | split the money to creator + collaborators in one batch |
| Webhooks v1 | `POST /v1/notifications/verify-webhook-signature` | trust incoming events |

All mutating calls send a `PayPal-Request-Id` for idempotency, so retries never double-capture or double-pay.

### AI used

| Tool | Where | How |
|---|---|---|
| **LLM** (default: Qwen2.5 via **Ollama**, free and local; any OpenAI-compatible API such as xAI Grok, OpenAI or Groq via `.env`) | `server/ai.js` | JSON-mode prompts with zod-validated schemas and an automatic repair retry: (1) chat → contract, (2) delivery judge + bilingual feedback + brand-safety flags, (3) natural-language → AG Grid filter model |
| **Whisper** (`faster-whisper`, local) | `scripts/transcribe.py` | multilingual timestamped transcript of Arabic, English and code-switched speech |
| **Tesseract OCR** (eng+ara, local) | `server/verify.js` | 1 fps on-screen text detection (promo codes, subtitles, disclosures) |
| **MCP** | `server/mcp.js` | exposes Wasl as tools so AI agents can transact (agentic commerce) |

### Use with an AI agent (MCP)

```json
{ "mcpServers": { "wasl": { "command": "node", "args": ["/path/to/wasl/server/mcp.js"], "env": { "WASL_URL": "http://localhost:8787" } } } }
```
Tools: `wasl_structure_deal`, `wasl_create_deal`, `wasl_fund_deal`, `wasl_get_deal`, `wasl_list_deals`, `wasl_submit_delivery`, `wasl_release_payment`, `wasl_void_hold`, `wasl_payouts`.

## Notes & limits

* Sandbox only. No real money moves anywhere in this project.
* PayPal authorizations have a 3-day honor period and can be captured for up to 29 days. Longer campaigns would re-authorize or switch to Invoicing.
* The sample brand "Noor Coffee", its product and all people in the samples are fictional. Sample voices are synthetic (edge-tts).

## License

[MIT](LICENSE)
