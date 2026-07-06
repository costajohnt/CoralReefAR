import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initQuestBootstrap } from './bootstrap.js';

function mockUi() {
  const button = document.createElement('button');
  button.disabled = true;
  button.textContent = 'Checking WebXR…';
  const status = document.createElement('div');
  return { button, status };
}

describe('initQuestBootstrap', () => {
  beforeEach(() => {
    delete (navigator as Navigator & { xr?: XRSystem }).xr;
  });

  afterEach(() => {
    delete (navigator as Navigator & { xr?: XRSystem }).xr;
  });

  it('returns null and surfaces a helpful message when WebXR is absent', async () => {
    const { button, status } = mockUi();
    const app = await initQuestBootstrap(button, status);
    expect(app).toBeNull();
    expect(button.textContent).toBe('WebXR not available');
    expect(status.textContent).toMatch(/Meta Quest Browser/);
  });

  it('returns null when immersive-ar is not supported', async () => {
    (navigator as Navigator & { xr?: XRSystem }).xr = {
      isSessionSupported: vi.fn().mockResolvedValue(false),
      requestSession: vi.fn(),
    } as unknown as XRSystem;
    const { button, status } = mockUi();
    const app = await initQuestBootstrap(button, status);
    expect(app).toBeNull();
    expect(button.textContent).toBe('Immersive AR unsupported');
  });

  it('returns null when isSessionSupported rejects (treats throw as unsupported)', async () => {
    (navigator as Navigator & { xr?: XRSystem }).xr = {
      isSessionSupported: vi.fn().mockRejectedValue(new Error('SecurityError')),
      requestSession: vi.fn(),
    } as unknown as XRSystem;
    const { button, status } = mockUi();
    const app = await initQuestBootstrap(button, status);
    expect(app).toBeNull();
    expect(button.textContent).toBe('Immersive AR unsupported');
  });

  it('returns a QuestApp + enables the button when WebXR is supported', async () => {
    (navigator as Navigator & { xr?: XRSystem }).xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
      requestSession: vi.fn(),
    } as unknown as XRSystem;
    const { button, status } = mockUi();
    const app = await initQuestBootstrap(button, status);
    expect(app).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Enter MR');
    expect(status.textContent).toBe('');
  });

  it('returns null when DOM nodes are missing (safe early-exit)', async () => {
    const app = await initQuestBootstrap(null, null);
    expect(app).toBeNull();
  });
});
