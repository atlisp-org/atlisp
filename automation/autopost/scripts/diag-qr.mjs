// 诊断 snapQr 失败原因
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ locale: 'zh-CN' })).newPage();
await page.goto('https://qzone.qq.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);

console.log('顶层 iframe 数量:', await page.locator('iframe').count());
for (let i = 0; i < (await page.locator('iframe').count()); i++) {
  const src = await page.locator('iframe').nth(i).getAttribute('src');
  console.log(`iframe[${i}] src:`, (src || '').slice(0, 70));
}

const fr = page.frameLocator('iframe').first();
const qr = fr.locator('#qrlogin_img, img.qrImg').first();
console.log('frameLocator 内 qr count:', await qr.count().catch((e) => `ERR ${e.message.slice(0, 80)}`));
try {
  console.log('qr 可见性:', await qr.isVisible().catch((e) => `ERR ${e.message.slice(0, 80)}`));
  const box = await qr.boundingBox().catch((e) => `ERR ${e.message.slice(0, 80)}`);
  console.log('qr boundingBox:', JSON.stringify(box));
  await qr.screenshot({ path: '/tmp/opencode/qr-test.png' });
  const fs = await import('node:fs');
  console.log('qr 截图成功, bytes:', fs.statSync('/tmp/opencode/qr-test.png').size);
} catch (e) {
  console.log('qr 截图失败:', e.message.slice(0, 200));
}
await browser.close();
