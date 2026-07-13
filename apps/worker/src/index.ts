import { runScan, type ScanResult } from "@awe/pipeline";

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
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[worker] REDIS_URL not set — idle stub. Set REDIS_URL to enable the 'scan' queue.");
    return;
  }
  const { Worker } = await import("bullmq");
  const u = new URL(redisUrl);
  const connection = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
  };

  const worker = new Worker<ScanJobData, ScanResult>(
    "scan",
    async (job) => processScanJob(job.data),
    { connection },
  );
  worker.on("completed", (job) => console.log(`[worker] scan job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[worker] scan job ${job?.id} failed:`, err));
  console.log("[worker] listening on 'scan' queue");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
