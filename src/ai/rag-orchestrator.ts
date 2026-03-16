import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { config } from '../utils/config.js'
import { createAIProvider } from './provider-factory.js'
import type { AIProvider } from './provider.js'

interface ResearchPlanFilters {
  spaceName?: string
  titleIncludes?: string
}

interface ResearchPlan {
  strategy: 'precise' | 'exhaustive'
  queries: string[]
  hardKeywords: string[]
  filters: ResearchPlanFilters
}

export class RagOrchestrator {
  private vectorStore: VectorStore
  private aiProvider: AIProvider
  private ripgrep: RgSearch

  constructor() {
    this.vectorStore = new VectorStore()
    this.aiProvider = createAIProvider()
    this.ripgrep = new RgSearch()
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest Adaptive RAG processing: "${question}"`)

    try {
      await this.aiProvider.validate()
      await this.vectorStore.assertIndexReady()

      const researchPlan = await this.developResearchPlan(question)
      const exhaustiveMode = researchPlan.strategy === 'exhaustive'

      logger.info(`Plan: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (exhaustiveMode) {
        logger.warn(
          `Exhaustive mode enabled. This may take a while as I'll be doing a deep dive into your history.`
        )
      }

      if (researchPlan.hardKeywords?.length) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      const searchResults = await this.executeAdaptiveHybridSearch(researchPlan)
      if (searchResults.length === 0) {
        logger.warn('No relevant indexed history was found for this question.')
        return
      }

      const contextFacts = await this.extractFactsWithGranularMapReduce(
        question,
        searchResults,
        exhaustiveMode
      )
      if (contextFacts.length === 0) {
        logger.warn('Relevant snippets were found, but no usable facts could be extracted.')
        return
      }

      logger.info(`Synthesizing final answer from ${contextFacts.length} verified facts...`)
      const finalAnswer = await this.generateMightiestResponse(
        question,
        contextFacts,
        researchPlan.strategy
      )

      console.log(`\n${chalk.bold.green('Mightiest AI Response:')}\n`)
      console.log(finalAnswer)

      this.displaySourceProvenance(contextFacts)

      const feedback = await this.verifyAnswerQuality(question, finalAnswer, contextFacts)
      if (feedback.status === 'missed-info') {
        logger.warn(`Self-Correction: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developResearchPlan(originalQuestion: string): Promise<ResearchPlan> {
    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
4. Filters: optionally return {"spaceName": "..."} and/or {"titleIncludes": "..."} if the question clearly implies them.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "filters": {"spaceName": "...", "titleIncludes": "..."}}
`
    try {
      const response = await this.aiProvider.generate(plannerPrompt)
      const json = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
      return {
        strategy: json.strategy || 'precise',
        queries: json.queries || [originalQuestion],
        hardKeywords: json.hardKeywords || [],
        filters: this.normalizeResearchPlanFilters(json.filters),
      }
    } catch (_err) {
      return { strategy: 'precise', queries: [originalQuestion], hardKeywords: [], filters: {} }
    }
  }

  private async executeAdaptiveHybridSearch(plan: ResearchPlan): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []
    const filter = this.buildMetadataFilter(plan.filters)

    for (let i = 0; i < (plan.queries || []).length; i++) {
      const q = plan.queries[i]!
      logger.debug(`Executing semantic search [${i + 1}/${plan.queries.length}]: "${q}"`)
      const res = filter
        ? await this.vectorStore.searchWithMetadataFilter(q, filter, 40)
        : await this.vectorStore.search(q, 40)
      searchPools.push(res)
    }

    const keywordPool: VectorSearchResult[] = []
    for (let i = 0; i < (plan.hardKeywords || []).length; i++) {
      const k = plan.hardKeywords[i]!
      logger.debug(`Executing keyword search [${i + 1}/${plan.hardKeywords.length}]: "${k}"`)
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: k })
        const converted: VectorSearchResult[] = matches.map((m) => ({
          meta: {
            path: join(config.exportDir, m.path),
            snippet: m.text,
            title: m.path.split('/').pop() || 'Untitled',
            id: m.path + m.line,
          },
          score: 1.0,
        }))
        keywordPool.push(...converted)
      } catch (_err) {
        /* oxlint-disable-next-line no-empty */
      }
    }

    if (keywordPool.length > 0) {
      searchPools.push(keywordPool)
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const scores = new Map<string, { res: VectorSearchResult; score: number }>()
    pools.forEach((pool) => {
      pool.forEach((res, rank) => {
        const path = res.meta['path'] || 'unknown'
        const snippet = res.meta['snippet'] || ''
        const id = res.meta['id'] || `${path}:${snippet}`
        const s = 1 / (60 + rank)
        if (scores.has(id)) {
          scores.get(id)!.score += s
        } else {
          scores.set(id, { res, score: s })
        }
      })
    })
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .map((v) => v.res)
  }

  private normalizeResearchPlanFilters(filters: unknown): ResearchPlanFilters {
    if (!filters || typeof filters !== 'object') {
      return {}
    }

    const candidate = filters as Record<string, unknown>
    const normalized: ResearchPlanFilters = {}

    if (typeof candidate['spaceName'] === 'string' && candidate['spaceName'].trim()) {
      normalized.spaceName = candidate['spaceName'].trim()
    }

    if (typeof candidate['titleIncludes'] === 'string' && candidate['titleIncludes'].trim()) {
      normalized.titleIncludes = candidate['titleIncludes'].trim()
    }

    return normalized
  }

  private buildMetadataFilter(filters: ResearchPlanFilters):
    | ((meta: Record<string, any>) => boolean)
    | null {
    const hasSpaceFilter = !!filters.spaceName
    const hasTitleFilter = !!filters.titleIncludes

    if (!hasSpaceFilter && !hasTitleFilter) {
      return null
    }

    return (meta: Record<string, any>) => {
      const spaceName = String(meta['spaceName'] ?? '')
      const title = String(meta['title'] ?? '')

      if (filters.spaceName && spaceName !== filters.spaceName) {
        return false
      }

      if (
        filters.titleIncludes &&
        !title.toLowerCase().includes(filters.titleIncludes.toLowerCase())
      ) {
        return false
      }

      return true
    }
  }

  private async extractFactsWithGranularMapReduce(
    question: string,
    results: VectorSearchResult[],
    exhaustive: boolean
  ): Promise<any[]> {
    const poolLimit = exhaustive ? 60 : 20
    const pool = results.slice(0, poolLimit)
    if (pool.length === 0) return []

    const findings: any[] = []
    const batchSize = 10
    const totalBatches = Math.ceil(pool.length / batchSize)

    for (let i = 0, batchIdx = 0; i < pool.length; i += batchSize, batchIdx++) {
      const batch = pool.slice(i, i + batchSize)
      logger.info(`Analyzing history snippets... batch ${batchIdx + 1} of ${totalBatches}`)

      const researchPrompt = `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${batch.map((r, j) => `[Node ${i + j}] ${r.meta['title']}: ${r.meta['snippet']}`).join('\n\n')}

Extract every specific fact, mention, date, or piece of code.
Return JSON array: [{"fact": "...", "node_id": N, "thread": "..."}]
`
      try {
        const response = await this.aiProvider.generate(researchPrompt)
        const extracted = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]')
        extracted.forEach((f: any) => {
          const original = pool[f.node_id - i]
          findings.push({
            fact: f.fact,
            source_title: original?.meta['title'] || f.thread || 'Unknown',
            thread: f.thread || original?.meta['title'] || 'Unknown',
          })
        })
      } catch (_err) {
        batch.forEach((r) => {
          findings.push({
            fact: r.meta['snippet'],
            source_title: r.meta['title'],
          })
        })
      }
    }

    return findings
  }

  private async generateMightiestResponse(
    question: string,
    findings: any[],
    strategy: string
  ): Promise<string> {
    const prompt = `
You are the Narrator. Synthesize these research findings into a cohesive, mightiest answer for: "${question}"
Strategy: ${strategy}
Findings:
${findings.map((f, i) => `[Find ${i}] (${f.source_title}): ${f.fact}`).join('\n')}

INSTRUCTIONS:
1. Provide a comprehensive, authoritative response.
2. If "exhaustive", list ALL relevant conversations and what they contributed.
3. Be specific with names and technical details.
4. Cite everything with [Find N].

ANSWER:
`
    return this.aiProvider.generate(prompt)
  }

  private displaySourceProvenance(facts: any[]): void {
    const uniqueThreads = new Set(facts.map((f: any) => f.source_title))
    if (uniqueThreads.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Explored:')}`)
      uniqueThreads.forEach((t) => console.log(` - ${t}`))
    }
  }

  private async verifyAnswerQuality(
    question: string,
    answer: string,
    _facts: any[]
  ): Promise<{ status: string; suggestion?: string }> {
    const prompt = `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
    try {
      const res = await this.aiProvider.generate(prompt)
      const parsed = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "ok"}')
      if (parsed.status !== 'ok' && parsed.status !== 'missed-info') {
        return { status: 'ok' }
      }
      return parsed
    } catch (_err) {
      return { status: 'ok' }
    }
  }
}
