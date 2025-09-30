import { config } from 'dotenv';
config();
import { Connection, Client } from '@temporalio/client';
import { v4 as uuid } from 'uuid';

async function main() {
  const deliveryId = process.argv[2] ?? uuid();
  const origin = process.argv[3] ?? 'San Francisco, CA';
  const destination = process.argv[4] ?? 'Oakland, CA';
  const recipientEmail = process.argv[5] ?? 'customer@example.com';
  const thresholdMinutes = Number(process.env.DELAY_THRESHOLD_MINUTES ?? '30');
  const notifyDeltaMinutes = Number(process.env.NOTIFY_DELTA_MINUTES ?? '10');

  const connection = await Connection.connect();
  const client = new Client({ connection });
  const workflowId = `delivery-${deliveryId}-${new Date().toISOString().slice(0, 10)}`;

  const handle = await client.workflow.start('monitorDeliveryWorkflow', {
    taskQueue: 'deliveries',
    workflowId,
    args: [{ deliveryId, origin, destination, recipientEmail, thresholdMinutes, notifyDeltaMinutes }]
  });
  console.log('Started workflow', { workflowId, runId: handle.firstExecutionRunId });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
