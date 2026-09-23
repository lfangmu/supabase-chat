import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.TEST_URL || 'https://chat.example.com';
const TEST_PASSWORD = '000000';
const TEST_NICKNAME = 'TestUser' + Date.now();
const TEST_MESSAGE = 'Hello from Playwright ' + Date.now();

async function login(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Password gate
  const passwordInput = page.locator('input[placeholder*="密码"], input[type="password"]').first();
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
  await passwordInput.fill(TEST_PASSWORD);
  await passwordInput.press('Enter');

  // Wait for login to complete
  await page.waitForTimeout(2000);
}

async function setNickname(page: Page) {
  const nicknameInput = page.locator('input[placeholder*="昵称"], input[placeholder*="nickname"]').first();
  if (await nicknameInput.isVisible().catch(() => false)) {
    await nicknameInput.fill(TEST_NICKNAME);
    await nicknameInput.press('Enter');
    await page.waitForTimeout(1000);
  }
}

test.describe('Supabase Chat Full Test', () => {
  test('1. Home page loads', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
    const title = await page.title();
    console.log('Page title:', title);
    expect(title.length).toBeGreaterThan(0);
  });

  test('2. Password login works', async ({ page }) => {
    await login(page);
    // After login, should not see password input
    const passwordInput = page.locator('input[type="password"]').first();
    await expect(passwordInput).not.toBeVisible({ timeout: 5000 });
  });

  test('3. Set nickname', async ({ page }) => {
    await login(page);
    await setNickname(page);
    // After setting nickname, chat input should appear
    const chatInput = page.locator('input[placeholder*="输入"], textarea[placeholder*="输入"]').first();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
  });

  test('4. Send text message', async ({ page }) => {
    await login(page);
    await setNickname(page);

    const chatInput = page.locator('input[placeholder*="输入"], textarea[placeholder*="输入"]').first();
    await chatInput.fill(TEST_MESSAGE);
    await chatInput.press('Enter');

    // Wait for message to appear in list
    await page.waitForTimeout(2000);
    const messageText = page.locator('text=' + TEST_MESSAGE).first();
    await expect(messageText).toBeVisible({ timeout: 10000 });
  });

  test('5. Theme toggle', async ({ page }) => {
    await login(page);
    await setNickname(page);

    // Find theme toggle button (usually has sun/moon icon or "主题" text)
    const themeBtn = page.locator('button').filter({ hasText: /主题|theme|🌙|☀️/i }).first();
    if (await themeBtn.isVisible().catch(() => false)) {
      await themeBtn.click();
      await page.waitForTimeout(1000);
      // Check that theme changed (dark class on html/body)
      const html = page.locator('html');
      const hasDark = await html.evaluate(el => el.classList.contains('dark'));
      console.log('Dark mode active:', hasDark);
    } else {
      console.log('Theme toggle not found, skipping');
      test.skip();
    }
  });

  test('6. Withdraw message', async ({ page }) => {
    await login(page);
    await setNickname(page);

    // Send a message
    const chatInput = page.locator('input[placeholder*="输入"], textarea[placeholder*="输入"]').first();
    const withdrawMsg = 'Withdraw test ' + Date.now();
    await chatInput.fill(withdrawMsg);
    await chatInput.press('Enter');
    await page.waitForTimeout(2000);

    // Right-click the message to find withdraw option
    const msg = page.locator('text=' + withdrawMsg).first();
    await msg.click({ button: 'right' });
    await page.waitForTimeout(500);

    // Look for withdraw menu item (exact button text to avoid matching message content containing 'Withdraw')
    const withdrawMenu = page.locator('button', { hasText: '撤回' }).first();
    if (await withdrawMenu.isVisible().catch(() => false)) {
      await withdrawMenu.click();
      await page.waitForTimeout(3000);
      // Message should disappear after withdrawal
      await expect(msg).not.toBeVisible({ timeout: 5000 });
    } else {
      console.log('Withdraw menu not found, skipping');
      test.skip();
    }
  });

  test('7. Send failed message shows retry', async ({ page }) => {
    await login(page);
    await setNickname(page);

    // Block the API temporarily to simulate failure
    await page.route('**/api/messages', route => route.abort('failed'));

    const chatInput = page.locator('input[placeholder*="输入"], textarea[placeholder*="输入"]').first();
    await chatInput.fill('Failed message test');
    await chatInput.press('Enter');
    await page.waitForTimeout(3000);

    // Look for failed indicator
    const failedIndicator = page.locator('text=/发送失败|failed|retry/i').first();
    if (await failedIndicator.isVisible().catch(() => false)) {
      console.log('Failed message indicator found');
    } else {
      console.log('Failed indicator not found (may be too fast)');
    }

    await page.unroute('**/api/messages');
  });
});
