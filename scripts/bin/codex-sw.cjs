#!/usr/bin/env node
"use strict";

const { runCodexSw } = require("./launcher.cjs");

runCodexSw().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
