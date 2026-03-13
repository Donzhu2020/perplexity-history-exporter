import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'

interface OllamaEmbeddingResponse {
  embedding: number[]
  data: Array<{ embedding: number[] }>
}

export class OllamaClient {
  // ========== Custom Error Classes ==========
  static readonly EmbeddingError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaEmbeddingError'
    }
  }

  static readonly ValidationError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaValidationError'
    }
  }

  static readonly ResponseFormatError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OllamaResponseFormatError'
    }
  }

  /**
   * Generate embeddings for a list of texts.
   * @throws {OllamaClient.EmbeddingError} if the request fails.
   * @throws {OllamaClient.ResponseFormatError} if the response format is unexpected.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    const body = this.buildRequestBody(texts)
    const response = await this.sendRequest(body)
    return this.parseResponse(response)
  }

  /**
   * Validate Ollama connectivity by embedding a single test string.
   * @throws {OllamaClient.ValidationError} if validation fails.
   */
  async validate(): Promise<void> {
    try {
      logger.info('Validating Ollama embedding configuration...')
      await this.embed(['ping'])
      logger.success('Ollama embeddings look good.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new OllamaClient.ValidationError(`Ollama validation failed: ${message}`)
    }
  }

  // ========== Private Methods ==========

  /**
   * Build the request body for the embeddings API.
   */
  private buildRequestBody(texts: string[]): object {
    return {
      model: config.ollamaEmbedModel,
      input: texts,
      options: {
        num_ctx: 8192, // nomic-embed-text supports up to 8192
      },
    }
  }

  /**
   * Send the embedding request and handle HTTP errors.
   * @throws {OllamaClient.EmbeddingError} on network or HTTP error.
   */
  private async sendRequest(body: object): Promise<Response> {
    const url = `${config.ollamaUrl}/v1/embeddings`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        await this.handleErrorResponse(response, body)
      }

      return response
    } catch (error) {
      throw new OllamaClient.EmbeddingError(
        `Network error while calling Ollama: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Process a non-OK HTTP response, extracting error details and throwing EmbeddingError.
   */
  private async handleErrorResponse(response: Response, body: object): Promise<never> {
    const errorText = await response.text().catch(() => '')
    const inputLengths = (body as any).input?.map((t: string) => t.length) || []
    const maxLength = inputLengths.length ? Math.max(...inputLengths) : 0

    console.error(`Ollama Embed Error: ${response.status} ${response.statusText}`)
    console.error(`Payload size: ${inputLengths.length} texts`)
    console.error(`Max text length: ${maxLength}`)

    throw new OllamaClient.EmbeddingError(
      `Ollama embeddings failed (${response.status}): ${errorText || response.statusText}`
    )
  }

  /**
   * Parse the JSON response and extract embeddings.
   * @throws {OllamaClient.ResponseFormatError} if format is unexpected.
   */
  private parseResponse(response: Response): number[][] {
    // We already checked response.ok, so response.json() should succeed.
    // But we'll still wrap in try/catch.
    try {
      const json = response.json() as unknown as OllamaEmbeddingResponse

      // Handle OpenAI-compatible format (data array)
      if (json.data && Array.isArray(json.data)) {
        return json.data.map(item => item.embedding)
      }

      // Fallback for older Ollama versions (single embedding)
      if (json.embedding) {
        return [json.embedding]
      }

      throw new OllamaClient.ResponseFormatError(
        'Unexpected response format from Ollama embeddings endpoint'
      )
    } catch (error) {
      if (error instanceof OllamaClient.ResponseFormatError) throw error
      throw new OllamaClient.ResponseFormatError(
        `Failed to parse Ollama response: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
