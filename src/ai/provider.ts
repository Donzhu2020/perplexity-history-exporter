export type EmbeddingTaskType = 'document' | 'query'

export interface AIProvider {
  readonly providerName: string
  readonly embeddingModel: string
  readonly generationModel: string

  embed(texts: string[], taskType?: EmbeddingTaskType): Promise<number[][]>
  generate(prompt: string, modelOverride?: string): Promise<string>
  validate(): Promise<void>
}
