import { describe, expect, test, vi } from 'vitest';

// We don't run the full tree entry in test — it calls WebGL and fetch.
// Instead, verify the module imports without throwing and the config parser
// + scene factory work together as expected.
describe('tree module', () => {
  test('config + scene + api all importable together', async () => {
    const [config, scene, api] = await Promise.all([
      import('./tree/config.js'),
      import('./tree/scene.js'),
      import('./tree/api.js'),
    ]);
    expect(typeof config.readTreeConfig).toBe('function');
    expect(typeof scene.createTreePedestal).toBe('function');
    expect(typeof api.fetchTree).toBe('function');
  });

  test('readTreeConfig + createTreePedestal produce a valid pair', async () => {
    const { readTreeConfig } = await import('./tree/config.js');
    const { createTreePedestal } = await import('./tree/scene.js');
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readTreeConfig().mode).toBe('screen');
    expect(createTreePedestal()).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
