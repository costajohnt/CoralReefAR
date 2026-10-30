// Fake co-presence visitor (#114) for checking presence with one headset.
// Connects to /ws and sends a head pose circling the reef origin at 5 Hz,
// 1.2 m out and 1.5 m up, always facing the centre. Needs PRESENCE_ENABLED=1.
// Run: node packages/server/scripts/presence-bot.mjs [ws://localhost:8787/ws]
import WebSocket from 'ws';

const url = process.argv[2] ?? 'ws://localhost:8787/ws';
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log(`presence bot connected to ${url}; Ctrl-C to stop`);
  const start = Date.now();
  setInterval(() => {
    const a = ((Date.now() - start) / 12_000) * Math.PI * 2; // one lap per 12 s
    // Yaw so local -Z (gaze) points at the origin from (sin a, cos a) * r.
    const yaw = a;
    ws.send(JSON.stringify({
      type: 'presence',
      p: [Math.sin(a) * 1.2, 1.5, Math.cos(a) * 1.2],
      q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    }));
  }, 200);
});
let seen = '';
ws.on('message', (d) => {
  const msg = JSON.parse(String(d));
  if (msg.type !== 'presence') return;
  const ids = msg.visitors.map((v) => v.id).sort().join(', ');
  if (ids !== seen) console.log(`sees: ${(seen = ids)}`);
});
ws.on('close', (code) => { console.log('closed', code); process.exit(0); });
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
