import type { Page } from '@playwright/test'
import { logger } from '../utils/logger.js'
import type { ConversationMetadata } from './checkpoint-manager.js'

export class LibraryDiscovery {
  // ========== Custom Error Classes ==========
  static readonly VersionCaptureError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VersionCaptureError'
    }
  }

  static readonly PaginationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'PaginationError'
    }
  }

  static readonly NoDataError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'NoDataError'
    }
  }

  async discoverFromLibrary(page: Page): Promise<ConversationMetadata[]> {
    logger.info('Discovering threads via REST API...')

    await page.goto('https://www.perplexity.ai/library')
    await page.waitForLoadState('domcontentloaded')

    // 1. Capture API version from a real request (fallback to default)
    const apiVersion = await this.captureApiVersion(page)

    // 2. Paginate until no more threads
    const conversations = await this.paginateAllThreads(page, apiVersion)

    logger.success(`Discovered ${conversations.length} threads`)
    return conversations
  }

  /**
   * Attempts to extract the API version from a live network request.
   * Falls back to '2.18' if detection fails.
   */
  private async captureApiVersion(page: Page): Promise<string> {
    const defaultVersion = '2.18'

    try {
      const request = await page.waitForRequest(
        (req) => req.url().includes('/rest/thread/list_ask_threads'),
        { timeout: 5000 }
      )

      const url = request.url()
      const match = url.match(/[?&]version=([^&]+)/)

      if (match?.[1]) {
        const version = match[1]
        logger.info(`Discovered API version: ${version}`)
        return version
      }

      logger.warn('Found list_ask_threads request but no version parameter, using fallback')
      return defaultVersion
      // oxlint-disable-next-line no-unused-vars
    } catch (_error) {
      // waitForRequest timed out or failed – no request seen
      logger.warn('No list_ask_threads request detected, using fallback version')
      return defaultVersion
    }
  }

  /**
   * Fetches all threads by paginating through the API.
   */
  private async paginateAllThreads(
    page: Page,
    apiVersion: string
  ): Promise<ConversationMetadata[]> {
    const pageSize = 20
    let offset = 0
    const conversations: ConversationMetadata[] = []

    while (true) {
      const batch = await this.fetchThreadBatch(page, apiVersion, offset, pageSize)

      if (!batch.length) {
        logger.info(`No more threads at offset ${offset}`)
        break
      }

      const processed = this.processBatch(batch)
      conversations.push(...processed)

      logger.info(`Fetched ${batch.length} threads (offset ${offset})`)
      offset += pageSize
    }

    return conversations
  }

  /**
   * Fetches a single batch of threads from the API.
   */
  private async fetchThreadBatch(
    page: Page,
    apiVersion: string,
    offset: number,
    limit: number
  ): Promise<any[]> {
    try {
      return await page.evaluate(
        async ({ offset, limit, version }) => {
          const res = await fetch(
            `/rest/thread/list_ask_threads?version=${version}&source=default`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ limit, ascending: false, offset, search_term: '' }),
            }
          )

          if (!res.ok) {
            throw new Error(`API responded with ${res.status}`)
          }

          const data = await res.json()
          return Array.isArray(data) ? data : []
        },
        { offset, limit, version: apiVersion }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new LibraryDiscovery.PaginationError(
        `Failed to fetch batch at offset ${offset}: ${message}`
      )
    }
  }

  /**
   * Converts raw thread items into ConversationMetadata objects.
   */
  private processBatch(batch: any[]): ConversationMetadata[] {
    return batch
      .filter((item) => this.isValidThreadItem(item))
      .map((item) => ({
        url: `https://www.perplexity.ai/search/${item.slug}`,
        title: item.title ?? 'Untitled',
        spaceName: item.collection?.title ?? 'General',
        timestamp: item.last_query_datetime ?? undefined,
      }))
  }

  /**
   * Validates that a thread item has the minimum required fields.
   */
  private isValidThreadItem(item: any): boolean {
    if (!item || typeof item !== 'object') return false
    if (!item.slug || typeof item.slug !== 'string') return false
    // slug must be present and non-empty for URL construction
    return true
  }
}
