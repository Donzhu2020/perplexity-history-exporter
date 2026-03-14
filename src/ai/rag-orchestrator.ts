import { VectorStore, type VectorSearchResult } from '../search/vector-store.js'
import { OllamaClient } from './ollama-client.js'
import { RgSearch } from '../search/rg-search.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'
import { join } from 'node:path'
import { config } from '../utils/config.js'

export class RagOrchestrator {
  private vectorStore: VectorStore
  private ollamaClient: OllamaClient
  private ripgrep: RgSearch

  constructor() {
    this.vectorStore = new VectorStore()
    this.ollamaClient = new OllamaClient()
    this.ripgrep = new RgSearch()
  }

  async answerQuestion(question: string): Promise<void> {
    logger.info(`Mightiest Adaptive RAG processing: "${question}"`)

    try {
      const researchPlan = await this.developResearchPlan(question)
      logger.info(`Plan: ${chalk.bold.yellow(researchPlan.strategy.toUpperCase())}`)
      if (researchPlan.hardKeywords?.length) {
        logger.info(`Hard Keywords detected: ${chalk.gray(researchPlan.hardKeywords.join(', '))}`)
      }

      const searchCandidates = await this.executeAdaptiveHybridSearch(researchPlan)

      logger.info(`Analyzing ${searchCandidates.length} potential conversation segments...`)
      const intermediateFindings = await this.performDeepResearch(question, searchCandidates, researchPlan.strategy)

      const gapAnalysis = await this.performGapAnalysis(question, intermediateFindings)
      if (gapAnalysis.gapsFound && gapAnalysis.followUpQueries.length > 0) {
        logger.info(`Information Gap! Triggering secondary research phase...`)
        const followUpResults = await this.executeAdaptiveHybridSearch({
          queries: gapAnalysis.followUpQueries,
          hardKeywords: gapAnalysis.followUpKeywords,
          filters: researchPlan.filters
        })
        const followUpFindings = await this.performDeepResearch(question, followUpResults, researchPlan.strategy)
        intermediateFindings.push(...followUpFindings)
      }

      logger.info(`Final synthesis from ${intermediateFindings.length} verified research nodes...`)
      const finalResponse = await this.narrateMightiestAnswer(question, intermediateFindings, researchPlan.strategy)

      console.log(`\n${chalk.bold.green('Mightiest AI Response:')}\n`)
      console.log(finalResponse)

      this.displaySourceProvenance(intermediateFindings)

      await this.performSelfVerification(question, finalResponse)

    } catch (_error) {
      const errorMessage = _error instanceof Error ? _error.message : String(_error)
      logger.error(`Mightiest RAG failed: ${errorMessage}`)
    }
  }

  private async developResearchPlan(originalQuestion: string): Promise<any> {
    const plannerPrompt = `
Analyze: "${originalQuestion}"
1. Strategy: "precise" (specific facts) or "exhaustive" (broad summary/entity history).
2. Variations: 3 semantic search phrases.
3. Hard Keywords: Identify any names, IDs, or unique technical terms for exact matching.
Return JSON: {"strategy": "...", "queries": [], "hardKeywords": [], "filters": {}}
`
    try {
      const response = await this.ollamaClient.generate(plannerPrompt)
      return JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] || '{}')
    } catch (_err) {
      return { strategy: 'precise', queries: [originalQuestion], hardKeywords: [], filters: {} }
    }
  }

  private async executeAdaptiveHybridSearch(plan: any): Promise<VectorSearchResult[]> {
    const searchPools: VectorSearchResult[][] = []

    for (const q of plan.queries || []) {
      const res = await this.vectorStore.search(q, 40)
      searchPools.push(res)
    }

    for (const k of plan.hardKeywords || []) {
      try {
        const matches = await this.ripgrep.captureSearchMatches({ pattern: k })
        searchPools.push(matches.map(m => ({
          meta: { path: join(config.exportDir, m.path), snippet: m.text, title: m.path.split('/').pop() || 'Untitled' },
          score: 1.0
        })) as any)
      } catch (_err) { /* oxlint-disable-next-line no-empty */ }
    }

    return this.mergeAndFusionRank(searchPools)
  }

  private mergeAndFusionRank(pools: VectorSearchResult[][]): VectorSearchResult[] {
    const scores = new Map<string, { res: VectorSearchResult; score: number }>()
    pools.forEach(pool => {
      pool.forEach((res, rank) => {
        const path = res.meta['path'] || 'unknown'
        const snippet = res.meta['snippet'] || ''
        const id = res.meta['id'] || `${path}:${snippet}`
        const s = 1 / (60 + rank)
        if (scores.has(id)) scores.get(id)!.score += s
        else scores.set(id, { res, score: s })
      })
    })
    return Array.from(scores.values()).sort((a, b) => b.score - a.score).map(v => v.res)
  }

  private async performDeepResearch(question: string, candidates: VectorSearchResult[], strategy: string): Promise<any[]> {
    const limit = strategy === 'exhaustive' ? 60 : 25
    const pool = candidates.slice(0, limit)
    if (pool.length === 0) return []

    const findings: any[] = []
    const batchSize = 10

    for (let i = 0; i < pool.length; i += batchSize) {
      const batch = pool.slice(i, i + batchSize)
      const researchPrompt = `
You are the Researcher. Analyze these snippets from the user's history for the question: "${question}"
Context:
${batch.map((r, j) => `[Node ${i + j}] ${r.meta['title']}: ${r.meta['snippet']}`).join('\n\n')}

Extract every specific fact, mention, date, or piece of code.
Return JSON array: [{"fact": "...", "node_id": N, "thread": "..."}]
`
      try {
        const response = await this.ollamaClient.generate(researchPrompt)
        const extracted = JSON.parse(response.match(/\[[\s\S]*\]/)?.[0] || '[]')
        extracted.forEach((f: any) => {
          findings.push({ ...f, original: pool[f.node_id - i] })
        })
      } catch (_err) {
        batch.forEach((r, j) => findings.push({ fact: r.meta['snippet'], node_id: i + j, thread: r.meta['title'], original: r }))
      }
    }

    return findings
  }

  private async performGapAnalysis(question: string, findings: any[]): Promise<any> {
    const prompt = `
Based on history findings: ${findings.slice(0, 10).map(f => f.fact).join('; ')}
What's missing for the question: "${question}"?
Return JSON: {"gapsFound": boolean, "followUpQueries": [], "followUpKeywords": []}
`
    try {
      const res = await this.ollamaClient.generate(prompt)
      return JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"gapsFound": false}')
    } catch (_err) { return { gapsFound: false } }
  }

  private async narrateMightiestAnswer(question: string, findings: any[], strategy: string): Promise<string> {
    const prompt = `
You are the Narrator. Synthesize these research findings into a cohesive, mightiest answer for: "${question}"
Strategy: ${strategy}
Findings:
${findings.map((f, i) => `[Find ${i}] (${f.thread}): ${f.fact}`).join('\n')}

INSTRUCTIONS:
1. Provide a comprehensive, authoritative response.
2. If "exhaustive", list ALL relevant conversations and what they contributed.
3. Be specific with names and technical details.
4. Cite everything with [Find N].

ANSWER:
`
    return this.ollamaClient.generate(prompt)
  }

  private async performSelfVerification(question: string, answer: string): Promise<void> {
    const prompt = `
Verify the answer.
Question: "${question}"
Answer: "${answer.slice(0, 500)}..."
Did I miss anything important?
Return JSON: {"status": "ok" | "missed-info", "suggestion": "..."}
`
    try {
      const res = await this.ollamaClient.generate(prompt)
      const feedback = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] || '{"status": "ok"}')
      if (feedback.status === 'missed-info') {
        logger.warn(`Verification Note: ${chalk.gray(feedback.suggestion)}`)
      }
    } catch (_err) { /* oxlint-disable-next-line no-empty */ }
  }

  private displaySourceProvenance(findings: any[]): void {
    const threadMap = new Map()
    findings.forEach(f => {
      const title = f.thread || f.original?.meta?.title || 'Untitled'
      const path = f.original?.meta?.path || 'unknown'
      threadMap.set(title, path)
    })
    if (threadMap.size > 0) {
      console.log(`\n${chalk.bold.cyan('History Sources Analyzed:')}`)
      for (const [title, path] of threadMap) {
        console.log(` - ${title} (${chalk.gray(path)})`)
      }
    }
  }
}
