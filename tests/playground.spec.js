// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Set the value of an Ace editor by its container element ID.
 */
async function setEditorValue(page, editorId, value) {
  await page.evaluate(
    ({ id, val }) => {
      window.ace.edit(id).getSession().setValue(val);
    },
    { id: editorId, val: value }
  );
}

/**
 * Get the value of an Ace editor by its container element ID.
 */
async function getEditorValue(page, editorId) {
  return page.evaluate(
    (id) => window.ace.edit(id).getSession().getValue(),
    editorId
  );
}

/**
 * Wait for the output editor to contain the expected text.
 * Uses polling since rendering is debounced.
 */
async function expectOutput(page, expected, options = {}) {
  await expect
    .poll(
      async () => getEditorValue(page, 'output'),
      { timeout: 30_000, ...options }
    )
    .toBe(expected);
}

test.beforeEach(async ({ page }) => {
  // Clear localStorage so each test starts with defaults
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.waitForSelector('body.loaded', { timeout: 45_000 });
});

test('page loads and renders default output', async ({ page }) => {
  await expectOutput(page, 'Hello, World!');
});

test('env option checkboxes exist and default to unchecked', async ({ page }) => {
  for (const id of ['opt-trim-blocks', 'opt-lstrip-blocks', 'opt-keep-trailing-newline']) {
    const checkbox = page.locator(`#${id}`);
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();
  }
});

test('trim_blocks removes newline after block tag', async ({ page }) => {
  await setEditorValue(page, 'template', '{% if true %}\nhello\n{% endif %}');
  await setEditorValue(page, 'variables', '{}');
  await page.locator('#opt-trim-blocks').check();

  await expectOutput(page, 'hello\n');
});

test('lstrip_blocks strips leading whitespace before block tags', async ({ page }) => {
  const template = '  {% if true %}\nhello\n  {% endif %}';
  await setEditorValue(page, 'template', template);
  await setEditorValue(page, 'variables', '{}');
  await page.locator('#opt-lstrip-blocks').check();

  await expectOutput(page, '\nhello\n');
});

test('keep_trailing_newline preserves trailing newline', async ({ page }) => {
  const template = 'hi\n';
  await setEditorValue(page, 'template', template);
  await setEditorValue(page, 'variables', '{}');

  // Without keep_trailing_newline: Jinja2 strips trailing newline by default
  await expectOutput(page, 'hi');

  // Enable keep_trailing_newline
  await page.locator('#opt-keep-trailing-newline').check();
  await expectOutput(page, 'hi\n');
});

test('sharing link round-trip preserves env options', async ({ page }) => {
  await setEditorValue(page, 'template', '{% if true %}\nhello\n{% endif %}');
  await setEditorValue(page, 'variables', '{}');
  await page.locator('#opt-trim-blocks').check();
  await page.locator('#opt-lstrip-blocks').check();

  // Wait for output to settle so the sharing link is updated
  await expectOutput(page, 'hello\n');

  // Grab the sharing link href
  const href = await page.locator('#sharinglink').getAttribute('href');
  expect(href).toBeTruthy();

  // Navigate away first so the hash URL triggers a full page reload
  await page.goto('about:blank');
  await page.goto(href);
  await page.waitForSelector('body.loaded', { timeout: 45_000 });

  // Verify checkboxes are restored
  await expect(page.locator('#opt-trim-blocks')).toBeChecked();
  await expect(page.locator('#opt-lstrip-blocks')).toBeChecked();
  await expect(page.locator('#opt-keep-trailing-newline')).not.toBeChecked();

  // Verify output matches
  await expectOutput(page, 'hello\n');
});

test('old sharing link without envOptions defaults checkboxes to off', async ({ page }) => {
  // Build a hash using only {templateString, variablesString} via the page's pako
  const hash = await page.evaluate(() => {
    const obj = { templateString: 'Hello, {{ x }}!', variablesString: '{"x": "test"}' };
    const compressed = pako.gzip(JSON.stringify(obj), { level: 9 });
    let b64 = btoa(Array.from(compressed).map((b) => String.fromCharCode(b)).join(''));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });

  const baseURL = page.url().split('#')[0];
  // Navigate away first so the hash URL triggers a full page reload
  await page.goto('about:blank');
  await page.goto(`${baseURL}#${hash}`);
  await page.waitForSelector('body.loaded', { timeout: 45_000 });

  // All checkboxes should be unchecked
  for (const id of ['opt-trim-blocks', 'opt-lstrip-blocks', 'opt-keep-trailing-newline']) {
    await expect(page.locator(`#${id}`)).not.toBeChecked();
  }

  await expectOutput(page, 'Hello, test!');
});
