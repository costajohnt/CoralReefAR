import { describe, expect, test, vi } from 'vitest';

// We don't run the full playground entry in test — it calls WebGL and fetch.
// Instead, verify the module imports without throwing and the config parser
// + scene factory work together as expected.
describe('playground module', () => {
  test('config + scene + autoOrbit + interaction all importable together', async () => {
    const [config, scene, autoOrbit, interaction] = await Promise.all([
      import('./playground/config.js'),
      import('./playground/scene.js'),
      import('./playground/autoOrbit.js'),
      import('./playground/interaction.js'),
    ]);
    expect(typeof config.readPlaygroundConfig).toBe('function');
    expect(typeof scene.createPedestal).toBe('function');
    expect(typeof autoOrbit.computeOrbitPose).toBe('function');
    expect(typeof interaction.computePlacementFromClick).toBe('function');
  });

  test('readPlaygroundConfig + createPedestal produce a valid pair', async () => {
    const { readPlaygroundConfig } = await import('./playground/config.js');
    const { createPedestal } = await import('./playground/scene.js');
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readPlaygroundConfig().mode).toBe('screen');
    expect(createPedestal()).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
