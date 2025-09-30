import { Client, Connection } from '@temporalio/client';
import { env } from './env';

let temporalClientPromise: Promise<Client> | null = null;
export async function getTemporalClient(): Promise<Client> {
  if (!temporalClientPromise) {
    temporalClientPromise = (async () => {
      const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
      return new Client({ connection });
    })();
  }
  return temporalClientPromise;
}
