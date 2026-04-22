import { afterEach, describe, expect, test, vi } from 'vitest';
import { readTreeConfig } from './config.js';

describe('readTreeConfig', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('defaults: interactive mode, not readonly, apiBase empty (same origin)', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readTreeConfig()).toEqual({
      mode: 'interactive',
      readonly: false,
      apiBase: '',
    });
  });

  test('?mode=screen → screen mode (auto-orbit, no picker)', () => {
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readTreeConfig().mode).toBe('screen');
  });

  test('?readonly=1 → readonly flag true', () => {
    vi.stubGlobal('location', { search: '?readonly=1' });
    expect(readTreeConfig().readonly).toBe(true);
  });

  test('?api=http://localhost:8787 → apiBase set', () => {
    vi.stubGlobal('location', { search: '?api=http://localhost:8787' });
    expect(readTreeConfig().apiBase).toBe('http://localhost:8787');
  });

  test('unknown mode falls back to interactive', () => {
    vi.stubGlobal('location', { search: '?mode=rubbish' });
    expect(readTreeConfig().mode).toBe('interactive');
  });

  test('combined: mode=screen + api override', () => {
    vi.stubGlobal('location', { search: '?mode=screen&api=http://reef.example' });
    const c = readTreeConfig();
    expect(c.mode).toBe('screen');
    expect(c.apiBase).toBe('http://reef.example');
  });
});
