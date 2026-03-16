import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'huggingface'
process.env.HF_TOKEN = 'test-hf-token'
process.env.HF_API_URL = 'https://api-inference.huggingface.co/models'
process.env.HF_ROUTER_URL = 'https://router.huggingface.co/v1'
process.env.HF_MODEL = 'Qwen/Qwen2.5-7B-Instruct'
process.env.HF_EMBED_MODEL = 'intfloat/multilingual-e5-large'

const { HuggingFaceProvider } = await import('../../src/ai/huggingface-provider.js')
const { config } = await import('../../src/utils/config.js')
const encodedEmbedModel = config.huggingFaceEmbedModel.replace('/', '%2F')

const mswServer = setupServer(
  http.post(new RegExp(`/models/${encodedEmbedModel}$`), async ({ request }) => {
    const body = (await request.json()) as { inputs: string[] }
    return HttpResponse.json(
      body.inputs.map((input, index) => (input.includes('hello') ? [0.9, 0.1] : [index + 0.1, 0.8]))
    )
  }),
  http.post(new RegExp('/chat/completions$'), async ({ request }) => {
    const body = (await request.json()) as {
      messages?: Array<{ content?: string }>
    }
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: `HF mocked response for: ${body.messages?.[0]?.content ?? ''}`,
          },
        },
      ],
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

describe('HuggingFaceProvider (MSW Mocked)', () => {
  it('should return embeddings', async () => {
    const provider = new HuggingFaceProvider()
    const result = await provider.embed(['hello world', 'doc two'], 'document')
    expect(result).toEqual([
      [0.9, 0.1],
      [1.1, 0.8],
    ])
  })

  it('should generate a response', async () => {
    const provider = new HuggingFaceProvider()
    const result = await provider.generate('test prompt')
    expect(result).toContain('HF mocked response')
  })
})
