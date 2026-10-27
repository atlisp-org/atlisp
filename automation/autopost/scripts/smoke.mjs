#!/usr/bin/env node
// 冒烟测试：不登录，验证 1) 浏览器能启动 2) QQ空间/创作者平台页面可达 3) 抖音开放平台 API 可达
// 用法: node scripts/smoke.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const outDir = new URL('../logs/smoke/', import.meta.url);
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 800 } });

async function probe(name, url, shotName) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    console.log(`[OK] ${name}: url=${page.url()} title=${(await page.title()).slice(0, 50)}`);
    await page.screenshot({ path: new URL(shotName, outDir).pathname });
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message.slice(0, 150)}`);
  } finally {
    await page.close().catch(() => {});
  }
}

await probe('QQ空间', 'https://qzone.qq.com/', 'qzone.png');
await probe('抖音创作者平台', 'https://creator.douyin.com/', 'douyin-creator.png');
await browser.close();

// 抖音开放平台 API 连通性（假 code，预期返回业务错误 JSON 而不是网络错误）
try {
  const r = await fetch('https://open.douyin.com/oauth/access_token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: 'smoke',
      client_secret: 'smoke',
      code: 'smoke',
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`[OK] 抖音开放平台 API: HTTP ${r.status} ${JSON.stringify(j).slice(0, 150)}`);
} catch (e) {
  console.log(`[FAIL] 抖音开放平台 API: ${e.message}`);
}
