import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'gemini'
process.env.GEMINI_API_KEY = 'test-gemini-key'
process.env.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'
process.env.GEMINI_MODEL = 'gemini-2.0-flash'
process.env.GEMINI_EMBED_MODEL = 'gemini-embedding-001'

const { GeminiProvider } = await import('../../src/ai/gemini-provider.js')
const { config } = await import('../../src/utils/config.js')

const mswServer = setupServer(
  http.post(new RegExp(`/models/${config.geminiEmbedModel}:embedContent`), () => {
    return HttpResponse.json({
      embedding: {
        values: [0.1, 0.2, 0.3],
      },
    })
  }),
  http.post(new RegExp(`/models/${config.geminiEmbedModel}:batchEmbedContents`), async ({ request }) => {
    const body = (await request.json()) as { requests: Array<unknown> }
    return HttpResponse.json({
      embeddings: body.requests.map((_, index) => ({
        values: [index + 0.1, index + 0.2, index + 0.3],
      })),
    })
  }),
  http.post(new RegExp(`/models/${config.geminiModel}:generateContent`), () => {
    return HttpResponse.json({
      candidates: [
        {
          content: {
            parts: [{ text: 'Gemini mocked response' }],
          },
        },
      ],
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

describe('GeminiProvider (MSW Mocked)', () => {
  it('should return a single embedding', async () => {
    const provider = new GeminiProvider()
    const result = await provider.embed(['hello world'], 'query')
    expect(result).toEqual([[0.1, 0.2, 0.3]])
  })

  it('should return batch embeddings', async () => {
    const provider = new GeminiProvider()
    const result = await provider.embed(['doc one', 'doc two'], 'document')
    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [1.1, 1.2, 1.3],
    ])
  })

  it('should generate a response', async () => {
    const provider = new GeminiProvider()
    const result = await provider.generate('test prompt')
    expect(result).toBe('Gemini mocked response')
  })
})
