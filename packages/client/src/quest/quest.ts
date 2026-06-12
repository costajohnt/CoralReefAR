import { initQuestBootstrap } from './bootstrap.js';

const button = document.getElementById('enter-mr') as HTMLButtonElement | null;
const status = document.getElementById('status') as HTMLDivElement | null;

void initQuestBootstrap(button, status);
