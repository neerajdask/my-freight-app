import { Router } from 'express';
import { z } from 'zod';
import { getTemporalClient } from '../temporal';

export function workflowsRouter() {
  const r = Router();

  r.get('/workflows/:id/status', async (req, res) => {
    const id = req.params.id as string;
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(id);
      const desc = await handle.describe();
      const info = (desc as any).workflowExecutionInfo ?? (desc as any).executionInfo;
      const statusEnum = info?.status;
      const statusNameMap = ['STATUS_UNSPECIFIED','RUNNING','COMPLETED','FAILED','CANCELED','TERMINATED','CONTINUED_AS_NEW','TIMED_OUT'];
      const statusName = typeof statusEnum === 'number' ? (statusNameMap[statusEnum] ?? String(statusEnum)) : String(statusEnum ?? 'STATUS_UNKNOWN');
      res.json({ statusMessage: `Workflow ${id} status: ${statusName}` });
    } catch (err: any) {
      console.error('describe failed', err);
      res.status(404).json({ statusMessage: `Workflow ${id} not found or Temporal unavailable` });
    }
  });

  r.post('/workflows/start', async (req, res) => {
    try {
      const body = req.body as any;
      const schema = z.object({
        deliveryId: z.string().min(1),
        origin: z.string().min(1),
        destination: z.string().min(1),
        recipientEmail: z.string().email(),
        thresholdMinutes: z.number().int().positive().default(30),
        notifyDeltaMinutes: z.number().int().positive().default(10)
      });
      const parsed = schema.parse(body);

      const isoDate = new Date().toISOString().slice(0, 10);
      const workflowId = `delivery-${parsed.deliveryId}-${isoDate}`;

      const client = await getTemporalClient();
      const handle = await client.workflow.start('monitorDeliveryWorkflow', {
        taskQueue: 'deliveries',
        workflowId,
        args: [parsed]
      });
      return res.status(202).json({ workflowId, runId: handle.firstExecutionRunId });
    } catch (err: any) {
      console.error('start failed', err);
      return res.status(503).json({ error: 'Temporal unavailable or start failed' });
    }
  });

  r.post('/workflows/:id/cancel', async (req, res) => {
    const id = req.params.id as string;
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(id);
      await handle.cancel();
      res.status(202).json({ ok: true, message: `Cancel requested for ${id}` });
    } catch (err: any) {
      console.error('cancel failed', err);
      res.status(404).json({ ok: false, error: `Workflow ${id} not found or Temporal unavailable` });
    }
  });

  // Signals
  r.post('/workflows/:id/snooze', async (req, res) => {
    const id = req.params.id as string;
    const minutes = Math.max(1, Number((req.body as any)?.minutes ?? 30));
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(id);
      // signal method name must match workflow signal export
      // @ts-ignore
      await handle.signal('snooze', minutes);
      res.status(202).json({ ok: true, message: `Snoozed ${id} for ${minutes} minutes` });
    } catch (err) {
      console.error('snooze failed', err);
      res.status(404).json({ ok: false, error: `Workflow ${id} not found or Temporal unavailable` });
    }
  });

  r.post('/workflows/:id/route-restarted', async (req, res) => {
    const id = req.params.id as string;
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(id);
      // @ts-ignore
      await handle.signal('routeRestarted');
      res.status(202).json({ ok: true, message: `Route restarted acknowledged for ${id}` });
    } catch (err) {
      console.error('routeRestarted failed', err);
      res.status(404).json({ ok: false, error: `Workflow ${id} not found or Temporal unavailable` });
    }
  });

  r.post('/workflows/:id/check-now', async (req, res) => {
    const id = req.params.id as string;
    try {
      const client = await getTemporalClient();
      const handle = client.workflow.getHandle(id);
      // @ts-ignore
      await handle.signal('checkNow');
      res.status(202).json({ ok: true, message: `Requested immediate check for ${id}` });
    } catch (err) {
      console.error('checkNow failed', err);
      res.status(404).json({ ok: false, error: `Workflow ${id} not found or Temporal unavailable` });
    }
  });

  return r;
}
