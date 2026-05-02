import cron from 'node-cron';
import { settingsRepo } from '../db/settingsRepository';
import { runFullSync } from './syncJob';

let currentTask: cron.ScheduledTask | null = null;
let schedulerRunning = false;

/**
 * Reads schedule settings and starts the cron job if scheduling is enabled.
 * Safe to call at server startup.
 */
export function startScheduler(): void {
  const enabled = settingsRepo.get('schedule_enabled') === 'true';
  if (!enabled) {
    console.log('[scheduler] Scheduling is disabled — skipping');
    return;
  }

  const cronExpr = settingsRepo.get('schedule_cron');
  if (!cronExpr || !cron.validate(cronExpr)) {
    console.warn('[scheduler] Invalid or missing cron expression, skipping');
    return;
  }

  currentTask = cron.schedule(cronExpr, async () => {
    if (schedulerRunning) {
      console.log('[scheduler] Skipping run — sync already in progress');
      return;
    }
    schedulerRunning = true;
    const startedAt = new Date().toISOString();
    console.log(`[scheduler] Starting full sync at ${startedAt}`);

    try {
      const { plaid, actual } = await runFullSync();
      const allErrors = [...plaid.errors, ...actual.errors];
      const resultMsg = allErrors.length > 0
        ? `error: ${allErrors.join('; ')}`
        : `success (fetched: ${plaid.totalAdded}, imported: ${actual.imported})`;
      settingsRepo.set('schedule_last_run', startedAt);
      settingsRepo.set('schedule_last_result', resultMsg);
      console.log(`[scheduler] Done — ${resultMsg}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      settingsRepo.set('schedule_last_run', startedAt);
      settingsRepo.set('schedule_last_result', `error: ${msg}`);
      console.error('[scheduler] Fatal error during scheduled sync:', err);
    } finally {
      schedulerRunning = false;
    }
  });

  console.log(`[scheduler] Scheduled full sync with cron "${cronExpr}"`);
}

/**
 * Stops any running cron job and re-reads settings to start a fresh one.
 * Call this whenever schedule settings change.
 */
export function restartScheduler(): void {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    console.log('[scheduler] Stopped existing scheduled task');
  }
  startScheduler();
}
