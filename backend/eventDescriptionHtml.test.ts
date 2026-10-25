import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import puppeteer from "puppeteer";
import { sanitizeEventDescriptionHtml } from "./eventDescriptionHtml";

const description = `<section style="max-width:780px;margin:0 auto;padding:24px 16px;font-family:Arial,'Noto Sans Thai',sans-serif;color:#333;line-height:1.85">
<header style="text-align:center;margin-bottom:30px"><p style="color:#61846b;font-size:15px;margin-bottom:8px">SAHAJA YOGA MEDITATION</p>
<h1 style="font-size:clamp(25px,5vw,36px);line-height:1.4;color:#345c43;margin:0 0 12px">🌿 ความสงบที่คุณค้นหา…</h1></header>
<div style="background:#f3f7f1;padding:22px;border-radius:14px;margin:28px 0"><h2 style="font-size:22px">Workshop</h2></div>
<div lang="en"><p>Free workshop</p></div><hr style="border:0;border-top:1px solid #ddd;margin:38px 0"></section>`;

test("public description preserves layout containers and safe responsive typography", () => {
  const html = sanitizeEventDescriptionHtml(description);
  assert.match(html, /<section style=/);
  assert.match(html, /<header style="text-align:center/);
  assert.match(html, /font-size:clamp\(25px,5vw,36px\)/);
  assert.match(html, /margin:0 auto/);
  assert.match(html, /line-height:1.85/);
  assert.match(html, /background:#f3f7f1/);
  assert.match(html, /border-radius:14px/);
});

test("layout support does not allow scripts, handlers or CSS URLs", () => {
  const html = sanitizeEventDescriptionHtml(`<section onclick="alert(1)" style="position:fixed;background:url(https://evil.test);font-size:expression(alert(1))"><header><script>alert(1)</script><img src="javascript:alert(1)" onerror="alert(1)"></header></section>`);
  assert.doesNotMatch(html, /onclick|onerror|<script|javascript:|expression|url\(|position:/i);
});

test("browser and server sanitizers preserve editor layout on desktop and mobile", async () => {
  const source = await readFile(new URL("../src/lib/eventDescriptionHtml.ts", import.meta.url), "utf8");
  const { code } = await transform(source, { loader: "ts", format: "iife", globalName: "descriptionHtml" });
  const css = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({ content: code });
    const publicHtml = await page.evaluate((html) => (window as any).descriptionHtml.renderEventDescriptionHtml(html), sanitizeEventDescriptionHtml(description));
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.setContent(`<style>${css}</style><div id="editor" class="event-description-content rich-event-editor">${description}</div><div class="public-event-themed"><div id="public" class="event-description-content">${publicHtml}</div></div>`);
      const styles = await page.evaluate(() => ["editor", "public"].map((id) => {
        const root = document.getElementById(id)!;
        return ["section", "header", "h1", "h2", "div", "hr"].map((selector) => {
          const style = getComputedStyle(root.querySelector(selector)!);
          return [style.fontSize, style.fontFamily, style.textAlign, style.lineHeight, style.marginTop, style.marginBottom, style.padding, style.backgroundColor, style.borderRadius, style.borderTop];
        });
      }));
      assert.deepEqual(styles[1], styles[0], `layout differs at ${width}px`);
    }
    const unsafe = await page.evaluate(() => (window as any).descriptionHtml.renderEventDescriptionHtml('<header onclick="alert(1)" style="background:url(javascript:alert(1));position:fixed"><script>alert(1)</script>Safe</header>'));
    assert.doesNotMatch(unsafe, /onclick|<script|javascript:|position:/i);
  } finally { await browser.close(); }
});
