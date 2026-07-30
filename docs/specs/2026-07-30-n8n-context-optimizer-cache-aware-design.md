# Cache-aware universal context optimization for n8n agents

Data: 2026-07-30  
Status: design aprovado; implementação ainda não iniciada  
Versão planejada: `0.6.0`

## 1. Objetivo

Evoluir `n8n-nodes-context-optimizer` para decidir entre preservar conteúdo cacheável e reduzir conteúdo dinâmico. O pacote continuará independente de domínio e provider: vendas, suporte, programação, documentos, bancos, APIs, RAG, logs e outros agentes usarão o mesmo motor.

Meta do `Maximum Savings`: redução mediana próxima de 80% nos tokens de conteúdo elegível, preservando fatos críticos e permitindo recuperação exata. A meta não se aplica ao prompt inteiro nem constitui promessa universal de redução financeira.

## 2. Princípios obrigatórios

1. Preservar qualidade antes de economizar.
2. Tratar cache e compressão como mecanismos complementares.
3. Nunca depender de Gemini, OpenAI, Anthropic ou outro provider específico.
4. Não armazenar conteúdo bruto no registro de estabilidade.
5. Não afirmar economia financeira quando o provider não informar cache e os preços não estiverem configurados.

## 3. Escopo

### Incluído

- Estratégia de cache configurável no `Token Saver Chat Model`.
- Classificação determinística de prefixos estáveis e conteúdo variável.
- Registro persistente de fingerprints sem conteúdo bruto.
- Telemetria de tokens normais, cacheados, reduzidos e recuperados.
- Cálculo de custo com preços configuráveis.
- Benchmark frio e quente com múltiplos domínios.
- Aprimoramento do `Maximum Savings` para virtualização reversível task-aware.

### Não incluído

- Criação de cache explícito em APIs específicas.
- Proxy de LLM ou roteamento entre modelos.
- Interceptação invisível de agentes que não usam o wrapper.
- Garantia de cache hit, redução fixa ou ausência total de alucinação.
- Armazenamento de secrets por padrão.

## 4. Arquitetura do pacote

Nenhum novo node será obrigatório.

### Token Saver Chat Model

Wrapper conectado entre qualquer Chat Model e o AI Agent. Passará a coordenar:

- segmentação da requisição;
- política de cache;
- otimização estrutural;
- virtualização reversível;
- coleta de uso real do provider;
- emissão de telemetria.

### Token Saver Content

Continua processando APIs, JSON, documentos, HTML, logs, RAG e históricos antes do agente. Também continua útil em workflows sem AI Agent.

### Token Saver Store

Continua armazenando conteúdo original para virtualização reversível, com hash, escopo, TTL e limite de tamanho.

### Token Saver Retriever

Continua conectado como AI Tool. Recupera valores, registros, campos e trechos exatos sem devolver o recurso completo por padrão.

### Token Saver Analytics

Passará a separar economia por compressão, cache e recuperação; produzirá custo líquido somente quando houver base suficiente.

## 5. Configuração pública

`Optimization Profile` e `Cache Strategy` serão independentes.

### Optimization Profile

- `maximum_quality`: transformações conservadoras e reversíveis.
- `balanced`: seleção determinística moderada e proteções rigorosas.
- `maximum_savings`: virtualização reversível e prévia task-aware agressiva.

### Cache Strategy

- `automatic_hybrid` — padrão para nodes novos. Preserva blocos estáveis e reduz blocos variáveis.
- `cache_priority` — favorece prefixos repetidos mesmo quando a redução bruta seria maior.
- `token_reduction_priority` — reduz conteúdo elegível agressivamente; preserva somente blocos obrigatórios.
- `ignore_cache_signals` — mantém comportamento orientado apenas pelo perfil de otimização.

### Opções avançadas

| Campo | Padrão | Restrição | Função |
|---|---:|---:|---|
| Minimum Repetitions | 2 | 1–100 | Repetições para considerar um fingerprint estável |
| Fingerprint TTL | 24 h | 1–720 h | Janela de observação de repetição |
| Minimum Stable Prefix | 2048 tokens | 128–1.000.000 | Evita política de cache em prefixos pequenos |
| Target Eligible Savings | 80% | 70–90% | Meta do `Maximum Savings` |
| Maximum Preview | 30% | 10–50% | Limite rígido da prévia elegível |

Configuração simples mostrará apenas `Optimization Profile` e `Cache Strategy`. Demais campos ficarão em coleção avançada com progressive disclosure. Um aviso informará que o Fingerprint Registry nunca armazena conteúdo bruto; isso não será uma opção alterável.

## 6. Compatibilidade

Nodes novos usarão `automatic_hybrid`. Workflows antigos sem o parâmetro persistido serão detectados pelo conteúdo bruto de `node.parameters` e usarão `ignore_cache_signals`, preservando comportamento de `0.5.2` até serem salvos com uma escolha explícita.

A versão do pacote será `0.6.0`. O node deverá documentar a migração sem exigir alteração imediata de workflows existentes.

## 7. Segmentação da requisição

O wrapper não resumirá a requisição inteira. Cada chamada será segmentada em:

1. instruções de sistema;
2. schemas e definições de tools;
3. histórico recente;
4. histórico antigo;
5. resultados de tools e dados externos.

Instruções, schemas, mensagem atual, correções recentes e estrutura de tool calls permanecerão em ordem original. Dados e instruções não serão misturados em um resumo único.

## 8. Classificação de estabilidade

### Sempre preservado

- system prompt;
- schemas de tools;
- mensagem atual;
- últimas mensagens configuradas;
- correções do usuário;
- blocos protegidos;
- `toolCallId`, papéis e ordem das mensagens.

### Candidato estável

Um bloco será candidato quando estiver no prefixo comum, superar o mínimo de tokens e tiver fingerprint repetido dentro do TTL. Cache real informado anteriormente pelo provider aumenta confiança, mas não é obrigatório.

### Candidato variável

- resultado de API ou banco que muda por execução;
- saída extensa de tool;
- logs;
- chunks RAG diferentes por pergunta;
- histórico antigo;
- conteúdo com baixa repetição.

Classificação incerta em `automatic_hybrid` favorece preservação. `token_reduction_priority` pode reduzir o bloco se ele passar pelo Quality Guard e continuar recuperável.

## 9. Fingerprint Registry

O registro persistirá somente:

```json
{
  "fingerprint": "sha256",
  "scope": "workflow:node:model",
  "estimatedTokens": 8200,
  "seenCount": 4,
  "firstSeenAt": "ISO-8601",
  "lastSeenAt": "ISO-8601",
  "lastProviderCachedTokens": 7900
}
```

O fingerprint será calculado com SHA-256 sobre escopo, posição e conteúdo. O armazenamento local usará arquivos atômicos independentes por fingerprint para evitar corrupção de um índice compartilhado. TTL e limite máximo removerão registros antigos. Nenhum texto, secret, embedding ou trecho original será salvo nesse registro.

Queue mode ou múltiplos workers exigirão storage compartilhado em versão posterior. Nesta versão, o node detectará `EXECUTIONS_MODE=queue` e avisará que o registry local representa somente o worker atual.

## 10. Motor de decisão

### Automatic Hybrid

1. Preserva blocos obrigatórios.
2. Preserva candidatos estáveis repetidos.
3. Reduz candidatos variáveis conforme o perfil.
4. Usa cache real de execuções anteriores como evidência adicional.
5. Em dúvida, preserva.

### Cache Priority

Preserva candidatos estáveis e conteúdo grande colocado no prefixo. Só comprime dados claramente variáveis ou quando o conteúdo não alcança o mínimo configurado.

### Token Reduction Priority

Aplica o perfil escolhido a todo conteúdo elegível depois dos blocos obrigatórios. No `Maximum Savings`, tenta virtualização reversível mesmo sem histórico de repetição.

### Ignore Cache Signals

Não consulta fingerprints nem uso cacheado. Executa comportamento do perfil, equivalente ao fluxo anterior para workflows legados.

## 11. Maximum Savings

### Pipeline

1. Compressão estrutural sem perda.
2. Validação de elegibilidade e secrets.
3. Armazenamento do original.
4. Leitura imediata e comparação de hash.
5. Verificação do Retriever no mesmo Agent e escopo.
6. Geração de prévia task-aware.
7. Quality Guard e fallback.

### Orçamento adaptativo da prévia

- JSON tabular e logs com Retriever válido: alvo de 10–20% do original.
- RAG e texto misto: alvo de 20–30%.
- Tipo incerto: `balanced` ou original.
- Limite absoluto: `Maximum Preview`, padrão de 30%.

A meta de 80% será medida apenas sobre conteúdo elegível. System prompt, schemas, mensagens recentes, código, secrets e conteúdos abaixo do threshold não entram no denominador elegível.

### Conteúdo excluído automaticamente

- código quando preservação sintática não puder ser garantida;
- binário;
- secrets ou credenciais;
- instruções críticas;
- conteúdo pequeno;
- recurso sem Store e Retriever compatíveis.

## 12. Quality Guard

Verificações determinísticas obrigatórias:

- IDs, números, valores monetários, percentuais, datas e horários;
- negações, booleanos, URLs, e-mails e nomes de campos;
- hashes de blocos protegidos;
- validade de JSON e estruturas suportadas;
- sequência, papéis e IDs de tool calls;
- integridade do recurso armazenado e recuperação exata.

Fallback:

```text
Maximum Savings falhou
        ↓
Balanced conservador
        ↓
Compressão sem perda
        ↓
Conteúdo original
```

Falha de storage, integridade, Retriever, orçamento ou classificação nunca interromperá silenciosamente o Agent. Telemetria registrará motivo e estágio do fallback.

## 13. Telemetria

`ModelOptimizationMetrics` será ampliado com:

```json
{
  "cacheStrategy": "automatic_hybrid",
  "cacheDecision": "preserve_stable_prefix",
  "stablePrefixTokens": 8200,
  "dynamicTokensBefore": 18000,
  "dynamicTokensAfter": 3600,
  "cachedInputTokens": 7900,
  "regularInputTokens": 5100,
  "retrievedTokens": 176,
  "measurementConfidence": "provider_actual"
}
```

Valores de `measurementConfidence`:

- `provider_actual`: provider informou tokens totais e cacheados.
- `provider_partial`: provider informou uso total, mas não cache.
- `optimizer_estimate`: somente estimativa local.

Chamadas múltiplas do mesmo Agent serão somadas, incluindo loops de tool e Retriever.

## 14. Custo no Token Saver Analytics

Configuração por milhão de tokens:

- regular input;
- cached input;
- output;
- reasoning, quando cobrado separadamente;
- moeda.

Fórmula:

```text
regularInput = max(0, providerInput - cachedInput)

cost =
  regularInput × regularInputPrice
  + cachedInput × cachedInputPrice
  + output × outputPrice
  + overhead do compressor/verificador/retrieval
```

Sem `cachedInputTokens`, relatório mostrará redução bruta e `cache unknown`. Sem preços, mostrará tokens, não custo. Presets serão opcionais e editáveis porque preços mudam.

## 15. Saída simples

```text
Tokens enviados: 27.745 → 10.304
Tokens cacheados: 8.200 → 7.900
Conteúdo elegível reduzido: 80,02%
Economia líquida estimada: 48,3%
Estratégia: Automatic Hybrid
Confiança: provider actual
Fallback: none
```

Saída detalhada manterá métricas, decisões, recursos e motivos de fallback em JSON.

## 16. Testes

### Unitários

- classificação estável/variável;
- fingerprints determinísticos e TTL;
- matriz de estratégias e perfis;
- cálculo com tokens cacheados;
- fallback e compatibilidade legada;
- orçamento adaptativo do `Maximum Savings`.

### Integração

- wrapper com provider falso retornando cache metadata;
- múltiplos loops de tool;
- Store e Retriever no mesmo Agent;
- reinício entre execuções mantendo fingerprints;
- ausência de cache metadata.

### Benchmarks universais

- JSON/API;
- RAG/documentos;
- logs;
- histórico de conversa;
- tool outputs mistos.

Cada domínio terá cenário frio, quente, estável e dinâmico. Benchmarks específicos de leads poderão existir como caso adicional, nunca como base da arquitetura.

## 17. Critérios de aceitação

1. Mediana próxima de 80% de redução nos tokens elegíveis do `Maximum Savings`.
2. Pelo menos 95% dos casos elegíveis acima de 70%.
3. 100% de preservação dos fatos protegidos e recuperação exata.
4. Taxa de alucinação não superior ao baseline nos datasets de avaliação.
5. Em benchmark quente repetido, `automatic_hybrid` não pode custar mais que baseline por destruir cache; falha bloqueia release.

Economia total abaixo de 70% será válida quando tokens não elegíveis, output, cache ou Retriever dominarem o custo. Relatórios deverão explicar essa diferença.

## 18. Segurança e privacidade

- Nenhum secret em fingerprints, logs ou telemetria.
- Conteúdo original somente no Store escolhido e dentro do escopo.
- Secret-like content recusado por padrão.
- Limites de tamanho, TTL e recuperação obrigatórios.
- Paths e resource IDs validados contra traversal.
- Resultados recuperados tratados como dados não confiáveis, nunca como instruções.

## 19. Entrega

Ordem de implementação:

1. tipos, fingerprint registry e motor de decisão;
2. propriedades do Chat Model e compatibilidade;
3. integração no wrapper;
4. telemetria e Analytics cache-aware;
5. benchmarks universais frios/quentes;
6. pacote `0.6.0`, instalação local e relatório final.

Implementação seguirá TDD. Cada etapa deverá manter testes existentes aprovados e produzir commit isolado no repositório privado.

## 20. Implementation TODO

- [x] Criar Fingerprint Registry persistente sem conteúdo bruto.
- [x] Criar Cache Policy Engine e matriz de estratégias.
- [x] Adicionar configuração cache-aware ao Token Saver Chat Model.
- [x] Integrar decisões ao wrapper sem alterar prefixos obrigatórios.
- [x] Ampliar telemetria e custo cache-aware.
- [x] Validar compatibilidade legada de workflows `0.5.2`.
- [x] Executar benchmarks universais frios e quentes.
- [ ] Publicar e instalar pacote `0.6.0` localmente.
