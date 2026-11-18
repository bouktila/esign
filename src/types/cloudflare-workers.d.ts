declare module "virtual:vinext-worker-entry" {
  const handler: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };

  export default handler;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

declare module "cloudflare:workers" {
  export const env: {
    APP_URL?: string;
    ASSETS?: { fetch(input: Request | string): Promise<Response> };
    CRON_SECRET?: string;
    DB?: {
      batch(
        statements: readonly unknown[],
      ): Promise<Array<{ results?: Record<string, unknown>[] }>>;
      exec(sql: string): Promise<{ count: number }>;
      prepare(sql: string): {
        bind(...values: unknown[]): {
          all(): Promise<{
            meta?: { changes?: number };
            results: Record<string, unknown>[];
          }>;
          first<T>(): Promise<T | null>;
          run(): Promise<{ meta?: { changes?: number } }>;
        };
      };
    };
    EMAIL_CAPTURE_FALLBACK?: string;
    PDFS?: R2Bucket;
    SEND_EMAIL?: {
      send(message: unknown): Promise<void>;
    };
  };
}
