# Gemini Migration and RAG Closure Plan

## Goal

Replace the current Ollama-first AI path with hosted-provider support, and turn the RAG flow into a complete and reliable loop.

## Workstreams

### 1. Provider Abstraction

- Introduce a shared AI provider interface for embeddings, generation, and validation.
- Keep Ollama support as an optional provider.
- Add a provider factory so search and RAG stop instantiating Ollama directly.

### 2. Gemini Integration

- Add a Gemini provider for embeddings and text generation.
- Make Gemini the default provider through environment configuration.
- Support API key based validation with clear error messages.

### 2b. Hugging Face Integration

- Add a Hugging Face provider for embeddings and text generation.
- Support token based validation and hosted inference endpoints.
- Allow Hugging Face to act as the default low-friction hosted workflow.

### 3. Vector Index Closure

- Route vector indexing through the provider abstraction.
- Fail vector index builds if any embedding batch fails.
- Persist index metadata so searches can detect provider/model mismatches.
- Refuse RAG/vector search if the index is missing or incompatible.

### 4. RAG Closure

- Ensure the RAG path validates provider readiness and index readiness before running.
- Improve no-result and malformed-model-output fallbacks.
- Fix the answer verification status mismatch.
- Make the existing research-plan contract consistent with runtime behavior.

### 5. CLI and Docs

- Update config and environment examples for Gemini-first usage.
- Update README and help text so the actual setup path matches the code.
- Document how to rebuild the vector index after switching embedding providers.

### 6. Verification

- Run type-checking after each structural change.
- Add or update mocked tests for provider behavior.
- Add coverage for index readiness and RAG gating.

## Implementation Order

1. Save the plan and refactor the provider abstraction.
2. Add Gemini provider and environment wiring.
3. Rewire vector store and RAG to the provider factory.
4. Add index metadata and readiness checks.
5. Tighten RAG failure handling and validation.
6. Update tests and docs.
