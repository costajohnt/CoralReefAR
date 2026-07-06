import { describe, it, expect } from 'vitest';
import type { PublicPolyp, ServerMessage, SimDelta } from '@reef/shared';
import { Reef } from '../scene/reef.js';
import { applyServerMessage } from './serverMessageHandler.js';

function polyp(id: number): PublicPolyp {
  return {
    id,
    species: 'branching',
    seed: id * 17,
    colorKey: 'coral-pink',
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: 1,
    createdAt: 1700000000000 + id,
  };
}

function simDelta(polypId: number): SimDelta {
  return {
    polypId,
    kind: 'algae',
    params: {},
    createdAt: Date.now(),
  };
}

describe('applyServerMessage', () => {
  it('polyp_added adds the polyp to the reef', () => {
    const reef = new Reef();
    const msg: ServerMessage = { type: 'polyp_added', polyp: polyp(1) };
    applyServerMessage(reef, msg);
    expect(reef.hasPolyp(1)).toBe(true);
  });

  it('polyp_added is idempotent (re-broadcast does not double-insert)', () => {
    const reef = new Reef();
    const msg: ServerMessage = { type: 'polyp_added', polyp: polyp(1) };
    applyServerMessage(reef, msg);
    applyServerMessage(reef, msg);
    expect(reef.anchor.children).toHaveLength(1);
  });

  it('polyp_removed deletes the polyp', () => {
    const reef = new Reef();
    applyServerMessage(reef, { type: 'polyp_added', polyp: polyp(1) });
    applyServerMessage(reef, { type: 'polyp_removed', id: 1 });
    expect(reef.hasPolyp(1)).toBe(false);
  });

  it('polyp_removed for an unknown id is a safe no-op', () => {
    const reef = new Reef();
    expect(() => applyServerMessage(reef, { type: 'polyp_removed', id: 999 })).not.toThrow();
  });

  it('sim_update applies each delta in order', () => {
    const reef = new Reef();
    applyServerMessage(reef, { type: 'polyp_added', polyp: polyp(1) });
    applyServerMessage(reef, { type: 'polyp_added', polyp: polyp(2) });
    const msg: ServerMessage = {
      type: 'sim_update',
      updates: [simDelta(1), simDelta(2)],
    };
    // No assertion on visual state — just that applying does not throw and
    // does not remove polyps. simDecor unit tests cover the visual side.
    expect(() => applyServerMessage(reef, msg)).not.toThrow();
    expect(reef.hasPolyp(1)).toBe(true);
    expect(reef.hasPolyp(2)).toBe(true);
  });

  it('hello is a no-op (does not crash on empty reef)', () => {
    const reef = new Reef();
    const msg: ServerMessage = { type: 'hello', polypCount: 7, serverTime: 1 };
    expect(() => applyServerMessage(reef, msg)).not.toThrow();
  });
});
