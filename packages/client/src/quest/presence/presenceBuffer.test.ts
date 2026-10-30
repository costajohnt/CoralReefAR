import { describe, it, expect } from 'vitest';
import { PresenceBuffer, presenceFlagEnabled } from './presenceBuffer.js';

const pose = (id: string, x: number, yaw = 0) => ({
  id, p: [x, 1.5, 0] as [number, number, number],
  q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] as [number, number, number, number],
});

function at(buf: PresenceBuffer, now: number) {
  const out = new Map<string, { x: number; qy: number }>();
  buf.sample(now, (id, p, q) => out.set(id, { x: p.x, qy: q.y }));
  return out;
}

describe('PresenceBuffer', () => {
  it('interpolates position and rotation between samples around now - delay', () => {
    const buf = new PresenceBuffer(400, 2000);
    buf.push([pose('a', 0, 0)], 1000);
    buf.push([pose('a', 1, Math.PI / 2)], 1200);
    const s = at(buf, 1500).get('a')!; // render time 1100: halfway
    expect(s.x).toBeCloseTo(0.5);
    expect(s.qy).toBeCloseTo(Math.sin(Math.PI / 8)); // slerp to 45 degrees
  });

  it('holds the newest sample when the stream runs dry (no extrapolation)', () => {
    const buf = new PresenceBuffer(400, 2000);
    buf.push([pose('a', 0)], 1000);
    buf.push([pose('a', 1)], 1200);
    expect(at(buf, 1900).get('a')!.x).toBe(1);
  });

  it('shows the oldest sample before the render time reaches it', () => {
    const buf = new PresenceBuffer(400, 2000);
    buf.push([pose('a', 3)], 1000);
    expect(at(buf, 1000).get('a')!.x).toBe(3);
  });

  it('picks the bracketing pair from several samples', () => {
    const buf = new PresenceBuffer(0, 2000);
    [0, 1, 2, 3].forEach((x, i) => buf.push([pose('a', x)], 1000 + i * 200));
    expect(at(buf, 1500).get('a')!.x).toBeCloseTo(2.5);
  });

  it('tracks visitors independently and culls the stale ones', () => {
    const buf = new PresenceBuffer(400, 2000);
    buf.push([pose('a', 0), pose('b', 5)], 1000);
    buf.push([pose('a', 1)], 2500);
    expect(buf.cull(3100)).toEqual(['b']);
    expect([...at(buf, 3100).keys()]).toEqual(['a']);
    expect(buf.cull(4600)).toEqual(['a']);
    expect(buf.size()).toBe(0);
  });
});

describe('presenceFlagEnabled', () => {
  it('is on only for ?presence=1', () => {
    expect(presenceFlagEnabled('?presence=1')).toBe(true);
    expect(presenceFlagEnabled('')).toBe(false);
    expect(presenceFlagEnabled('?presence=true')).toBe(false);
  });
});
