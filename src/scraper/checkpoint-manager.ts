import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

export interface SpaceMetadata {
  url: string
  name: string
}

export interface ConversationMetadata {
  url: string
  title: string
  spaceName: string
  timestamp?: string
}

export interface Checkpoint {
  spaces: SpaceMetadata[]
  discoveredConversations: ConversationMetadata[]
  processedUrls: string[]
  discoveryCompleted: boolean
  lastUpdated: string
  totalProcessed: number
}

export class CheckpointManager {
  // ========== Custom Error Classes ==========
  static readonly LoadError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointLoadError'
    }
  }

  static readonly SaveError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointSaveError'
    }
  }

  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'CheckpointValidationError'
    }
  }

  private checkpoint: Checkpoint
  private saveCounter = 0

  constructor() {
    this.checkpoint = this.load()
  }

  // ========== Public API ==========
  setSpaces(spaces: SpaceMetadata[]): void {
    this.checkpoint.spaces = spaces
    this.save()
    logger.success(`Space discovery complete: ${spaces.length} spaces found`)
  }

  getSpaces(): SpaceMetadata[] {
    return this.checkpoint.spaces
  }

  setDiscoveredConversations(conversations: ConversationMetadata[]): void {
    this.checkpoint.discoveredConversations = conversations
    this.checkpoint.discoveryCompleted = true
    this.save()
    logger.success(`Discovery complete: ${conversations.length} conversations found`)
  }

  markProcessed(url: string): void {
    if (this.checkpoint.processedUrls.includes(url)) return

    this.checkpoint.processedUrls.push(url)
    this.checkpoint.totalProcessed++
    this.saveCounter++

    if (this.saveCounter >= config.checkpointSaveInterval) {
      this.save()
      logger.debug(`Checkpoint saved (${this.checkpoint.totalProcessed} processed)`)
      this.saveCounter = 0
    }
  }

  getPendingConversations(): ConversationMetadata[] {
    return this.checkpoint.discoveredConversations.filter(
      (conv) => !this.checkpoint.processedUrls.includes(conv.url)
    )
  }

  getProgress(): { total: number; processed: number; pending: number } {
    const total = this.checkpoint.discoveredConversations.length
    const processed = this.checkpoint.processedUrls.length
    return { total, processed, pending: total - processed }
  }

  isDiscoveryComplete(): boolean {
    return this.checkpoint.discoveryCompleted
  }

  reset(): void {
    this.checkpoint = this.createDefaultCheckpoint()
    this.save()
    logger.info('Checkpoint reset')
  }

  finalSave(): void {
    this.save()
    logger.success(
      `Final checkpoint saved: ${this.checkpoint.totalProcessed} conversations processed`
    )
  }

  // ========== Private Methods ==========

  /**
   * Loads the checkpoint from disk, or returns a default if not present/corrupt.
   */
  private load(): Checkpoint {
    if (!existsSync(config.checkpointPath)) {
      return this.createDefaultCheckpoint()
    }

    try {
      const rawData = this.readCheckpointFile()
      const parsed = this.parseCheckpointData(rawData)
      this.validateCheckpoint(parsed)
      return parsed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to load checkpoint (${message}), starting fresh`)
      return this.createDefaultCheckpoint()
    }
  }

  /**
   * Reads the checkpoint file and returns its content as a string.
   */
  private readCheckpointFile(): string {
    try {
      return readFileSync(config.checkpointPath, 'utf-8')
    } catch (error) {
      throw new CheckpointManager.LoadError(
        `Cannot read checkpoint file: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Parses JSON data into a Checkpoint object.
   */
  private parseCheckpointData(rawData: string): Checkpoint {
    try {
      return JSON.parse(rawData) as Checkpoint
    } catch (error) {
      throw new CheckpointManager.LoadError(
        `Invalid JSON in checkpoint: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Validates that the loaded checkpoint has the required structure.
   */
  private validateCheckpoint(data: any): asserts data is Checkpoint {
    if (!data || typeof data !== 'object') {
      throw new CheckpointManager.ValidationError('Checkpoint is not an object')
    }

    const requiredFields: (keyof Checkpoint)[] = [
      'spaces',
      'discoveredConversations',
      'processedUrls',
      'discoveryCompleted',
      'lastUpdated',
      'totalProcessed',
    ]

    for (const field of requiredFields) {
      if (!(field in data)) {
        throw new CheckpointManager.ValidationError(`Missing required field: ${field}`)
      }
    }

    // Basic type checks (optional, but helpful)
    if (!Array.isArray(data.spaces)) {
      throw new CheckpointManager.ValidationError('spaces must be an array')
    }
    if (!Array.isArray(data.discoveredConversations)) {
      throw new CheckpointManager.ValidationError('discoveredConversations must be an array')
    }
    if (!Array.isArray(data.processedUrls)) {
      throw new CheckpointManager.ValidationError('processedUrls must be an array')
    }
    if (typeof data.discoveryCompleted !== 'boolean') {
      throw new CheckpointManager.ValidationError('discoveryCompleted must be a boolean')
    }
    if (typeof data.totalProcessed !== 'number') {
      throw new CheckpointManager.ValidationError('totalProcessed must be a number')
    }
  }

  /**
   * Creates a fresh default checkpoint.
   */
  private createDefaultCheckpoint(): Checkpoint {
    return {
      spaces: [],
      discoveredConversations: [],
      processedUrls: [],
      discoveryCompleted: false,
      lastUpdated: new Date().toISOString(),
      totalProcessed: 0,
    }
  }

  /**
   * Saves the current checkpoint to disk.
   */
  private save(): void {
    this.checkpoint.lastUpdated = new Date().toISOString()
    try {
      writeFileSync(config.checkpointPath, JSON.stringify(this.checkpoint, null, 2))
    } catch (error) {
      throw new CheckpointManager.SaveError(
        `Failed to write checkpoint: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
