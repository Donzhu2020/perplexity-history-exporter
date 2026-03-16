import { z } from 'zod'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import type { AIProvider, EmbeddingTaskType } from './provider.js'

const geminiEmbeddingSchema = z.object({
  embedding: z.object({
    values: z.array(z.number()),
  }),
})

const geminiBatchEmbeddingSchema = z.object({
  embeddings: z.array(
    z.union([
      z.object({
        values: z.array(z.number()),
      }),
      z.object({
        embedding: z.object({
          values: z.array(z.number()),
        }),
      }),
    ])
  ),
})

const geminiGenerationSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(
          z.object({
            text: z.string().optional(),
          })
        ),
      }),
    })
  ),
})

export class GeminiProvider implements AIProvider {
  static readonly GeminiError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'GeminiError'
    }
  }

  readonly providerName = 'gemini'
  readonly embeddingModel = config.geminiEmbedModel
  readonly generationModel = config.geminiModel

  async embed(texts: string[], taskType: EmbeddingTaskType = 'document'): Promise<number[][]> {
    if (texts.length === 0) return []
    this.ensureApiKey()

    const task = taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'

    if (texts.length === 1) {
      const responseData = await this.performGeminiRequest(
        `/models/${this.embeddingModel}:embedContent`,
        {
          model: `models/${this.embeddingModel}`,
          content: {
            parts: [{ text: texts[0] }],
          },
          taskType: task,
        }
      )
      return [geminiEmbeddingSchema.parse(responseData).embedding.values]
    }

    const responseData = await this.performGeminiRequest(
      `/models/${this.embeddingModel}:batchEmbedContents`,
      {
        requests: texts.map((text) => ({
          model: `models/${this.embeddingModel}`,
          content: {
            parts: [{ text }],
          },
          taskType: task,
        })),
      }
    )

    return geminiBatchEmbeddingSchema.parse(responseData).embeddings.map((item) =>
      'values' in item ? item.values : item.embedding.values
    )
  }

  async generate(prompt: string, modelOverride?: string): Promise<string> {
    this.ensureApiKey()

    const responseData = await this.performGeminiRequest(
      `/models/${modelOverride ?? this.generationModel}:generateContent`,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
      }
    )

    const parsed = geminiGenerationSchema.parse(responseData)
    const text = parsed.candidates
      .flatMap((candidate) => candidate.content.parts)
      .map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!text) {
      throw new GeminiProvider.GeminiError('Gemini returned an empty generation response.')
    }

    return text
  }

  async validate(): Promise<void> {
    logger.info('Validating Gemini configuration...')
    this.ensureApiKey()
    try {
      await this.embed(['ping'], 'query')
      logger.success('Gemini embeddings look good.')
    } catch (_error) {
      const message = _error instanceof Error ? _error.message : String(_error)
      throw new GeminiProvider.GeminiError(`Gemini validation failed: ${message}`)
    }
  }

  private ensureApiKey(): void {
    if (!config.geminiApiKey) {
      throw new GeminiProvider.GeminiError('GEMINI_API_KEY is required when AI_PROVIDER=gemini.')
    }
  }

  private async performGeminiRequest(endpoint: string, body: object): Promise<unknown> {
    const url = `${config.geminiApiUrl}${endpoint}?key=${encodeURIComponent(config.geminiApiKey)}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        let errorBody = ''
        try {
          errorBody = await response.text()
        } catch (_errorReadingResponseBody) {
          /* oxlint-disable-next-line no-empty */
        }
        throw new GeminiProvider.GeminiError(
          `Gemini request failed with status ${response.status} – ${errorBody.slice(0, 300)}`
        )
      }

      return await response.json()
    } catch (_error) {
      if (_error instanceof GeminiProvider.GeminiError) throw _error
      throw new GeminiProvider.GeminiError(
        `Network error while calling Gemini: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }
}
