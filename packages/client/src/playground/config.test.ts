import { afterEach, describe, expect, test, vi } from 'vitest';
import { readPlaygroundConfig } from './config.js';

describe('readPlaygroundConfig', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('defaults: interactive mode, not readonly, apiBase empty (same origin)', () => {
    vi.stubGlobal('location', { search: '', origin: 'https://reef.example' });
    expect(readPlaygroundConfig()).toEqual({
      mode: 'interactive',
      readonly: false,
      apiBase: '',
      plantUrl: 'https://reef.example/',
    });
  });

  test('?mode=screen → screen mode (auto-orbit, no picker)', () => {
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readPlaygroundConfig().mode).toBe('screen');
  });

  test('?readonly=1 → readonly flag true', () => {
    vi.stubGlobal('location', { search: '?readonly=1' });
    expect(readPlaygroundConfig().readonly).toBe(true);
  });

  test('?api=http://localhost:8787 → apiBase set', () => {
    vi.stubGlobal('location', { search: '?api=http://localhost:8787' });
    expect(readPlaygroundConfig().apiBase).toBe('http://localhost:8787');
  });

  test('unknown mode falls back to interactive', () => {
    vi.stubGlobal('location', { search: '?mode=rubbish' });
    expect(readPlaygroundConfig().mode).toBe('interactive');
  });

  test('combined: mode=screen + api override', () => {
    vi.stubGlobal('location', { search: '?mode=screen&api=http://reef.example' });
    const c = readPlaygroundConfig();
    expect(c.mode).toBe('screen');
    expect(c.apiBase).toBe('http://reef.example');
  });

  test('?mode=gallery is an alias for screen mode', () => {
    vi.stubGlobal('location', { search: '?mode=gallery', origin: 'https://reef.example' });
    expect(readPlaygroundConfig().mode).toBe('screen');
  });

  test('?plant= overrides the planting URL shown in the gallery QR code', () => {
    vi.stubGlobal('location', { search: '?plant=' + encodeURIComponent('https://reef.example/?tracker=noop'), origin: 'https://x.test' });
    expect(readPlaygroundConfig().plantUrl).toBe('https://reef.example/?tracker=noop');
  });

  test('a non-http(s) ?plant= is ignored (no javascript: or data: QR codes)', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'not a url']) {
      vi.stubGlobal('location', { search: '?plant=' + encodeURIComponent(bad), origin: 'https://reef.example' });
      expect(readPlaygroundConfig().plantUrl).toBe('https://reef.example/');
    }
  });
});
