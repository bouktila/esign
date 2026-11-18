import assert from "node:assert/strict";
import { test } from "node:test";

import { splitSqlScript, translatePostgresSql } from "./sql-dialect.ts";

test("placeholders become question marks in the order they appear", () => {
  const translated = translatePostgresSql(
    "select $2, $1, $2::text from public.envelopes where title ILIKE $1",
    ["a", "b"],
  );

  assert.equal(
    translated.sql,
    "select ?, ?, ? from envelopes where title LIKE ?",
  );
  assert.deepEqual(translated.params, ["b", "a", "b", "a"]);
});

test("json and any-array forms become sqlite json functions", () => {
  const translated = translatePostgresSql(
    "select metadata->>'signerId' from audit_events where id = ANY($1::text[])",
    [["e1", "e2"]],
  );

  assert.match(translated.sql, /json_extract\(metadata, '\$\.signerId'\)/);
  assert.match(translated.sql, /id IN \(SELECT value FROM json_each\(\?\)\)/);
});

test("a script splits on semicolons and keeps quoted ones", () => {
  assert.deepEqual(splitSqlScript("select ';';\nselect 1"), [
    "select ';'",
    "select 1",
  ]);
});
