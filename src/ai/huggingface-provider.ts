import { z } from 'zod'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import type { AIProvider, EmbeddingTaskType } from './provider.js'

const huggingFaceChatSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    })
  ),
})

const huggingFaceEmbeddingSchema = z.array(z.array(z.number()))

export class HuggingFaceProvider implements AIProvider {
  static readonly HuggingFaceError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'HuggingFaceError'
    }
  }

  readonly providerName = 'huggingface'
  readonly embeddingModel = config.huggingFaceEmbedModel
  readonly generationModel = config.huggingFaceModel

  async embed(texts: string[], taskType: EmbeddingTaskType = 'document'): Promise<number[][]> {
    if (texts.length === 0) return []
    this.ensureToken()

    try {
      const response = await fetch(
        `${config.huggingFaceApiUrl}/${encodeURIComponent(this.embeddingModel)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.huggingFaceToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: texts,
            normalize: true,
            prompt_name: taskType === 'query' ? 'query' : 'passage',
          }),
        }
      )

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new HuggingFaceProvider.HuggingFaceError(
          `Hugging Face embedding request failed with status ${response.status} – ${errorBody.slice(0, 300)}`
        )
      }

      const json = await response.json()
      const parsed = huggingFaceEmbeddingSchema.safeParse(json)
      if (parsed.success) {
        return parsed.data
      }

      throw new HuggingFaceProvider.HuggingFaceError(
        'Unexpected response format from Hugging Face feature extraction endpoint.'
      )
    } catch (_error) {
      if (_error instanceof HuggingFaceProvider.HuggingFaceError) throw _error
      throw new HuggingFaceProvider.HuggingFaceError(
        `Network error while calling Hugging Face embeddings: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  async generate(prompt: string, modelOverride?: string): Promise<string> {
    this.ensureToken()
    const model = modelOverride ?? this.generationModel

    try {
      const response = await fetch(`${config.huggingFaceRouterUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.huggingFaceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new HuggingFaceProvider.HuggingFaceError(
          `Hugging Face generation request failed with status ${response.status} – ${errorBody.slice(0, 300)}`
        )
      }

      const json = await response.json()
      const parsed = huggingFaceChatSchema.parse(json)
      const content = parsed.choices[0]?.message.content?.trim()
      if (!content) {
        throw new HuggingFaceProvider.HuggingFaceError(
          'Hugging Face chat completion returned empty content.'
        )
      }

      return content
    } catch (_error) {
      if (_error instanceof HuggingFaceProvider.HuggingFaceError) throw _error
      throw new HuggingFaceProvider.HuggingFaceError(
        `Network error while calling Hugging Face generation: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  async validate(): Promise<void> {
    logger.info('Validating Hugging Face configuration...')
    this.ensureToken()
    try {
      await this.embed(['ping'], 'query')
      logger.success('Hugging Face embeddings look good.')
    } catch (_error) {
      const message = _error instanceof Error ? _error.message : String(_error)
      throw new HuggingFaceProvider.HuggingFaceError(
        `Hugging Face validation failed: ${message}`
      )
    }
  }

  private ensureToken(): void {
    if (!config.huggingFaceToken.trim()) {
      throw new HuggingFaceProvider.HuggingFaceError(
        'HF_TOKEN is required when AI_PROVIDER=huggingface.'
      )
    }
  }
}
