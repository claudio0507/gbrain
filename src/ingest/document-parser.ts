/**
 * Document Parser - Converte PDFs, planilhas e outros documentos para Markdown/JSON
 * 
 * Suporta:
 * - PDF: Extração de texto e tabelas
 * - Excel/CSV: Conversão para tabelas Markdown ou JSON
 * - Word/Docs: Extração de texto estruturado
 * - Imagens: OCR (opcional, requer Tesseract)
 */

import { promises as fs } from 'fs';
import path from 'path';

export interface ParsedDocument {
  filename: string;
  contentType: 'markdown' | 'json' | 'text';
  content: string;
  metadata: {
    title?: string;
    author?: string;
    created?: string;
    pages?: number;
    sheets?: number;
    tables?: number;
    [key: string]: any;
  };
  tables: TableData[];
  extractedAt: string;
}

export interface TableData {
  name: string;
  headers: string[];
  rows: (string | number)[][];
  rowCount: number;
  colCount: number;
}

export class DocumentParser {
  private supportedExtensions = new Map([
    ['.pdf', 'pdf'],
    ['.xlsx', 'spreadsheet'],
    ['.xls', 'spreadsheet'],
    ['.csv', 'csv'],
    ['.docx', 'word'],
    ['.doc', 'word'],
    ['.txt', 'text'],
    ['.md', 'markdown'],
    ['.json', 'json'],
  ]);

  /**
   * Detecta o tipo de documento pela extensão
   */
  detectType(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedExtensions.get(ext) || null;
  }

  /**
   * Parse principal - roteia para o parser específico
   */
  async parse(filePath: string, options: ParseOptions = {}): Promise<ParsedDocument> {
    const type = this.detectType(filePath);
    if (!type) {
      throw new Error(`Tipo de arquivo não suportado: ${path.extname(filePath)}`);
    }

    const filename = path.basename(filePath);
    const baseDoc: Partial<ParsedDocument> = {
      filename,
      extractedAt: new Date().toISOString(),
      metadata: {},
      tables: [],
    };

    switch (type) {
      case 'pdf':
        return this.parsePDF(filePath, baseDoc, options);
      case 'spreadsheet':
      case 'csv':
        return this.parseSpreadsheet(filePath, baseDoc, options);
      case 'word':
        return this.parseWord(filePath, baseDoc, options);
      case 'text':
      case 'markdown':
        return this.parseText(filePath, baseDoc, options);
      case 'json':
        return this.parseJSON(filePath, baseDoc, options);
      default:
        throw new Error(`Parser não implementado para: ${type}`);
    }
  }

  /**
   * PDF -> Markdown
   * Usa pdftotext (poppler-utils) ou fallback para pdf-parse
   */
  private async parsePDF(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    options: ParseOptions
  ): Promise<ParsedDocument> {
    // Tenta pdftotext primeiro (mais rápido, sem deps pesadas)
    try {
      const { execSync } = require('child_process');
      const text = execSync(`pdftotext "${filePath}" -`, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      
      // Conta páginas aproximadas
      const pageMatches = text.match(/\f/g);
      const pages = pageMatches ? pageMatches.length + 1 : 1;

      return {
        ...baseDoc,
        contentType: 'markdown',
        content: this.cleanPDFText(text),
        metadata: {
          ...baseDoc.metadata,
          pages,
          source: 'pdftotext',
        },
        tables: [],
        extractedAt: baseDoc.extractedAt!,
      } as ParsedDocument;
    } catch (e) {
      // Fallback: usa pdf-parse se disponível
      return this.parsePDFWithLibrary(filePath, baseDoc, options);
    }
  }

  /**
   * PDF com pdf-parse (npm)
   */
  private async parsePDFWithLibrary(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    _options: ParseOptions
  ): Promise<ParsedDocument> {
    try {
      const pdfParse = require('pdf-parse');
      const buffer = await fs.readFile(filePath);
      const data = await pdfParse(buffer);

      return {
        ...baseDoc,
        contentType: 'markdown',
        content: this.cleanPDFText(data.text),
        metadata: {
          ...baseDoc.metadata,
          pages: data.numpages,
          info: data.info,
          source: 'pdf-parse',
        },
        tables: [],
        extractedAt: baseDoc.extractedAt!,
      } as ParsedDocument;
    } catch (e) {
      throw new Error(`Falha ao parsear PDF. Instale: npm install pdf-parse OU apt install poppler-utils`);
    }
  }

  /**
   * Excel/CSV -> Markdown (tabelas) ou JSON
   */
  private async parseSpreadsheet(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    options: ParseOptions
  ): Promise<ParsedDocument> {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.csv') {
      return this.parseCSV(filePath, baseDoc, options);
    }

    // Excel
    try {
      const xlsx = require('xlsx');
      const workbook = xlsx.readFile(filePath);
      
      const tables: TableData[] = [];
      let fullMarkdown = '';

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        
        if (jsonData.length === 0) continue;

        const headers = jsonData[0].map(h => String(h || ''));
        const rows = jsonData.slice(1).filter(row => row.some(cell => cell !== undefined && cell !== ''));

        const table: TableData = {
          name: sheetName,
          headers,
          rows: rows.map(row => row.map(cell => cell ?? '')),
          rowCount: rows.length,
          colCount: headers.length,
        };
        tables.push(table);

        // Converte para Markdown
        fullMarkdown += `## Planilha: ${sheetName}\n\n`;
        fullMarkdown += this.tableToMarkdown(table);
        fullMarkdown += '\n\n';
      }

      return {
        ...baseDoc,
        contentType: options.outputFormat === 'json' ? 'json' : 'markdown',
        content: options.outputFormat === 'json' 
          ? JSON.stringify(tables, null, 2)
          : fullMarkdown.trim(),
        metadata: {
          ...baseDoc.metadata,
          sheets: workbook.SheetNames.length,
          tables: tables.length,
        },
        tables,
        extractedAt: baseDoc.extractedAt!,
      } as ParsedDocument;
    } catch (e) {
      throw new Error(`Falha ao parsear Excel. Instale: npm install xlsx`);
    }
  }

  /**
   * CSV -> Markdown ou JSON
   */
  private async parseCSV(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    options: ParseOptions
  ): Promise<ParsedDocument> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      
      if (lines.length === 0) {
        throw new Error('CSV vazio');
      }

      // Parser simples de CSV
      const parseLine = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim());
        return result;
      };

      const headers = parseLine(lines[0]);
      const rows = lines.slice(1).map(line => parseLine(line));

      const table: TableData = {
        name: path.basename(filePath, '.csv'),
        headers,
        rows,
        rowCount: rows.length,
        colCount: headers.length,
      };

      return {
        ...baseDoc,
        contentType: options.outputFormat === 'json' ? 'json' : 'markdown',
        content: options.outputFormat === 'json'
          ? JSON.stringify([table], null, 2)
          : this.tableToMarkdown(table),
        metadata: {
          ...baseDoc.metadata,
          rows: rows.length,
          columns: headers.length,
        },
        tables: [table],
        extractedAt: baseDoc.extractedAt!,
      } as ParsedDocument;
    } catch (e) {
      throw new Error(`Falha ao parsear CSV: ${e}`);
    }
  }

  /**
   * Word -> Markdown
   */
  private async parseWord(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    _options: ParseOptions
  ): Promise<ParsedDocument> {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.convertToMarkdown({ path: filePath });

      return {
        ...baseDoc,
        contentType: 'markdown',
        content: result.value,
        metadata: {
          ...baseDoc.metadata,
          messages: result.messages,
        },
        tables: [],
        extractedAt: baseDoc.extractedAt!,
      } as ParsedDocument;
    } catch (e) {
      throw new Error(`Falha ao parsear Word. Instale: npm install mammoth`);
    }
  }

  /**
   * Texto/Markdown -> pass-through com normalização
   */
  private async parseText(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    _options: ParseOptions
  ): Promise<ParsedDocument> {
    const content = await fs.readFile(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();

    return {
      ...baseDoc,
      contentType: ext === '.md' ? 'markdown' : 'text',
      content,
      metadata: {
        ...baseDoc.metadata,
        size: content.length,
        lines: content.split('\n').length,
      },
      tables: [],
      extractedAt: baseDoc.extractedAt!,
    } as ParsedDocument;
  }

  /**
   * JSON -> normalização
   */
  private async parseJSON(
    filePath: string,
    baseDoc: Partial<ParsedDocument>,
    _options: ParseOptions
  ): Promise<ParsedDocument> {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    return {
      ...baseDoc,
      contentType: 'json',
      content: JSON.stringify(parsed, null, 2),
      metadata: {
        ...baseDoc.metadata,
        type: Array.isArray(parsed) ? 'array' : typeof parsed,
        keys: typeof parsed === 'object' && !Array.isArray(parsed) 
          ? Object.keys(parsed) 
          : undefined,
      },
      tables: [],
      extractedAt: baseDoc.extractedAt!,
    } as ParsedDocument;
  }

  /**
   * Converte tabela para Markdown
   */
  private tableToMarkdown(table: TableData): string {
    if (table.headers.length === 0) return '';

    const escapeCell = (cell: string | number): string => {
      const str = String(cell || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      return str;
    };

    let md = '| ' + table.headers.map(escapeCell).join(' | ') + ' |\n';
    md += '|' + table.headers.map(() => ' --- |').join('') + '\n';
    
    for (const row of table.rows.slice(0, 1000)) { // Limita a 1000 linhas
      const cells = row.map((cell, i) => escapeCell(cell ?? ''));
      // Preenche células vazias se necessário
      while (cells.length < table.headers.length) {
        cells.push('');
      }
      md += '| ' + cells.join(' | ') + ' |\n';
    }

    if (table.rows.length > 1000) {
      md += `\n*... ${table.rows.length - 1000} linhas omitidas ...*\n`;
    }

    return md;
  }

  /**
   * Limpa texto de PDF (remove headers/footers repetidos)
   */
  private cleanPDFText(text: string): string {
    const lines = text.split('\n');
    const seen = new Set<string>();
    const cleaned: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Remove linhas muito curtas que parecem headers/footers de página
      if (trimmed.length < 5 && /^\d+$/.test(trimmed)) continue;
      // Remove linhas duplicadas consecutivas (cabeçalhos de página)
      if (seen.has(trimmed) && cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === trimmed) {
        continue;
      }
      seen.add(trimmed);
      cleaned.push(line);
    }

    return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
}

export interface ParseOptions {
  outputFormat?: 'markdown' | 'json';
  extractTables?: boolean;
  ocr?: boolean; // Para PDFs scanneados
  maxPages?: number;
}

// Export singleton
export const documentParser = new DocumentParser();
