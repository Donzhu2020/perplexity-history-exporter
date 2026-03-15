<p align="center">
  <img src="docs/header.svg" width="100%" alt="Perplexity History Export Header" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-4c1d95?style=flat&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5b21b6?style=flat&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Ollama-6d28d9?style=flat&logo=ollama&logoColor=white" alt="Ollama" />
  <img src="https://img.shields.io/badge/Playwright-7c3aed?style=flat&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/Vitest-8b5cf6?style=flat&logo=vitest&logoColor=white" alt="Vitest" />
</p>

---

<!-- toc -->

- [Introduction](#introduction)
- [Key Features](#key-features)
- [Prerequisites](#prerequisites)
- [Ollama Setup](#ollama-setup)
- [Installation](#installation)
- [Configuration](#configuration)
  * [Key Environment Variables](#key-environment-variables)
- [Usage Guide](#usage-guide)
  * [Operational Directives](#operational-directives)
- [RAG Capabilities](#rag-capabilities)
- [Testing](#testing)
- [Architecture & Deep Dive](#architecture--deep-dive)
  * [Project Structure](#project-structure)

<!-- tocstop -->

---

## Introduction

This tool is designed to externalize your Perplexity.ai conversation history into organized, semantically searchable Markdown files. It facilitates the emergence of a personal knowledge base powered by local AI, bridging the gap between ephemeral inquiry and structured knowledge.

## Key Features

- **Parallelized Extraction**: Leverages Playwright to extract multiple conversation threads simultaneously for high-velocity data retrieval.
- **Architectural Resilience**: Automatically restores browser contexts and retries operations, ensuring continuity amidst environmental instability.
- **Advanced RAG (Retrieval-Augmented Generation)**: Engage in a cognitive dialogue with your history. The system employs intent analysis to synthesize broad summaries or pinpoint specific technical insights.
- **Semantic Vector Search**: Move beyond keyword matching. Locate information based on conceptual depth and semantic relevance.
- **Persistent State Tracking**: Frequent checkpoints allow the system to resume progress after any interruption.
- **Interactive Synthesis (REPL)**: A streamlined command-line interface for human-system synergy.

## Prerequisites

- **Node.js 20+**: The core runtime for logic.
- **[Ollama](https://ollama.ai)**: Local engine for embedding generation and cognitive synthesis.
- **[ripgrep](https://github.com/BurntSushi/ripgrep)** (rg): For high-speed exact pattern matching.
- **Playwright**: Installed via npm, providing the interface to the web.

## Ollama Setup

Initialize the necessary models:

```bash
# For generating semantic embeddings
ollama pull nomic-embed-text

# For RAG-based generative synthesis
ollama pull deepseek-r1
```

## Installation

Instantiate the project dependencies:

```bash
npm install
```

## Configuration

Establish your environment by duplicating the template:

```bash
cp .env.example .env
```

### Key Environment Variables

- **OLLAMA_URL**: Access point for your local AI engine (default: http://localhost:11434).
- **OLLAMA_MODEL**: Cognitive model for RAG synthesis (e.g., deepseek-r1).
- **OLLAMA_EMBED_MODEL**: Model for generating vector representations (e.g., nomic-embed-text).
- **ENABLE_VECTOR_SEARCH**: Set to `true` to activate semantic and RAG layers.

## Usage Guide

Launch the system:

```bash
# Start the development environment
npm run d\
ev
```

### Operational Directives

- **Start scraper (Library)**: Initiates extraction. Authenticate manually if required.
- **Search conversations**: Interface with your history using various modes:
  - **Auto**: Heuristic selection between semantic and exact search.
  - **Semantic**: Fuzzy matching via high-dimensional vector space.
  - **RAG**: Direct inquiry—e.g., "What did I learn about emergent intelligence?"
  - **Exact**: Rapid string matching via ripgrep.
- **Build vector index**: Processes Markdown exports into a local vector store.
- **Reset all data**: Purges checkpoints, authentication data, and the vector index.

## RAG Capabilities

The RAG modality is engineered for various levels of cognitive inquiry:

- **Broad Synthesis**: "Summarize all threads regarding distributed systems."
- **Granular Retrieval**: "Locate the specific TypeScript pattern I used for the worker pool."
- **Cross-Thread Integration**: "How has my conceptual understanding of React hooks shifted?"

## Testing

We prioritize a "Testing Trophy" architecture, emphasizing integration tests.

```bash
# Execute unit-level verifications
npm run test:unit

# Execute integration-level verifications
npm run test:integration
```

## Architecture & Deep Dive

For a detailed look at our RAG implementation, hybrid search strategy, and theoretical foundations, please refer to:

👉 **[ARCH.md](./ARCH.md)**

### Project Structure

- **src/ai/**: Ollama interaction and advanced RAG orchestration layers.
- **src/scraper/**: Playwright-based extraction logic and parallel worker pool management.
- **src/search/**: Vector storage (Vectra) and ripgrep search implementation.
- **src/repl/**: Interactive CLI components.
- **src/utils/**: Shared utility functions for data chunking and logging.
