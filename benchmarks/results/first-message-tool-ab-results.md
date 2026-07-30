# Token Saver — prova real na primeira mensagem

Data: 2026-07-30

| Métrica | Baseline | Otimizado | Resultado |
|---|---:|---:|---:|
| Tokens de entrada do provider | 66080 | 30396 | 35684 economizados (54%) |
| Registros na Code Tool | 240 | 240 | mesma tool |
| Fatos exatos preservados | 5/5 | 5/5 | sim |

## Controle do teste

- Primeira mensagem, sem memória ou conversa anterior.
- Mesmo Gemini 2.5 Flash, temperatura 0, prompt e Code Tool.
- Baseline em **Measure Baseline**: nenhuma alteração na entrada.
- Otimizado em **Balanced**: somente a saída repetitiva da tool foi compactada.
- Medição real do provider, não estimativa interna.

## Evidência técnica

- Execução local: **94**.
- Pacote: **n8n-nodes-context-optimizer 0.4.2**.
- Estratégia observada: **tool_sequence_content_only**.
- Estimativa interna da segunda chamada: **49448 → 23574**.
- Uso real da segunda chamada otimizada: **30396 tokens de entrada**.

## Respostas

Baseline e otimizado devolveram exatamente:

```
Lead: LEAD-2048
Cidade: Campinas/SP
Capital: R$ 850.000,00
Reunião: 05/08/2026 14:30
Aprovado: false
```
