// Swarm chat hub: one MCP server that every teammate's agent connects to,
// plus a live web page (one thinking-orb per agent) where humans can watch and talk.
//
//   npm install && npm start            -> MCP at http://<this-ip>:3000/mcp, chat UI at http://<this-ip>:3000/
//   SWARM_TOKEN=secret npm start        -> require "Authorization: Bearer secret" on /mcp

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.SWARM_TOKEN || '';
const MIN_SEND_GAP_MS = Number(process.env.MIN_SEND_GAP_MS || 3000); // per-agent rate limit
const ORB_STATES = ['working', 'searching', 'solving', 'listening', 'connecting', 'weaving', 'composing', 'breathing', 'shaping'];

// ---------- shared state (in memory) ----------
const messages = []; // { id, from, text, ts }
const agents = new Map(); // name -> { name, state, note, lastSeen, lastSent }
let nextId = 1;
const waiters = new Set(); // pending wait_for_messages resolvers
const browsers = new Set(); // SSE responses for the web UI

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of browsers) res.write(payload);
}

function touch(name, state, note) {
  const a = agents.get(name) || { name, state: 'connecting', note: '', lastSeen: 0, lastSent: 0 };
  a.lastSeen = Date.now();
  if (state) a.state = state;
  if (note !== undefined) a.note = note;
  agents.set(name, a);
  broadcast('agent', a);
  return a;
}

function post(from, text) {
  const msg = { id: nextId++, from, text, ts: Date.now() };
  messages.push(msg);
  if (messages.length > 2000) messages.shift();
  broadcast('message', msg);
  for (const w of [...waiters]) w();
  return msg;
}

function since(afterId, exclude) {
  return messages.filter((m) => m.id > afterId && m.from !== exclude);
}

function fmt(list) {
  if (!list.length) return '(no new messages)';
  return list.map((m) => `#${m.id} [${m.from}] ${m.text}`).join('\n');
}

// Agents that haven't been heard from in a while fade to "breathing".
setInterval(() => {
  for (const a of agents.values()) {
    if (a.state !== 'breathing' && Date.now() - a.lastSeen > 120_000) {
      a.state = 'breathing';
      broadcast('agent', a);
    }
  }
}, 15_000);

// ---------- MCP server ----------
function buildMcpServer() {
  const server = new McpServer({ name: 'swarm-chat', version: '0.1.0' });
  const name = z.string().min(1).max(40).describe('Your agent name in the swarm, e.g. "alice-claude". Use the same one every call.');

  server.registerTool(
    'join',
    {
      description:
        'Join the swarm chat. Call once at the start. Returns recent history and the id to pass to wait_for_messages.',
      inputSchema: { name, role: z.string().max(200).optional().describe('What you are working on / your specialty') },
    },
    async ({ name, role }) => {
      const isNew = !agents.has(name);
      touch(name, 'connecting', role || '');
      if (isNew) post('system', `${name} joined${role ? ` (${role})` : ''}`);
      const recent = messages.slice(-30);
      const others = [...agents.keys()].filter((n) => n !== name);
      return {
        content: [
          {
            type: 'text',
            text:
              `Joined as ${name}. Agents online: ${others.join(', ') || 'none yet'}.\n` +
              `Latest message id: ${nextId - 1}\n\nRecent history:\n${fmt(recent)}\n\n` +
              'Now loop: wait_for_messages(after_id=<latest id>) -> reply with send_message when you have something useful -> repeat.',
          },
        ],
      };
    },
  );

  server.registerTool(
    'send_message',
    {
      description: 'Post a message to the whole swarm. Mention someone with @name to direct it at them.',
      inputSchema: { name, text: z.string().min(1).max(4000) },
    },
    async ({ name, text }) => {
      const a = touch(name, 'composing');
      const wait = a.lastSent + MIN_SEND_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      a.lastSent = Date.now();
      const msg = post(name, text);
      return { content: [{ type: 'text', text: `Sent as #${msg.id}.` }] };
    },
  );

  server.registerTool(
    'wait_for_messages',
    {
      description:
        'Block until someone else posts (or the timeout passes), then return the new messages. Use the highest id you have seen as after_id.',
      inputSchema: {
        name,
        after_id: z.number().int().min(0).describe('Return messages with id greater than this'),
        timeout_seconds: z.number().int().min(1).max(110).optional().describe('Default 50'),
      },
    },
    async ({ name, after_id, timeout_seconds }) => {
      touch(name, 'listening');
      let list = since(after_id, name);
      if (!list.length) {
        await new Promise((resolve) => {
          const done = () => {
            if (since(after_id, name).length) finish();
          };
          const finish = () => {
            waiters.delete(done);
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(finish, (timeout_seconds || 50) * 1000);
          waiters.add(done);
        });
        list = since(after_id, name);
      }
      touch(name, 'solving');
      const latest = list.length ? list[list.length - 1].id : after_id;
      return {
        content: [{ type: 'text', text: `${fmt(list)}\n\nlatest_id: ${latest}` }],
      };
    },
  );

  server.registerTool(
    'set_status',
    {
      description: `Optional: set the orb animation shown for you on the dashboard. States: ${ORB_STATES.join(', ')}.`,
      inputSchema: { name, state: z.enum(ORB_STATES), note: z.string().max(200).optional() },
    },
    async ({ name, state, note }) => {
      touch(name, state, note);
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  );

  server.registerTool(
    'list_agents',
    { description: 'Who is in the swarm and what they are doing.', inputSchema: {} },
    async () => ({
      content: [
        {
          type: 'text',
          text:
            [...agents.values()]
              .map((a) => `${a.name}: ${a.state}${a.note ? ` — ${a.note}` : ''} (seen ${Math.round((Date.now() - a.lastSeen) / 1000)}s ago)`)
              .join('\n') || 'nobody yet',
        },
      ],
    }),
  );

  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: '1mb' }));

function auth(req, res, next) {
  if (!TOKEN || req.get('authorization') === `Bearer ${TOKEN}`) return next();
  res.status(401).json({ error: 'bad or missing bearer token' });
}

// Stateless Streamable HTTP: a fresh server+transport per request, so agents
// survive hub restarts and never hit "unknown session" errors.
app.post('/mcp', auth, async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
  }
});
app.all('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());

// Web UI
const here = path.dirname(fileURLToPath(import.meta.url));
app.get('/', (_req, res) => res.sendFile(path.join(here, 'public', 'index.html')));

app.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: init\ndata: ${JSON.stringify({ messages: messages.slice(-200), agents: [...agents.values()] })}\n\n`);
  browsers.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    browsers.delete(res);
  });
});

app.post('/say', (req, res) => {
  const from = String(req.body?.from || 'human').slice(0, 40);
  const text = String(req.body?.text || '').slice(0, 4000).trim();
  if (!text) return res.status(400).end();
  res.json(post(`👤 ${from}`, text));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`swarm hub on :${PORT}`);
  console.log(`  chat UI : http://localhost:${PORT}/`);
  console.log(`  MCP     : http://<your-ip>:${PORT}/mcp${TOKEN ? '  (bearer token required)' : '  (no token set — anyone on the network can join)'}`);
});
