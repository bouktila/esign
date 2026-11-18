import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  recordSystemAuditEvent,
  verifySystemAuditChain,
} from "../services/system-audit.ts";
import { getDb } from "./connection.ts";

const directory = await mkdtemp(path.join(tmpdir(), "equity-on-d1-"));

process.env.DATABASE_DRIVER = "sqlite";
process.env.SQLITE_PATH = path.join(directory, "app.sqlite");

after(async () => {
  delete process.env.DATABASE_DRIVER;
  delete process.env.SQLITE_PATH;
  await rm(directory, { force: true, recursive: true });
});

test("the install audit chain survives the sqlite translation", async () => {
  const database = getDb();

  await recordSystemAuditEvent(
    {
      actorEmail: "elena@glasvane.example",
      event: "settings_changed",
      metadata: { example: "Glasvane Ltd" },
    },
    database,
  );
  await recordSystemAuditEvent(
    {
      actorEmail: "elena@glasvane.example",
      event: "part11_mode_changed",
      metadata: { enabled: false },
    },
    database,
  );

  const chain = await verifySystemAuditChain(database);

  assert.equal(chain.ok, true);
  assert.equal(chain.events, 2);
});
