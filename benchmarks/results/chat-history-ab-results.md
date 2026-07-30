# Chat A/B — resultado real com histórico de mensagens

Data: 2026-07-30

| Cenário | Baseline input | Otimizado input | Economia do turno | Fatos preservados |
|---|---:|---:|---:|---|
| Mensagens repetidas | 941 | 351 | 590 (62.7%) | sim |
| Mensagens únicas | 320 | 304 | 16 (5%) | sim |

## Evidência

- Gemini 2.5 Flash em ambos os agentes.
- Temperatura 0 e prompt curto idêntico.
- Histórico criado por mensagens enviadas ao Chat Trigger.
- Uso obtido de `providerUsage`, com base `provider-actual`.
- Cenário repetitivo: execution **75**, mensagens **16 → 6**.
- Cenário único: execution **83**, mensagens **14 → 11**.

## Conclusão

O node economizou fortemente quando havia mensagens repetidas e permaneceu conservador no controle com mensagens únicas. As respostas finais foram equivalentes e todos os fatos do roteiro foram preservados nos dois cenários.
