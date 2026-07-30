# n8n Context Optimizer v0.2 — plano de implementação

Data: 2026-07-30
Spec: `docs/specs/2026-07-30-n8n-context-optimizer-v0-2-design.md`

## Objetivo

Evoluir pacote local `n8n-nodes-context-optimizer` para cinco nós:

1. `Context Optimizer`;
2. `Optimized Chat Model`;
3. `Context Store`;
4. `Context Retriever Tool`;
5. `Token Analytics`.

Resultado precisa preservar tool calling, fatos protegidos e fallback para original.

## Restrições

- Não alterar workflows corporativos.
- Não publicar pacote no npm.
- Não integrar Headroom ou OmniRoute.
- Não acessar banco interno do n8n para analytics.
- Não persistir conteúdo sem opção explícita.
- Não aplicar compressão com economia líquida negativa.
- Não alterar ordem de mensagens de tools.

## Marco 1 — corrigir wrapper

### 1.1 Reproduzir sequência Gemini

Adicionar fixtures com:

- system → user → assistant tool call → tool result;
- múltiplas tool calls;
- tool call sem resultado;
- histórico com duas rodadas de tools;
- `additional_kwargs.tool_calls`;
- `tool_call_id`;
- mensagens LangChain com `_getType()`.

### 1.2 Validar estrutura

Criar `src/model-wrapper/message-sequence.ts`:

- classificar papéis;
- detectar tool calls e tool results;
- identificar grupos indivisíveis;
- validar sequência antes e depois;
- indicar motivo de bypass.

### 1.3 Política segura

- Qualquer input com tool call/result será encaminhado integralmente na v0.2.0.
- Compressão de tool outputs ocorrerá antes do agente via `Context Optimizer`, Store e Retriever.
- Entrada sem tools continua elegível para deduplicação.
- Resultado estruturalmente inválido faz fallback para input original.

### 1.4 Aceite

- testes do wrapper passam;
- erro Gemini não é causado pelo proxy;
- `invoke`, `batch`, `stream`, `generate` e `bindTools` continuam disponíveis;
- telemetria informa `bypassReason`.

## Marco 2 — motor por tipo de conteúdo

### 2.1 Tipos

Estender `src/core/types.ts` com:

- operações;
- tipos de conteúdo;
- manifestos;
- Quality Guard;
- storage;
- cache;
- métricas líquidas.

### 2.2 Detecção

Criar `src/content/content-detector.ts`.

Detectar:

- JSON válido;
- HTML;
- logs;
- code;
- RAG/tool output por dica explícita;
- texto como fallback.

### 2.3 Compressores

Criar:

- `text-compressor.ts`;
- `json-compressor.ts`;
- `log-compressor.ts`;
- `html-compressor.ts`;
- `rag-compressor.ts`.

Cada compressor retorna:

- conteúdo;
- estratégias;
- tokens;
- manifesto;
- fatos protegidos;
- avisos.

### 2.4 Quality Guard

Criar `src/quality/quality-guard.ts`:

- comparar fatos protegidos;
- validar blocos por hash;
- validar JSON quando aplicável;
- validar contagem de registros;
- emitir score, checks e fallback.

### 2.5 Aceite

- `100%` dos fatos protegidos nas fixtures;
- JSON tabular escapa delimitadores;
- logs mantêm `ERROR` e `FATAL`;
- HTML não executa scripts;
- resultado inseguro volta ao original.

## Marco 3 — operações do Context Optimizer

### 3.1 `Build Agent Context`

Manter compatibilidade com v0.1.

### 3.2 `Compile Static Prompt`

- hash SHA-256;
- cache local;
- compilação determinística;
- Compression Model opcional;
- cobertura e fallback;
- cache invalidado por configuração.

### 3.3 `Optimize Content`

Parâmetros:

- conteúdo;
- tipo;
- tarefa atual;
- orçamento;
- perfil;
- campos incluídos/excluídos;
- valores protegidos;
- armazenar original;
- TTL.

### 3.4 Aceite

- workflows v0.1 continuam carregando;
- novas operações aparecem na UI;
- múltiplos itens preservam `pairedItem`;
- cache hit evita nova compressão semântica.

## Marco 4 — armazenamento reversível

### 4.1 Store interno

Criar:

- `src/storage/resource-store.ts`;
- `src/storage/filesystem-store.ts`;
- `src/storage/resource-id.ts`;
- `src/storage/ttl.ts`.

Requisitos:

- diretório restrito;
- gzip;
- manifesto separado;
- escrita atômica;
- SHA-256;
- TTL;
- limite por recurso;
- proteção contra path traversal.

### 4.2 Context Store

Operações:

- Store;
- Inspect;
- Delete;
- Purge Expired.

### 4.3 Aceite

- resourceId estável por conteúdo e escopo;
- arquivo parcial nunca é lido;
- recurso expirado não retorna conteúdo;
- purge não remove arquivo fora do diretório.

## Marco 5 — Context Retriever Tool

### 5.1 Contrato AI Tool

Implementar subnó `AiTool` nativo, sem depender de geração automática de tool variant.

### 5.2 Operações

- `search_context`;
- `filter_records`;
- `get_exact_value`;
- `get_section`;
- `inspect_schema`;
- `get_original_fragment`.

### 5.3 Limites

- resultados;
- tokens;
- chamadas;
- campos;
- original completo;
- motivo.

### 5.4 Aceite

- AI Agent chama a tool;
- valores exatos incluem `resourceId` e `path`;
- recurso ausente/expirado retorna erro estruturado;
- limite nunca é ultrapassado.

## Marco 6 — Token Analytics

### 6.1 Operações

- Analyze Item;
- Compare Runs;
- Aggregate Batch;
- Estimate Cost.

### 6.2 Métricas

- original;
- enviado;
- compressor;
- recuperado;
- output;
- cached;
- reasoning;
- economia bruta/líquida;
- fallback;
- latência.

### 6.3 Aceite

- fórmulas testadas;
- ausência de preço não impede contagem;
- métricas não contêm texto do usuário.

## Marco 7 — integração local

### 7.1 Pacote

- versão `0.2.0`;
- README;
- CHANGELOG;
- cinco exports exatos;
- tarball local;
- instalação em `~/.n8n/nodes`.

### 7.2 Smoke workflows

- compressor JSON;
- Store + Retriever;
- Gemini sem tools;
- Gemini com tools;
- analytics.

### 7.3 Lino v0.2

Criar nova cópia separada:

- baseline intacto;
- cópia proxy existente intacta;
- cópia Context + Model existente intacta;
- nova cópia usa v0.2.

### 7.4 Relatório

Comparar:

- saudação;
- ramo protegido;
- tool call;
- conversa longa;
- JSON grande;
- RAG com recuperação.

## Portões

### Antes de instalar

- testes;
- build;
- lint;
- exports;
- nenhum segredo;
- traversal e TTL testados.

### Antes do Lino

- Gemini tool calling válido;
- Store + Retriever funcionais;
- fallback exercitado;
- telemetria real.

### Liberação local

- qualidade mínima `95%`;
- fatos protegidos `100%`;
- sequência de tools `100%`;
- economia líquida positiva;
- pacote removível;
- nenhum workflow corporativo alterado.

## Commits previstos

1. `fix: preserve model tool-call sequences`
2. `feat: add content-aware compression`
3. `feat: add reversible context store`
4. `feat: add context retriever tool`
5. `feat: add token analytics`
6. `test: validate context optimizer v0.2 locally`
