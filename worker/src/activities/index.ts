/**
 * Fetch traffic conditions for origin → destination.
 * Returns planned vs in-traffic durations and a derived delay in minutes.
 * Uses Google Distance Matrix when available; otherwise a mock.
 */
export async function fetchTrafficConditions(origin: string, destination: string) {
  const useMock = (process.env.USE_MOCK_TRAFFIC ?? 'false') === 'true';
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const provider = (process.env.TRAFFIC_PROVIDER ?? 'google_routes').toLowerCase();

  if (useMock || !apiKey) {
    const plannedSeconds = 3600; // 60m
    const inTrafficSeconds = 5400; // 90m
    const delayMinutes = Math.max(0, Math.round((inTrafficSeconds - plannedSeconds) / 60));
    console.log(`[TRAFFIC:MOCK] ${origin} → ${destination} delay=${delayMinutes}m`);
    return { plannedSeconds, inTrafficSeconds, delayMinutes };
  }

  // Prefer Google Routes API (new) over legacy Distance Matrix
  if (provider === 'google_routes') {
    const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      // Field mask reduces payload and is required by Routes
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration'
    };
    const body = {
      origin: { address: origin },
      destination: { address: destination },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      // Routes API requires a future timestamp if provided. Use +2 minutes.
      departureTime: new Date(Date.now() + 120_000).toISOString()
    } as any;

    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          console.error(`[TRAFFIC] Routes HTTP ${res.status} body=${bodyText}`);
          throw new Error(`Routes HTTP ${res.status}`);
        }
        const json: any = await res.json();
        const route = json?.routes?.[0];
        if (!route) throw new Error('Routes: missing routes[0]');
        const toSeconds = (dur: string | undefined): number => {
          if (!dur) return NaN;
          const m = dur.match(/^(\d+)s$/);
          return m ? Number(m[1]) : NaN;
        };
        const inTrafficSeconds = toSeconds(route.duration);
        const plannedSeconds = toSeconds(route.staticDuration) || inTrafficSeconds;
        if (!Number.isFinite(inTrafficSeconds) || !Number.isFinite(plannedSeconds)) {
          throw new Error('Routes: invalid duration fields');
        }
        const delayMinutes = Math.max(0, Math.round((inTrafficSeconds - plannedSeconds) / 60));
        console.log(`[TRAFFIC] ${origin} → ${destination} planned=${Math.round(plannedSeconds/60)}m inTraffic=${Math.round(inTrafficSeconds/60)}m delay=${delayMinutes}m`);
        return { plannedSeconds, inTrafficSeconds, delayMinutes };
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, attempt * 500));
      }
    }
    console.error('[TRAFFIC] Routes API failed:', lastError);
    throw lastError instanceof Error ? lastError : new Error('Routes API failure');
  }

  // Legacy fallback: Distance Matrix API (if provider=google_legacy)
  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    mode: 'driving',
    departure_time: 'now',
    traffic_model: 'best_guess',
    units: 'metric',
    key: apiKey
  });
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

  // simple retry (2 attempts)
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      if (json?.status && json.status !== 'OK') {
        const em = json?.error_message ?? '';
        console.error(`[TRAFFIC] API status=${json.status} error=${em}`);
        throw new Error(`DistanceMatrix status ${json.status}`);
      }
      const element = json?.rows?.[0]?.elements?.[0];
      if (!element) {
        throw new Error('DistanceMatrix: missing rows/elements');
      }
      if (element.status !== 'OK') {
        // Gracefully treat ZERO_RESULTS / NOT_FOUND as no available route (0 delay)
        if (element.status === 'ZERO_RESULTS' || element.status === 'NOT_FOUND') {
          console.warn(`[TRAFFIC] element.status=${element.status}; treating as no route → delay 0m`);
          return { plannedSeconds: 0, inTrafficSeconds: 0, delayMinutes: 0 };
        }
        throw new Error(`Element status ${element.status}`);
      }
      const plannedSeconds = Number(element.duration?.value);
      const inTrafficSeconds = Number(element.duration_in_traffic?.value ?? plannedSeconds);
      if (!Number.isFinite(plannedSeconds) || !Number.isFinite(inTrafficSeconds)) {
        throw new Error('Invalid duration fields in response');
      }
      const delayMinutes = Math.max(0, Math.round((inTrafficSeconds - plannedSeconds) / 60));
      console.log(`[TRAFFIC] ${origin} → ${destination} planned=${Math.round(plannedSeconds/60)}m inTraffic=${Math.round(inTrafficSeconds/60)}m delay=${delayMinutes}m`);
      return { plannedSeconds, inTrafficSeconds, delayMinutes };
    } catch (err) {
      lastError = err;
      const backoffMs = attempt * 500;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  console.error(`[TRAFFIC] Failed to fetch traffic:`, lastError);
  throw lastError instanceof Error ? lastError : new Error('Unknown traffic error');
}

/**
 * Generate a short friendly delay message.
 * Uses OpenAI when configured; otherwise a static fallback.
 */
export async function generateDelayMessage(context: { origin: string; destination: string; delayMinutes: number }) {
  const useMock = (process.env.USE_MOCK_AI ?? 'false') === 'true';
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const fallback = () =>
    `Heads up! Your delivery from ${context.origin} to ${context.destination} is delayed by about ${context.delayMinutes} minutes due to traffic. We'll keep you posted.`;

  if (useMock || !apiKey) {
    console.log('[AI:MOCK] returning template message');
    return fallback();
  }

  try {
    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: 'You write short, friendly delivery delay notifications. Do NOT include any sign-off or company name; one short paragraph only.'
        },
        {
          role: 'user',
          content: `A delivery from ${context.origin} to ${context.destination} is delayed by about ${context.delayMinutes} minutes due to traffic. Write a brief, friendly message to the customer.`
        }
      ]
    } as any;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenAI empty response');
    console.log(`[AI] message="${text}"`);
    return text;
  } catch (err) {
    console.error('[AI] failed, using fallback', err);
    const fb = fallback();
    console.log(`[AI:FALLBACK] message="${fb}"`);
    return fb;
  }
}

/**
 * Send an email notification with idempotency.
 * Uses SendGrid when configured; otherwise logs.
 */
export async function sendNotificationEmail(to: string, subject: string, body: string, idempotencyKey: string) {
  const useMock = (process.env.USE_MOCK_EMAIL ?? 'false') === 'true';
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? 'no-reply@freightapp.local';
  const sandbox = (process.env.SENDGRID_SANDBOX ?? 'false') === 'true';
  const companyName = process.env.COMPANY_NAME ?? 'MyFreightApp';
  const fromName = process.env.SENDGRID_FROM_NAME ?? companyName;
  const finalBody = `${body}\n\nBest,\n${companyName}`;

  if (useMock || !apiKey) {
    console.log(`[EMAIL:MOCK] to=${to} from=${fromEmail} subject=${subject} body=${finalBody}`);
    return;
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: 'text/plain', value: finalBody }],
      ...(sandbox ? { mail_settings: { sandbox_mode: { enable: true } } } : {})
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SendGrid HTTP ${res.status} ${text}`);
  }
  console.log(`[EMAIL] sent to=${to} from=${fromEmail} subject=${subject}${sandbox ? ' (sandbox)' : ''}`);
}
