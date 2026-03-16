import { config } from '../utils/config.js'
import type { AIProvider, ProviderName } from './provider.js'
import { GeminiProvider } from './gemini-provider.js'
import { HuggingFaceProvider } from './huggingface-provider.js'
import { LMStudioProvider } from './lmstudio-provider.js'
import { OllamaProvider } from './ollama-provider.js'

function createProvider(providerName: ProviderName): AIProvider {
  if (providerName === 'huggingface') {
    return new HuggingFaceProvider()
  }

  if (providerName === 'gemini') {
    return new GeminiProvider()
  }

  if (providerName === 'lmstudio') {
    return new LMStudioProvider()
  }

  return new OllamaProvider()
}

export function createAIProvider(): AIProvider {
  return createProvider(config.aiProvider)
}

export function createEmbeddingProvider(): AIProvider {
  return createProvider(config.embedProvider)
}

export function createGenerationProvider(): AIProvider {
  return createProvider(config.generateProvider)
}
