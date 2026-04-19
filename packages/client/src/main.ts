import { App } from './app.js';

const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const landing = document.getElementById('landing')!;
const video = document.getElementById('cam') as HTMLVideoElement;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const picker = document.getElementById('picker')!;
const status = document.getElementById('status')!;

startBtn.addEventListener('click', async () => {
  landing.classList.add('hidden');
  const app = new App({ canvas, video, pickerRoot: picker, statusEl: status });
  try {
    await app.start();
  } catch (e) {
    console.error(e);
    status.textContent = 'Could not start. Check camera permissions.';
    status.classList.remove('hidden');
  }
});
