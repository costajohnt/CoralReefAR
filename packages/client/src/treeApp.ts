export interface TreeAppOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  pickerRoot: HTMLElement;
  statusEl: HTMLElement;
}

export class TreeApp {
  constructor(readonly opts: TreeAppOptions) {}

  async start(): Promise<void> {}

  stop(): void {}
}
