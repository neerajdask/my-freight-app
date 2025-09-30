import { z } from 'zod';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load local .env, then also try project root .env (one level up)
config();
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootEnv = path.resolve(__dirname, '../../.env');
  config({ path: rootEnv, override: false });
} catch {}

const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.string().default('development'),
  TEMPORAL_ADDRESS: z.string().default('localhost:7233')
});

export const env = envSchema.parse(process.env);
