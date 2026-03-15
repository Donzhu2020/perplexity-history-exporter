import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export class BrowserManager {
  static readonly BrowserLaunchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'BrowserLaunchError'
    }
  }

  static readonly AuthError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'AuthError'
    }
  }

  static readonly ContextError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ContextError'
    }
  }

  static readonly NavigationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NavigationError'
    }
  }

  public browserInstance: Browser | null = null
  private activeContext: BrowserContext | null = null
  private activePage: Page | null = null

  async launch(): Promise<Page> {
    try {
      const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)

      if (isSavedAuthValid) {
        // Try starting in requested headless mode directly
        await this.launchBrowser(config.headless)
        await this.initializeBrowserContext()
        await this.navigateToSettingsPage()
        const isLoggedIn = await this.verifyLoginStatus(this.getActivePage())

        if (isLoggedIn) {
          logger.success('Already logged in!')
          return this.getActivePage()
        }

        logger.warn(
          'Saved authentication expired or invalid. Restarting in headful mode for login...'
        )
        await this.close()
      }

      // Need login: launch headful
      await this.launchBrowser(false)
      await this.initializeBrowserContext()
      await this.navigateToSettingsPage()
      await this.ensureUserIsAuthenticated()

      // Keep the proven working headful session after manual login.
      // Perplexity may reject the restarted headless session even when auth is valid.
      if (config.headless !== false) {
        logger.info(
          'Authentication successful. Continuing in visible browser mode to avoid headless 403s.'
        )
      }

      return this.getActivePage()
    } catch (_error) {
      if (_error instanceof Error) throw _error
      throw new BrowserManager.BrowserLaunchError(`Unexpected error: ${String(_error)}`)
    }
  }

  async relaunchAuthenticated(headless: boolean | 'new' = config.headless): Promise<Page> {
    const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)
    if (!isSavedAuthValid) {
      throw new BrowserManager.AuthError(
        'No fresh saved authentication state is available for background extraction.'
      )
    }

    await this.close()
    await this.launchBrowser(headless)
    await this.initializeBrowserContext()
    await this.navigateToSettingsPage()

    const page = this.getActivePage()
    const isLoggedIn = await this.verifyLoginStatus(page)
    if (!isLoggedIn) {
      throw new BrowserManager.AuthError(
        'Saved authentication could not be reused for background extraction.'
      )
    }

    return page
  }

  async close(): Promise<void> {
    if (this.activePage) await this.activePage.close().catch(() => {})
    if (this.activeContext) await this.activeContext.close().catch(() => {})
    if (this.browserInstance) await this.browserInstance.close().catch(() => {})
    this.activePage = null
    this.activeContext = null
    this.browserInstance = null
  }

  private async launchBrowser(headless: boolean | 'new'): Promise<void> {
    try {
      this.browserInstance = await chromium.launch({
        headless: headless === 'new' ? true : headless,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (_error) {
      throw new BrowserManager.BrowserLaunchError(
        `Failed to launch browser: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async initializeBrowserContext(): Promise<void> {
    if (!this.browserInstance) throw new BrowserManager.ContextError('Browser not initialized')

    const isSavedAuthValid = this.checkIfSavedAuthenticationIsFresh(config.authStoragePath)

    if (isSavedAuthValid) {
      logger.info('Loading saved authentication state...')
      try {
        const storageStateData = JSON.parse(readFileSync(config.authStoragePath, 'utf-8'))
        this.activeContext = await this.browserInstance.newContext({
          storageState: storageStateData,
        })
      } catch (_error) {
        logger.warn('Failed to load saved auth state, starting fresh.', _error)
        this.activeContext = await this.browserInstance.newContext()
      }
    } else {
      if (existsSync(config.authStoragePath)) {
        logger.info('Saved authentication is older than 1 day, discarding.')
      }
      this.activeContext = await this.browserInstance.newContext()
    }
  }

  private checkIfSavedAuthenticationIsFresh(path: string): boolean {
    if (!existsSync(path)) return false
    try {
      const fileStats = statSync(path)
      const fileAgeInMs = Date.now() - fileStats.mtimeMs
      const twentyFourHoursInMs = 24 * 60 * 60 * 1000
      return fileAgeInMs < twentyFourHoursInMs
    } catch (_error) {
      return false
    }
  }

  private async navigateToSettingsPage(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.NavigationError('No browser context available')
    }
    this.activePage = await this.activeContext.newPage()
    const perplexitySettingsUrl = 'https://www.perplexity.ai/settings'
    try {
      await this.activePage.goto(perplexitySettingsUrl, {
        timeout: 30000,
        waitUntil: 'domcontentloaded',
      })
    } catch (_error) {
      // Navigation errors (redirects, slow load) are non-fatal in headful mode.
      // The page may still be usable for login even if goto throws.
      logger.warn(`Navigation warning (non-fatal): ${_error instanceof Error ? _error.message : String(_error)}`)
    }
  }

  private async ensureUserIsAuthenticated(): Promise<void> {
    if (!this.activePage) {
      throw new BrowserManager.AuthError('Page not initialized')
    }

    logger.info('Please log in manually in the browser window...')
    logger.info('The browser will stay open for at least 1 minute before login is checked.')
    logger.info('Complete the Perplexity login flow in the browser window.')

    await this.waitForManualLogin(this.activePage)

    const perplexitySettingsUrl = 'https://www.perplexity.ai/settings'
    await this.activePage.goto(perplexitySettingsUrl, {
      waitUntil: 'networkidle',
    })

    const isLoginSuccessfulNow = await this.verifyLoginStatus(this.activePage)
    if (!isLoginSuccessfulNow) {
      throw new BrowserManager.AuthError(
        `Login verification failed. Current URL: ${this.activePage.url()}`
      )
    }

    await this.persistAuthenticationState()
    logger.success('Authentication state saved!')
  }

  private async waitForManualLogin(page: Page): Promise<void> {
    const loginTimeoutInMs = 5 * 60 * 1000
    const pollIntervalInMs = 1000
    const timeoutAt = Date.now() + loginTimeoutInMs
    const earliestAutoDetectAt = Date.now() + 60 * 1000

    logger.info('Waiting 60 seconds before the first login check...')

    while (Date.now() < timeoutAt) {
      if (Date.now() < earliestAutoDetectAt) {
        await page.waitForTimeout(pollIntervalInMs).catch(() => {})
        continue
      }

      const isLoggedIn = await this.verifyLoginStatus(page).catch(() => false)
      if (isLoggedIn) {
        logger.success('Login detected in browser.')
        return
      }

      await page.waitForTimeout(pollIntervalInMs).catch(() => {})
    }

    throw new BrowserManager.AuthError(
      'Timed out waiting for manual login after 5 minutes. Keep the browser open and try again.'
    )
  }

  private async verifyLoginStatus(page: Page): Promise<boolean> {
    await page.waitForTimeout(1000).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    const currentUrl = page.url()

    const unauthenticatedUrlPatterns = ['/login', '/sign-in', '/join', '/signup']
    if (unauthenticatedUrlPatterns.some((path) => currentUrl.includes(path))) {
      return false
    }

    const userMenuElementCount = await page
      .locator('[data-testid="user-menu"]')
      .count()
      .catch(() => 0)

    if (userMenuElementCount > 0) {
      return true
    }

    const authenticatedUiSignalCount = await page
      .locator('text=/Account|Settings|Subscription|Manage Subscription/i')
      .count()
      .catch(() => 0)

    return authenticatedUiSignalCount > 0
  }

  private async persistAuthenticationState(): Promise<void> {
    if (!this.activeContext) {
      throw new BrowserManager.AuthError('No browser context available to save')
    }
    const currentStorageState = await this.activeContext.storageState()
    // Ensure the storage directory exists (it may have been deleted by a reset)
    const storageDir = dirname(config.authStoragePath)
    if (!existsSync(storageDir)) {
      mkdirSync(storageDir, { recursive: true })
    }
    writeFileSync(config.authStoragePath, JSON.stringify(currentStorageState, null, 2))
  }

  private getActivePage(): Page {
    if (!this.activePage) {
      throw new BrowserManager.ContextError('Page not initialized')
    }
    return this.activePage
  }
}
