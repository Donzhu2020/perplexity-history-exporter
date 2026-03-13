import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { config } from '../utils/config.js'
import { logger } from '../utils/logger.js'
import chalk from 'chalk'

export interface RgSearchOptions {
  pattern: string
  caseSensitive?: boolean
  wholeWord?: boolean
  regex?: boolean
}

export class RgSearch {
  // ========== Custom Error Classes ==========
  static readonly RgSearchError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RgSearchError'
    }
  }

  static readonly RgNotFoundError = class extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'RgNotFoundError'
    }
  }

  async search(options: RgSearchOptions): Promise<void> {
    this.ensureExportDirExists()
    const args = this.buildRgArgs(options)
    await this.executeRg(args)
  }

  // ========== Private Methods ==========

  private ensureExportDirExists(): void {
    if (!existsSync(config.exportDir)) {
      throw new RgSearch.RgSearchError('No exports directory found. Run "start" command first.')
    }
  }

  private buildRgArgs(options: RgSearchOptions): string[] {
    const args: string[] = [
      '--color=always',
      '--heading',
      '--line-number',
      '--no-messages',
      '--column',
      '--smart-case',
    ]

    if (options.caseSensitive) {
      args.push('--case-sensitive')
    }

    if (options.wholeWord) {
      args.push('--word-regexp')
    }

    if (options.regex) {
      args.push('--regexp', options.pattern)
    } else {
      args.push('--fixed-strings', options.pattern)
    }

    args.push('--type', 'markdown')
    return args
  }

  private executeRg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const rg = spawn('rg', args, {
        cwd: config.exportDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let hasResults = false

      rg.stdout.on('data', (data) => {
        hasResults = true
        process.stdout.write(data)
      })

      rg.stderr.on('data', (data) => {
        const errorMsg = data.toString()
        if (!errorMsg.includes('No such file or directory')) {
          process.stderr.write(chalk.red(data))
        }
      })

      rg.on('error', (error) => {
        if (error.message.includes('ENOENT')) {
          reject(new RgSearch.RgNotFoundError(this.getInstallInstructions()))
        } else {
          reject(new RgSearch.RgSearchError(`Search failed: ${error.message}`))
        }
      })

      rg.on('close', (code) => {
        if (code === 0 || code === 1) {
          if (!hasResults && code === 1) {
            logger.info('No results found.')
          }
          resolve()
        } else {
          reject(new RgSearch.RgSearchError(`rg exited with code ${code}`))
        }
      })
    })
  }

  private getInstallInstructions(): string {
    return (
      'ripgrep (rg) not found. Please install it:\n' +
      '  macOS: brew install ripgrep\n' +
      '  Linux: apt install ripgrep / dnf install ripgrep\n' +
      '  Windows: choco install ripgrep / scoop install ripgrep'
    )
  }
}
