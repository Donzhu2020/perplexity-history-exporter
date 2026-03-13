import { join } from 'node:path'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { config } from '../utils/config.js'
import type { ExtractedConversation } from '../scraper/conversation-extractor.js'
import { sanitizeFilename, sanitizeSpaceName } from './sanitizer.js'

export class FileWriter {
  // ========== Custom Error Classes ==========
  static readonly WriteError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FileWriteError'
    }
  }

  constructor() {
    this.ensureExportDir()
  }

  /**
   * Write a conversation to disk.
   * @throws {FileWriter.WriteError} if writing fails.
   */
  write(conversation: ExtractedConversation): string {
    try {
      const filepath = this.buildFilePath(conversation)
      const content = this.formatContent(conversation)

      // Ensure the space directory exists (if not already)
      const spaceDir = join(config.exportDir, sanitizeSpaceName(conversation.spaceName))
      if (!existsSync(spaceDir)) {
        mkdirSync(spaceDir, { recursive: true })
      }

      writeFileSync(filepath, content, 'utf-8')
      return filepath
    } catch (error) {
      throw new FileWriter.WriteError(
        `Failed to write conversation ${conversation.id}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // ========== Private Methods ==========

  /**
   * Ensure the base export directory exists.
   */
  private ensureExportDir(): void {
    if (!existsSync(config.exportDir)) {
      mkdirSync(config.exportDir, { recursive: true })
    }
  }

  /**
   * Build the full file path for a conversation.
   */
  private buildFilePath(conversation: ExtractedConversation): string {
    const safeSpace = sanitizeSpaceName(conversation.spaceName)
    const safeTitle = sanitizeFilename(conversation.title)
    const filename = `${safeTitle} (${conversation.id}).md`
    return join(config.exportDir, safeSpace, filename)
  }

  /**
   * Format the conversation content as a Markdown file.
   */
  private formatContent(conv: ExtractedConversation): string {
    return (
      `# ${conv.title}\n\n` +
      `Space: ${conv.spaceName}\n` +
      `ID: ${conv.id}\n` +
      `Date: ${conv.timestamp.toISOString()}\n\n` +
      `${conv.content}`
    )
  }
}
