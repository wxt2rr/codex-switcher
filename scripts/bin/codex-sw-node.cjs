#!/usr/bin/env node
"use strict";

const { runCodexSwNode } = require("./launcher.cjs");

runCodexSwNode().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
