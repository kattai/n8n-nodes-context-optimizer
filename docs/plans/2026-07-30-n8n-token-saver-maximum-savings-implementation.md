# Token Saver — plano de implementação do Maximum Savings

Data: 2026-07-30

## Estratégia

Alteração programática porque o node intercepta chamadas LangChain, transforma envelopes de mensagens, grava recursos e aplica fallback assíncrono. Um node declarativo HTTP não cobre esse comportamento.

## 1. Contrato e testes vermelhos

- Ampliar `ModelOptimizationMetrics` com métricas de conteúdo elegível e virtualização.
- Criar testes do wrapper para JSON grande, limite de preview, preservação dos IDs e fallback.
- Criar testes adversariais para secret, falha de Store e conteúdo pequeno.
- Criar teste de telemetria com um baseline comparado a mais de um perfil.

Arquivos principais:

- `test/unit/model-wrapper.test.ts`
- `test/unit/model-telemetry-registry.test.ts`
- `test/unit/context-virtualizer.test.ts`

## 2. Virtualização automática reversível

- Criar um adaptador assíncrono de virtualização de resultados de tools.
- Armazenar o original exato com SHA-256 e reler antes de substituir o conteúdo.
- Gerar preview determinístico limitado a 20% por padrão e 30% no máximo.
- Recusar código, binário, credenciais prováveis e entradas menores que 2.000 tokens.
- Voltar para compressão estrutural atual em qualquer falha.

Arquivos principais:

- `src/model-wrapper/maximum-savings-virtualizer.ts`
- `src/model-wrapper/wrap-language-model.ts`
- `src/virtualization/context-virtualizer.ts`
- `src/storage/filesystem-store.ts`

## 3. Configuração progressiva no node

- Atualizar a descrição de `Maximum Savings`.
- Mostrar opções de Store apenas quando esse perfil estiver ativo.
- Adicionar diretório, scope, TTL, mínimo de tokens, preview alvo, preview máximo e opt-in de secrets.
- Manter defaults seguros e compatíveis com o Retriever.

Arquivos principais:

- `nodes/OptimizedChatModel/OptimizedChatModel.node.ts`
- `test/unit/node-descriptions.test.ts`
- `README.md`

## 4. Telemetria reutilizável

- Tornar leituras não destrutivas.
- Não limpar toda a execução após a primeira comparação.
- Limpar por TTL e limite de execuções.
- Expor motivo de fallback e se a banda de 70–90% foi atingida.

Arquivos principais:

- `src/analytics/model-telemetry-registry.ts`
- `nodes/TokenAnalytics/TokenAnalytics.node.ts`
- `src/output/format-node-output.ts`

## 5. Validação e empacotamento

- Rodar testes unitários focados durante cada etapa.
- Rodar `npm run check` no pacote.
- Atualizar versão e `CHANGELOG.md`.
- Empacotar e reinstalar no n8n local.
- Executar A/B com a mesma pergunta, tool e Gemini 2.5 Flash.
- Registrar tokens reais, economia elegível, recuperação exata e fatos preservados.

## Critério de conclusão

- Pelo menos 70% de redução elegível no conjunto estruturado.
- Preview nunca acima de 30%.
- Original e amostras recuperáveis exatamente.
- Fallback seguro em 100% das falhas injetadas.
- `npm run check` sem erros.
- Comparação real identifica métricas do provider separadas das estimativas.
