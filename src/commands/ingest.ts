/**
 * Comando CLI: gbrain ingest
 * 
 * Ingestão manual de documentos no brain.
 * 
 * Uso:
 *   gbrain ingest <arquivo.pdf>                    # Ingestão única
 *   gbrain ingest <diretorio/> --recursive         # Ingestão em lote
 *   gbrain ingest <arquivo.xlsx> --format json     # Saída como JSON
 *   gbrain ingest <arquivo.pdf> --dry-run          # Preview sem persistir
 * 
 * Opções:
 *   --brain <id>          # Brain de destino (default: default)
 *   --source-name <nome>  # Nome da source
 *   --tags <tag1,tag2>    # Tags para categorização
 *   --category <cat>      # Categoria (documento, planilha, etc)
 *   --format <markdown|json>  # Formato de saída
 *   --recursive           # Processar subdiretórios
 *   --dry-run             # Simulação (não persiste)
 *   --output <dir>        # Diretório para exportar arquivos convertidos
 */

import { Command } from 'commander';
import { promises as fs } from 'fs';
import path from 'path';
import { createIngestManager, documentParser } from '../ingest/index.js';
import { createEngine } from '../core/engine-factory.js';
import { getConfig } from '../core/config.js';

export function registerIngestCommand(program: Command): void {
  program
    .command('ingest <path>')
    .description('Ingestão de documentos (PDF, Excel, Word, CSV) no brain')
    .option('-b, --brain <id>', 'Brain de destino', 'default')
    .option('-n, --source-name <name>', 'Nome da source')
    .option('-t, --tags <tags>', 'Tags separadas por vírgula')
    .option('-c, --category <cat>', 'Categoria do documento')
    .option('-f, --format <format>', 'Formato de saída (markdown, json)', 'markdown')
    .option('-r, --recursive', 'Processar subdiretórios recursivamente')
    .option('-d, --dry-run', 'Simulação - não persiste no banco')
    .option('-o, --output <dir>', 'Exportar arquivos convertidos para diretório')
    .action(async (filePath: string, options) => {
      try {
        const config = await getConfig();
        const engine = await createEngine(config);
        const ingestManager = createIngestManager(engine);
        
        // Verifica se é arquivo ou diretório
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
          await ingestDirectory(filePath, options, ingestManager);
        } else {
          await ingestSingleFile(filePath, options, ingestManager);
        }
        
        await engine.disconnect();
      } catch (error) {
        console.error('❌ Erro:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Subcomando: ingest parse (apenas conversão, sem persistir)
  program
    .command('ingest:parse <path>')
    .description('Converte documento para Markdown/JSON sem ingestão')
    .option('-f, --format <format>', 'Formato (markdown, json)', 'markdown')
    .option('-o, --output <file>', 'Arquivo de saída (default: stdout)')
    .action(async (filePath: string, options) => {
      try {
        const parsed = await documentParser.parse(filePath, {
          outputFormat: options.format,
        });

        const output = options.format === 'json' 
          ? JSON.stringify(parsed, null, 2)
          : parsed.content;

        if (options.output) {
          await fs.writeFile(options.output, output, 'utf-8');
          console.log(`✁️  Convertido: ${filePath} -> ${options.output}`);
        } else {
          console.log(output);
        }
      } catch (error) {
        console.error('❌ Erro:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

async function ingestSingleFile(
  filePath: string, 
  options: any,
  ingestManager: import('../ingest/index.js').IngestManager
): Promise<void> {
  console.log(`📄 Ingestão: ${path.basename(filePath)}`);
  
  if (options.dryRun) {
    console.log('   [DRY RUN - simulação]');
  }

  const result = await ingestManager.ingestFile(filePath, {
    brainId: options.brain,
    sourceName: options.sourceName,
    tags: options.tags?.split(',').map((t: string) => t.trim()),
    category: options.category,
    parseOptions: {
      outputFormat: options.format,
    },
    dryRun: options.dryRun,
  });

  if (result.success) {
    console.log(`✅ Concluído: ${result.pagesCreated} página(s) criada(s)`);
    console.log(`   Source ID: ${result.sourceId}`);
    console.log(`   Tokens estimados: ${result.metadata.tokensEstimate}`);
    
    if (result.warnings.length > 0) {
      console.log('   Avisos:', result.warnings.join(', '));
    }

    // Exporta arquivo convertido se solicitado
    if (options.output) {
      await exportConvertedFile(filePath, options);
    }
  } else {
    console.error('❌ Falha:');
    result.errors.forEach(e => console.error(`   - ${e}`));
  }
}

async function ingestDirectory(
  dirPath: string, 
  options: any,
  ingestManager: import('../ingest/index.js').IngestManager
): Promise<void> {
  console.log(`📁 Diretório: ${dirPath}`);
  console.log(`   Recursivo: ${options.recursive ? 'sim' : 'não'}`);
  console.log('');

  const results = await ingestManager.ingestDirectory(dirPath, {
    brainId: options.brain,
    sourceName: options.sourceName,
    tags: options.tags?.split(',').map((t: string) => t.trim()),
    category: options.category,
    parseOptions: {
      outputFormat: options.format,
    },
    dryRun: options.dryRun,
    recursive: options.recursive,
  });

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log('');
  console.log(`📊 Resumo:`);
  console.log(`   Total: ${results.length} arquivo(s)`);
  console.log(`   ✅ Sucesso: ${successful.length}`);
  console.log(`   ❌ Falhas: ${failed.length}`);
  
  if (successful.length > 0) {
    const totalPages = successful.reduce((sum, r) => sum + r.pagesCreated, 0);
    const totalTokens = successful.reduce((sum, r) => sum + r.metadata.tokensEstimate, 0);
    console.log(`   Páginas criadas: ${totalPages}`);
    console.log(`   Tokens estimados: ${totalTokens.toLocaleString()}`);
  }

  if (failed.length > 0) {
    console.log('');
    console.log('❌ Falhas detalhadas:');
    failed.forEach(r => {
      console.log(`   - ${r.metadata.filename}: ${r.errors.join(', ')}`);
    });
  }
}

async function exportConvertedFile(filePath: string, options: any): Promise<void> {
  const parsed = await documentParser.parse(filePath, {
    outputFormat: options.format,
  });

  const baseName = path.basename(filePath, path.extname(filePath));
  const ext = options.format === 'json' ? '.json' : '.md';
  const outputPath = path.join(options.output, `${baseName}${ext}`);

  // Garante que diretório existe
  await fs.mkdir(options.output, { recursive: true });

  const content = options.format === 'json'
    ? JSON.stringify(parsed, null, 2)
    : `---\ntitle: ${parsed.metadata.title || parsed.filename}\nsource: ${parsed.filename}\nextracted_at: ${parsed.extractedAt}\n---\n\n${parsed.content}`;

  await fs.writeFile(outputPath, content, 'utf-8');
  console.log(`✁️  Exportado: ${outputPath}`);
}
