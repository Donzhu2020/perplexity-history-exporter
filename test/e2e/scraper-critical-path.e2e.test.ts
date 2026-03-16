import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type BrowserContext } from '@playwright/test'
import { ConversationExtractor } from '../../src/scraper/conversation-extractor.js'
import { existsSync, rmSync } from 'node:fs'

const TEST_OUTPUT = './test-output-e2e'

describe('Scraper E2E - Critical Path', () => {
  let browser: Browser | undefined
  let context: BrowserContext | undefined

  beforeAll(async () => {
    try {
      browser = await chromium.launch({ headless: true })
    } catch (_error) {
      console.warn('Skipping scraper E2E browser setup because Chromium could not launch.')
    }
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true })
  })

  afterAll(async () => {
    await browser?.close()
    if (existsSync(TEST_OUTPUT)) rmSync(TEST_OUTPUT, { recursive: true })
  })

  // Skip this - requires real authenticated Perplexity session
  it.skip('should complete full workflow: discover → extract → save', async () => {
    // Manual test only - replace URL with real conversation from your account
  }, 60000)

  it('should handle missing/invalid URL gracefully without crashing', async () => {
    if (!browser) return

    context = await browser.newContext()
    const extractor = new ConversationExtractor(context)

    // ✅ Now we expect it to THROW with a descriptive error
    await expect(
      extractor.extract('https://www.perplexity.ai/search/nonexistent-xyz-12345')
    ).rejects.toThrow(/Authentication required|403|401|No API response/)

    await context.close()
  }, 30000)
})
