// Workflow orchestrates the multi-step delay notification logic.
// Signals allow external control (snooze, restart, immediate check).
import * as wf from '@temporalio/workflow';

const { fetchTrafficConditions, generateDelayMessage, sendNotificationEmail } = wf.proxyActivities<{
  fetchTrafficConditions: (origin: string, destination: string) => Promise<{ plannedSeconds: number; inTrafficSeconds: number; delayMinutes: number }>;
  generateDelayMessage: (context: { origin: string; destination: string; delayMinutes: number }) => Promise<string>;
  sendNotificationEmail: (to: string, subject: string, body: string, idempotencyKey: string) => Promise<void>;
}>({ startToCloseTimeout: '2 minutes' });

export interface MonitorArgs {
  deliveryId: string;
  origin: string;
  destination: string;
  recipientEmail: string;
  thresholdMinutes: number;
  notifyDeltaMinutes: number;
}

// Signals allow external callers (API/CLI) to asynchronously influence a running workflow
// without restarting it. These handlers update in-memory workflow state deterministically.
export const snooze = wf.defineSignal<[minutes: number]>('snooze');
export const routeRestarted = wf.defineSignal('routeRestarted');
export const checkNow = wf.defineSignal('checkNow');

export async function monitorDeliveryWorkflow(args: MonitorArgs): Promise<void> {
  // Tracks the largest delay we've notified about to prevent spammy repeats
  let highestNotifiedDelayMinutes = 0;
  // Monotonic sequence to build deterministic idempotency keys for notifications
  let notificationSequence = 0;
  // Track whether we've ever notified over-threshold, to send a single "all clear"
  let hasNotifiedOverThreshold = false;
  // If set, we will sleep for this many milliseconds before next check
  let snoozeSleepMs: number | null = null;
  // If true, skip waiting and run the next check immediately once
  let shouldCheckNow = false;

  // Attach signal handlers
  wf.setHandler(snooze, (minutes: number) => {
    const ms = Math.max(0, Math.floor(minutes) * 60_000);
    snoozeSleepMs = ms;
  });
  wf.setHandler(routeRestarted, () => {
    highestNotifiedDelayMinutes = 0;
  });
  wf.setHandler(checkNow, () => {
    shouldCheckNow = true;
  });

  while (true) {
    // Respect snooze: if we have a pending snooze and no immediate check requested, sleep
    if (snoozeSleepMs !== null && !shouldCheckNow) {
      const ms = snoozeSleepMs;
      snoozeSleepMs = null;
      await wf.sleep(ms as any);
    }

    const traffic = await fetchTrafficConditions(args.origin, args.destination);
    const delay = traffic.delayMinutes;
    // Anti-spam: only notify first time over threshold or when delay increases sufficiently
    if (delay >= args.thresholdMinutes && delay >= highestNotifiedDelayMinutes + args.notifyDeltaMinutes) {
      const body = await generateDelayMessage({ origin: args.origin, destination: args.destination, delayMinutes: delay });
      const subject = `Delay update for delivery ${args.deliveryId}`;
      notificationSequence += 1;
      const idempotencyKey = `${args.deliveryId}-${notificationSequence}`;
      await sendNotificationEmail(args.recipientEmail, subject, body, idempotencyKey);
      highestNotifiedDelayMinutes = delay;
      hasNotifiedOverThreshold = true;
    }

    // If we previously notified and now the delay is back below threshold, send a one-time "all clear" message
    if (hasNotifiedOverThreshold && delay < args.thresholdMinutes) {
      const body = `Good news! Traffic has improved and your delivery from ${args.origin} to ${args.destination} is back on track. We'll keep monitoring.`;
      const subject = `Update for delivery ${args.deliveryId}: back on track`;
      notificationSequence += 1;
      const idempotencyKey = `${args.deliveryId}-${notificationSequence}`;
      await sendNotificationEmail(args.recipientEmail, subject, body, idempotencyKey);
      // Reset state so future increases can notify again
      hasNotifiedOverThreshold = false;
      highestNotifiedDelayMinutes = 0;
    }

    // Reset one-shot immediate check flag after executing a cycle
    if (shouldCheckNow) {
      shouldCheckNow = false;
    }

    // Base polling interval (deterministic; avoid Math.random in workflows)
    // Base interval between checks (env-configurable in future)
    const baseMs = 30 * 60 * 1000; // 30 minutes
    await wf.sleep(baseMs as any);
  }
}
