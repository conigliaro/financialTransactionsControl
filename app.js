import { initializeBridge } from './host/bridge-client.js';
import { FinancieApp } from './financie-app.js';

async function boot() {
  try {
    await initializeBridge();
  } catch {
    // Bridge is optional for standalone usage; send flows handle not-ready state.
  }

  const app = new FinancieApp();
  await app.init();
}

window.addEventListener('load', () => {
  void boot();
});

