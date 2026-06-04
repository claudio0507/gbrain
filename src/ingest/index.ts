/**
 * Ingest API - Interface para ingestão de documentos no GBrain
 * 
 * Expõe comandos CLI e API para:
 * - Upload de documentos (PDF, Excel, Word, etc)
 * - Conversão para Markdown/JSON
 * - Ingestão no banco de dados do brain
 */

export { DocumentParser, documentParser, type ParsedDocument, type TableData, type ParseOptions } from './document-parser.js';
export { IngestManager, type IngestResult, type IngestBatchOptions } from './ingest-manager.js';
