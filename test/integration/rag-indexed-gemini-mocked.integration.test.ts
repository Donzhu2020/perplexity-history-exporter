import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'gemini'
process.env.GEMINI_API_KEY = 'test-gemini-key'
process.env.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'
process.env.GEMINI_MODEL = 'gemini-2.0-flash'
process.env.GEMINI_EMBED_MODEL = 'gemini-embedding-001'

const TEST_EXPORTS = join(process.cwd(), 'test-fixtures', 'rag-exports')
const TEST_INDEX = join(process.cwd(), 'test-fixtures', 'rag-vector-index')

const { config } = await import('../../src/utils/config.js')

const mswServer = setupServer(
  http.post(new RegExp(`/models/${config.geminiEmbedModel}:embedContent`), async ({ request }) => {
    const body = (await request.json()) as {
      content?: { parts?: Array<{ text?: string }> }
      taskType?: string
    }
    const text = body.content?.parts?.map((part) => part.text ?? '').join(' ') ?? ''

    if (text.includes('TypeScript')) {
      return HttpResponse.json({ embedding: { values: [0.9, 0.1, 0.0] } })
    }

    if (text.includes('testing')) {
      return HttpResponse.json({ embedding: { values: [0.1, 0.9, 0.0] } })
    }

    return HttpResponse.json({ embedding: { values: [0.8, 0.2, 0.0] } })
  }),
  http.post(
    new RegExp(`/models/${config.geminiEmbedModel}:batchEmbedContents`),
    async ({ request }) => {
      const body = (await request.json()) as {
        requests: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      return HttpResponse.json({
        embeddings: body.requests.map((req) => {
          const text = req.content?.parts?.map((part) => part.text ?? '').join(' ') ?? ''
          if (text.includes('TypeScript')) {
            return { values: [0.9, 0.1, 0.0] }
          }
          if (text.includes('testing')) {
            return { values: [0.1, 0.9, 0.0] }
          }
          return { values: [0.8, 0.2, 0.0] }
        }),
      })
    }
  ),
  http.post(new RegExp(`/models/${config.geminiModel}:generateContent`), async ({ request }) => {
    const body = (await request.json()) as {
      contents?: Array<{ parts?: Array<{ text?: string }> }>
    }
    const prompt =
      body.contents?.flatMap((content) => content.parts ?? []).map((part) => part.text ?? '').join('\n') ??
      ''

    let responseText = '{"status":"ok"}'

    if (prompt.includes('Analyze:')) {
      responseText =
        '{"strategy":"precise","queries":["TypeScript static typing"],"hardKeywords":["TypeScript"],"filters":{"spaceName":"Dev"}}'
    } else if (prompt.includes('You are the Researcher.')) {
      responseText =
        '[{"fact":"TypeScript adds static typing to JavaScript.","node_id":0,"thread":"TypeScript Guide (Part 1)"}]'
    } else if (prompt.includes('You are the Narrator.')) {
      responseText = 'TypeScript adds static typing to JavaScript. [Find 0]'
    } else if (prompt.includes('Verify the answer.')) {
      responseText = '{"status":"ok"}'
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

let VectorStore: any
let RagOrchestrator: any

describe('RAG Indexed Flow (Gemini Mocked)', () => {
  beforeAll(async () => {
    mswServer.listen()

    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    })

    Object.defineProperty(config, 'exportDir', {
      get: () => TEST_EXPORTS,
      configurable: true,
    })
    Object.defineProperty(config, 'vectorIndexPath', {
      get: () => TEST_INDEX,
      configurable: true,
    })
    Object.defineProperty(config, 'aiProvider', {
      get: () => 'gemini',
      configurable: true,
    })
    Object.defineProperty(config, 'geminiApiKey', {
      get: () => 'test-gemini-key',
      configurable: true,
    })
    Object.defineProperty(config, 'geminiModel', {
      get: () => 'gemini-2.0-flash',
      configurable: true,
    })
    Object.defineProperty(config, 'geminiEmbedModel', {
      get: () => 'gemini-embedding-001',
      configurable: true,
    })

    VectorStore = (await import('../../src/search/vector-store.js')).VectorStore
    RagOrchestrator = (await import('../../src/ai/rag-orchestrator.js')).RagOrchestrator
  })

  afterAll(() => {
    mswServer.close()
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    })
  })

  beforeEach(() => {
    ;[TEST_EXPORTS, TEST_INDEX].forEach((dir) => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
    })
  })

  it('should build an index and answer from indexed content', async () => {
    writeFileSync(
      join(TEST_EXPORTS, 'typescript-guide.md'),
      `# TypeScript Guide\n\n**Space:** Dev  \n**ID:** ts-123  \n**Date:** 2025-01-01T00:00:00.000Z  \n\n## Question\n\nWhat does TypeScript do?\n\n## Answer\n\nTypeScript adds static typing to JavaScript.\n`
    )

    writeFileSync(
      join(TEST_EXPORTS, 'testing-guide.md'),
      `# Testing Guide\n\n**Space:** QA  \n**ID:** qa-123  \n**Date:** 2025-01-02T00:00:00.000Z  \n\n## Question\n\nWhat is testing?\n\n## Answer\n\nTesting verifies behavior.\n`
    )

    const store = new VectorStore()
    await store.rebuildFromExports()

    const orchestrator = new RagOrchestrator()
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await orchestrator.answerQuestion('What did I learn about TypeScript in Dev?')

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('TypeScript adds static typing'))
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('TypeScript Guide'))

    consoleLogSpy.mockRestore()
  })
})
