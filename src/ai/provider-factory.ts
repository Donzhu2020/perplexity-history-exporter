import { config } from '../utils/config.js'
import type { AIProvider } from './provider.js'
import { GeminiProvider } from './gemini-provider.js'
import { OllamaProvider } from './ollama-provider.js'

export function createAIProvider(): AIProvider {
  if (config.aiProvider === 'gemini') {
    return new GeminiProvider()
  }

  return new OllamaProvider()
}
