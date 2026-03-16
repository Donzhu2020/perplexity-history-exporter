import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

process.env.AI_PROVIDER = 'huggingface'
process.env.EMBED_PROVIDER = 'huggingface'
process.env.GENERATE_PROVIDER = 'lmstudio'
process.env.HF_TOKEN = 'test-hf-token'
process.env.HF_API_URL = 'https://router.huggingface.co/hf-inference/models'
process.env.HF_ROUTER_URL = 'https://router.huggingface.co/v1'
process.env.HF_EMBED_MODEL = 'intfloat/multilingual-e5-large'
process.env.LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
process.env.LM_STUDIO_MODEL = 'qwen3.5-27b'

const TEST_EXPORTS = join(process.cwd(), 'test-fixtures', 'rag-hf-lmstudio-exports')
const TEST_INDEX = join(process.cwd(), 'test-fixtures', 'rag-hf-lmstudio-vector-index')

const { config } = await import('../../src/utils/config.js')
const encodedEmbedModel = config.huggingFaceEmbedModel.replace('/', '%2F')

const mswServer = setupServer(
  http.post(new RegExp(`/models/${encodedEmbedModel}$`), async ({ request }) => {
    const body = (await request.json()) as { inputs: string[] }
    return HttpResponse.json(
      body.inputs.map((input) => {
        if (input.includes('TypeScript')) return [0.9, 0.1]
        if (input.includes('testing')) return [0.1, 0.9]
        return [0.8, 0.2]
      })
    )
  }),
  http.get(new RegExp('/v1/models$'), () => {
    return HttpResponse.json({
      data: [{ id: 'qwen3.5-27b' }],
    })
  }),
  http.post(new RegExp('/v1/chat/completions$'), async ({ request }) => {
    const body = (await request.json()) as {
      messages?: Array<{ content?: string }>
    }
    const prompt = body.messages?.[0]?.content ?? ''

    let content = '{"status":"ok"}'
    if (prompt.includes('Analyze:')) {
      content =
        '{"strategy":"precise","queries":["TypeScript static typing"],"hardKeywords":["TypeScript"],"filters":{"spaceName":"Dev"}}'
    } else if (prompt.includes('You are the Researcher.')) {
      content =
        '[{"fact":"TypeScript adds static typing to JavaScript.","node_id":0,"thread":"TypeScript Guide (Part 1)"}]'
    } else if (prompt.includes('You are the Narrator.')) {
      content = 'TypeScript adds static typing to JavaScript. [Find 0]'
    } else if (prompt.includes('Verify the answer.')) {
      content = '{"status":"ok"}'
    }

    return HttpResponse.json({
      choices: [
        {
          message: {
            content,
          },
        },
      ],
    })
  })
)

let VectorStore: any
let RagOrchestrator: any

describe('RAG Indexed Flow (HF Embeddings + LM Studio Generation)', () => {
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
    Object.defineProperty(config, 'embedProvider', {
      get: () => 'huggingface',
      configurable: true,
    })
    Object.defineProperty(config, 'generateProvider', {
      get: () => 'lmstudio',
      configurable: true,
    })
    Object.defineProperty(config, 'huggingFaceToken', {
      get: () => 'test-hf-token',
      configurable: true,
    })
    Object.defineProperty(config, 'lmStudioBaseUrl', {
      get: () => 'http://127.0.0.1:1234/v1',
      configurable: true,
    })
    Object.defineProperty(config, 'lmStudioModel', {
      get: () => 'qwen3.5-27b',
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
