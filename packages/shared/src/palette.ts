export interface PaletteEntry {
  key: string;
  name: string;
  hex: string;
}

export const REEF_PALETTE: readonly PaletteEntry[] = [
  { key: 'coral-pink', name: 'Coral Pink', hex: '#ff8572' },
  { key: 'anemone-purple', name: 'Anemone Purple', hex: '#9b5de5' },
  { key: 'deep-red', name: 'Deep Red', hex: '#c42030' },
  { key: 'pale-yellow', name: 'Pale Yellow', hex: '#ffe9a8' },
  { key: 'teal', name: 'Teal', hex: '#2ec4b6' },
  { key: 'mint', name: 'Reef Mint', hex: '#7fd8be' },
  { key: 'sunset-orange', name: 'Sunset Orange', hex: '#ff9f1c' },
  { key: 'sand', name: 'Sand', hex: '#e6cfa7' },
  { key: 'cerulean', name: 'Cerulean', hex: '#1d6fa5' },
  { key: 'plum', name: 'Plum', hex: '#6d2e46' },
] as const;

const byKey = new Map(REEF_PALETTE.map((p) => [p.key, p] as const));

export function paletteByKey(key: string): PaletteEntry {
  const entry = byKey.get(key);
  if (!entry) throw new Error(`Unknown palette key: ${key}`);
  return entry;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
