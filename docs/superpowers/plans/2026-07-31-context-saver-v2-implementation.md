# Context Saver v2 — plano de implementação

Data: 2026-07-31

Spec: `docs/superpowers/specs/2026-07-31-context-saver-v2-design.md`

Objetivo final: entregar todas as fases aprovadas em commits verificáveis, terminando no pacote `0.9.0`, sem alterar workflows de produção nem publicar no npm.

## Regras de execução

- Escrever teste antes ou junto de cada mudança comportamental.
- Manter `npm run check` verde em cada checkpoint.
- Usar light node versioning `[1, 2]`; versão 1 mantém parâmetros e comportamento atuais.
- Não renomear package name, internal node names ou node type IDs.
- Não usar credenciais pagas sem autorização separada.
- Não aceitar compressão com economia líquida negativa.
- Preservar tool call IDs, ordem, structured output e erros do provider.
- Editar arquivos somente com `apply_patch`; formatadores podem executar mecanicamente.

## Entrega 1 — v0.7.0: engine segura e cinco nós

### Tarefa 1 — contratos compartilhados

Arquivos:

- criar `src/context/types.ts`
- criar `src/context/canonical-context.ts`
- criar `src/context/categories.ts`
- atualizar `src/core/types.ts`
- criar `test/unit/canonical-context.test.ts`

Implementar:

- `CanonicalContext`, `ContextBlock`, `ToolSequence`, `ToolSchemaBlock` e categorias;
- IDs/hashes determinísticos;
- separação entre instruções, current message, histórico, RAG, schemas e tools;
- classificação de risco, estabilidade, exatidão e recuperabilidade;
- normalização sem misturar instruções e dados.

Aceite:

- mesma entrada gera mesma representação/hash;
- current message e system instructions ficam em categorias protegidas;
- tool calls/results continuam identificáveis por ID.

Commit: `feat: add canonical context model`

### Tarefa 2 — sequências de tools

Arquivos:

- refatorar `src/model-wrapper/message-sequence.ts`
- atualizar `src/model-wrapper/wrap-language-model.ts`
- ampliar `test/unit/model-wrapper.test.ts`
- criar `test/unit/tool-sequence.test.ts`

Implementar:

- agrupar chamadas paralelas e resultados por ID;
- classificar grupos active, recent-completed, archived-completed ou invalid;
- remover `tool_sequence_present` como bypass geral;
- preservar sequência ativa integralmente;
- permitir compressão somente do conteúdo de resultados concluídos;
- suportar `additional_kwargs`, content blocks e aliases de providers.

Aceite:

- IDs, ordem e pareamento 100% preservados;
- sequência inválida usa original e motivo específico;
- sequência válida permite compressão estrutural de tool output.

Commit: `fix: canonicalize active tool sequences`

### Tarefa 3 — contagem por modelo e economia líquida

Arquivos:

- criar `src/tokens/types.ts`
- criar `src/tokens/token-counter.ts`
- criar `src/tokens/model-detector.ts`
- adaptar `src/core/token-estimator.ts`
- atualizar `src/analytics/provider-usage.ts`
- atualizar `src/analytics/token-analytics.ts`
- criar `test/unit/token-counter.test.ts`
- ampliar `test/unit/token-analytics.test.ts`

Implementar:

- adapter exato quando tokenizer local suportado estiver disponível;
- estimativas calibradas por família e fallback genérico;
- custom chars/tokens override;
- confidence level;
- cálculo líquido incluindo compressor, retrieval e verification;
- prevenção global de resultado negativo.

Aceite:

- provider actual sempre vence estimativa no relatório final;
- custo não aparece sem preços configurados;
- transformação negativa retorna original com `negative_net_savings`.

Commit: `feat: add model-aware token accounting`

### Tarefa 4 — Policy Engine e perfis v2

Arquivos:

- refatorar `src/core/profiles.ts`
- ampliar `src/core/types.ts`
- criar `src/policy/policy-engine.ts`
- criar `src/policy/profile-contracts.ts`
- atualizar `src/cache/policy-engine.ts`
- ampliar `test/unit/profiles.test.ts`
- criar `test/unit/policy-engine-v2.test.ts`

Implementar:

- Quality, Balanced, Savings e Custom;
- aliases safe/balanced/aggressive;
- orçamento total e por categoria;
- meta típica elegível e status/motivo;
- ganho mínimo configurável;
- interação cache/reduction por bloco.

Aceite:

- Quality nunca remove conteúdo único;
- Balanced só omite conteúdo quando recuperável;
- Savings nunca remove bloco protegido para bater meta;
- workflows v1 resolvem perfis antigos sem mudança.

Commit: `feat: differentiate Context Saver profiles`

### Tarefa 5 — JSON Optimizer v2

Arquivos:

- refatorar `src/content/json-compressor.ts`
- criar `src/content/json-packing.ts`
- criar `src/content/dictionary-encoding.ts`
- criar `src/content/json-roundtrip.ts`
- atualizar `src/content/types.ts`
- atualizar `src/content/optimize-content.ts`
- atualizar `src/quality/quality-guard.ts`
- criar `test/unit/json-optimizer-v2.test.ts`

Implementar:

- arrays tabulares recursivos;
- schema compartilhado por path;
- formato delimitado com escaping reversível;
- dictionary encoding somente com ganho líquido;
- JSONPath include/exclude/protect;
- type manifest e round-trip validation;
- fallback para minified/original.

Aceite:

- tipos/valores/ordem de arrays reconstruídos exatamente;
- Unicode, delimitadores, strings vazias e `null` cobertos;
- nenhum JSON pequeno aumenta tokens;
- protected paths permanecem presentes ou recuperáveis.

Commit: `feat: add reversible JSON packing v2`

### Tarefa 6 — seleção lexical e orçamento por categoria

Arquivos:

- criar `src/relevance/bm25.ts`
- criar `src/relevance/chunk-selector.ts`
- criar `src/relevance/field-projector.ts`
- criar `src/relevance/category-budget.ts`
- atualizar `src/virtualization/context-virtualizer.ts`
- criar testes unitários correspondentes

Implementar:

- BM25 sem LLM;
- recency/source/protected/neighbor bonuses;
- diversidade de fontes;
- field projection recuperável;
- redistribuição segura de orçamento.

Aceite:

- marcador ligado à tarefa aparece no preview;
- campo protegido nunca é removido irreversivelmente;
- resultado determinístico para mesma entrada/tarefa.

Commit: `feat: add task-aware context selection`

### Tarefa 7 — Store content-addressed e receipts

Arquivos:

- ampliar `src/storage/types.ts`
- refatorar `src/storage/filesystem-store.ts`
- criar `src/storage/resource-index.ts`
- criar `src/receipts/context-receipt.ts`
- atualizar `nodes/ContextStore/ContextStore.node.ts`
- ampliar `test/unit/filesystem-store.test.ts`
- criar `test/unit/context-receipt.test.ts`

Implementar:

- deduplicação SHA-256 + scope;
- reuse/ref metadata;
- token/schema/sensitivity/index manifest;
- last access e expiry seguros;
- receipt compacto e verificável;
- bloqueio secret-like por padrão.

Aceite:

- store duplicado reutiliza mesmo recurso;
- conteúdo original continua byte-identical após gzip;
- scope errado nunca lê/deleta recurso;
- receipt não contém original grande ou secret.

Commit: `feat: reuse stored context by content hash`

### Tarefa 8 — Retriever universal v2

Arquivos:

- refatorar `src/retrieval/retrieve-context.ts`
- atualizar `nodes/ContextRetrieverTool/ContextRetrieverTool.node.ts`
- atualizar `src/output/format-node-output.ts`
- ampliar `test/unit/retrieve-context.test.ts`

Implementar:

- BM25 e chunks vizinhos;
- filtros compostos;
- JSONPath e field projection;
- cursor/paginação;
- evidence resource/path/hash/exact;
- orçamento por chamada e execução;
- respostas compactas.

Aceite:

- valor exato inclui evidence;
- resultado grande pagina sem perder continuidade;
- blocklist/allowlist permanecem recursivas;
- retrieval nunca supera limite configurado sem cursor.

Commit: `feat: add evidence-based paged retrieval`

### Tarefa 9 — Model, Content e Metrics v2

Arquivos:

- atualizar `nodes/OptimizedChatModel/OptimizedChatModel.node.ts`
- atualizar `nodes/ContextOptimizer/ContextOptimizer.node.ts`
- atualizar `nodes/TokenAnalytics/TokenAnalytics.node.ts`
- atualizar os três `.node.json`
- atualizar `test/unit/node-descriptions.test.ts`
- ampliar testes de wrapper/output/analytics

Implementar:

- light versions `[1, 2]`;
- novos nomes visuais;
- progressive disclosure;
- perfis e metas na UI;
- perfil visível em todas operações do Content;
- Automatic/Disabled/Required virtualization;
- eligible/full/provider/net metrics;
- recomendações e motivos.

Aceite:

- typeVersion 1 conserva defaults/valores;
- typeVersion 2 mostra apenas campos relevantes;
- output simple não carrega conteúdo original;
- métricas deixam estimativa/actual inequívocos.

Commit: `feat: add Context Saver v2 node UX`

### Tarefa 10 — ícones, documentação e benchmark v0.7

Arquivos:

- substituir SVG light/dark dos cinco nós;
- atualizar `README.md` e `CHANGELOG.md`;
- criar `docs/nodes/*.md` para os cinco nós;
- criar/atualizar workflows em `examples/workflows/`;
- criar `scripts/run-profile-v2-benchmark.mjs`;
- gerar `benchmarks/results/profile-v2-results.{json,md}`;
- atualizar `package.json` para `0.7.0`.

Aceite:

- mini docs cobrem função, mecanismo, uso, contraindicação, perfil e exemplo;
- ícones não têm fundo preenchido e possuem light/dark;
- medianas elegíveis atingem Quality >=15%, Balanced >=35%, Savings >=60% no dataset definido;
- facts, round-trip, retrieval e tool IDs em 100%;
- benchmark não suja Git quando repetido.

Commit: `release: prepare Context Saver 0.7.0`

## Entrega 2 — v0.8.0: Memory e lazy tools

### Tarefa 11 — Context Saver Memory

Arquivos:

- criar `src/memory/types.ts`
- criar `src/memory/memory-manager.ts`
- criar `src/memory/fact-versioning.ts`
- criar `src/memory/incremental-summary.ts`
- criar `nodes/ContextMemory/ContextMemory.node.ts`
- criar metadata/icons do novo nó
- registrar node no `package.json`
- criar testes e `docs/nodes/context-saver-memory.md`

Implementar operações Update, Build, Inspect, Delete e Purge. Persistir pinned facts, structured state, recent messages, incremental summary e archived resources por sessionKey/scope. Detectar fatos substituídos sem apagar histórico recuperável.

Aceite:

- valor atual entra no prompt uma única vez;
- correções e pendências ficam protegidas;
- resumo inválido não substitui estado anterior;
- sessões/scopes não cruzam dados.

Commit: `feat: add Context Saver Memory`

### Tarefa 12 — tool schema selection e lazy binding

Arquivos:

- criar `src/tools/tool-registry.ts`
- criar `src/tools/tool-schema-selector.ts`
- atualizar `src/model-wrapper/wrap-language-model.ts`
- ampliar testes `bindTools` e many-tools

Implementar deferred binding, seleção determinística, allowlist, recently-used bonus, confidence fallback e budget. Quality mantém tudo. Baixa confiança sempre usa todas tools.

Aceite:

- tool necessária permanece disponível nos golden cases;
- seleção nunca muda executor/tool call contract;
- prompts com muitas tools reduzem tokens;
- structured output ambiguity faz fallback seguro.

Commit: `feat: add safe lazy tool schemas`

### Tarefa 13 — release v0.8

Atualizar docs, exemplos, CHANGELOG e package version `0.8.0`. Rodar benchmark many-tools e memory growth. Instalar `.tgz` no n8n isolado e executar smoke workflow.

Commit: `release: prepare Context Saver 0.8.0`

## Entrega 3 — v0.9.0: estratégias experimentais

### Tarefa 14 — semantic pipeline opt-in

Arquivos:

- criar `src/semantic/types.ts`
- criar `src/semantic/semantic-deduplicator.ts`
- criar `src/semantic/semantic-reranker.ts`
- ampliar `src/memory/incremental-summary.ts`
- atualizar opções Advanced dos nós v2
- criar testes com adapters mockados

Implementar adapters opcionais para semantic dedup, LLM summary, reranking e embeddings. Sem provider embutido. Medir compressor tokens, validar protected facts e comparar com caminho determinístico.

Aceite:

- desligado por padrão;
- nenhum adapter chamado sem opt-in;
- baixa confiança/erro/economia negativa volta ao determinístico;
- custos do compressor aparecem no net savings.

Commit: `feat: add guarded semantic optimization`

### Tarefa 15 — Quality Guard automático

Arquivos:

- refatorar `src/quality/quality-guard.ts`
- criar `src/quality/verification-policy.ts`
- criar `src/quality/fallback-controller.ts`
- ampliar testes de falha e retry conservador

Implementar níveis Fast, Strict e Critical; verificação determinística sempre; judge opcional; retry com perfil mais conservador; original como último fallback.

Aceite:

- blocos protegidos byte-identical;
- contradição/omissão injetada reprova;
- fallback não faz segunda chamada paga sem configuração explícita.

Commit: `feat: add adaptive quality fallback`

### Tarefa 16 — release v0.9 e prova final

Atualizar package `0.9.0`, README, mini docs, CHANGELOG, workflows e benchmark universal. Rodar:

```powershell
npm run check
npm run benchmark:cache
npm run benchmark:profiles
npm pack --dry-run --silent
```

Gerar `.tgz`, instalar em n8n local isolado, confirmar seis nós, importar/exportar workflows e executar smoke sem credenciais pagas. Publicar commits no repositório privado. Não publicar npm release.

Commit: `release: prepare Context Saver 0.9.0`

## Ordem e checkpoints

1. Tarefas 1–4 estabelecem contratos; nenhuma UI antes delas.
2. Tarefas 5–8 implementam economia/retrieval sobre contratos estáveis.
3. Tarefas 9–10 fecham v0.7 e devem deixar CI verde.
4. Tarefas 11–13 dependem de Store/Policy/Canonical Context.
5. Tarefas 14–16 dependem de métricas líquidas e Quality Guard v2.

Checkpoint por entrega:

- worktree limpo;
- local HEAD igual a origin/main;
- tests/build/lint verdes;
- pacote instalável;
- resultado benchmark versionado;
- documentação compatível com UI real.

