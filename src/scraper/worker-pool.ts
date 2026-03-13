import type { Browser, BrowserContext } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { logger } from '../utils/logger.js'
import { config } from '../utils/config.js'
import { ConversationExtractor, type ExtractedConversation } from './conversation-extractor.js'
import { FileWriter } from '../export/file-writer.js'
import type { CheckpointManager, ConversationMetadata } from './checkpoint-manager.js'

interface Worker {
  id: number
  extractor: ConversationExtractor
  isBusy: boolean
}

interface ProcessingStats {
  total: number
  succeeded: number
  failed: number
  skipped: number
  failures: Array<{ url: string; title: string; reason: string }>
}

/**
 * Loads and validates the saved authentication state.
 * Returns the storage state object if valid, otherwise null.
 */
function loadAuthState(): any | null {
  const authPath = config.authStoragePath
  if (!existsSync(authPath)) return null
  try {
    const stats = statSync(authPath)
    const ageMs = Date.now() - stats.mtimeMs
    const oneDayMs = 24 * 60 * 60 * 1000
    if (ageMs >= oneDayMs) return null
    return JSON.parse(readFileSync(authPath, 'utf-8'))
  } catch {
    return null
  }
}

export class WorkerPool {
  // ========== Custom Error Classes ==========
  static readonly InitializationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkerInitializationError'
    }
  }

  static readonly ProcessingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'WorkerProcessingError'
    }
  }

  static readonly FileValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileValidationError'
    }
  }

  static readonly ExtractionError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'ExtractionError'
    }
  }

  private workers: Worker[] = []
  private readonly fileWriter: FileWriter
  private readonly checkpointManager: CheckpointManager
  private stats: ProcessingStats
  private sharedContext: BrowserContext | null = null
  private contextLock: Promise<void> | null = null // simple lock for context recreation
  private browser: Browser // store browser reference

  constructor(checkpointManager: CheckpointManager, browser: Browser) {
    this.fileWriter = new FileWriter()
    this.checkpointManager = checkpointManager
    this.stats = this.createEmptyStats()
    this.browser = browser
  }

  // ========== Public API ==========
  async initialize(): Promise<void> {
    logger.info(`Initializing worker pool with ${config.parallelWorkers} workers...`)

    try {
      // Create a single shared context with saved auth state
      await this.recreateSharedContext()

      // Create workers, each sharing the same context
      for (let i = 0; i < config.parallelWorkers; i++) {
        const worker = await this.createWorker(i + 1)
        this.workers.push(worker)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new WorkerPool.InitializationError(`Failed to initialize workers: ${message}`)
    }

    logger.success(`Worker pool ready with ${this.workers.length} workers`)
  }

  async processConversations(conversations: ConversationMetadata[]): Promise<void> {
    this.resetStats(conversations.length)
    logger.info(`Processing ${conversations.length} conversations in parallel...`)

    const queue = [...conversations]
    const activeWorkers = this.workers.map((worker) => this.runWorkerLoop(worker, queue))

    await Promise.all(activeWorkers)
    this.printSummary()
  }

  async close(): Promise<void> {
    if (this.sharedContext) {
      await this.sharedContext.close()
    }
    logger.info('Worker pool closed')
  }

  // ========== Private Methods ==========

  /**
   * Recreates the shared browser context using the stored auth state.
   * Uses a lock to prevent multiple concurrent recreations.
   */
  private async recreateSharedContext(): Promise<void> {
    // If a recreation is already in progress, wait for it
    if (this.contextLock) {
      await this.contextLock
      return
    }

    // Create a new lock promise
    let resolveLock: () => void
    this.contextLock = new Promise<void>((resolve) => {
      resolveLock = resolve
    })

    try {
      if (this.sharedContext) {
        await this.sharedContext.close().catch(() => {})
      }

      const storageState = loadAuthState()
      this.sharedContext = storageState
        ? await this.browser.newContext({ storageState })
        : await this.browser.newContext()

      logger.info('Shared browser context recreated')
    } finally {
      // Release lock
      resolveLock!()
      this.contextLock = null
    }
  }

  /**
   * Creates a single worker that shares the global context.
   */
  private async createWorker(id: number): Promise<Worker> {
    if (!this.sharedContext) {
      throw new WorkerPool.InitializationError('Shared context not initialized')
    }

    const extractor = new ConversationExtractor(this.sharedContext)

    return {
      id,
      extractor,
      isBusy: false,
    }
  }

  /**
   * Creates an empty stats object.
   */
  private createEmptyStats(): ProcessingStats {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    }
  }

  /**
   * Resets stats for a new processing run.
   */
  private resetStats(total: number): void {
    this.stats = {
      total,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    }
  }

  /**
   * Worker loop: continuously pulls tasks from the queue until empty.
   */
  private async runWorkerLoop(worker: Worker, queue: ConversationMetadata[]): Promise<void> {
    while (queue.length > 0) {
      const conversation = queue.shift()
      if (!conversation) break

      await this.processConversation(worker, conversation)
    }
    logger.debug(`Worker ${worker.id} finished (queue empty)`)
  }

  /**
   * Processes a single conversation: delay, extract, validate, save, update stats/checkpoint.
   * If a context error occurs, attempts to recreate the context and retry once.
   */
  private async processConversation(
    worker: Worker,
    conversation: ConversationMetadata
  ): Promise<void> {
    worker.isBusy = true

    try {
      await this.randomDelay()
      this.logWorkerStart(worker, conversation)

      let extracted: ExtractedConversation | null = null
      let retried = false

      // Attempt extraction (with one retry on context error)
      while (true) {
        try {
          extracted = await worker.extractor.extract(conversation.url)
          break // success
        } catch (error) {
          const isContextError = this.isContextError(error)
          if (isContextError && !retried) {
            logger.warn(`Worker ${worker.id}: context error, attempting to recreate...`)
            await this.recreateSharedContext()
            // Update worker's extractor with the new context
            worker.extractor = new ConversationExtractor(this.sharedContext!)
            retried = true
            // Continue loop to retry
          } else {
            // Re-throw if not a context error or retry already attempted
            throw error
          }
        }
      }

      if (!extracted) {
        this.handleSkipped(
          worker,
          conversation,
          'No extractable content (empty thread or auth issue)'
        )
        return
      }

      const filepath = this.fileWriter.write(extracted)
      await this.validateExtractedFile(filepath, extracted)

      this.logWorkerSuccess(worker, filepath)
      this.stats.succeeded++
      this.checkpointManager.markProcessed(conversation.url)
    } catch (error) {
      this.handleProcessingError(worker, conversation, error)
    } finally {
      worker.isBusy = false
    }
  }

  /**
   * Determines if an error is caused by a dead browser context.
   */
  private isContextError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      message.includes('Target page, context or browser has been closed') ||
      message.includes('Failed to open a new tab') ||
      message.includes('Protocol error') ||
      message.includes('browserContext.newPage')
    )
  }

  /**
   * Adds a random delay to avoid overwhelming the server.
   */
  private async randomDelay(): Promise<void> {
    const delayMs = 1000 + Math.random() * 2000
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  /**
   * Logs the start of a conversation processing.
   */
  private logWorkerStart(worker: Worker, conversation: ConversationMetadata): void {
    const shortTitle = conversation.title.substring(0, 80)
    logger.info(`Worker ${worker.id} → ${shortTitle} (${conversation.url})`)
  }

  /**
   * Logs successful processing.
   */
  private logWorkerSuccess(worker: Worker, filepath: string): void {
    logger.success(`Worker ${worker.id} saved: ${filepath}`)
  }

  /**
   * Validates that the written file meets expectations.
   * Throws FileValidationError if validation fails.
   */
  private async validateExtractedFile(
    filepath: string,
    extracted: ExtractedConversation
  ): Promise<void> {
    const validationError = this.validateFile(filepath, extracted)
    if (validationError) {
      throw new WorkerPool.FileValidationError(validationError)
    }
  }

  /**
   * Performs file existence, size, and content checks.
   * Returns error message string or null if valid.
   */
  private validateFile(filepath: string, extracted: ExtractedConversation): string | null {
    try {
      if (!existsSync(filepath)) {
        return 'File not found after write'
      }

      const stats = statSync(filepath)
      if (stats.size === 0) {
        return 'File is empty'
      }

      if (stats.size < 50) {
        return `File too small (${stats.size} bytes)`
      }

      const content = readFileSync(filepath, 'utf-8')

      if (!content.includes('##')) {
        return 'Missing question headers (##)'
      }

      if (!content.includes('---')) {
        return 'Missing separators (---)'
      }

      if (!content.includes(`# ${extracted.title}`)) {
        return 'Title not found in file content'
      }

      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Validation exception: ${message}`
    }
  }

  /**
   * Handles a skipped conversation (extractor returned null).
   */
  private handleSkipped(worker: Worker, conversation: ConversationMetadata, reason: string): void {
    logger.warn(`Worker ${worker.id} skipped: ${conversation.title} (${reason})`)
    this.stats.skipped++
    this.stats.failures.push({
      url: conversation.url,
      title: conversation.title,
      reason,
    })
  }

  /**
   * Handles errors during processing (extraction, validation, writing).
   */
  private handleProcessingError(
    worker: Worker,
    conversation: ConversationMetadata,
    error: unknown
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Worker ${worker.id} failed for ${conversation.title}`)
    logger.error(`  URL: ${conversation.url}`)
    logger.error(`  Error: ${message}`)

    this.stats.failed++
    this.stats.failures.push({
      url: conversation.url,
      title: conversation.title,
      reason: message,
    })
    // Do not mark as processed
  }

  /**
   * Prints a detailed summary of processing results.
   */
  private printSummary(): void {
    const line = '='.repeat(70)
    logger.info(`\n${line}`)
    logger.info('📊 EXPORT SUMMARY')
    logger.info(line)

    logger.info(`Total conversations: ${this.stats.total}`)
    logger.success(`✓ Successfully exported: ${this.stats.succeeded}`)

    if (this.stats.skipped > 0) {
      logger.warn(`⚠ Skipped (no extractable content): ${this.stats.skipped}`)
    }

    if (this.stats.failed > 0) {
      logger.error(`✗ Failed: ${this.stats.failed}`)
    }

    if (this.stats.failures.length > 0) {
      logger.info('\n❌ Failed / Skipped Conversations:')
      logger.info('-'.repeat(70))
      for (const failure of this.stats.failures) {
        logger.error(`\n  ${failure.title}`)
        logger.error(`    URL: ${failure.url}`)
        logger.error(`    Reason: ${failure.reason}`)
      }
      logger.info()
    }

    logger.info(`${line}\n`)

    if (this.stats.failed > 0 || this.stats.skipped > 0) {
      logger.info('💡 Failed/skipped conversations were NOT marked as processed.')
      logger.info('   You can rerun the scraper to retry them.')
    }
  }
}
