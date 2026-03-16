# Perplexity History Exporter

Export your Perplexity conversation history to local Markdown files, then search it with exact match, semantic search, or RAG.

This repository is based on the original project [simwai/perplexity-ai-export](https://github.com/simwai/perplexity-ai-export), with additional reliability, login-flow, and usability changes.

## Credits

- Original project: [simwai/perplexity-ai-export](https://github.com/simwai/perplexity-ai-export)
- This repository keeps the original core idea and extends it with workflow and reliability improvements for local export usage.

## Changes from Upstream

Compared with the original upstream project, this version adds and changes:

- a more reliable manual login flow that does not depend on a terminal confirmation prompt,
- stricter login detection to reduce false positives,
- a longer manual-login window before automated checks begin,
- safer checkpoint behavior when discovery returns zero conversations,
- background extraction fallback logic so long exports do not always keep a visible browser in front,
- a more practical README that explains the purpose, design choices, and local-data safety model.

## What It Does

- Logs into Perplexity through a real browser session.
- Discovers conversations from your Perplexity library.
- Exports each conversation as a Markdown file under `exports/`.
- Saves progress so interrupted runs can resume.
- Supports exact search with ripgrep.
- Supports semantic search and RAG with Gemini or Ollama.

## Why This Exists

Perplexity is great for exploration, but conversation history is not ideal as a long-term personal knowledge base. This project turns those conversations into local files you control so you can:

- keep a durable archive of your research,
- search across old threads quickly,
- build a private knowledge base on your own machine,
- use local models to ask questions across your history.

## Why The Current Design Looks Like This

This code uses Playwright, checkpoints, and a configurable AI provider on purpose:

- Playwright is used because Perplexity history is tied to an authenticated browser session.
- Checkpoints are used because large exports can take time and should be resumable.
- Markdown exports are used because they are portable, easy to inspect, and work well with search tools.
- Gemini is the default AI path so semantic search and RAG can work without local model installs.
- Ollama remains available as an optional local provider.

Recent reliability fixes were added for real-world usage:

- Manual login now waits in the browser instead of relying on a fragile terminal confirmation.
- Login detection is stricter, which avoids false positives and early browser shutdown.
- Discovery no longer gets stuck in an empty-complete checkpoint state.
- After interactive login, extraction can switch to background mode so the browser does not block your desktop the whole time.
- If background mode cannot reuse auth safely, the exporter falls back to visible mode instead of failing hard.

## How It Works

1. Start the CLI.
2. Choose `Start scraper (Library)`.
3. Log into Perplexity in the opened browser if needed.
4. The tool discovers your conversations.
5. It exports pending conversations to `exports/`.
6. You can later search or vectorize the exported files.

## Project Structure

- `src/scraper/`: browser automation, discovery, extraction, checkpoints
- `src/export/`: Markdown writing and filename sanitizing
- `src/search/`: exact and semantic search orchestration
- `src/ai/`: provider abstraction, Gemini/Ollama clients, and RAG logic
- `src/repl/`: CLI menu and command flow
- `src/utils/`: config, logging, waiting strategies

## Requirements

- Node.js 20 or newer recommended
- npm
- Playwright Chromium
- Gemini API key for the default semantic search and RAG workflow
- Ollama only if you explicitly choose the Ollama provider

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Quick-start helpers in the repo:

- `./setup-and-run.sh`: install dependencies, install Playwright Chromium, then launch the CLI
- `python3 run_scraper.py`: launch the CLI and auto-select `Start scraper (Library)` without auto-confirming login

## Important Config

Common environment variables:

- `AUTH_STORAGE_PATH`: where login state is stored
- `EXPORT_DIR`: where Markdown exports are written
- `CHECKPOINT_PATH`: where progress state is stored
- `HEADLESS`: `true`, `false`, or `new`
- `ENABLE_VECTOR_SEARCH`: set to `true` to enable semantic search
- `AI_PROVIDER`: `gemini` or `ollama`
- `GEMINI_API_KEY`: required when `AI_PROVIDER=gemini`
- `GEMINI_MODEL`: generation model for RAG answers
- `GEMINI_EMBED_MODEL`: embedding model for vector search
- `OLLAMA_URL`: Ollama server URL
- `OLLAMA_MODEL`: generation model for RAG
- `OLLAMA_EMBED_MODEL`: embedding model for vector search

Example Gemini-first setup:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=your_api_key_here
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_MODEL=gemini-2.0-flash
GEMINI_EMBED_MODEL=gemini-embedding-001
ENABLE_VECTOR_SEARCH=true
```

## Usage

Run the CLI:

```bash
npm run dev
```

Or use the included helpers:

```bash
./setup-and-run.sh
python3 run_scraper.py
```

Menu options:

- `Start scraper (Library)`: discover and export conversations
- `Search conversations`: search exported history
- `Build vector index`: build embeddings for semantic search
- `Reset all data`: clear auth cache, checkpoint state, and vector index
- `Help`: show command help

Important:

- build the vector index before using semantic search or RAG,
- rebuild the vector index whenever you change embedding provider or embedding model.

## Background Extraction

To keep login reliable, the tool opens a visible browser for manual authentication when needed.

After login and discovery:

- extraction will try to continue in background mode if headless mode is enabled,
- if Perplexity rejects the background session, the tool falls back to visible mode automatically.

This is meant to balance reliability with convenience.

## Search Modes

- `Exact`: fast text search over exported Markdown
- `Semantic`: embedding-based search with the configured provider + Vectra
- `RAG`: ask questions across your history using local models
- `RAG`: ask questions across your history using the configured provider
- `Auto`: choose between exact and semantic behavior heuristically

## Data Safety

This repo is set up so local private data stays local:

- `.env` is ignored
- `.storage/` is ignored
- `exports/` is ignored

That means auth state and exported conversations are not intended to be committed.

## Development

Type-check:

```bash
npm run type-check
```

Run tests:

```bash
npm test
```

For architecture notes, see [ARCH.md](./ARCH.md).
