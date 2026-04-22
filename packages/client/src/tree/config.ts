export type TreeMode = 'interactive' | 'screen';

export interface TreeConfig {
  mode: TreeMode;
  readonly: boolean;
  /** Empty string = same origin. Otherwise a URL like `http://localhost:8787`. */
  apiBase: string;
}

export function readTreeConfig(): TreeConfig {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const rawMode = params.get('mode');
  const mode: TreeMode = rawMode === 'screen' ? 'screen' : 'interactive';
  const readonly = params.get('readonly') === '1';
  const apiBase = params.get('api') ?? '';
  return { mode, readonly, apiBase };
}
