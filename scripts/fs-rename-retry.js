const fs = require("node:fs");
const nodeFsPromises = require("node:fs/promises");
const fsPromises = require("fs/promises");

const DEFAULT_ATTEMPTS = 80;
const DEFAULT_RETRY_DELAY_MS = 500;
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRenameError(error) {
  return Boolean(error && RETRYABLE_RENAME_CODES.has(error.code));
}

function createPromiseRenameWithRetry(rename, options = {}) {
  const attempts = options.attempts || DEFAULT_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  return async function renameWithRetry(from, to) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await rename(from, to);
      } catch (error) {
        if (!isRetryableRenameError(error) || attempt === attempts) {
          throw error;
        }
        if (options.log !== false) {
          console.warn(
            `[fs-rename-retry] rename failed with ${error.code}, retry ${attempt}/${attempts}: ${from} -> ${to}`
          );
        }
        await delay(retryDelayMs);
      }
    }
  };
}

function createCallbackRenameWithRetry(rename, options = {}) {
  const promiseRename = createPromiseRenameWithRetry(
    (from, to) =>
      new Promise((resolve, reject) => {
        rename(from, to, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    options
  );

  return function renameWithRetry(from, to, callback) {
    promiseRename(from, to).then(
      () => callback(null),
      (error) => callback(error)
    );
  };
}

function install(options = {}) {
  if (fs.__html2exeRenameRetryInstalled) {
    return;
  }

  const originalPromiseRename = fs.promises.rename.bind(fs.promises);
  const originalRename = fs.rename.bind(fs);
  const retryingPromiseRename = createPromiseRenameWithRetry(originalPromiseRename, options);
  fs.promises.rename = retryingPromiseRename;
  nodeFsPromises.rename = retryingPromiseRename;
  fsPromises.rename = retryingPromiseRename;
  fs.rename = createCallbackRenameWithRetry(originalRename, options);
  fs.__html2exeRenameRetryInstalled = true;
}

module.exports = {
  createCallbackRenameWithRetry,
  createPromiseRenameWithRetry,
  install,
  isRetryableRenameError,
};
