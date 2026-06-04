/**
 * Ingest Manager - Orquestra a ingestão de documentos no GBrain
 * 
 * Responsabilidades:
 * - Receber arquivos (upload ou path)
 * - Parsear com DocumentParser
 * - Transformar em páginas do GBrain
 * - Inserir no banco com metadados apropriados
 */

import { promises as fs } from 'fs';
import path from 'path';
import { DocumentParser, ParsedDocument, ParseOptions } from './document-parser.js';

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
      const sourceId = await this.createSource({
        brainId: options.brainId,
        name: options.sourceName || parsed.filename,
        type: 'document-upload',
        metadata: parsed.metadata,
        tags: options.tags,
        category: options.category,
      });
      result.sourceId = sourceId;

      if (options.dryRun) {
        result.success = true;
        result.warnings.push('Dry run - nenhum dado persistido');
        return result;
      }

      // 4. Criar páginas
      const pages = this.splitIntoPages(parsed, {
        maxTokensPerPage: 4000,
        overlapTokens: 200,
      });

      for (const page of pages) {
        await this.createPage({
          brainId: options.brainId,
          sourceId,
          title: page.title,
          content: page.content,
          metadata: page.metadata,
        });
        result.pagesCreated++;
      }

      result.success = true;

    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }

    return result;
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
   * Cria source no GBrain (placeholder - integrar com core)
   */
  private async createSource(params: {
    brainId: string;
    name: string;
    type: string;
    metadata: any;
    tags?: string[];
    category?: string;
  }): Promise<string> {
    // TODO: Integrar com src/core/operations.ts
    // Por enquanto retorna ID mock
    return `source-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Cria página no GBrain (placeholder - integrar com core)
   */
  private async createPage(params: {
    brainId: string;
    sourceId: string;
    title: string;
    content: string;
    metadata: any;
  }): Promise<void> {
    // TODO: Integrar com src/core/operations.ts
    // Esta é a interface que precisa ser implementada
    console.log(`[INGEST] Criando página: ${params.title} (${params.content.length} chars)`);
  }
}

export const ingestManager = new IngestManager();
