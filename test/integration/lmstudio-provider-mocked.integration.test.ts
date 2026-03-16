import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'lmstudio'
process.env.EMBED_PROVIDER = 'huggingface'
process.env.GENERATE_PROVIDER = 'lmstudio'
process.env.LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
process.env.LM_STUDIO_MODEL = 'qwen3.5-27b'
process.env.LM_STUDIO_API_KEY = ''

const { LMStudioProvider } = await import('../../src/ai/lmstudio-provider.js')
const { config } = await import('../../src/utils/config.js')

const mswServer = setupServer(
  http.get(new RegExp('/v1/models$'), () => {
    return HttpResponse.json({
      data: [{ id: 'qwen3.5-27b' }],
    })
  }),
  http.post(new RegExp('/v1/chat/completions$'), async ({ request }) => {
    const body = (await request.json()) as {
      messages?: Array<{ content?: string }>
    }
    return HttpResponse.json({
      choices: [
        {
          message: {
            content: `LM Studio mocked response for: ${body.messages?.[0]?.content ?? ''}`,
          },
        },
      ],
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => mswServer.resetHandlers())
afterAll(() => mswServer.close())

describe('LMStudioProvider (MSW Mocked)', () => {
  it('should validate against the local models endpoint', async () => {
    const provider = new LMStudioProvider()
    await expect(provider.validate()).resolves.toBeUndefined()
  })

  it('should generate a response', async () => {
    const provider = new LMStudioProvider()
    const result = await provider.generate('test prompt')
    expect(result).toContain('LM Studio mocked response')
  })
})
