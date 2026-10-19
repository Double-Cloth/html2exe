const fs = require("node:fs");
const path = require("node:path");

function resolveNpmCli(options = {}) {
  const env = options.env || process.env;
  const executable = options.execPath || process.execPath;
  const searchDirs = [path.dirname(executable), ...(env.PATH || env.Path || "").split(path.delimiter)];
  const candidates = [options.bundledCli, env.npm_execpath];
  for (const dir of searchDirs.filter(Boolean)) {
    candidates.push(path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"));
    candidates.push(path.join(dir, "npm", "bin", "npm-cli.js"));
    // Unix 的 npm 通常是指向包内 CLI 的符号链接。
    try {
      const npmPath = fs.realpathSync(path.join(dir, "npm"));
      if (path.basename(npmPath) === "npm-cli.js") candidates.push(npmPath);
    } catch (error) {}
  }
  return candidates.find((candidate) => {
    if (!candidate || path.basename(candidate) !== "npm-cli.js") return false;
    try { return fs.statSync(candidate).isFile(); } catch (error) { return false; }
  }) || "";
}

module.exports = { resolveNpmCli };
