// Swarm stage: every agent is a thinking-orb (https://github.com/Jakubantalik/thinking-orbs)
// orbiting a central hub. Messages fly as glowing comets along curved beams, speakers get
// speech bubbles, and the hub sends out a shockwave whenever anything is said.
//
//   const stage = createStage(el, { agentSize: 96, hubSize: 150, rotate: true, stars: true });
//   stage.upsertAgent({ name, state, note });   stage.message({ from, text });
import { MODE_DRAWS, resolvePreset } from '/vendor/thinking-orbs.js';

const PALETTE = ['#8fd3ff', '#b49cff', '#79e6b8', '#ffb47a', '#ff8fbd', '#f2df73', '#76e4f0', '#d0a8ff', '#a2e673', '#ff9c8a'];
export const colorFor = (name) => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
export const HUMAN_COLOR = '#ffd68a';
const STATE_LABEL = { connecting: 'joining', listening: 'listening', solving: 'thinking', composing: 'talking', breathing: 'idle', working: 'working', searching: 'searching', weaving: 'weaving', shaping: 'shaping' };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = Math.min(2, devicePixelRatio || 1);

// ---------- thinking-orbs: one shared clock + one rAF loop for every orb ----------
const orbs = new Set();
export function makeOrb(cssSize, state) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssSize * DPR);
  canvas.height = Math.round(cssSize * DPR);
  canvas.style.width = canvas.style.height = cssSize + 'px';
  canvas.setAttribute('role', 'img');
  const orb = { canvas, ctx: canvas.getContext('2d'), cssSize, state: null };
  orb.set = (s) => {
    if (s === orb.state) return;
    // The library tunes two sizes (64 and 20); draw the 64px design scaled up so big orbs stay crisp.
    const p = resolvePreset(s, 64);
    Object.assign(orb, { state: s, draw: MODE_DRAWS[p.mode], speed: p.speed, opts: p.opts });
    canvas.setAttribute('aria-label', s);
  };
  orb.set(state);
  orbs.add(orb);
  return orb;
}
function paintOrb(o, t) {
  const k = (o.cssSize / 64) * DPR;
  o.ctx.setTransform(k, 0, 0, k, 0, 0);
  o.ctx.clearRect(0, 0, 64, 64);
  o.draw(o.ctx, 64, reduced ? 0.6 : t * o.speed, true, o.opts);
}
const frameHooks = new Set();
function tick() {
  if (document.visibilityState !== 'hidden') {
    const t = performance.now() / 1000;
    for (const o of orbs) (o.canvas.isConnected ? paintOrb(o, t) : orbs.delete(o));
    for (const f of frameHooks) f(t);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ---------- helpers ----------
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
function bez(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y };
}
// control point that bends a beam sideways so the network looks organic, not spoked
function ctrl(a, b, bend) {
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y;
  return { x: mx - dy * bend, y: my + dx * bend };
}

export function createStage(root, opts = {}) {
  const o = { agentSize: 84, hubSize: 120, rotate: true, stars: true, bubbleMs: 7000, hubLabel: 'HUB', ...opts };
  root.classList.add('swarm-stage');

  const fx = document.createElement('canvas');
  fx.className = 'swarm-fx';
  const layer = document.createElement('div');
  layer.className = 'swarm-nodes';
  root.append(fx, layer);
  const g = fx.getContext('2d');

  let W = 0, H = 0;
  const resize = () => {
    W = root.clientWidth; H = root.clientHeight;
    fx.width = Math.round(W * DPR); fx.height = Math.round(H * DPR);
    fx.style.width = W + 'px'; fx.style.height = H + 'px';
  };
  new ResizeObserver(resize).observe(root);
  resize();

  // starfield
  const stars = Array.from({ length: o.stars ? 160 : 0 }, () => ({
    x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, tw: Math.random() * Math.PI * 2, z: Math.random() * 0.6 + 0.2,
  }));

  // hub node
  const hub = document.createElement('div');
  hub.className = 'swarm-node swarm-hub';
  hub.style.setProperty('--c', '#8fd3ff');
  hub.innerHTML = '<div class="swarm-bubble"></div><div class="swarm-ring"></div><div class="swarm-label"><div class="swarm-name"></div><div class="swarm-state"></div></div>';
  hub.style.setProperty('--r', o.hubSize / 2 + 'px');
  hub.querySelector('.swarm-name').textContent = o.hubLabel;
  const hubOrb = makeOrb(o.hubSize, 'connecting');
  hub.querySelector('.swarm-ring').append(hubOrb.canvas);
  layer.append(hub);
  const hubPos = { x: 0, y: 0 };

  const agents = new Map(); // name -> { el, orb, data, angle, target, pos, color, born }
  const packets = [];
  const waves = [];
  let spin = 0, last = performance.now() / 1000;

  function relayout() {
    const list = [...agents.values()];
    list.forEach((a, i) => { a.target = (i / Math.max(1, list.length)) * Math.PI * 2; });
  }

  function upsertAgent(d) {
    let a = agents.get(d.name);
    if (!a) {
      const el = document.createElement('div');
      el.className = 'swarm-node';
      const color = colorFor(d.name);
      el.style.setProperty('--c', color);
      el.innerHTML = '<div class="swarm-bubble"></div><div class="swarm-ring"></div><div class="swarm-label"><div class="swarm-name"></div><div class="swarm-state"></div><div class="swarm-role"></div></div>';
      el.style.setProperty('--r', o.agentSize / 2 + 'px');
      el.querySelector('.swarm-name').textContent = d.name;
      const orb = makeOrb(o.agentSize, d.state);
      el.querySelector('.swarm-ring').append(orb.canvas);
      layer.append(el);
      a = { el, orb, data: d, angle: null, target: 0, pos: { ...hubPos }, color, born: performance.now() / 1000 };
      agents.set(d.name, a);
      relayout();
      if (a.angle === null) a.angle = a.target;
      waves.push({ who: d.name, t0: performance.now() / 1000, color, big: true });
    }
    a.data = d;
    a.orb.set(d.state);
    a.el.querySelector('.swarm-state').textContent = STATE_LABEL[d.state] || d.state;
    a.el.querySelector('.swarm-role').textContent = d.note || '';
    a.el.classList.toggle('idle', d.state === 'breathing');
    root.dataset.agents = agents.size;
    hub.querySelector('.swarm-state').textContent = `${agents.size} agent${agents.size === 1 ? '' : 's'}`;
  }

  function bubble(el, text) {
    const b = el.querySelector('.swarm-bubble');
    b.textContent = text.length > 160 ? text.slice(0, 157) + '...' : text;
    b.classList.add('show');
    el.classList.add('talking');
    clearTimeout(el._t);
    el._t = setTimeout(() => { b.classList.remove('show'); el.classList.remove('talking'); }, o.bubbleMs);
  }

  function message(m) {
    if (m.from === 'system') return;
    const now = performance.now() / 1000;
    const sender = agents.get(m.from);
    const color = sender ? sender.color : HUMAN_COLOR;
    const names = [...agents.keys()].filter((n) => n !== m.from);
    const mentioned = names.filter((n) => m.text.includes('@' + n));
    const targets = mentioned.length ? mentioned : names;
    if (sender) {
      bubble(sender.el, m.text);
      packets.push({ from: m.from, to: 'hub', color, t0: now, dur: 0.75 });
    } else {
      bubble(hub, m.from.replace(/^\S+\s/, '') + ': ' + m.text);
    }
    const delay = sender ? 0.7 : 0;
    waves.push({ who: 'hub', t0: now + delay, color });
    hubOrb.set('working');
    clearTimeout(hubOrb._t);
    hubOrb._t = setTimeout(() => hubOrb.set('connecting'), 1600);
    targets.forEach((n, i) => packets.push({ from: 'hub', to: n, color, t0: now + delay + i * 0.05, dur: 0.85, hot: mentioned.length > 0 }));
  }

  const posOf = (who) => (who === 'hub' ? hubPos : agents.get(who)?.pos);

  frameHooks.add((t) => {
    if (!root.isConnected) return;
    const dt = Math.min(0.1, t - last); last = t;
    if (o.rotate && !reduced) spin += dt * 0.035;

    // ---- positions ----
    const cx = W / 2, cy = H / 2 + (o.offsetY || 0);
    hubPos.x = cx; hubPos.y = cy;
    hub.style.transform = `translate(${cx}px, ${cy}px)`;
    const margin = o.agentSize * 0.9 + 40;
    const rx = Math.max(120, W / 2 - margin), ry = Math.max(110, H / 2 - margin * 0.85);
    for (const a of agents.values()) {
      let d = a.target - a.angle;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.angle += d * Math.min(1, dt * 3);
      const ang = -Math.PI / 2 + a.angle + spin;
      const grow = Math.min(1, (t - a.born) / 0.9);
      const k = ease(grow);
      const bob = reduced ? 0 : Math.sin(t * 0.9 + a.target * 3) * 6;
      a.pos.x = cx + Math.cos(ang) * rx * k;
      a.pos.y = cy + Math.sin(ang) * ry * k + bob;
      a.el.style.transform = `translate(${a.pos.x}px, ${a.pos.y}px)`;
      a.el.style.opacity = k;
    }

    // ---- fx canvas ----
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);

    for (const s of stars) {
      const x = ((s.x + (reduced ? 0 : t * 0.002 * s.z)) % 1) * W, y = s.y * H;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.tw));
      g.fillStyle = `rgba(200,215,255,${a * s.z})`;
      g.beginPath(); g.arc(x, y, s.r, 0, Math.PI * 2); g.fill();
    }

    // hub glow
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, o.hubSize * 2.2);
    glow.addColorStop(0, 'rgba(143,211,255,0.16)');
    glow.addColorStop(1, 'rgba(143,211,255,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, o.hubSize * 2.2, 0, Math.PI * 2); g.fill();

    // beams: curved, dashed, flowing toward the hub
    g.lineWidth = 1.2;
    for (const a of agents.values()) {
      const c = ctrl(a.pos, hubPos, 0.18);
      g.strokeStyle = hexA(a.color, a.el.classList.contains('talking') ? 0.55 : 0.16);
      g.setLineDash([2, 7]);
      g.lineDashOffset = reduced ? 0 : -t * 18;
      g.beginPath(); g.moveTo(a.pos.x, a.pos.y); g.quadraticCurveTo(c.x, c.y, hubPos.x, hubPos.y); g.stroke();
    }
    g.setLineDash([]);

    g.globalCompositeOperation = 'lighter';
    // shockwaves
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i], p = posOf(w.who);
      const age = t - w.t0;
      if (age < 0) continue;
      const life = w.big ? 1.6 : 1.1;
      if (!p || age > life) { waves.splice(i, 1); continue; }
      const k = age / life;
      const base = w.who === 'hub' ? o.hubSize * 0.55 : o.agentSize * 0.55;
      g.strokeStyle = hexA(w.color, (1 - k) * 0.7);
      g.lineWidth = 2 * (1 - k) + 0.5;
      g.beginPath(); g.arc(p.x, p.y, base + k * (w.big ? 160 : 120), 0, Math.PI * 2); g.stroke();
    }
    // comets
    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      const a = posOf(p.from), b = posOf(p.to);
      const age = t - p.t0;
      if (!a || !b || age > p.dur) {
        if (age > p.dur && p.to !== 'hub' && b) waves.push({ who: p.to, t0: t, color: p.color });
        packets.splice(i, 1);
        continue;
      }
      if (age < 0) continue;
      const c = ctrl(p.from === 'hub' ? a : a, b, p.from === 'hub' ? -0.18 : 0.18);
      const head = ease(age / p.dur);
      for (let k = 0; k < 14; k++) {
        const tt = Math.max(0, head - k * 0.018);
        const q = bez(a, c, b, tt);
        const r = (p.hot ? 5.5 : 4) * (1 - k / 14);
        g.fillStyle = hexA(p.color, (1 - k / 14) * 0.9);
        g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fill();
      }
      const q = bez(a, c, b, head);
      const hg = g.createRadialGradient(q.x, q.y, 0, q.x, q.y, 22);
      hg.addColorStop(0, hexA(p.color, 0.55));
      hg.addColorStop(1, hexA(p.color, 0));
      g.fillStyle = hg;
      g.beginPath(); g.arc(q.x, q.y, 22, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });

  return { upsertAgent, message, agents, hubOrb };
}

// ---------- shared live feed: server-sent events, with a polling fallback ----------
export function connectFeed({ onInit, onMessage, onAgent, onStatus }) {
  let gotInit = false, polling = false, lastId = 0;
  const known = new Map();
  const es = new EventSource('/events');
  es.addEventListener('init', (e) => {
    if (polling) return;
    gotInit = true;
    const d = JSON.parse(e.data);
    lastId = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
    onInit?.(d);
  });
  es.addEventListener('message', (e) => { if (polling) return; const m = JSON.parse(e.data); lastId = m.id; onMessage?.(m); });
  es.addEventListener('agent', (e) => { if (!polling) onAgent?.(JSON.parse(e.data)); });
  es.onopen = () => onStatus?.(true);
  es.onerror = () => { if (!polling) onStatus?.(false); };
  // If the stream hasn't delivered anything in 5s, a proxy is holding it back: poll instead.
  setTimeout(async () => {
    if (gotInit) return;
    polling = true; es.close();
    let first = true;
    for (;;) {
      try {
        const d = await (await fetch('/poll?after=' + (first ? 0 : lastId))).json();
        onStatus?.(true);
        if (first) { onInit?.(d); first = false; }
        else {
          d.messages.forEach((m) => onMessage?.(m));
          for (const a of d.agents) {
            const sig = a.state + '|' + a.note;
            if (known.get(a.name) !== sig) onAgent?.(a);
          }
        }
        d.agents.forEach((a) => known.set(a.name, a.state + '|' + a.note));
        lastId = d.latest;
      } catch { onStatus?.(false); }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }, 5000);
  return es;
}

export const STAGE_CSS = `
.swarm-stage { position:relative; overflow:hidden; background:radial-gradient(ellipse at 50% 50%, #151826 0%, #0b0c13 50%, #050508 100%); }
.swarm-fx { position:absolute; inset:0; pointer-events:none; }
.swarm-nodes { position:absolute; inset:0; pointer-events:none; }
.swarm-node { position:absolute; left:0; top:0; width:0; height:0; will-change:transform; }
.swarm-ring { position:absolute; left:0; top:0; transform:translate(-50%, -50%); border-radius:50%; display:grid; place-items:center; }
.swarm-ring::after { content:''; position:absolute; inset:-9px; border-radius:50%; border:1px solid color-mix(in srgb, var(--c) 40%, transparent); box-shadow:0 0 28px color-mix(in srgb, var(--c) 22%, transparent), inset 0 0 20px color-mix(in srgb, var(--c) 10%, transparent); transition:all .3s; }
.swarm-node.talking .swarm-ring::after { inset:-14px; border-color:var(--c); box-shadow:0 0 64px color-mix(in srgb, var(--c) 60%, transparent), inset 0 0 26px color-mix(in srgb, var(--c) 28%, transparent); }
.swarm-node.idle { filter:saturate(.4) brightness(.7); }
.swarm-label { position:absolute; left:0; top:calc(var(--r) + 16px); transform:translateX(-50%); display:flex; flex-direction:column; align-items:center; gap:2px; text-align:center; }
.swarm-name { font-weight:650; font-size:14px; color:#eef0f6; white-space:nowrap; text-shadow:0 2px 10px #000; }
.swarm-state { font-size:10.5px; color:var(--c); text-transform:uppercase; letter-spacing:.16em; white-space:nowrap; }
.swarm-role { font-size:11px; color:#8b8fa3; white-space:nowrap; max-width:190px; overflow:hidden; text-overflow:ellipsis; }
.swarm-hub .swarm-name { letter-spacing:.34em; font-size:12px; color:#9aa0b8; }
.swarm-bubble { position:absolute; left:0; bottom:calc(var(--r) + 18px); transform:translateX(-50%) translateY(8px) scale(.94); transform-origin:50% 100%; width:max-content; max-width:290px; background:rgba(20,22,32,.95); border:1px solid color-mix(in srgb, var(--c) 60%, #2a2d3a); color:#eef0f6; padding:9px 13px; border-radius:14px; font-size:13px; line-height:1.4; opacity:0; transition:opacity .25s, transform .35s cubic-bezier(.2,1.4,.4,1); box-shadow:0 10px 40px rgba(0,0,0,.6), 0 0 26px color-mix(in srgb, var(--c) 20%, transparent); z-index:5; }
.swarm-bubble.show { opacity:1; transform:translateX(-50%) translateY(0) scale(1); }
.swarm-bubble::after { content:''; position:absolute; top:100%; left:50%; transform:translateX(-50%); border:7px solid transparent; border-top-color:color-mix(in srgb, var(--c) 60%, #2a2d3a); }
`;
