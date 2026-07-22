import { getConfig } from "@awe/config";
import { createLogger, reportError } from "@awe/logger";
import { runScan, type ScanResult } from "@awe/pipeline";

const log = createLogger("worker");

export interface ScanJobData {
  url: string;
  html: string;
}

/** The unit of work: run the pipeline for one page. */
export async function processScanJob(data: ScanJobData): Promise<ScanResult> {
  return runScan(data.html, data.url);
}

/**
 * Starts a BullMQ worker if REDIS_URL is configured; otherwise stays idle so the
 * repo runs with zero infra. Wire a real crawler into the job payload later.
 */
async function main(): Promise<void> {
  const { REDIS_URL } = getConfig();
  if (!REDIS_URL) {
    log.info("REDIS_URL not set — idle stub. Set REDIS_URL to enable the 'scan' queue.");
    return;
  }
  const { Worker } = await import("bullmq");
  const url = new URL(REDIS_URL);
  const connection = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: url.username } : {}),
    ...(url.password ? { password: url.password } : {}),
  };

  const worker = new Worker<ScanJobData, ScanResult>(
    "scan",
    async (job) => processScanJob(job.data),
    { connection },
  );
  worker.on("completed", (job) => log.info({ jobId: job.id }, "scan job completed"));
  worker.on("failed", (job, err) => reportError(err, { jobId: job?.id }));
  log.info("listening on 'scan' queue");
}

main().catch((err) => {
  reportError(err);
  process.exit(1);
});
