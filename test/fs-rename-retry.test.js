const assert = require("node:assert/strict");
const test = require("node:test");

test("rename retry wrapper retries transient Windows rename failures", async () => {
  const { createPromiseRenameWithRetry } = require("../scripts/fs-rename-retry");
  let attempts = 0;
  const rename = async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("busy");
      error.code = "EPERM";
      throw error;
    }
  };

  const retryingRename = createPromiseRenameWithRetry(rename, {
    attempts: 3,
    retryDelayMs: 0,
    log: false,
  });

  await retryingRename("from", "to");

  assert.equal(attempts, 3);
});

test("rename retry install patches fs promises module exports", () => {
  const fs = require("node:fs");
  const fsPromises = require("node:fs/promises");
  const { install } = require("../scripts/fs-rename-retry");

  install({ attempts: 1, retryDelayMs: 0, log: false });

  assert.equal(fsPromises.rename, fs.promises.rename);
});
