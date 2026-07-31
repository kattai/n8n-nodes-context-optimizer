# Context Saver v2 — design aprovado

Data: 2026-07-31

Status: aprovado para planejamento e implementação

Pacote técnico: `n8n-nodes-context-optimizer`

Nome exibido no n8n: `Context Saver`

## 1. Objetivo

Transformar o pacote atual em uma camada geral de gerenciamento de contexto para qualquer AI Agent do n8n. O produto deve reduzir tokens de entrada sem depender de um provider específico, preservar fatos e sequências estruturais, manter conteúdo exato recuperável e medir economia líquida em vez de anunciar apenas redução bruta.

O produto não promete uma porcentagem fixa para todo prompt. As faixas dos perfis representam metas típicas sobre **contexto elegível**. System prompt, mensagem atual, sequências ativas de tools, schemas obrigatórios e conteúdo protegido não serão removidos para forçar uma meta.

## 2. Princípios

1. Compressão sem perda antes de qualquer seleção com perda.
2. Conteúdo exato removido do prompt permanece recuperável.
3. Toda transformação deve economizar tokens líquidos; caso contrário, usa o original.
4. Instruções, dados, memória e resultados de tools mantêm tipos e origens separados.
5. Compressão incerta falha em favor da qualidade: modo conservador e depois original.
6. Prefixos estáveis podem ser preservados quando o cache do provider gerar benefício maior.
7. Métricas estimadas e usage real do provider nunca serão misturados.

## 3. Nome e identidade

O nome visual será **Context Saver**. O package name, node type names e repositório técnico permanecem como estão para não quebrar workflows exportados ou instalações existentes.

Nomes dos nós:

- `Context Saver Model`
- `Context Saver Content`
- `Context Saver Store`
- `Context Saver Retriever`
- `Context Saver Metrics`
- `Context Saver Memory` — novo na segunda entrega

Os seis ícones formarão uma família visual: SVG flat, sem quadrado preenchido, traços legíveis em tamanho pequeno e arquivos próprios para light/dark. Light usa grafite com coral `#FF6D5A`; dark usa branco suave com coral claro. Símbolos: balão comprimido, chaves convergentes, arquivo em storage, lupa recuperando fragmento, barras com `%` e camadas de memória.

## 4. Perfis

### Quality — meta típica de 15–35%

- Somente transformações determinísticas e reversíveis.
- Últimas 12 mensagens intactas.
- Deduplicação exata.
- JSON packing reversível.
- Cache estável preservado.
- Sem resumo semântico, embeddings ou remoção de conteúdo único.

### Balanced — meta típica de 35–60%

- Tudo de Quality.
- Últimas 6 mensagens intactas.
- Dicionário somente quando o ganho líquido for positivo.
- Field projection e seleção conservadora por tarefa.
- Virtualização automática quando Store e Retriever estiverem disponíveis.
- Conteúdo único omitido do prompt somente quando o original estiver recuperável.

### Savings — meta típica de 60–85%

- Tudo de Balanced.
- Últimas 3 mensagens intactas.
- Preview orientado à tarefa com orçamento pequeno.
- Virtualização de resultados grandes de tools, APIs, logs e RAG.
- Seleção de chunks e campos por relevância.
- Lazy tool loading somente quando houver muitas tools e confiança suficiente.
- Recuperação exata obrigatória para detalhes ausentes do preview.

### Custom

Permite configurar técnicas, orçamento total, orçamento por categoria, janela recente, virtualização, seleção de tools, armazenamento, proteção e estratégias experimentais.

### Baseline

`Measure Baseline` continua como modo de teste, não como perfil de produção.

### Regras das faixas

- A faixa é exibida como `Typical eligible saving`, não como garantia.
- Economias naturais acima da faixa não serão desfeitas.
- Meta não atingida inclui motivo estruturado: `content_not_repetitive`, `retriever_unavailable`, `cache_preserved`, `quality_fallback`, `negative_net_savings` ou `content_not_eligible`.
- `Context Saver Metrics` mostra separadamente economia elegível e economia real/estimada do request completo.
- Valores internos antigos `safe`, `balanced` e `aggressive` continuam aceitos como aliases de compatibilidade.

## 5. Arquitetura compartilhada

### 5.1 Canonical Context

Toda entrada será convertida para uma representação canônica antes de ser otimizada:

```ts
interface CanonicalContext {
  stableInstructions: ContextBlock[];
  dynamicInstructions: ContextBlock[];
  currentMessage: ContextBlock;
  recentHistory: ContextBlock[];
  archivedHistory: ContextBlock[];
  toolSchemas: ToolSchemaBlock[];
  activeToolSequences: ToolSequence[];
  completedToolSequences: ToolSequence[];
  retrievedContext: ContextBlock[];
  protectedFacts: ProtectedFact[];
}
```

Cada bloco carrega `id`, `category`, `source`, `risk`, `stable`, `exact`, `retrievable`, token count e hash. Instruções nunca serão misturadas com dados em um resumo único.

### 5.2 Pipeline

1. Canonicalizar entrada e validar sequência.
2. Detectar conteúdo, risco, estabilidade e fatos protegidos.
3. Contar tokens por bloco e categoria.
4. Aplicar política de cache.
5. Executar limpeza e compressão estrutural reversível.
6. Aplicar seleção por relevância permitida pelo perfil.
7. Virtualizar conteúdo elegível e gerar receipt.
8. Aplicar estratégia semântica somente quando habilitada.
9. Executar Quality Guard e round-trip checks.
10. Calcular economia líquida; resultado negativo volta ao original.

### 5.3 Token Counter

Será criada uma interface pluggable de contagem:

- tokenizer exato local quando estiver disponível para a família do modelo;
- estimador calibrado por família antes da chamada quando tokenizer exato não existir;
- configuração manual para modelo desconhecido;
- usage real do provider depois da chamada;
- confidence: `provider_actual`, `model_tokenizer`, `model_estimate` ou `generic_estimate`.

O orçamento pré-chamada usa tokenizer/estimativa. Relatórios finais preferem usage do provider.

### 5.4 Economia líquida

```text
netSaved = originalInput
         - optimizedInput
         - compressorInput
         - compressorOutput
         - retrievedTokens
         - verificationTokens
```

Cache read/write e output/reasoning são apresentados separadamente. Custo financeiro só será calculado quando o usuário fornecer preços.

## 6. Sequências de tools

`tool_sequence_present` deixa de representar bypass geral. A engine agrupa chamadas e resultados pelos IDs e classifica cada grupo:

- ativa/incompleta: preservar byte a byte e na ordem original;
- concluída e recente: preservar estrutura, podendo comprimir apenas conteúdo do resultado;
- concluída e antiga: manter receipt e virtualizar resultado grande;
- inválida ou órfã: bypass conservador com motivo exato.

Chamadas paralelas, `additional_kwargs`, blocos multimodais, streaming e providers com formatos diferentes precisam preservar IDs e pareamento.

## 7. JSON Optimizer v2

O compressor JSON será reversível e orientado por ganho:

- detectar arrays tabulares em qualquer profundidade;
- extrair schema compartilhado de cada array elegível;
- usar representação delimitada com escaping determinístico;
- aplicar dictionary encoding em strings/subsequências repetidas somente quando o dicionário economizar tokens líquidos;
- preservar diferença entre string, número, boolean, `null`, objeto e array;
- suportar JSONPath para include, exclude e protected paths;
- projetar campos por tarefa somente quando o original estiver armazenado;
- gerar receipt com paths, campos, linhas, hashes e instrução de recuperação;
- reconstruir JSON e comparar tipos/valores no Quality Guard.

JSON pequeno ou não repetitivo permanece minificado ou original.

## 8. Redesenho dos nós

### 8.1 Context Saver Model

Nó principal conectado entre qualquer Chat Model e o AI Agent.

Campos principais:

- `Mode`: Save Tokens ou Measure Baseline.
- `Profile`: Quality, Balanced, Savings ou Custom.
- `Cache`: Automatic, Prefer Cache, Prefer Reduction ou Ignore Cache.

Advanced Options:

- janela recente;
- economia líquida mínima;
- orçamento total e por categoria;
- tratamento de tool results;
- lazy tool loading;
- proteção e storage;
- estratégias experimentais.

O wrapper otimiza `invoke`, `batch`, `stream` e `generate`, preserva structured output e intercepta `bindTools` sem mudar o contrato do provider.

### 8.2 Context Saver Content

Operações:

- `Optimize Content` — padrão;
- `Build Agent Context`;
- `Optimize Stable Prefix`.

O perfil fica visível nas três operações. Content Type permanece em Auto por padrão. Opções JSON aparecem somente para tipos compatíveis. Virtualização oferece `Automatic`, `Disabled` ou `Required`. Simple Output nunca copia o original grande.

### 8.3 Context Saver Store

Mantém gzip, SHA-256, scope, TTL, atomic writes e safe paths. Adiciona:

- content-addressed deduplication por hash + scope;
- reutilização de recurso existente;
- manifesto com tokens, schema, sensibilidade e índices;
- atualização segura de last access/expiry;
- secret-like content bloqueado por padrão;
- índice lateral para busca sem carregar/serializar conteúdo inteiro repetidamente.

Operações Store, Inspect, Delete e Purge permanecem.

### 8.4 Context Saver Retriever

Continua sendo uma única tool `retrieve_context`. Adiciona:

- BM25 lexical sem chamada de LLM;
- seleção de chunks vizinhos;
- filtros compostos e JSONPath;
- field projection;
- paginação/cursor;
- evidence `{ resourceId, path, hash, exact }`;
- orçamento por chamada e por execução;
- redaction recursiva;
- respostas compactas que também podem ser otimizadas pelo Model.

Resultado exato maior que o orçamento retorna página/cursor em vez de erro definitivo.

### 8.5 Context Saver Metrics

Relata:

- eligible savings;
- full-request savings;
- provider actual usage;
- net savings;
- cache read/write/hit rate;
- compressor, retrieval, output e reasoning tokens;
- target band, fallback e quality status;
- recomendações operacionais.

Sem usage do provider, o resultado é marcado como estimado. Aggregate e A/B Comparison permanecem.

### 8.6 Context Saver Memory

Novo nó de gerenciamento explícito por `sessionKey`. Não duplica silenciosamente a memória nativa do Agent. Operações:

- `Update Session`;
- `Build Context`;
- `Inspect Session`;
- `Delete Session`;
- `Purge Expired Sessions`.

Camadas:

- pinned rules/facts;
- structured current state;
- recent messages;
- incremental summary;
- archived retrievable events.

Correções do usuário, pendências, decisões e falhas ativas são protegidas. Fatos substituídos recebem versionamento: somente valor atual entra no prompt; histórico anterior permanece recuperável. Resumo incremental é opcional e validado antes de substituir conteúdo anterior.

## 9. Seleção inteligente

### Field projection

Campos são ranqueados contra tarefa atual, nomes de campos, valores protegidos e regras do usuário. Quality não remove campos. Balanced/Savings só removem campos inline quando o original for recuperável.

### Chunk selection

Chunks recebem score BM25, recência, source priority, protected-fact bonus e neighbor bonus. Diversidade impede que todos chunks escolhidos venham da mesma fonte.

### Orçamento por categoria

Custom permite limites para instructions, recent history, archived history, RAG, tool schemas, tool results e retrieval. Orçamento não utilizado pode ser redistribuído, nunca retirado de uma categoria protegida.

### Tool schema selection

Quality mantém todos schemas. Balanced permite allowlist/regras. Savings pode selecionar schemas quando houver mais que o threshold configurado. Tools recentemente usadas, explicitamente citadas ou obrigatórias ficam sempre presentes.

### Lazy tool loading

O wrapper adia `bindTools` e escolhe subset por chamada. Baixa confiança, poucas tools, structured-output ambiguity ou sequência ativa fazem fallback para todas as tools. Nenhuma classificação adicional por LLM será usada por padrão.

## 10. Estratégias experimentais

Desligadas por padrão:

- semantic deduplication;
- LLM summary;
- semantic reranking;
- embeddings;
- lossy token-level compression.

Requisitos para uso:

- opt-in explícito;
- custo do compressor medido;
- fatos, negações, IDs, datas, números e blocos protegidos verificados;
- resultado comparado com estratégia determinística;
- fallback para determinístico/original em baixa confiança, erro ou economia negativa.

## 11. UX e progressive disclosure

Cada nó mostra no primeiro nível apenas operação, perfil/modo e campos essenciais. Configurações específicas ficam em collections Advanced. Descrições devem explicar impacto, risco e dependências. Defaults devem funcionar sem configuração manual e nunca criar armazenamento externo ou custo de LLM silenciosamente.

## 12. Compatibilidade e versionamento

- Package release seguinte: `0.7.0` para engine v2 dos cinco nós.
- Node version `1` preserva comportamento e parâmetros atuais.
- Node version `2` recebe nomes, perfis e UX novos.
- Valores internos antigos são migrados/aceitos por aliases.
- Workflows de exemplo serão atualizados para version `2` sem editar workflows de produção.
- `0.8.0` adiciona Memory e lazy tool loading completo.
- `0.9.0` consolida estratégias experimentais e adapters adicionais.

As três entregas fazem parte do escopo aprovado e serão executadas em sequência, com validação e commit independentes.

## 13. Segurança e erros

- Não armazenar conteúdo secret-like automaticamente.
- Não registrar prompt, resource content ou credencial em analytics/fingerprints.
- Scope obrigatório para Store/Retriever/Memory.
- Paths resolvidos precisam permanecer dentro do diretório autorizado.
- Escritas atômicas e limites de tamanho/TTL continuam obrigatórios.
- Falhas de storage, retrieval, tokenizer ou compressor não podem invalidar resposta do provider.
- `continueOnFail()` permanece nos nós main quando aplicável.
- Retriever mantém field allowlist/blocklist recursiva e limita chamadas.

## 14. Testes e critérios de aceitação

### Testes unitários

- canonical context e active/completed tool sequences;
- tool calls paralelas, órfãs, incompletas e em `additional_kwargs`;
- `invoke`, `batch`, `stream`, `generate`, `bindTools` e structured output;
- JSON aninhado, escaping, Unicode, tipos, `null`, JSONPath e round-trip;
- hash reuse, TTL, scope, cursor e redaction;
- memory replacement, incremental summary e archive;
- cache cold/warm e economia líquida negativa.

### Benchmarks determinísticos

Domínios: JSON/API, logs, RAG, conversation history, mixed tools, code, structured output e many-tools. Cada caso registra eligible/full savings, facts, exact retrieval, latency e fallback.

Metas de mediana em casos elegíveis:

- Quality: pelo menos 15%;
- Balanced: pelo menos 35%;
- Savings: pelo menos 60%;
- protected facts: 100%;
- JSON round-trip: 100%;
- exact retrieval: 100%;
- tool call ID/order preservation: 100%;
- nenhuma transformação com economia líquida negativa aceita.

### A/B real

Comparar baseline e perfis com o mesmo modelo, temperatura e dataset somente quando houver credencial e orçamento explicitamente autorizados. Usage real do provider é a fonte para custo final. Cache cold e warm são medidos separadamente. Qualidade é verificada por golden facts e contratos estruturados; LLM judge, se usado, é apenas evidência adicional.

### Verificação do pacote

- `npm run test`;
- `npm run build`;
- `npm run lint`;
- `npm pack --dry-run`;
- instalação do `.tgz` em n8n local isolado;
- import/export e execução dos workflows de exemplo;
- CI verde.

## 15. Documentação obrigatória

README geral e mini documentação por nó. Cada página contém:

1. O que o nó faz.
2. Como reduz tokens.
3. Quando usar.
4. Quando não usar.
5. Configuração recomendada por perfil.
6. Exemplo mínimo e leitura das métricas.

Também serão documentados: significado das faixas, economia elegível versus request completo, cache versus redução, limites dos tokenizers, segurança do storage, uso do Retriever e procedimento A/B.

## 16. Fora do escopo

- Roteamento entre providers/modelos.
- Proxy global de LLM.
- Promessa universal de porcentagem ou zero alucinação.
- Alteração automática de workflows existentes.
- Interceptação de agentes que não conectarem os nós do pacote.
- Vector database embutido de grande escala.
- Publicação pública no npm sem aprovação explícita.
