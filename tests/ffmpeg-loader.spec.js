const { test, expect } = require('@playwright/test');

test('production ffmpeg loader starts from local vendor files', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/index-v1.html');

  const result = await page.evaluate(async () => {
    const ffmpeg = await window.loadFfmpeg();
    return {
      ok: Boolean(ffmpeg),
      hasWriteFile: typeof ffmpeg.writeFile === 'function',
      hasExec: typeof ffmpeg.exec === 'function',
      hasReadFile: typeof ffmpeg.readFile === 'function'
    };
  });

  expect(result).toEqual({
    ok: true,
    hasWriteFile: true,
    hasExec: true,
    hasReadFile: true
  });
  expect(consoleErrors).toEqual([]);
});
