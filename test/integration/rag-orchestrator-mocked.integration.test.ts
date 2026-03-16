import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'gemini'
process.env.GEMINI_API_KEY = 'test-gemini-key'
process.env.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'
process.env.GEMINI_MODEL = 'gemini-2.0-flash'
process.env.GEMINI_EMBED_MODEL = 'gemini-embedding-001'

const { RagOrchestrator } = await import('../../src/ai/rag-orchestrator.js')
const { config } = await import('../../src/utils/config.js')
const { VectorStore } = await import('../../src/search/vector-store.js')
const { RgSearch } = await import('../../src/search/rg-search.js')

Object.defineProperty(config, 'aiProvider', {
  get: () => 'gemini',
  configurable: true,
})
Object.defineProperty(config, 'embedProvider', {
  get: () => 'gemini',
  configurable: true,
})
Object.defineProperty(config, 'generateProvider', {
  get: () => 'gemini',
  configurable: true,
})

const mockSearchOutcome = [
  {
    meta: {
      title: 'Mocked Title',
      path: 'path/to/mocked.md',
      snippet: 'This is some mocked content from a Perplexity export.',
      id: 'mock-1',
    },
    score: 0.95,
  },
]

const mswServer = setupServer(
  http.post(new RegExp(`/models/${config.geminiEmbedModel}:embedContent`), () => {
    return HttpResponse.json({
      embedding: {
        values: [0.1, 0.2, 0.3],
      },
    })
  }),
  http.post(new RegExp(`/models/${config.geminiModel}:generateContent`), async ({ request }) => {
    const body = (await request.json()) as { prompt: string }
    const prompt =
      body.prompt ??
      body.contents?.flatMap((content: any) => content.parts ?? []).map((part: any) => part.text).join('\n') ??
      ''

    let responseText = ''
    if (prompt.includes('Analyze:')) {
      responseText =
        '{"strategy": "precise", "queries": ["What is in my history?"], "hardKeywords": ["mocked"], "filters": {}}'
    } else if (prompt.includes('You are the Researcher.')) {
      responseText =
        '[{"fact": "Based on your history, there is a Mocked Title.", "node_id": 0, "thread": "Mocked Title"}]'
    } else if (prompt.includes('You are the Narrator.')) {
      responseText = 'Based on your history, there is a Mocked Title.'
    } else if (prompt.includes('Verify the answer.')) {
      responseText = '{"status": "ok"}'
    } else {
      responseText = '{"status": "ok"}'
    }

    return HttpResponse.json({
      candidates: [
        {
          content: {
            parts: [{ text: responseText }],
          },
        },
      ],
    })
  })
)

beforeAll(() => mswServer.listen())
afterEach(() => {
  mswServer.resetHandlers()
  vi.restoreAllMocks()
})
afterAll(() => mswServer.close())

describe('RagOrchestrator (MSW Mocked)', () => {
  it('should orchestrate the RAG flow successfully', async () => {
    vi.spyOn(VectorStore.prototype, 'search').mockResolvedValue(mockSearchOutcome)
    vi.spyOn(VectorStore.prototype, 'validate').mockResolvedValue(undefined)
    vi.spyOn(VectorStore.prototype, 'assertIndexReady').mockResolvedValue(undefined)
    vi.spyOn(RgSearch.prototype, 'captureSearchMatches').mockResolvedValue([])

    const ragOrchestratorInstance = new RagOrchestrator()
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await ragOrchestratorInstance.answerQuestion('What is in my history?')

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Based on your history'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Mocked Title'))

    consoleLogSpy.mockRestore()
  })
})
