import express from 'express';
import cors from 'cors';
import { env } from './env';
import { healthRouter } from './routes/health';
import { workflowsRouter } from './routes/workflows';

const app = express();
app.use(cors());
app.use(express.json());

app.use(healthRouter());
app.use(workflowsRouter());

app.listen(Number(env.PORT), '0.0.0.0', () => {
  console.log(`API listening on :${env.PORT}`);
});
