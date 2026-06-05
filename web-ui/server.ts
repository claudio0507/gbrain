/**
 * Servidor web para ingestão de documentos no GBrain
 * 
 * Endpoints:
 * - POST /api/ingest - Upload e ingestão de documento
 * - GET /api/brains - Lista brains disponíveis
 * - GET /api/status - Status do servidor
 * - GET / - Interface web
 */

import { serve } from 'bun';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { createIngestManager } from '../src/ingest/index.js';
import { createEngine } from '../src/core/engine-factory.js';
import { getConfig } from '../src/core/config.js';

const PORT = process.env.PORT || 3333;
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/gbrain-uploads';

// MIME types suportados
const SUPPORTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/markdown',
  'text/plain',
  'application/json',
];

// Extensões suportadas
const SUPPORTED_EXTENSIONS = ['.pdf', '.xlsx', '.xls', '.csv', '.docx', '.doc', '.md', '.txt', '.json'];

interface IngestRequest {
  file: File;
  brain: string;
  category: string;
  tags: string;
  sourceName: string;
}

async function handleIngest(req: Request): Promise<Response> {
  try {
    const formData = await req.formData();
    
    const file = formData.get('file') as File;
    const brain = (formData.get('brain') as string) || 'default';
    const category = (formData.get('category') as string) || 'document';
    const tags = (formData.get('tags') as string) || '';
    const sourceName = (formData.get('sourceName') as string) || '';

    if (!file) {
      return jsonResponse({ error: 'Nenhum arquivo enviado' }, 400);
    }

    // Valida tipo/extensão
    const ext = path.extname(file.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return jsonResponse({ 
        error: `Tipo de arquivo não suportado: ${ext}`,
        supported: SUPPORTED_EXTENSIONS 
      }, 400);
    }

    // Cria diretório de upload
    await mkdir(UPLOAD_DIR, { recursive: true });
    
    // Salva arquivo temporariamente
    const tempPath = path.join(UPLOAD_DIR, `${Date.now()}-${file.name}`);
    const buffer = await file.arrayBuffer();
    await writeFile(tempPath, Buffer.from(buffer));

    try {
      // Inicializa engine e ingest manager
      const config = await getConfig();
      const engine = await createEngine(config);
      const ingestManager = createIngestManager(engine);

      // Processa ingestão
      const result = await ingestManager.ingestFile(tempPath, {
        brainId: brain,
        sourceName: sourceName || file.name,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        category,
        parseOptions: {
          outputFormat: 'markdown',
        },
        dryRun: false,
      });

      await engine.disconnect();

      if (result.success) {
        return jsonResponse({
          success: true,
          sourceId: result.sourceId,
          pagesCreated: result.pagesCreated,
          tokensEstimate: result.metadata.tokensEstimate,
          filename: file.name,
        });
      } else {
        return jsonResponse({
          error: 'Falha na ingestão',
          details: result.errors,
        }, 500);
      }
    } finally {
      // Limpa arquivo temporário
      try {
        await rm(tempPath);
      } catch {}
    }
  } catch (error) {
    console.error('Erro no ingest:', error);
    return jsonResponse({
      error: 'Erro interno do servidor',
      message: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

async function handleListBrains(): Promise<Response> {
  try {
    // Por enquanto retorna apenas o brain default
    // TODO: Listar brains do config ou banco
    return jsonResponse({
      brains: [
        { id: 'default', name: 'Default', description: 'Brain principal' },
      ],
    });
  } catch (error) {
    return jsonResponse({ error: 'Erro ao listar brains' }, 500);
  }
}

async function handleStatus(): Promise<Response> {
  return jsonResponse({
    status: 'ok',
    version: '1.0.0',
    supportedFormats: SUPPORTED_EXTENSIONS,
    uploadDir: UPLOAD_DIR,
  });
}

async function serveStaticFile(url: URL): Promise<Response> {
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(import.meta.dir, pathname);
  
  // Segurança: não serve arquivos fora do diretório web-ui
  if (!filePath.startsWith(import.meta.dir)) {
    return new Response('Forbidden', { status: 403 });
  }

  if (!existsSync(filePath)) {
    return new Response('Not Found', { status: 404 });
  }

  const content = await readFile(filePath);
  const ext = path.extname(filePath);
  
  const contentTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };

  return new Response(content, {
    headers: {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// CORS preflight
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// Main server
console.log(`🧠 GBrain Web UI starting on port ${PORT}...`);

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return handleOptions();
    }

    // API routes
    if (url.pathname === '/api/ingest' && req.method === 'POST') {
      return handleIngest(req);
    }

    if (url.pathname === '/api/brains' && req.method === 'GET') {
      return handleListBrains();
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      return handleStatus();
    }

    // Static files
    return serveStaticFile(url);
  },
});

console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
console.log(`📁 Uploads temporários: ${UPLOAD_DIR}`);
