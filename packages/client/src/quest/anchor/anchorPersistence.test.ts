import { describe, it, expect, beforeEach } from 'vitest';
import {
  persistFlagEnabled,
  loadAnchorHandle,
  saveAnchorHandle,
  clearAnchorHandle,
} from './anchorPersistence.js';

describe('persistFlagEnabled', () => {
  it('returns true for ?persist=1', () => {
    expect(persistFlagEnabled('?persist=1')).toBe(true);
  });
  it('returns false when absent', () => {
    expect(persistFlagEnabled('')).toBe(false);
    expect(persistFlagEnabled('?other=value')).toBe(false);
  });
  it('returns false for any non-"1" value', () => {
    expect(persistFlagEnabled('?persist=0')).toBe(false);
    expect(persistFlagEnabled('?persist=true')).toBe(false);
  });
});

describe('anchor handle storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('save -> load returns the same handle', () => {
    saveAnchorHandle('abc-123-uuid');
    expect(loadAnchorHandle()).toBe('abc-123-uuid');
  });

  it('load returns null when nothing is saved', () => {
    expect(loadAnchorHandle()).toBeNull();
  });

  it('clear removes a saved handle', () => {
    saveAnchorHandle('abc-123');
    clearAnchorHandle();
    expect(loadAnchorHandle()).toBeNull();
  });

  it('save tolerates a localStorage that throws (e.g. private browsing)', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
    try {
      expect(() => saveAnchorHandle('x')).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
