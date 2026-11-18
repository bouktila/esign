import handler from "virtual:vinext-worker-entry";

import { migrateSqlDatabase } from "../lib/db/sqlite-migrate.ts";
import type { SqlDatabase } from "../lib/db/sqlite-driver.ts";
import { setSendEmailBinding } from "../lib/services/email.ts";
import { setR2Bucket } from "../lib/services/storage.ts";

type StagingEnv = {
  APP_URL?: string;
  CRON_SECRET?: string;
  DB?: SqlDatabase;
  PDFS?: Parameters<typeof setR2Bucket>[0];
  SEND_EMAIL?: { send(message: unknown): Promise<void> };
};

let migrated = false;

async function prepare(env: StagingEnv) {
  if (env.PDFS) {
    setR2Bucket(env.PDFS);
  }

  setSendEmailBinding(env.SEND_EMAIL ?? null);

  if (env.DB && !migrated) {
    await migrateSqlDatabase(env.DB);
    migrated = true;
  }
}

type WorkerHandler = {
  fetch(request: Request, env: StagingEnv, ctx: ExecutionContext): Promise<Response>;
};

const app = handler as WorkerHandler;

export default {
  async fetch(request: Request, env: StagingEnv, ctx: ExecutionContext) {
    await prepare(env);

    return app.fetch(request, env, ctx);
  },
  async scheduled(
    _controller: ScheduledController,
    env: StagingEnv,
    ctx: ExecutionContext,
  ) {
    await prepare(env);
    const origin = env.APP_URL || "https://equity-on-sign-staging.workers.dev";
    const headers = new Headers();

    if (env.CRON_SECRET) {
      headers.set("authorization", `Bearer ${env.CRON_SECRET}`);
    }

    ctx.waitUntil(
      app.fetch(
        new Request(new URL("/api/internal/retention", origin), { headers }),
        env,
        ctx,
      ),
    );
  },
};
