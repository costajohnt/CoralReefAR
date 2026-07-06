import { QuestApp } from './questApp.js';

/**
 * Wire the "Enter MR" 2D page to a QuestApp. Lives in its own module
 * (separate from quest.ts) so it can be unit-tested without the
 * top-level side effects of the entry file.
 *
 * Returns the constructed QuestApp on success (so tests can drive it),
 * or null when WebXR isn't usable in this environment — non-Quest
 * browsers, immersive-ar unsupported, missing DOM. The on-page button
 * + status are updated in either case so a visitor on a phone sees a
 * helpful message instead of a dead button.
 */
export async function initQuestBootstrap(
  button: HTMLButtonElement | null,
  status: HTMLDivElement | null,
): Promise<QuestApp | null> {
  if (!button || !status) return null;
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) {
    button.textContent = 'WebXR not available';
    status.textContent = 'Open this page in the Meta Quest Browser.';
    return null;
  }
  const supported = await xr.isSessionSupported('immersive-ar').catch(() => false);
  if (!supported) {
    button.textContent = 'Immersive AR unsupported';
    status.textContent =
      'This device or browser cannot enter immersive-ar mode. The Meta Quest Browser supports it natively.';
    return null;
  }
  button.textContent = 'Enter MR';
  button.disabled = false;
  const app = new QuestApp({ button, status });
  button.addEventListener('click', () => {
    void app.start();
  });
  return app;
}
