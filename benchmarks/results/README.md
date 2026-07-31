# Benchmarks do Context Saver

## Resultado atual — 0.8.0

- [Memória e lazy tools](memory-tools-v0.8.0.md): histórico crescente e 24 schemas de ferramentas.
- Redução estimada: **92,27%** na memória enviada e **83,21%** nos schemas enviados.
- Integridade definida pelo benchmark: **100%**; originais e fatos substituídos continuam recuperáveis.
- Comando reproduzível: `npm run benchmark:v0.8`.

As porcentagens descrevem o corpus determinístico. Baixa confiança, Quality, Cache Priority e structured output ambíguo mantêm todas as tools.

## Resultado anterior — 0.7.0

- [Perfis v2](profile-v2-results.md): 12 casos determinísticos por perfil em JSON/API, RAG e logs.
- Medianas no conteúdo elegível: **Quality 25,11%**, **Balanced 59,73%**, **Savings 80,33%**.
- Integridade: fatos, JSON round-trip, recuperação exata e tool IDs em **100%**.
- Comando reproduzível: `npm run benchmark:profiles`.

As porcentagens descrevem o corpus elegível, não garantem economia fixa na requisição completa.

# Comparação local — agente com prompt de 12K

## Resultado atual — 0.6.0

- [Benchmark cache-aware universal](cache-aware-v0.6.0.md): 20 casos de JSON/API, RAG, logs, histórico e tools mistas; inclui matriz fria/quente das quatro estratégias.
- [Prova de instalação local](local-install-v0.6.0.md): n8n `2.18.5`, cinco nodes carregados, workflow importado e runtime smoke concluído.
- Comando reproduzível: `npm run benchmark:cache`.

Os números de cache do benchmark `0.6.0` são modelados e identificados como tal. Resultados provider-billed exigem execução A/B no workflow sanitizado `examples/workflows/chat-history-ab.workflow.json`.

## Resultado anterior — agente 12K

Dois workflows usam a mesma pergunta, o mesmo prompt e o mesmo Gemini 2.5 Flash.

## Resultado medido

| Variante | Tokens reais de entrada | Tokens de saída | Total reportado |
|---|---:|---:|---:|
| Baseline | 12.332 | 28 | 12.360 |
| Otimizado | 384 | 28 | 412 |

- Economia real de entrada: **11.948 tokens (96,89%)**
- Qualidade neste teste: **resposta idêntica**
- Estimativa do Context Optimizer: **12.002 → 337 tokens (97,19%)**
- Execuções verificadas no tarball final da v0.3.0: **60 (baseline)** e **61 (otimizado)**

## Eficiência por tipo de conteúdo

| Caso determinístico | Antes | Depois | Redução |
|---|---:|---:|---:|
| Texto repetido | 1.167 | 20 | 98,29% |
| JSON tabular | 6.884 | 3.348 | 51,37% |
| Logs repetidos | 2.717 | 20 | 99,26% |
| Texto único | 10 | 10 | 0% — fallback |
| Código/YAML | 17 | 17 | 0% — preservado |

Isso evita uma conclusão falsa: a ferramenta é muito eficiente em repetição, JSON e logs; ela não tenta “economizar” texto único ou código quando isso aumentaria o risco.

## Fluxos

- `[LAB LOCAL] Agente 12K — Baseline`
- `[LAB LOCAL] Agente 12K — Otimizado`

Abra `http://localhost:5678`, entre no workflow e use o chat incorporado.

Pergunta de controle:

```text
Qual é o código de validação e qual regra de segurança você deve seguir?
```

Resposta esperada:

```text
Código: CDC-EXP-2026
Segurança: Nunca expor credenciais, tokens, senhas ou dados pessoais.
```

## Como usar os nós

Fluxo principal:

```text
Chat Trigger
  → Context Optimizer (Compile Static Prompt)
  → Token Analytics
  → AI Agent
  → Resposta
```

Conexão do modelo:

```text
Gemini Chat Model
  → Optimized Chat Model
  → AI Agent
```

O `Context Optimizer` entrega `optimizedPrompt`. Use essa propriedade como `System Message` do AI Agent. O `Token Analytics` não altera a resposta; ele expõe as métricas antes/depois.

## Repetir a medição

Depois de conversar uma vez em cada workflow:

```powershell
node .\scripts\report-12k-token-comparison.mjs
```

Este é um teste de estresse sintético com 59 cópias exatas de uma política. Ele demonstra a deduplicação máxima. Prompts reais terão economia proporcional à repetição, formatação e contexto descartável presentes.
