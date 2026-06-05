# GBrain Web UI

Interface web para upload e ingestão de documentos no GBrain.

## Funcionalidades

- ✅ **Drag & drop** de arquivos
- ✅ **Múltiplos formatos**: PDF, Excel, CSV, Word, Markdown, JSON, TXT
- ✅ **Categorização**: Documento, Relatório, Planilha, Contrato, Nota
- ✅ **Tags**: Organize com tags personalizadas
- ✅ **Preview**: Veja resultados em tempo real
- ✅ **Progresso**: Barra de progresso durante upload

## Como usar

### 1. Iniciar o servidor

```bash
cd web-ui
bun start
```

O servidor inicia em `http://localhost:3333`

### 2. Acessar a interface

Abra o navegador em `http://localhost:3333`

### 3. Fazer upload

1. Arraste arquivos para a área de upload ou clique para selecionar
2. Escolha a categoria e adicione tags (opcional)
3. Clique em "Ingerir documentos"
4. Veja o resultado com source ID e número de páginas criadas

## API Endpoints

### POST /api/ingest

Upload e ingestão de documento.

**Request:** `multipart/form-data`
- `file` (required): Arquivo a ser ingerido
- `brain` (optional): ID do brain (default: "default")
- `category` (optional): Categoria do documento
- `tags` (optional): Tags separadas por vírgula
- `sourceName` (optional): Nome customizado da source

**Response:**
```json
{
  "success": true,
  "sourceId": "ingest-1234567890-abc123",
  "pagesCreated": 3,
  "tokensEstimate": 4520,
  "filename": "documento.pdf"
}
```

### GET /api/brains

Lista brains disponíveis.

**Response:**
```json
{
  "brains": [
    { "id": "default", "name": "Default", "description": "Brain principal" }
  ]
}
```

### GET /api/status

Status do servidor.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "supportedFormats": [".pdf", ".xlsx", ".csv", ".docx", ".md", ".json", ".txt"],
  "uploadDir": "/tmp/gbrain-uploads"
}
```

## Variáveis de ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | `3333` | Porta do servidor |
| `UPLOAD_DIR` | `/tmp/gbrain-uploads` | Diretório temporário para uploads |

## Desenvolvimento

```bash
# Modo watch (recarrega em mudanças)
bun dev

# Ou manualmente
bun --watch server.ts
```

## Estrutura

```
web-ui/
├── index.html      # Interface web (single-page app)
├── server.ts       # Servidor Bun
├── package.json    # Dependências
└── README.md       # Esta documentação
```

## Próximos passos

- [ ] Autenticação (JWT/API keys)
- [ ] Listagem de sources/páginas ingeridas
- [ ] Preview de conteúdo antes de ingerir
- [ ] Upload em lote com fila
- [ ] WebSocket para progresso em tempo real
