import { LocalIndex } from 'vectra'
import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import { chunkMarkdown } from '../utils/chunking.js'
import { createAIProvider } from '../ai/provider-factory.js'
import type { AIProvider } from '../ai/provider.js'

export type VectorDocMeta = Record<string, string>

export interface VectorSearchResult {
  meta: VectorDocMeta
  score: number
}

interface IndexMetadata {
  provider: string
  embeddingModel: string
  generationModel: string
  builtAt: string
}

export class VectorStore {
  static readonly VectorStoreError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreError'
    }
  }

  static readonly IndexError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreIndexError'
    }
  }

  static readonly EmbeddingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreEmbeddingError'
    }
  }

  static readonly SearchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'VectorStoreSearchError'
    }
  }

  private vectorIndex: LocalIndex
  private aiProvider: AIProvider

  constructor() {
    this.vectorIndex = new LocalIndex(config.vectorIndexPath)
    this.aiProvider = createAIProvider()
  }

  async validate(): Promise<void> {
    try {
      await this.aiProvider.validate()
    } catch (_error) {
      throw new VectorStore.VectorStoreError(
        `Vector store validation failed: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  async rebuildFromExports(): Promise<void> {
    logger.info('Building vector index from exports folder...')
    const markdownFiles = this.getMarkdownFilesRecursively(config.exportDir)

    if (markdownFiles.length === 0) {
      logger.warn('No markdown files found to index.')
      return
    }

    await this.ensureIndexExists()
    await this.processMarkdownFilesByBatches(markdownFiles)
    this.writeIndexMetadata()

    logger.success('Vector index rebuild complete.')
  }

  async search(query: string, limit = 10): Promise<VectorSearchResult[]> {
    try {
      await this.assertIndexReady()
      const queryEmbedding = await this.generateQueryEmbedding(query)
      const rawResults = await this.queryVectorIndex(queryEmbedding, query, limit)
      return this.formatVectorSearchResults(rawResults)
    } catch (_error) {
      throw new VectorStore.SearchError(
        `Vector search failed: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  async searchWithMetadataFilter(
    query: string,
    filter: (meta: Record<string, any>) => boolean,
    limit = 10
  ): Promise<VectorSearchResult[]> {
    try {
      await this.assertIndexReady()
      const queryEmbedding = await this.generateQueryEmbedding(query)
      const rawResults = await this.vectorIndex.queryItems(
        queryEmbedding,
        query,
        limit,
        filter as any
      )
      return this.formatVectorSearchResults(rawResults)
    } catch (_error) {
      throw new VectorStore.SearchError(
        `Filtered vector search failed: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private async ensureIndexExists(): Promise<void> {
    if (!(await this.vectorIndex.isIndexCreated())) {
      await this.vectorIndex.createIndex()
    }
  }

  async hasUsableIndex(): Promise<boolean> {
    try {
      await this.assertIndexReady()
      return true
    } catch (_error) {
      return false
    }
  }

  async assertIndexReady(): Promise<void> {
    const isIndexCreated = await this.vectorIndex.isIndexCreated()
    if (!isIndexCreated) {
      throw new VectorStore.IndexError(
        'Vector index not found. Run "Build vector index" before using semantic search or RAG.'
      )
    }

    const indexMetadata = this.readIndexMetadata()
    if (!indexMetadata) {
      throw new VectorStore.IndexError(
        'Vector index metadata is missing. Rebuild the vector index before using semantic search or RAG.'
      )
    }

    if (
      indexMetadata.provider !== this.aiProvider.providerName ||
      indexMetadata.embeddingModel !== this.aiProvider.embeddingModel
    ) {
      throw new VectorStore.IndexError(
        `Vector index was built with ${indexMetadata.provider}/${indexMetadata.embeddingModel}. Rebuild the index for ${this.aiProvider.providerName}/${this.aiProvider.embeddingModel}.`
      )
    }
  }

  private getMarkdownFilesRecursively(directory: string): string[] {
    const entries = readdirSync(directory)
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = join(directory, entry)
      const fileStatus = statSync(fullPath)
      if (fileStatus.isDirectory()) {
        files.push(...this.getMarkdownFilesRecursively(fullPath))
      } else if (fileStatus.isFile() && fullPath.endsWith('.md')) {
        files.push(fullPath)
      }
    }
    return files
  }

  private async processMarkdownFilesByBatches(files: string[]): Promise<void> {
    await this.vectorIndex.beginUpdate()
    const EMBEDDING_BATCH_SIZE = 10
    let pendingTextsToEmbed: string[] = []
    let pendingMetadataToInsert: VectorDocMeta[] = []
    let failedEmbeddingBatchCount = 0

    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]!
      const { contentChunks, fileMetadata } = this.extractContentAndMetadata(filePath)

      for (let j = 0; j < contentChunks.length; j++) {
        const textChunk = contentChunks[j]!
        pendingTextsToEmbed.push(textChunk)
        pendingMetadataToInsert.push({
          ...fileMetadata,
          id: `${fileMetadata['id']}_part_${j}`,
          title: `${fileMetadata['title']} (Part ${j + 1})`,
          snippet: textChunk,
        })

        if (pendingTextsToEmbed.length >= EMBEDDING_BATCH_SIZE) {
          const success = await this.processAndInsertEmbeddingBatch(
            pendingTextsToEmbed,
            pendingMetadataToInsert
          )
          if (!success) {
            failedEmbeddingBatchCount++
          }
          pendingTextsToEmbed = []
          pendingMetadataToInsert = []
        }
      }

      if ((i + 1) % 10 === 0) {
        logger.debug(`Processed ${i + 1}/${files.length} files...`)
      }
    }

    if (pendingTextsToEmbed.length > 0) {
      const success = await this.processAndInsertEmbeddingBatch(
        pendingTextsToEmbed,
        pendingMetadataToInsert
      )
      if (!success) {
        failedEmbeddingBatchCount++
      }
    }

    await this.vectorIndex.endUpdate()

    if (failedEmbeddingBatchCount > 0) {
      throw new VectorStore.IndexError(
        `Vector index build failed: ${failedEmbeddingBatchCount} embedding batch(es) could not be processed.`
      )
    }
  }

  private extractContentAndMetadata(path: string): {
    contentChunks: string[]
    fileMetadata: VectorDocMeta
  } {
    const content = readFileSync(path, 'utf-8')
    const titleMatch = content.match(/^# (.+)$/m)
    const spaceMatch = content.match(/^\*\*Space:\*\* (.+?)\s{2,}$/m)
    const idMatch = content.match(/^\*\*ID:\*\* (.+?)\s{2,}$/m)
    const dateMatch = content.match(/^\*\*Date:\*\* (.+?)\s{2,}$/m)

    const title = titleMatch?.[1] ?? 'Untitled'
    const spaceName = spaceMatch?.[1] ?? 'General'
    const baseId = idMatch?.[1] ?? path
    const dateIso = dateMatch?.[1] ?? new Date().toISOString()

    const contentChunks = chunkMarkdown(content, 1500, 100)

    return {
      contentChunks,
      fileMetadata: { id: baseId, path, title, spaceName, date: dateIso },
    }
  }

  private async processAndInsertEmbeddingBatch(
    texts: string[],
    metas: VectorDocMeta[]
  ): Promise<boolean> {
    try {
      const embeddingVectors = await this.aiProvider.embed(texts, 'document')
      for (let k = 0; k < embeddingVectors.length; k++) {
        const vector = embeddingVectors[k]
        if (!vector) continue
        await this.vectorIndex.insertItem({
          vector,
          metadata: metas[k] as Record<string, any>,
        })
      }
      return true
    } catch (_error) {
      logger.error(`Batch embedding failed: ${(_error as Error).message}`)
      return false
    }
  }

  private async generateQueryEmbedding(query: string): Promise<number[]> {
    const [queryEmbedding] = await this.aiProvider.embed([query], 'query')
    if (!queryEmbedding) {
      throw new VectorStore.EmbeddingError('Failed to generate embedding for query')
    }
    return queryEmbedding
  }

  private async queryVectorIndex(
    embedding: number[],
    query: string,
    limit: number
  ): Promise<any[]> {
    return this.vectorIndex.queryItems(embedding, query, limit)
  }

  private formatVectorSearchResults(results: any[]): VectorSearchResult[] {
    return results.map((result) => ({
      meta: result.item.metadata as VectorDocMeta,
      score: result.score,
    }))
  }

  private getIndexMetadataPath(): string {
    return join(config.vectorIndexPath, 'provider-meta.json')
  }

  private writeIndexMetadata(): void {
    const metadata: IndexMetadata = {
      provider: this.aiProvider.providerName,
      embeddingModel: this.aiProvider.embeddingModel,
      generationModel: this.aiProvider.generationModel,
      builtAt: new Date().toISOString(),
    }

    writeFileSync(this.getIndexMetadataPath(), JSON.stringify(metadata, null, 2))
  }

  private readIndexMetadata(): IndexMetadata | null {
    const metadataPath = this.getIndexMetadataPath()
    if (!existsSync(metadataPath)) {
      return null
    }

    try {
      return JSON.parse(readFileSync(metadataPath, 'utf-8')) as IndexMetadata
    } catch (_error) {
      return null
    }
  }
}
