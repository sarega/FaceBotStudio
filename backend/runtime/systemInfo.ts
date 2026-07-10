import { createRequire } from "module";

const require = createRequire(import.meta.url);
const packageVersion = String(require("../../package.json")?.version || "0.0.0").trim();

export const SYSTEM_VERSION = String(process.env.APP_VERSION || packageVersion || "0.0.0").trim();
export const SYSTEM_REVISION = String(process.env.APP_REVISION || process.env.RAILWAY_GIT_COMMIT_SHA || "local").trim();

export function getSystemAuditMetadata() {
  return {
    system_version: SYSTEM_VERSION,
    system_revision: SYSTEM_REVISION,
  };
}
