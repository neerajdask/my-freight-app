### FreightApp

TypeScript project to monitor traffic delays on freight routes and notify customers using Temporal.

#### Prerequisites
- Node.js 18+ and npm
- Temporal dev server:
  - Temporal CLI: `brew install temporal` then `temporal server start-dev` (UI at http://localhost:8233)

#### Structure
```
packages/shared-types/   # shared DTOs and schemas
worker/                  # Temporal workflows and activities
api/                     # Minimal backend API
.env.example             # environment variables template
discussion.md            # approaches, decisions, conventions
```

#### Environments
- Copy `.env.example` to `.env` and fill secrets locally.

#### Roles
- Backend: `worker` (Temporal) + `api` service

#### Seed sample workflows
- Start Temporal, worker, and API as described earlier, then run:
```
cd worker && npm run seed
```
This starts three sample deliveries (SF→Oakland, LA→San Diego, NYC→Newark).

#### Setup
- Copy `.env.example` to `.env` and set keys. For real integrations, set:
  - `USE_MOCK_TRAFFIC=false`, `USE_MOCK_AI=false`, `USE_MOCK_EMAIL=false`
  - `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`, `SENDGRID_API_KEY`
  - `SENDGRID_FROM_EMAIL` (verified sender) and optional `SENDGRID_FROM_NAME`
  - `COMPANY_NAME` (defaults to `MyFreightApp`)
- Start services:
  - Temporal: `temporal server start-dev` (UI at http://localhost:8233)
  - Worker: `cd worker && npm i && npm run dev`
  - API: `cd api && npm i && npm run dev`

#### Quick test (real services)
1) Start a workflow (replace with your email):
```
curl -X POST http://localhost:3001/workflows/start \
  -H "Content-Type: application/json" \
  -d '{"deliveryId":"demo","origin":"San Francisco, CA","destination":"Oakland, CA","recipientEmail":"you@example.com","thresholdMinutes":5,"notifyDeltaMinutes":1}'
```
2) Force an immediate run:
```
curl -X POST "http://localhost:3001/workflows/delivery-demo-$(date +%F)/check-now"
```
3) Expect in worker terminal:
- `[TRAFFIC] … planned=…m inTraffic=…m delay=…m`
- `[AI] message="…"`
- `[EMAIL] sent to=… from=… subject=…`

#### Control endpoints
- Health: `GET /health` → simple `{ ok: true }`
- Start: `POST /workflows/start` → starts a monitoring workflow
- Status: `GET /workflows/:id/status` → returns current workflow status
- Snooze: `POST /workflows/:id/snooze { minutes }` → pause checks temporarily
- Route restarted: `POST /workflows/:id/route-restarted` → reset anti‑spam high‑water mark
- Check‑now: `POST /workflows/:id/check-now` → run an immediate check
- Cancel: `POST /workflows/:id/cancel` → request workflow cancellation

#### Common issues
- SendGrid 403: verify `SENDGRID_FROM_EMAIL` sender identity or enable sandbox `SENDGRID_SANDBOX=true`.
- Google errors: ensure Routes API enabled and key restricted properly.
- Still mocked: confirm `USE_MOCK_*` are `false` in the worker environment and restart.

#### Limitations (current MVP)
- No authentication/authorization on the API (dev-only).
- No geocoding endpoint; origin/destination are free-text (documented as future work).
- Email only (SendGrid); no SMS provider wired.
- No persistent DB for deliveries/notifications; relies on Temporal history and logs.
- Fixed 30‑minute polling interval; no deterministic staggering per delivery yet.
- No provider rate limiting/circuit breaker (beyond simple retries) in activities.
- Minimal observability; no metrics/trace export yet.
- Single task queue (`deliveries`); no regional/tenant partitioning.

#### Future improvements
- Add `/geocode` endpoint and accept `place_id`/lat,lng in Start requests.
- Deterministic staggering of check times; env‑tunable polling interval.
- Basic metrics (checks/sec, activity latency, error rates) and OpenTelemetry traces.
- Optional DB for audit of deliveries/notifications and idempotency keys.
- SMS channel (Twilio) and Slack/Webhook notifications.
- Secrets management (platform env/manager) and production config profiles.
- Swagger UI to serve `api/openapi.yaml` locally.

#### Build/run note for worker path
- In dev (`npm run dev`) the worker uses the TypeScript path for `workflowsPath`.
- For a compiled deploy (`npm run build` then `npm run start`), point to the built JS:
  - `workflowsPath: new URL('../workflows/index.js', import.meta.url).pathname`
  - Or switch based on `NODE_ENV`.
