# Context Saver 1.0 — guia completo

## Resultado

Context Saver reduz os tokens de entrada dos AI Agents sem depender de Gemini, OpenAI, Anthropic, Ollama ou outro provider. Primeiro aplica transformações determinísticas; conteúdo removido do prompt pode continuar armazenado e recuperável.

Não promete uma porcentagem em qualquer entrada. Se uma redução ameaçar fatos, tool calls, structured output ou cache útil, o perfil adaptativo reduz a agressividade ou devolve o original.

## Escolha rápida

| Problema | Nó principal | Posição |
|---|---|---|
| Prompt, histórico e muitas tools em cada chamada | **Agent Optimizer** | Entre Chat Model e AI Agent |
| JSON, API, RAG, HTML ou logs grandes | **Data Optimizer** | Antes do campo de contexto do Agent |
| Dois ou mais agentes repetindo contexto | **Agent Handoff** | Entre a saída de um Agent e a entrada do próximo |
| Conversa longa entre várias execuções | **Session Memory** | No caminho principal antes do Agent |
| Original precisa ficar fora do prompt | **Context Storage + Exact Lookup** | Storage no fluxo; Lookup na porta Tool |
| Medir a economia da execução | **Savings Report** | Depois do caminho otimizado |

Comece somente com **Agent Optimizer / Balanced**. Adicione outros nós quando o workflow tiver o problema correspondente.

## Perfis

| Perfil | Redução típica do conteúdo elegível | Uso recomendado |
|---|---:|---|
| **Quality First** | 15–35% | Código, regras críticas, contratos, structured output |
| **Balanced** | 35–60% | Padrão para agentes, chat, APIs e RAG |
| **Maximum Savings** | 60–85% | Tool results grandes com **Exact Lookup** conectado |
| **Custom** | Configurável | Casos avaliados com testes próprios |

As faixas não são garantia da fatura completa. O prompt não elegível, a saída do modelo e o cache do provider também influenciam custo real.

## 1. Agent Optimizer

### O que faz

Envolve qualquer Chat Model compatível com LangChain/n8n e otimiza cada chamada do AI Agent. Atua em prompt do sistema, mensagens antigas, resultados de tools e schemas de tools. Preserva a mensagem atual e sequências ativas de tool call/result.

### Como ligar

```text
Chat Model -> Agent Optimizer -> AI Agent
                                  |-> Exact Lookup, quando usar Maximum Savings
```

### Campos

| Campo | Função |
|---|---|
| **Model** | Chat Model original que será envolvido. |
| **Mode** | `Save Tokens` otimiza; `Measure Baseline` apenas mede para A/B. |
| **Profile** | Define janela recente, seleção e alvo de economia. |
| **Adaptive Quality Protection** | Rebaixa automaticamente para perfil mais seguro em código, citação exata, structured output, tool forçada, sequência ativa ou recuperação ausente. Mantenha ligado. |
| **Optimize Repeated Prompt Rules** | Remove blocos exatamente repetidos no system prompt; não reescreve regras únicas. |
| **Cache Strategy** | `Automatic Hybrid` preserva prefixos estáveis e reduz partes dinâmicas; as outras opções priorizam cache, redução direta ou ignoram sinais. |
| **Tool Schema Selection** | Carrega somente schemas claramente relevantes em Maximum Savings. Ambiguidade mantém todas as tools. |
| **Custom Profile** | Janela recente, deduplicação aproximada e orçamento manual. Use somente com evals. |

### Maximum Savings Options

| Campo | Função |
|---|---|
| **Storage Provider** | Filesystem local/compartilhado ou Redis. |
| **Scope / Session ID / Owner ID** | Limites de isolamento. Devem coincidir no Exact Lookup. |
| **Storage Directory / Redis Key Prefix** | Local onde o original será encontrado. |
| **Encrypt Stored Content** | AES-256-GCM antes de gravar. Requer credencial e chave ≥16 caracteres. |
| **Allow Secret-Like Content Storage** | Permite persistir texto parecido com segredo. Desligado por padrão. |
| **Minimum Content Tokens** | Abaixo disso, evita virtualização com overhead negativo. |
| **Target Preview (%)** | Parte aproximada mantida inline. 20% mira cerca de 80% no conteúdo elegível. |
| **Maximum Preview (%)** | Teto do preview; 30% exige ao menos 70% de redução elegível. |
| **Maximum Resource Size (MB)** | Limite do original; acima dele faz fallback seguro. |
| **TTL (Hours)** | Tempo de recuperação do original. |

### Tool Schema Selection

| Campo | Função |
|---|---|
| **Selection Mode** | Automático por perfil, sempre ligado ou desligado. |
| **Minimum Tools Before Selection** | Não seleciona conjuntos pequenos. |
| **Maximum Selected Tools** | Limite de schemas; tools obrigatórias/ativas podem ultrapassar. |
| **Tool Schema Token Budget** | Orçamento estimado total dos schemas. |
| **Always Available Tool Names** | Lista que nunca pode ser removida. |

### Cache-Aware Options

| Campo | Função |
|---|---|
| **Registry Provider** | Filesystem ou Redis para fingerprints; não guarda texto do prompt. |
| **Fingerprint Directory** | Diretório local de hashes e contadores. |
| **Redis Key Prefix** | Namespace compartilhado. |
| **Fingerprint TTL (Hours)** | Janela para considerar um prefixo recorrente. |
| **Maximum Fingerprints** | Limite local antes de remover observações antigas. |
| **Minimum Repetitions** | Repetições antes de tratar prefixo como cacheável. |
| **Minimum Stable Prefix Tokens** | Ignora prefixos pequenos, sem ganho relevante. |

## 2. Data Optimizer

### O que faz

Reduz conteúdo antes de inseri-lo no prompt. Detecta texto, JSON, HTML, logs, chat, tool output e código. Pode minificar, empacotar arrays JSON em tabela reversível, remover null/vazios autorizados, selecionar campos e virtualizar o restante.

### Operações

| Operação | Quando usar |
|---|---|
| **Optimize Content** | API, RAG, logs, HTML, JSON ou tool output grande. |
| **Build Agent Context** | Montar system prompt, memória, mensagem atual, retrieved context e tools em ordem canônica. |

### Campos de Optimize Content

| Campo | Função |
|---|---|
| **Content** | Texto/JSON que será otimizado. |
| **Content Type** | `Auto` ou tipo explícito para evitar detecção errada. |
| **Current Task** | Consulta usada para projeção e seleção lexical. |
| **Profile** | Quality First, Balanced, Maximum Savings ou Custom. |
| **Fields to Include / Exclude** | Projeção explícita de campos. Include tem precedência. |
| **Remove Null Fields / Empty Strings** | Remove somente valores sem conteúdo quando habilitado. |
| **Protected Values** | IDs, frases ou valores que devem sobreviver exatamente. |
| **Quality Verification** | Fast, Strict ou Critical; falha volta para candidato mais seguro/original. |
| **Context Virtualization** | Disabled, Automatic ou Required. |
| **Output** | Simple evita repassar o original; Detailed inclui diagnóstico. |

### Virtualization Options

Os campos de provider, isolamento, criptografia, tamanho, preview e TTL têm o mesmo significado do Agent Optimizer. **Maximum Preview Items** limita registros/chunks; **Maximum Preview Tokens** limita o preview textual.

### Campos de Build Agent Context

| Campo | Função |
|---|---|
| **System Prompt** | Regras fixas; nunca é misturado semanticamente com dados. |
| **Conversation History** | Histórico a compactar. |
| **Current Message** | Mensagem atual; preservada completa. |
| **Retrieved Context** | Dados recuperados por RAG/tool. |
| **Tool Definitions** | Schemas de tools. |
| **Optimization Level / Profile** | Política de janela, orçamento e deduplicação. |
| **Keep Recent Messages** | Quantidade integral no modo Custom. |
| **Maximum Input Tokens** | Alvo; conteúdo único só é cortado se autorizado. |
| **Allow Unique Content Trimming** | Permite descarte único no Custom. Arriscado sem Storage/Lookup. |
| **Approximate Deduplication** | Une quase duplicados somente com polaridade/negação compatível. |
| **Experimental Semantic Compression** | Usa modelo conectado; desligado por padrão. |

### Semantic Pipeline experimental

`LLM Summary`, `Semantic Deduplication`, `Task Reranking` e `LLM Judge` geram chamadas extras. Confidence, unit limits e budgets evitam custo descontrolado. Qualquer perda de fatos protegidos causa fallback determinístico.

## 3. Agent Handoff

### O que faz

Cria um contrato compacto entre agentes. Evita enviar toda a conversa e toda a saída do Agent A ao Agent B.

### Campos

| Campo | Função |
|---|---|
| **Objective** | Tarefa exata que o próximo agente continuará. |
| **Source Agent / Destination Agent** | Nomes para rastreabilidade. |
| **Confirmed Facts** | Fatos com evidência; duplicatas exatas são removidas. |
| **Decisions** | Decisões já tomadas. |
| **Pending Actions** | Pendências e perguntas abertas. |
| **Recoverable Resource IDs** | IDs que o próximo Agent pode consultar pelo Exact Lookup. |
| **Source Output** | Saída anterior; sofre packing determinístico quando seguro. |
| **Profile** | Intensidade da compactação estrutural. |

Quando houver Resource ID válido, Balanced/Maximum Savings podem substituir saída grande por referência recuperável.

## 4. Session Memory

### O que faz

Mantém memória por sessão fora do prompt: fatos fixados, estado atual, resumo incremental, janela recente, valores exatos e referências arquivadas. Detecta atualização de fatos sem tratar valor antigo como atual.

### Operações

| Operação | Função |
|---|---|
| **Update Session** | Aplica novas mensagens/estado e já devolve `memoryContext`. |
| **Build Context** | Monta somente o contexto necessário para o Agent. |
| **Inspect Session** | Diagnóstico sem alterar. |
| **Delete Session** | Apaga uma sessão. |
| **Purge Expired** | Limpa TTL vencido. |

### Campos

| Campo | Função |
|---|---|
| **Storage Provider** | Filesystem ou Redis compartilhado. |
| **Session Key** | Identificador estável da conversa. Obrigatório. |
| **Scope / Owner ID** | Isolamento de workflow/tenant. |
| **New Messages** | Mensagens novas, não o histórico completo. |
| **Pinned Facts** | Regras/preferências que não devem ser resumidas. |
| **Structured State** | Estado atual da tarefa. |
| **State Update Mode** | Merge preserva outros campos; Replace substitui o estado. |
| **Incremental Summary** | Resumo novo acumulado, sem reprocessar toda a conversa. |
| **Summary Based on Revision** | Evita aplicar resumo calculado sobre revisão antiga. |
| **Required Exact Values** | IDs/números/frases obrigatórios. |
| **Archived Resource References** | Conteúdo antigo recuperável por ID. |
| **Memory Profile / Recent Messages to Keep** | Tamanho da janela integral. |
| **Maximum Summary Tokens / Summary Safety** | Limite e validação do resumo. |
| **Session TTL / Maximum Session Size** | Contenção de storage. |
| **Encrypt Stored Sessions** | Criptografia AES-256-GCM. |
| **Output** | Simple para Agent; Detailed para auditoria. |

Redis usa lock distribuído para atualizações concorrentes. Filesystem é adequado a instância única; queue mode deve usar Redis ou caminho compartilhado.

## 5. Context Storage

### O que faz

Grava o original comprimido fora do prompt, calcula hash, reaproveita recursos iguais e devolve um receipt pequeno.

### Operações e campos

| Campo | Função |
|---|---|
| **Operation** | Store, Inspect, Delete ou Purge Expired. |
| **Content / Content Type** | Original e tipo. |
| **Resource ID** | ID usado em Inspect/Delete. |
| **Scope / Session ID / Owner ID** | Isolamento obrigatório na recuperação. |
| **Fields / Record Count** | Metadados para o receipt. |
| **Allow Secret-Like Content** | Autoriza storage de padrões sensíveis. |
| **Storage Provider / Directory / Redis Prefix** | Backend e namespace. |
| **Encrypt Stored Content** | AES-256-GCM autenticado. |
| **Maximum Resource Size / TTL** | Limites. |
| **Output** | Receipt simples ou manifesto detalhado. |

## 6. Exact Lookup

### O que faz

Tool do AI Agent para recuperar somente a parte exata necessária. Não injeta automaticamente o original inteiro.

### Configuração do nó

| Campo | Função |
|---|---|
| **Tool Description** | Diz ao Agent quando consultar; inclua “valores exatos ausentes”. |
| **Storage Provider / Directory / Redis Prefix** | Deve coincidir com o produtor. |
| **Scope / Session ID / Owner ID** | Deve coincidir; acesso cruzado é rejeitado. |
| **Encrypted Storage** | Usa a mesma chave do produtor. |
| **Maximum Calls per Execution** | Evita loop de recuperação. |
| **Maximum Tokens per Execution** | Orçamento total de recuperação. |
| **Maximum Retrieval Tokens / Results** | Limites por chamada. |
| **Allowed / Blocked Fields** | Política de exposição. Blocked prevalece. |
| **Allow Full Original** | Desligado por padrão; prefira busca/filtro/trecho. |

### Operações disponíveis ao Agent

`search_context`, `filter_records`, `get_exact_value`, `get_section`, `inspect_schema` e, se autorizado, `get_original`. A resposta informa Resource ID, path/trecho e se o valor é exato.

## 7. Savings Report

### O que faz

Consolida economia estimada e uso real reportado pelo provider. Inclui Agent Optimizer, Data Optimizer, Agent Handoff, Session Memory, Context Storage e overhead do Exact Lookup.

### Operações

| Operação | Função |
|---|---|
| **Current Execution** | Recomendado; agrega automaticamente a execução atual. |
| **Aggregate Items** | Soma vários outputs recebidos. |
| **Analyze Savings** | Analisa um output normalizado. |
| **Compare Current Model Calls (A/B)** | Compara wrappers baseline/otimizado da mesma execução. |
| **Compare Saved Runs** | Compara métricas carregadas de execuções diferentes. |
| **Estimate Cost** | Aplica preços informados; não chama provider. |

### Campos

| Campo | Função |
|---|---|
| **Baseline / Optimized Model Wrapper** | Nome exato dos nós no A/B. |
| **Metrics / Baseline Metrics / Optimized Metrics** | Objetos de telemetria. |
| **Input / Cached Input / Output / Reasoning Price** | Preço por 1 milhão de tokens. |
| **Currency** | Rótulo do custo. |
| **Output** | Simple mostra só decisão e números úteis; Detailed inclui diagnósticos. |

`netSavedTokens = original - enviado - compressor - verificação - recuperações`. Usage do provider não é inventado: quando ausente, aparece como estimativa.

## Configurações recomendadas

### Agente comum

```text
Agent Optimizer
Mode: Save Tokens
Profile: Balanced
Adaptive Quality Protection: On
Cache Strategy: Automatic Hybrid
```

### Muitas tools

Use Maximum Savings com seleção automática, mínimo de 8 tools, máximo de 6 e nomes críticos em Always Available. Se a intenção for ambígua, todas permanecem.

### JSON/tool output grande

Use Data Optimizer / Maximum Savings + Context Storage/Exact Lookup. Defina `Current Task`, proteja campos críticos e use Output Simple.

### Vários agentes

Use Agent Handoff. Passe fatos, decisões, pendências e Resource IDs; não repasse o transcript completo.

### Chat longo

Use Session Memory / Balanced. Envie apenas mensagens novas a Update Session; use `memoryContext` no Agent.

## Segurança e qualidade

- Nunca coloque senha/API key no prompt para “economizar”; deixe secret-like storage desligado.
- Use Redis e criptografia para múltiplos workers/usuários.
- Mantenha Scope, Session ID, Owner ID, provider, prefix/path e chave iguais entre Storage e Lookup.
- Maximum Savings sem recuperação é rebaixado automaticamente quando a perda seria irreversível.
- Compare resposta baseline/otimizada com evals antes de ativar em produção.

## Diagnóstico rápido

| Sintoma | Correção |
|---|---|
| Economia 0% | Conteúdo curto, único, ambíguo ou protegido; veja `bypassReason`. |
| Perfil rebaixado | Veja `adaptiveReasons`; conecte Exact Lookup ou remova requisito incompatível. |
| Resource not found | Confira TTL, backend, directory/prefix e Scope/Session/Owner. |
| Credencial Redis falha | Teste URL, usuário, senha, TLS `rediss://` e rede do worker. |
| Custo maior | Use Savings Report; compressor/retrieval pode superar ganho em entradas pequenas. |

## Validação local

```bash
npm run check:local
npm run benchmark:v1
```

Workflows de laboratório:

- `examples/workflows/context-saver-v1-chat-first-message.workflow.json`
- `examples/workflows/context-saver-v1-local-runtime.workflow.json`

Eles usam somente dados fictícios e não chamam provider externo.
