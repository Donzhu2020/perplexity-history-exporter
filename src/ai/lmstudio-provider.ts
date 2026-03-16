import { z } from 'zod'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import type { AIProvider, EmbeddingTaskType } from './provider.js'

const chatCompletionSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        content: z.string(),
      }),
    })
  ),
})

const modelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
    })
  ),
})

export class LMStudioProvider implements AIProvider {
  static readonly LMStudioError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'LMStudioError'
    }
  }

  readonly providerName = 'lmstudio'
  readonly embeddingModel = 'unsupported'
  readonly generationModel = config.lmStudioModel

  async embed(_texts: string[], _taskType: EmbeddingTaskType = 'document'): Promise<number[][]> {
    throw new LMStudioProvider.LMStudioError(
      'LM Studio provider is generation-only. Use it as GENERATE_PROVIDER, not EMBED_PROVIDER.'
    )
  }

  async generate(prompt: string, modelOverride?: string): Promise<string> {
    const model = modelOverride ?? this.generationModel
    if (!model.trim()) {
      throw new LMStudioProvider.LMStudioError(
        'LM_STUDIO_MODEL is required when GENERATE_PROVIDER=lmstudio.'
      )
    }

    try {
      const response = await fetch(`${config.lmStudioBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new LMStudioProvider.LMStudioError(
          `LM Studio generation request failed with status ${response.status} – ${errorBody.slice(0, 300)}`
        )
      }

      const json = await response.json()
      const parsed = chatCompletionSchema.parse(json)
      const content = this.stripThinkingContent(parsed.choices[0]?.message.content ?? '').trim()
      if (!content) {
        throw new LMStudioProvider.LMStudioError('LM Studio returned empty content.')
      }

      return content
    } catch (_error) {
      if (_error instanceof LMStudioProvider.LMStudioError) throw _error
      throw new LMStudioProvider.LMStudioError(
        `Network error while calling LM Studio: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  async validate(): Promise<void> {
    logger.info('Validating LM Studio configuration...')
    try {
      const response = await fetch(`${config.lmStudioBaseUrl}/models`, {
        method: 'GET',
        headers: this.buildHeaders(),
      })

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '')
        throw new LMStudioProvider.LMStudioError(
          `LM Studio validation failed with status ${response.status} – ${errorBody.slice(0, 300)}`
        )
      }

      const json = await response.json()
      const parsed = modelListSchema.parse(json)
      const modelIds = parsed.data.map((item) => item.id)
      if (config.lmStudioModel.trim() && !modelIds.includes(config.lmStudioModel)) {
        logger.warn(`Configured LM Studio model "${config.lmStudioModel}" was not listed by the server.`)
      }

      logger.success('LM Studio generation endpoint looks good.')
    } catch (_error) {
      if (_error instanceof LMStudioProvider.LMStudioError) throw _error
      throw new LMStudioProvider.LMStudioError(
        `Network error while validating LM Studio: ${_error instanceof Error ? _error.message : String(_error)}`
      )
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (config.lmStudioApiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.lmStudioApiKey}`
    }
    return headers
  }

  private stripThinkingContent(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '')
  }
}
