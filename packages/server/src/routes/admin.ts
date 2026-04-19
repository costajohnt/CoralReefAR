import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import type { Hub } from '../hub.js';

function requireAdmin(token: string | undefined): boolean {
  if (!token || !config.adminToken) return false;
  // Hash both to fixed-size 32-byte digests before timingSafeEqual so the
  // comparison runs in constant time regardless of the submitted token's
  // length. Raw-buffer compare leaks length through an early-return branch.
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(config.adminToken).digest();
  return timingSafeEqual(a, b);
}

// Check admin bearer token. Returns true on success; on failure writes a
// 401 response and returns false — callers should return immediately.
function checkAdminAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const auth = req.headers['authorization'];
  const token = auth?.toString().replace(/^Bearer\s+/i, '');
  if (!requireAdmin(token)) {
    void reply.status(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

// Parse admin auth + :id path param. Returns the id on success, or null after
// writing a 401/400 response — callers should return immediately when null.
function authorizeAndParseId(req: FastifyRequest, reply: FastifyReply): number | null {
  if (!checkAdminAuth(req, reply)) return null;
  const id = Number((req.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    void reply.status(400).send({ error: 'invalid_id' });
    return null;
  }
  return id;
}

export function registerAdminRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  app.delete<{ Params: { id: string } }>('/api/admin/polyp/:id', async (req, reply) => {
    const id = authorizeAndParseId(req, reply);
    if (id === null) return reply;
    const ok = db.softDeletePolyp(id);
    if (!ok) return reply.status(404).send({ error: 'not_found' });
    try {
      hub.broadcast({ type: 'polyp_removed', id });
    } catch (err) {
      req.log.warn({ err, id }, 'hub broadcast failed after delete');
    }
    return { ok: true };
  });

  app.get('/api/admin/deleted', async (req, reply) => {
    if (!checkAdminAuth(req, reply)) return reply;
    return { polyps: db.listDeletedPolyps() };
  });

  app.post<{ Params: { id: string } }>('/api/admin/polyp/:id/restore', async (req, reply) => {
    const id = authorizeAndParseId(req, reply);
    if (id === null) return reply;
    const pub = db.restorePolyp(id);
    if (!pub) return reply.status(404).send({ error: 'not_found' });
    try {
      hub.broadcast({ type: 'polyp_added', polyp: pub });
    } catch (err) {
      req.log.warn({ err, id }, 'hub broadcast failed after restore');
    }
    return pub;
  });

  // The admin page itself is a static HTML shell with no secrets; it prompts
  // for a token in memory and uses it only as a Bearer header on API calls.
  // No gating on GET /admin — the delete endpoint is the actual auth boundary.
  app.get('/admin', async (_req, reply) => {
    reply.type('text/html');
    return adminHtml();
  });
}

function adminHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Reef Admin</title>
<style>
body{font:14px system-ui;padding:1.5rem;background:#111;color:#eee}
button{border:0;padding:0.3rem 0.7rem;border-radius:4px;cursor:pointer;color:#fff}
button.danger{background:#c42030}
button.restore{background:#1f7a3a}
table{border-collapse:collapse;width:100%;margin-bottom:1.5rem}
td,th{padding:0.3rem 0.6rem;border-bottom:1px solid #333;text-align:left}
h2{font-size:1rem;margin:1.5rem 0 0.5rem;color:#bcd}
.count{color:#8ab;font-weight:400}
</style>
</head><body><h1>Reef admin</h1>
<p>Paste an admin token and click load. The token never leaves this page.</p>
<input id=tok type=password placeholder="admin token" style="padding:0.3rem;width:20rem"/>
<button id=loadBtn>Load</button>
<h2>Live <span class=count id=liveCount></span></h2>
<table id=liveTable></table>
<h2>Deleted <span class=count id=delCount></span></h2>
<table id=delTable></table>
<script>
const $ = (id) => document.getElementById(id);
function rowOf(p, actionText, actionClass, onAction) {
  const tr = document.createElement('tr');
  for (const v of [p.id, p.species, p.colorKey, new Date(p.createdAt).toISOString()]) {
    const td = document.createElement('td'); td.textContent = String(v); tr.appendChild(td);
  }
  const tdBtn = document.createElement('td');
  const btn = document.createElement('button');
  btn.textContent = actionText; btn.className = actionClass;
  btn.addEventListener('click', () => onAction(p.id));
  tdBtn.appendChild(btn); tr.appendChild(tdBtn);
  return tr;
}
function paint(table, headers, rows) {
  table.replaceChildren();
  const h = document.createElement('tr');
  for (const label of headers) { const th = document.createElement('th'); th.textContent = label; h.appendChild(th); }
  table.appendChild(h);
  for (const r of rows) table.appendChild(r);
}
async function authFetch(url, init) {
  const tok = $('tok').value;
  if (!tok) { alert('paste token first'); return null; }
  return fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: 'Bearer ' + tok } });
}
async function load() {
  const tok = $('tok').value;
  if (!tok) { alert('paste token first'); return; }
  const [liveR, delR] = await Promise.all([
    fetch('/api/reef'),
    fetch('/api/admin/deleted', { headers: { Authorization: 'Bearer ' + tok } }),
  ]);
  if (!delR.ok) { alert('auth failed: ' + delR.status); return; }
  const live = (await liveR.json()).polyps || [];
  const deleted = (await delR.json()).polyps || [];
  $('liveCount').textContent = '(' + live.length + ')';
  $('delCount').textContent = '(' + deleted.length + ')';
  paint($('liveTable'), ['id','species','color','when',''], live.map(p => rowOf(p, 'delete', 'danger', del)));
  paint($('delTable'), ['id','species','color','when',''], deleted.map(p => rowOf(p, 'restore', 'restore', restore)));
}
async function del(id) {
  const r = await authFetch('/api/admin/polyp/' + encodeURIComponent(id), { method: 'DELETE' });
  if (!r || !r.ok) { alert('delete failed: ' + (r ? r.status : 'no token')); return; }
  load();
}
async function restore(id) {
  const r = await authFetch('/api/admin/polyp/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
  if (!r || !r.ok) { alert('restore failed: ' + (r ? r.status : 'no token')); return; }
  load();
}
$('loadBtn').addEventListener('click', load);
</script></body></html>`;
}
