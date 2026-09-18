import cron from "node-cron";
import { runDailyCampaign } from "./campaign.js";
import { config } from "./config.js";
import { logError } from "./errors.js";
import { runMorningGather } from "./pipeline.js";
import { recordCronRun, storageBackend } from "./store.js";

export function startScheduler() {
  if (config.disableInternalCron) {
    console.log(
      "[cron] internal schedules disabled (DISABLE_INTERNAL_CRON=true); use external HTTP cron → /api/pipeline/gather and /api/campaigns/run",
    );
    return { gatherTask: null, sendTask: null };
  }

  const gatherTask = cron.schedule(
    config.gatherCronExpression,
    async () => {
      const stamp = new Date().toISOString();
      console.log(`[cron-gather] ${stamp} starting morning research gather`);
      try {
        const report = await runMorningGather();
        const summary = {
          industries: report.industries?.map((i) => i.industry),
          added: report.added,
          refreshed: report.refreshed || 0,
          drafted: report.drafted,
          skipped: report.skipped,
          failed: report.failed?.length || 0,
        };
        console.log("[cron-gather] finished", JSON.stringify(summary));
        await recordCronRun("gather", summary);
      } catch (err) {
        logError("cron-gather morning research", err);
        await recordCronRun("gather", { error: err.message }).catch(() => undefined);
      }
    },
    { timezone: config.timezone },
  );

  const sendTask = cron.schedule(
    config.sendCronExpression,
    async () => {
      const stamp = new Date().toISOString();
      console.log(`[cron-send] ${stamp} starting email dispatch`);
      try {
        const report = await runDailyCampaign();
        console.log("[cron-send] finished", JSON.stringify(report));
        await recordCronRun("send", {
          dryRun: report.dryRun,
          sent: report.sent,
          generated: report.generated,
          skipped: report.skipped,
          failed: report.failed?.length || 0,
        });
      } catch (err) {
        logError("cron-send email dispatch", err);
        await recordCronRun("send", { error: err.message }).catch(() => undefined);
      }
    },
    { timezone: config.timezone },
  );

  console.log(
    `[cron-gather] armed "${config.gatherCronExpression}" (${config.timezone}) storage=${storageBackend()}`,
  );
  console.log(
    `[cron-send] armed "${config.sendCronExpression}" (${config.timezone}) dryRun=${config.dryRun} storage=${storageBackend()}`,
  );

  return { gatherTask, sendTask };
}
