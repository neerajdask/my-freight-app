import { config } from 'dotenv';
config();
import { Connection, Client } from '@temporalio/client';

async function start(deliveryId: string, origin: string, destination: string, email: string) {
  const thresholdMinutes = Number(process.env.DELAY_THRESHOLD_MINUTES ?? '30');
  const notifyDeltaMinutes = Number(process.env.NOTIFY_DELTA_MINUTES ?? '10');
  const connection = await Connection.connect();
  const client = new Client({ connection });
  const isoDate = new Date().toISOString().slice(0, 10);
  const workflowId = `delivery-${deliveryId}-${isoDate}`;
  const handle = await client.workflow.start('monitorDeliveryWorkflow', {
    taskQueue: 'deliveries',
    workflowId,
    args: [{ deliveryId, origin, destination, recipientEmail: email, thresholdMinutes, notifyDeltaMinutes }]
  });
  console.log('Started', { workflowId, runId: handle.firstExecutionRunId });
}

async function main() {
  await start('seed-sf-oak', 'San Francisco, CA', 'Oakland, CA', 'customer1@example.com');
  await start('seed-la-sd', 'Los Angeles, CA', 'San Diego, CA', 'customer2@example.com');
  await start('seed-nyc-ewr', 'New York, NY', 'Newark, NJ', 'customer3@example.com');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
