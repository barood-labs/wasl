#!/usr/bin/env node
// Wasl MCP server — lets any AI agent (a brand's procurement agent, a creator's manager agent,
// Claude Desktop, Cursor, …) run sponsorship deals end-to-end over the Model Context Protocol.
// It drives the running Wasl API (WASL_URL, default http://localhost:8787), so every action goes
// through the same PayPal authorization → AI verification → capture → payout pipeline.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.WASL_URL || 'http://localhost:8787').replace(/\/$/, '');
async function api(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}
const out = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

const server = new McpServer({ name: 'wasl', version: '1.0.0' });

server.tool('wasl_structure_deal', 'Turn a raw brand↔creator negotiation chat (Arabic, English or mixed) into a checkable sponsorship contract. Does not create anything.',
  { chat: z.string().describe('The conversation text') },
  async ({ chat }) => out(await api('/api/extract', 'POST', { chat })));

server.tool('wasl_create_deal', 'Create a sponsorship deal from a structured contract (output of wasl_structure_deal, possibly edited).',
  { deal: z.record(z.any()), chat: z.string().optional() },
  async ({ deal, chat }) => out(await api('/api/deals', 'POST', { deal, chat })));

server.tool('wasl_fund_deal', 'Create the PayPal order (intent AUTHORIZE) for a deal and return the approval link the brand must open. Funds are only held, never captured, until delivery is verified.',
  { dealId: z.string() },
  async ({ dealId }) => out(await api(`/api/deals/${dealId}/fund`, 'POST')));

server.tool('wasl_get_deal', 'Get a deal with its status, PayPal ids, money split, latest verification evidence and timeline.',
  { dealId: z.string() },
  async ({ dealId }) => {
    const d = await api(`/api/deals/${dealId}`);
    const sub = d.submissions?.[0];
    return out({ id: d.id, title: d.title, status: d.status, amount: `${d.currency} ${d.amount}`, paypal: d.paypal, split: d.split,
      latestCheck: sub ? { status: sub.status, score: sub.result?.score, results: sub.result?.results?.map((r) => ({ requirement: r.description_en, pass: r.pass, evidence: r.evidence })), feedback: sub.result?.feedback_en } : null,
      timeline: d.events.slice(0, 15).map((e) => `${e.at} ${e.message}`) });
  });

server.tool('wasl_list_deals', 'List all deals with status, amount held/released and verification score.', {}, async () => out(await api('/api/deals')));

server.tool('wasl_submit_delivery', 'Submit a bundled sample video for verification (demo). Real uploads go through the web app.',
  { dealId: z.string(), sample: z.enum(['noor_v1.mp4', 'noor_v2.mp4']) },
  async ({ dealId, sample }) => out(await api(`/api/deals/${dealId}/submit`, 'POST', { sample })));

server.tool('wasl_release_payment', 'Brand override: capture the held PayPal authorization and pay out the split now.',
  { dealId: z.string() }, async ({ dealId }) => out(await api(`/api/deals/${dealId}/release`, 'POST')));

server.tool('wasl_void_hold', 'Void the PayPal authorization and return the funds to the brand.',
  { dealId: z.string() }, async ({ dealId }) => out(await api(`/api/deals/${dealId}/void`, 'POST')));

server.tool('wasl_payouts', 'List PayPal payouts to creators and collaborators with their status.', {}, async () => out(await api('/api/payouts')));

await server.connect(new StdioServerTransport());
