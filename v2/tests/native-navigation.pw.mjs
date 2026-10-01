import { test, expect } from '@playwright/test'

// Explicit HTML fixtures for the separate Native SPA. The navigation bridge
// itself is the actual public asset served by the existing Studio dev server.
async function fixture(page) {
  const documents = []
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()) })
  await page.route(/\/(sign-in|sign-up|register|security)(\?.*)?$/, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="zh"><head><script src="/studio/native-navigation.js"></script></head><body>
    <h1>Explicit Native navigation fixture</h1>
    <a href="/sign-in">Fixture return to sign-in</a>
    <a href="/sign-up">Fixture register</a>
    <button onclick="history.pushState({fixture:true},'', '/studio/chat?thread=fixture#result')">Fixture push Studio</button>
    <button onclick="history.replaceState({fixture:true},'', '/studio')">Fixture replace Studio</button>
    <button onclick="history.pushState({fixture:true},'', '/security')">Fixture Native security</button>
    <script>window.fixtureDocumentId = crypto.randomUUID()</script>
  </body></html>` }))
  await page.route(/\/studio\/(chat\?thread=fixture)?(#.*)?$/, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Explicit Studio document fixture</h1><script>window.fixtureDocumentId = crypto.randomUUID()</script>' }))
  return documents
}

test('default native login and registration retain the Studio return target', async ({ page }) => {
  await fixture(page)
  for (const path of ['/sign-in', '/sign-up', '/register']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Explicit Native navigation fixture' })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/studio/')
  }
})

test('registration anchor returns to Native sign-in with the original Studio redirect', async ({ page }) => {
  const documents = await fixture(page)
  await page.goto('/sign-up?redirect=%2Fstudio%2Fchat%3Fthread%3Dfixture')
  const originalDocument = await page.evaluate(() => window.fixtureDocumentId)
  await page.getByRole('link', { name: 'Fixture return to sign-in' }).click()
  await expect(page).toHaveURL(/\/sign-in\?redirect=/)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/studio/chat?thread=fixture')
  expect(await page.evaluate(() => window.fixtureDocumentId)).not.toBe(originalDocument)
  expect(documents).toHaveLength(2)
})

for (const action of ['push', 'replace']) {
  test(`Native history ${action} to Studio loads a same-origin document`, async ({ page }) => {
    const documents = await fixture(page)
    await page.goto('/sign-in')
    const origin = new URL(page.url()).origin
    const originalDocument = await page.evaluate(() => window.fixtureDocumentId)
    await page.getByRole('button', { name: action === 'push' ? 'Fixture push Studio' : 'Fixture replace Studio' }).click()
    await expect(page.getByRole('heading', { name: 'Explicit Studio document fixture' })).toBeVisible()
    expect(new URL(page.url()).origin).toBe(origin)
    expect(await page.evaluate(() => window.fixtureDocumentId)).not.toBe(originalDocument)
    expect(documents).toHaveLength(2)
    if (action === 'push') expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe('/studio/chat?thread=fixture#result')
    else expect(new URL(page.url()).pathname).toBe('/studio/')
  })
}

test('explicit Native security return stays Native and is not forced into Studio', async ({ page }) => {
  const documents = await fixture(page)
  await page.goto('/sign-in?redirect=%2Fsecurity')
  const originalDocument = await page.evaluate(() => window.fixtureDocumentId)
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/security')
  await page.getByRole('button', { name: 'Fixture Native security' }).click()
  await expect(page).toHaveURL(/\/security$/)
  expect(await page.evaluate(() => window.fixtureDocumentId)).toBe(originalDocument)
  expect(documents).toHaveLength(1)
})

test('external redirect is never executed by the bridge', async ({ page }) => {
  const documents = await fixture(page)
  let externalRequests = 0
  await page.route('https://external.invalid/**', route => { externalRequests++; return route.abort() })
  await page.goto('/sign-in?redirect=https%3A%2F%2Fexternal.invalid%2Faccount')
  await expect(page.getByRole('heading', { name: 'Explicit Native navigation fixture' })).toBeVisible()
  const origin = new URL(page.url()).origin
  await page.getByRole('button', { name: 'Fixture Native security' }).click()
  await expect(page).toHaveURL(/\/security$/)
  expect(new URL(page.url()).origin).toBe(origin)
  expect(externalRequests).toBe(0)
  expect(documents).toHaveLength(1)
})
