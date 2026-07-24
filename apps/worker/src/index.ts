import { InMemorySubscriptionStore, InMemoryUsageMeter, QuotaGuard } from "@awe/billing";
import { getConfig } from "@awe/config";
import { createScanStore } from "@awe/persistence";
import { runScanJob, type ScanJobData, type ScanJobDeps } from "./job";

export { runScanJob, type ScanJobData, type ScanJobResult } from "./job";

/** Assemble the job's collaborators from config (shared across all jobs). */
async function buildDeps(): Promise<ScanJobDeps> {
  const config = getConfig();
  const scanStore = await createScanStore({ databaseUrl: config.DATABASE_URL });
  const subscriptions = new InMemorySubscriptionStore();
  const usage = new InMemoryUsageMeter();
  return { scanStore, usage, quota: new QuotaGuard(subscriptions, usage) };
}

/**
 * Start a BullMQ worker if REDIS_URL is configured; otherwise stay idle so the
 * repo runs with zero infra. Each `scan` job runs the same pipeline as the HTTP
 * `/site-scan` endpoint (crawl → scan-vs-history → persist → meter).
 */
async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log(
      "[worker] REDIS_URL not set — idle stub. Set REDIS_URL to enable the 'scan' queue.",
    );
    return;
  }

  const deps = await buildDeps();
  const { Worker } = await import("bullmq");
  const u = new URL(redisUrl);
  const connection = {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
  };

  const worker = new Worker<ScanJobData>("scan", async (job) => runScanJob(job.data, deps), {
    connection,
  });
  worker.on("completed", (job, result) =>
    console.log(`[worker] scan ${job.id} ${result?.status}: ${result?.issues} issues`),
  );
  worker.on("failed", (job, err) => console.error(`[worker] scan ${job?.id} failed:`, err));
  console.log("[worker] listening on 'scan' queue");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
