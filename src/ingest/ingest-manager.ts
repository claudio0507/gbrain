/**
 * Ingest Manager - Orquestra a ingestão de documentos no GBrain
 * 
 * Responsabilidades:
 * - Receber arquivos (upload ou path)
 * - Parsear com DocumentParser
 * - Transformar em páginas do GBrain
 * - Inserir no banco via BrainEngine
 */

import { promises as fs } from 'fs';
import path from 'path';
import { DocumentParser, ParsedDocument, ParseOptions } from './document-parser.js';
import type { BrainEngine } from '../core/engine.js';
import { addSource } from '../core/sources-ops.js';

export interface IngestResult {
  success: boolean;
  sourceId: string;
  pagesCreated: number;
  errors: string[];
  warnings: string[];
  metadata: {
    filename: string;
    originalPath: string;
    contentType: string;
    tokensEstimate: number;
  };
}

export interface IngestBatchOptions {
  brainId: string;
  sourceName?: string;
  tags?: string[];
  category?: string;
  parseOptions?: ParseOptions;
  dryRun?: boolean;
}

export class IngestManager {
  private parser = new DocumentParser();
  private engine: BrainEngine;

  constructor(engine: BrainEngine) {
    this.engine = engine;
  }

  /**
   * Ingestão única de arquivo
   */
  async ingestFile(
    filePath: string,
    options: IngestBatchOptions
  ): Promise<IngestResult> {
    const result: IngestResult = {
      success: false,
      sourceId: '',
      pagesCreated: 0,
      errors: [],
      warnings: [],
      metadata: {
        filename: path.basename(filePath),
        originalPath: filePath,
        contentType: '',
        tokensEstimate: 0,
      },
    };

    try {
      // 1. Parsear documento
      const parsed = await this.parser.parse(filePath, options.parseOptions);
      result.metadata.contentType = parsed.contentType;

      // 2. Estimar tokens (regra simples: ~4 chars/token)
      result.metadata.tokensEstimate = Math.ceil(parsed.content.length / 4);

      // 3. Criar source no GBrain
      const sourceRow = await this.createSource({
        id: `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: options.sourceName || parsed.filename,
        type: 'document-upload',
        metadata: parsed.metadata,
        tags: options.tags,
        category: options.category,
      });
      result.sourceId = sourceRow.id;

      if (options.dryRun) {
        result.success = true;
        result.warnings.push('Dry run - nenhum dado persistido');
        return result;
      }

      // 4. Criar páginas via BrainEngine.putPage
      const pages = this.splitIntoPages(parsed, {
        maxTokensPerPage: 4000,
        overlapTokens: 200,
      });

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const slug = this.makeSlug(parsed.filename, i, pages.length);
        
        await this.engine.putPage(slug, {
          title: page.title,
          content: page.content,
          frontmatter: {
            type: options.category || 'document',
            tags: options.tags || [],
            ...page.metadata,
          },
        }, {
          sourceId: sourceRow.id,
        });
        
        result.pagesCreated++;
      }

      result.success = true;

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
  }
  
  private makeSlug(filename: string, index: number, total: number): string {
    const base = filename
      .replace(/\.[^/.]+$/, '') // remove extensão
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    
    if (total === 1) {
      return `docs/${base}`;
    }
    return `docs/${base}-parte-${index + 1}`;
  }

  /**
   * Ingestão em lote (diretório)
   */
  async ingestDirectory(
    dirPath: string,
    options: IngestBatchOptions & { recursive?: boolean }
  ): Promise<IngestResult[]> {
    const results: IngestResult[] = [];
    
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory() && options.recursive) {
        const subResults = await this.ingestDirectory(fullPath, options);
        results.push(...subResults);
      } else if (entry.isFile()) {
        // Verifica se é documento suportado
        if (this.parser.detectType(fullPath)) {
          const result = await this.ingestFile(fullPath, options);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Divide documento grande em páginas
   */
  private splitIntoPages(
    parsed: ParsedDocument,
    options: { maxTokensPerPage: number; overlapTokens: number }
  ): Array<{ title: string; content: string; metadata: any }> {
    const pages: Array<{ title: string; content: string; metadata: any }> = [];
    
    // Estima tokens (4 chars/token)
    const totalTokens = Math.ceil(parsed.content.length / 4);
    
    if (totalTokens <= options.maxTokensPerPage) {
      // Documento cabe em uma página
      pages.push({
        title: parsed.metadata.title || parsed.filename,
        content: parsed.content,
        metadata: {
          ...parsed.metadata,
          pageNumber: 1,
          totalPages: 1,
        },
      });
    } else {
      // Divide em chunks
      const charsPerPage = options.maxTokensPerPage * 4;
      const overlapChars = options.overlapTokens * 4;
      
      let start = 0;
      let pageNum = 1;
      
      while (start < parsed.content.length) {
        const end = Math.min(start + charsPerPage, parsed.content.length);
        const chunk = parsed.content.slice(start, end);
        
        // Tenta quebrar em parágrafo
        const lastNewline = chunk.lastIndexOf('\n\n');
        const cleanEnd = lastNewline > charsPerPage * 0.5 ? start + lastNewline : end;
        
        pages.push({
          title: `${parsed.filename} (parte ${pageNum})`,
          content: parsed.content.slice(start, cleanEnd),
          metadata: {
            ...parsed.metadata,
            pageNumber: pageNum,
            totalPages: Math.ceil(totalTokens / options.maxTokensPerPage),
            charRange: [start, cleanEnd],
          },
        });
        
        start = cleanEnd - overlapChars;
        pageNum++;
      }
    }

    // Adiciona tabelas como páginas separadas se houver
    for (const table of parsed.tables) {
      pages.push({
        title: `Tabela: ${table.name}`,
        content: this.tableToMarkdown(table),
        metadata: {
          type: 'table',
          tableName: table.name,
          rows: table.rowCount,
          cols: table.colCount,
        },
      });
    }

    return pages;
  }

  private tableToMarkdown(table: { name: string; headers: string[]; rows: any[][] }): string {
    let md = `## ${table.name}\n\n`;
    md += '| ' + table.headers.join(' | ') + ' |\n';
    md += '|' + table.headers.map(() => ' --- |').join('') + '\n';
    
    for (const row of table.rows.slice(0, 100)) {
      md += '| ' + row.map(cell => String(cell ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |\n';
    }
    
    if (table.rows.length > 100) {
      md += `\n*... ${table.rows.length - 100} linhas restantes ...*\n`;
    }
    
    return md;
  }

  /**
   * Cria source no GBrain usando sources-ops.ts
   */
  private async createSource(params: {
    id: string;
    name: string;
    type: string;
    metadata: any;
    tags?: string[];
    category?: string;
  }): Promise<{ id: string; name: string }> {
    // Cria diretório temporário para a source
    const tempDir = `/tmp/gbrain-ingest-${params.id}`;
    await fs.mkdir(tempDir, { recursive: true });
    
    // Usa addSource do core
    const sourceRow = await addSource(this.engine, {
      id: params.id,
      name: params.name,
      localPath: tempDir,
      config: {
        type: params.type,
        metadata: params.metadata,
        tags: params.tags,
        category: params.category,
        ingested_via: 'document-upload',
      },
    });
    
    return { id: sourceRow.id, name: sourceRow.name };
  }
}

/**
 * Factory function para criar IngestManager com engine
 */
export function createIngestManager(engine: BrainEngine): IngestManager {
  return new IngestManager(engine);
}
