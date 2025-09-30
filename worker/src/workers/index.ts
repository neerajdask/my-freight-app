import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// Load worker-local .env, then also project root .env (non-overriding)
config();
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootEnv = path.resolve(__dirname, '../../.env');
  config({ path: rootEnv, override: false });
} catch {}
import { Worker } from '@temporalio/worker';
import * as activities from '../activities';

export async function runWorker() {
  const worker = await Worker.create({
    // ESM-friendly path to the workflows entry module
    workflowsPath: new URL('../workflows/index.ts', import.meta.url).pathname,
    activities,
    taskQueue: 'deliveries'
  });
  console.log('[Worker] started on taskQueue=deliveries');
  await worker.run();
}

// ESM entry: always start worker when this module is executed
runWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
