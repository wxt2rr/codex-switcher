import { startUsageRouterService } from "./usage-router-service.js";

const stateDirIndex = process.argv.indexOf("--state-dir");
const stateDir = stateDirIndex >= 0 ? process.argv[stateDirIndex + 1] : undefined;

if (!stateDir) {
  console.error("--state-dir is required");
  process.exitCode = 1;
} else {
  void startUsageRouterService({ stateDir }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
