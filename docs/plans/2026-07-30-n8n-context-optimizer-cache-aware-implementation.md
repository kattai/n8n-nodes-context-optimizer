# Implementation plan — cache-aware universal optimizer 0.6.0

Spec: `docs/specs/2026-07-30-n8n-context-optimizer-cache-aware-design.md`  
Método: TDD; um commit por unidade funcional; `npm run check` antes de cada push relevante.

## Task 1 — Fingerprints e registro persistente

Arquivos:

- criar `src/cache/types.ts`;
- criar `src/cache/fingerprint.ts`;
- criar `src/cache/fingerprint-registry.ts`;
- criar `test/unit/cache-fingerprint.test.ts`;
- criar `test/unit/fingerprint-registry.test.ts`.

Testes primeiro:

1. Mesmo escopo, posição e conteúdo produzem mesmo SHA-256.
2. Conteúdo ou posição diferente produz fingerprint diferente.
3. Registro persiste somente hash e metadados permitidos.
4. `seenCount`, timestamps, cache observado e TTL funcionam.
5. Escrita atômica resiste a leituras repetidas e rejeita paths inválidos.

Implementação:

- um arquivo JSON por fingerprint;
- storage root configurável;
- TTL entre 1 e 720 horas;
- limpeza limitada por execução;
- nenhum conteúdo, preview, embedding ou secret no registro.

Commit: `feat: add cache fingerprint registry`

## Task 2 — Cache Policy Engine

Arquivos:

- criar `src/cache/cache-policy-engine.ts`;
- criar `test/unit/cache-policy-engine.test.ts`.

Testes primeiro:

1. Blocos obrigatórios sempre retornam `preserve`.
2. `automatic_hybrid` preserva prefixo repetido e reduz tool output variável.
3. `cache_priority` preserva candidato estável acima do threshold.
4. `token_reduction_priority` reduz conteúdo elegível sem violar proteções.
5. `ignore_cache_signals` reproduz decisão de `0.5.2`.
6. Incerteza em modo híbrido retorna `preserve`.
7. Queue mode local emite warning estruturado.

Implementação:

- tipos `CacheStrategy`, `CacheBlockKind`, `CacheDecision`;
- regras determinísticas, sem LLM;
- motivos enumerados para telemetria;
- limiares validados e clampados;
- decisão independente de provider e domínio.

Commit: `feat: add cache policy engine`

## Task 3 — Configuração do Token Saver Chat Model

Arquivos:

- alterar `nodes/OptimizedChatModel/OptimizedChatModel.node.ts`;
- alterar `test/unit/node-descriptions.test.ts`;
- alterar `test/unit/model-wrapper.test.ts` quando necessário para fixture de opções.

Testes primeiro:

1. Propriedade `Cache Strategy` mostra quatro opções e descrições claras.
2. Nodes novos usam `automatic_hybrid`.
3. Node antigo sem parâmetro usa `ignore_cache_signals`.
4. Advanced Options expõem repetition, TTL, stable prefix, target e preview.
5. Valores inválidos são limitados antes de chegar ao motor.

Implementação:

- progressive disclosure;
- detecção legada via `this.getNode().parameters`;
- registry em diretório local seguro;
- aviso para `EXECUTIONS_MODE=queue`;
- nenhum novo credential type.

Commit: `feat: expose cache-aware model settings`

## Task 4 — Integração no wrapper

Arquivos:

- alterar `src/model-wrapper/wrap-language-model.ts`;
- alterar `src/model-wrapper/maximum-savings-virtualizer.ts`;
- possivelmente criar `src/model-wrapper/message-segmenter.ts`;
- ampliar `test/unit/model-wrapper.test.ts`;
- ampliar `test/unit/maximum-savings-virtualizer.test.ts`.

Testes primeiro:

1. System, tool schema/config, mensagem atual e `toolCallId` não mudam.
2. Prefixo preservado continua byte a byte igual.
3. Tool output variável é virtualizado no híbrido.
4. Bloco estável repetido segue decisão da estratégia.
5. Mesmo conteúdo e tarefa geram recibo determinístico.
6. Preview adaptativo respeita 10–30% e alvo de 80% elegível.
7. Store/Retriever/Quality Guard falhando retornam caminho conservador.
8. Invoke, batch, stream e generate mantêm comportamento.

Implementação:

- segmentar sem reordenar;
- observar fingerprints antes da transformação;
- decidir por bloco;
- atualizar registry após resposta do provider;
- manter tool outputs como dados não confiáveis;
- unir métricas de todas as voltas do Agent.

Commit: `feat: apply cache-aware context optimization`

## Task 5 — Telemetria e Analytics

Arquivos:

- alterar `src/analytics/provider-usage.ts`;
- alterar `src/analytics/model-telemetry-registry.ts`;
- alterar `src/analytics/token-analytics.ts`;
- alterar `nodes/TokenAnalytics/TokenAnalytics.node.ts`;
- ampliar testes correspondentes.

Testes primeiro:

1. Extrair cached tokens dos formatos suportados sem confundir input total.
2. Somar cache e uso entre múltiplas chamadas do Agent.
3. Separar regular input, cached input, output e reasoning.
4. Custo usa preços distintos e inclui overhead.
5. Ausência de cache metadata produz `provider_partial`.
6. Ausência de uso real produz `optimizer_estimate`.
7. Saída simples não afirma economia financeira sem preços.

Implementação:

- `measurementConfidence` explícito;
- decisão e motivo no relatório;
- preços customizáveis; presets apenas como conveniência editável;
- formato simples curto e formato detalhado auditável.

Commit: `feat: report cache-aware token cost`

## Task 6 — Compatibilidade, versão e documentação

Arquivos:

- alterar `package.json` e `package-lock.json` para `0.6.0`;
- alterar `CHANGELOG.md`;
- alterar `README.md`;
- marcar TODOs concluídos na spec;
- adicionar exemplos sem credentials.

Verificações:

1. Importar workflow `0.5.2` e confirmar estratégia legada.
2. Criar node novo e confirmar híbrido padrão.
3. Executar `npm run check`.
4. Executar `npm pack` e inspecionar conteúdo.

Commit: `chore: release context optimizer 0.6.0`

## Task 7 — Benchmarks universais

Artefatos:

- criar workflow A/B frio/quente sanitizado;
- criar datasets JSON/API, RAG, logs, conversa e tools mistas;
- criar relatório JSON e Markdown;
- não incluir credenciais ou dados internos.

Matriz:

1. Baseline frio.
2. Baseline quente após warm-up.
3. Hybrid frio e quente.
4. Cache Priority frio e quente.
5. Token Reduction Priority frio e quente.

Critérios:

- 80% mediano em conteúdo elegível;
- 95% dos casos elegíveis acima de 70%;
- 100% dos fatos protegidos;
- custo híbrido quente não superior ao baseline no dataset;
- respostas comparadas por fatos e schema, não apenas texto idêntico.

Commit: `test: benchmark cache-aware strategies`

## Task 8 — Instalação e prova local

1. Instalar tarball `0.6.0` no n8n local.
2. Reiniciar n8n e verificar `/healthz`.
3. Importar workflow sanitizado.
4. Executar caminhos frio, warm-up e quente.
5. Gerar relatório final com execution IDs, tokens, cache, custo e qualidade.
6. Confirmar que Store e Retriever recuperam recurso exato.

Commit de correção somente se prova revelar defeito. Push final após CI verde.
