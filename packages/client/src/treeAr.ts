import { TreeApp } from './treeApp.js';

const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const landing = document.getElementById('landing')!;
const video = document.getElementById('cam') as HTMLVideoElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const pickerRoot = document.getElementById('picker')!;
const statusEl = document.getElementById('status')!;

const app = new TreeApp({ canvas, video, pickerRoot, statusEl });
app.wireToolbar();

startBtn.addEventListener('click', async () => {
  landing.classList.add('hidden');
  try {
    await app.start();
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Could not start. Check camera permissions.';
    statusEl.classList.remove('hidden');
  }
});
