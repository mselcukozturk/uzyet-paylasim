import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

// Failure modes: equal version alerts, stale initial identity, missing timer/focus/online
// checks, offline/invalid responses, forced reload, exam alerts, overwritten banners,
// pending writes lost on reload, mobile overflow, and unsafe reload during an active exam.
test("application version browser E2E", async () => {
  const source = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  let version = "a".repeat(64);
  let invalid = false;
  let requests = 0;
  let documents = 0;
  const hook = `
    window.versionFixture = {
      home: function(ai) { currentExam = null; aiModu = !!ai; VIEW = ai ? 'menuTest' : 'menuDeneme'; render(); },
      exam: function(kind) {
        var q = {guid:'fixture',konu:'Kredi',soru:'Deneme sorusu',siklar:['A','B','C','D'],cevapIdx:0};
        currentExam = {tip:kind,ai:kind==='ai',uzak:kind==='official',sorular:['fixture'],soruKayitlari:{fixture:q},index:0,cevaplar:{fixture:1},uyarilar:[],gecenSaniye:0};
        VIEW = 'exam'; render();
      },
      other: function() { currentExam = null; VIEW = 'gecmisUzak'; render(); },
      banner: function() { showBanner('Kaydedilmemiş ilerleme bu tarayıcıdan geri yüklendi, kaydediliyor…'); },
      pending: function(value) { localStorage.setItem(remoteStudyQueueKey(), JSON.stringify(value ? [{body:{action:'study-seen',questionGuid:'fixture'},readyAt:Date.now()+99999999}] : [])); render(); },
      answers: function() { return JSON.stringify(currentExam.cevaplar); }
    };
  `;
  const server = createServer(async (req, res) => {
    if (req.url?.startsWith("/version.json")) {
      requests++;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      res.end(invalid ? "{invalid" : JSON.stringify({ version }));
    } else if (req.url === "/api/access") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          authenticated: true,
          username: "version-test",
          isActive: true,
          isAdmin: false,
          disclaimerAccepted: true,
          canSeeAiSources: true,
        }),
      );
    } else if (req.url === "/api/exam") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          attempts: [],
          items: [],
          flags: [],
          questions: [],
          stats: {},
          activeAttempt: null,
        }),
      );
    } else {
      documents++;
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      res.setHeader("Content-Type", "text/html");
      res.end(
        source
          .replace("__APPLICATION_VERSION__", version)
          .replace(
            'var REMOTE_API = "https://uzyet-portal.vercel.app";',
            `var REMOTE_API = ${JSON.stringify(origin)};`,
          )
          .replace(
            "  setInterval(tickExamTimer, 1000);",
            hook + "\n  setInterval(tickExamTimer, 1000);",
          ),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checks: string[] = [];
  const notice = page.locator("[data-application-update]");
  const output = new URL("../outputs/application-version/", import.meta.url);
  try {
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(() => (window as any).versionFixture);
    await page.waitForFunction(() => document.body.textContent?.includes("Günün"));
    assert.ok(requests > 0, "initial version check must occur");
    assert.equal(await notice.count(), 0);
    checks.push("same version: no notice");
    version = "b".repeat(64);
    await page.clock.fastForward(120001);
    await notice.waitFor();
    checks.push("two minute poll: different version detected");
    assert.equal(documents, 1, "no automatic reload");
    await page.evaluate(() => (window as any).versionFixture.banner());
    assert.match(await page.locator(".anlik-bildirim-yigin").innerText(), /Kaydedilmemiş ilerleme/);
    assert.equal(await notice.count(), 1);
    checks.push("existing banner coexists");
    for (const kind of ["official", "ai", "local"]) {
      await page.evaluate((kind) => (window as any).versionFixture.exam(kind), kind);
      const answers = await page.evaluate(() => (window as any).versionFixture.answers());
      assert.equal(await notice.count(), 0);
      await page.clock.fastForward(120001);
      assert.equal(await notice.count(), 0);
      assert.equal(await page.evaluate(() => (window as any).versionFixture.answers()), answers);
      assert.equal(documents, 1);
      checks.push(`${kind} exam: hidden and answers unchanged`);
    }
    await page.evaluate(() => (window as any).versionFixture.other());
    assert.equal(await notice.count(), 0);
    checks.push("history: hidden");
    await page.evaluate(() => (window as any).versionFixture.home(true));
    await notice.waitFor();
    checks.push("AI home: notice visible");
    await page.evaluate(() => (window as any).versionFixture.pending(true));
    assert.equal(await notice.locator("button").isDisabled(), true);
    checks.push("pending writes: reload disabled");
    await page.evaluate(() => (window as any).versionFixture.pending(false));
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL("mobile.png", output)), fullPage: true });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.screenshot({ path: fileURLToPath(new URL("desktop.png", output)), fullPage: true });
    await notice.locator("button").click();
    await page.waitForLoadState("load");
    await page.waitForFunction(() => (window as any).versionFixture);
    assert.equal(await notice.count(), 0);
    checks.push("user reload loads current version");
    invalid = true;
    await page.clock.fastForward(120001);
    assert.equal(await notice.count(), 0);
    invalid = false;
    await context.setOffline(true);
    version = "c".repeat(64);
    await page.clock.fastForward(120001);
    assert.equal(await notice.count(), 0);
    checks.push("offline and invalid JSON: no false notice");
    await context.setOffline(false);
    await notice.waitFor();
    checks.push("online event: detects deployment");
    await notice.locator("button").click();
    await page.waitForLoadState("load");
    await page.waitForFunction(() => (window as any).versionFixture);
    version = "d".repeat(64);
    const beforeFocus = requests;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.fastForward(120001);
    assert.equal(requests, beforeFocus);
    checks.push("hidden tab: polling suspended");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await notice.waitFor();
    assert.ok(requests > beforeFocus);
    checks.push("visible again: immediate check");
    assert.deepEqual(errors, []);
    await writeFile(
      new URL("report.json", output),
      JSON.stringify({ passed: true, checks, requests, documents, pageErrors: errors }, null, 2),
    );
  } finally {
    await context.close();
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
