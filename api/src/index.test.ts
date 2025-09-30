import request from 'supertest';
import express from 'express';
import cors from 'cors';
import { healthRouter } from './routes/health';
import { workflowsRouter } from './routes/workflows';
import { vi, describe, it } from 'vitest';
import { expect } from 'vitest';

// Mock Temporal client for tests by setting env and stubbing getTemporalClient
vi.mock('./temporal', () => ({
  getTemporalClient: async () => ({
    workflow: {
      getHandle: (id: string) => ({
        describe: async () => ({ workflowExecutionInfo: { status: 1 } }), // RUNNING
        cancel: async () => {}
      }),
      start: async (_name: string, _opts: any) => ({ firstExecutionRunId: 'test-run' })
    }
  })
}));

const app = express();
app.use(cors());
app.use(express.json());
app.use(healthRouter());
app.use(workflowsRouter());

describe('API routes (mocked)', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /workflows/start', async () => {
    const res = await request(app)
      .post('/workflows/start')
      .send({ deliveryId: 't1', origin: 'A', destination: 'B', recipientEmail: 'x@y.com' });
    expect(res.status).toBe(202);
    expect(res.body.workflowId).toContain('delivery-t1-');
  });

  it('GET /workflows/:id/status', async () => {
    const res = await request(app).get('/workflows/test-id/status');
    expect(res.status).toBe(200);
    expect(res.body.statusMessage).toContain('Workflow test-id status');
  });

  it('POST /workflows/:id/cancel', async () => {
    const res = await request(app).post('/workflows/test-id/cancel');
    expect(res.status).toBe(202);
  });
});
