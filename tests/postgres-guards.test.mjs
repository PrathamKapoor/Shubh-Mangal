import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { validateDisposableTarget } from "../scripts/postgres-check.mjs";

const valid = {
  ALLOW_DISPOSABLE_POSTGRES: "true",
  TEST_DATABASE_URL:
    "postgresql://fixture:synthetic@localhost:55483/shubh_test_control",
};

test("PostgreSQL major defaults to 16 and only permits explicit 16 or 18", () => {
  assert.equal(validateDisposableTarget(valid).major, 16);
  assert.equal(validateDisposableTarget({ ...valid, TEST_POSTGRES_MAJOR: "16" }).major, 16);
  assert.equal(validateDisposableTarget({ ...valid, TEST_POSTGRES_MAJOR: "18" }).major, 18);
  for (const major of ["", "17", "19", "018", "18 ", "18.0", 18]) {
    assert.throws(() => validateDisposableTarget({ ...valid, TEST_POSTGRES_MAJOR: major }));
  }
});

test("disposable target requires explicit loopback test database and no URL overrides", () => {
  assert.equal(validateDisposableTarget(valid).host, "127.0.0.1");
  for (const url of [
    "postgresql://fixture:synthetic@example.com/shubh_test_control",
    "postgresql://fixture:synthetic@localhost/production",
    "postgresql://fixture:synthetic@localhost/shubh_test_control?host=example.com",
    "postgresql://fixture@localhost/shubh_test_control",
    "postgresql://fixture:synthetic@localhost/shubh_test_control#x",
  ])
    assert.throws(() =>
      validateDisposableTarget({ ...valid, TEST_DATABASE_URL: url }),
    );
  assert.throws(() =>
    validateDisposableTarget({ ...valid, ALLOW_DISPOSABLE_POSTGRES: "false" }),
  );
});

test("disposable target rejects inherited PostgreSQL environment overrides", () => {
  for (const key of ["PGHOST", "PGSERVICE", "PGOPTIONS", "PG_SSL"]) {
    assert.throws(() =>
      validateDisposableTarget({ ...valid, [key]: "unexpected" }),
    );
  }
});

test("harness rejects unsafe configuration without disclosing credentials", () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)),
  );
  const result = spawnSync(process.execPath, ["scripts/postgres-check.mjs"], {
    encoding: "utf8",
    env: {
      ...env,
      ALLOW_DISPOSABLE_POSTGRES: "true",
      TEST_DATABASE_URL:
        "postgresql://fixture:synthetic-secret@example.com/shubh_test_control",
    },
    timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rejected/);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-secret/);
});
