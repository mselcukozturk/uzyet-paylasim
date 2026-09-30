import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

// Read-only verification; no authenticated requests or database writes.
const origin = process.argv[2] || "https://uzyet-portal.vercel.app";
const versionResponse = await fetch(new URL("/version.json", origin), { cache: "no-store" });
assert.equal(versionResponse.status, 200);
const cacheControl = versionResponse.headers.get("cache-control");
assert.match(cacheControl || "", /no-store/);
const { version } = await versionResponse.json();
assert.match(version, /^[a-f0-9]{64}$/);
if (process.argv[3]) assert.equal(version, process.argv[3], "Expected deployment must be live");
const paths = [];
for (const path of ["/", "/index.html", "/application.html"]) {
  const response = await fetch(new URL(path, origin), { cache: "no-store" });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(
    html.includes(`var APPLICATION_VERSION = "${version}";`),
    `${path}: page and version file must agree`,
  );
  assert.ok(html.includes("data-application-update-slot"));
  paths.push({ path, status: response.status, versionMatches: true });
}
const output = new URL("../outputs/application-version/", import.meta.url);
await mkdir(output, { recursive: true });
const report = {
  passed: true,
  origin,
  checkedAt: new Date().toISOString(),
  version,
  cacheControl,
  paths,
};
await writeFile(
  new URL(
    origin.includes("127.0.0.1") ? "local-deployment.json" : "production-deployment.json",
    output,
  ),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
