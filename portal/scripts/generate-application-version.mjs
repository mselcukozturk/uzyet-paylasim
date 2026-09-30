import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Keep the editable source intact; only the served build output receives its identity.
const publicDirectory = new URL("../public/", import.meta.url);
const source = readFileSync(new URL("index.html", publicDirectory), "utf8").replace(/\r\n/g, "\n");
let revision = process.env.VERCEL_GIT_COMMIT_SHA;
if (!revision)
  revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
const marker = "__APPLICATION_VERSION__";
if (!source.includes(marker)) throw new Error("Application version marker is missing");
const version = createHash("sha256").update(revision).update(source).digest("hex");
writeFileSync(new URL("application.html", publicDirectory), source.replace(marker, version));
writeFileSync(new URL("version.json", publicDirectory), JSON.stringify({ version }) + "\n");
console.log(`Application version: ${version}`);
