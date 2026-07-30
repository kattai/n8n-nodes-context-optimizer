# Token Saver — Maximum Savings com virtualização reversível

Data: 2026-07-30

## Objetivo

Transformar o perfil existente `Maximum Savings` no modo de maior economia do Token Saver, sem criar outro perfil. Para conteúdos elegíveis, o perfil deve buscar redução de 70% a 90% por virtualização reversível: o conteúdo completo fica armazenado, o modelo recebe uma visão compacta e recupera valores exatos pela `Token Saver Retriever` quando necessário.

A meta de 70% a 90% se aplica à parte elegível do contexto, como JSON, RAG, logs e resultados grandes de tools. Não é promessa universal sobre o request inteiro, porque system prompt, definições de tools, mensagens recentes e conteúdo único podem ser indispensáveis.

## Resultado esperado na interface

Os perfis continuam sendo:

1. `Maximum Quality`: máxima fidelidade; remove apenas repetição exata fora da janela protegida.
2. `Balanced (Recommended)`: compressão estrutural segura e janela recente intermediária.
3. `Maximum Savings`: virtualização reversível para conteúdo grande, com alvo de 70% a 90% no conteúdo elegível.
4. `Custom (Advanced)`: opções manuais existentes e futuras.

`Maximum Savings` mostrará uma descrição explícita: “Armazena conteúdos grandes fora do prompt e envia somente contexto relevante. Requer Token Saver Retriever para recuperação exata.”

## Contrato de economia

Nenhum perfil prometerá percentual fixo para qualquer entrada. O contrato será:

- `Maximum Quality`: garante política conservadora, não percentual.
- `Balanced`: garante compressão segura quando houver redundância, não percentual.
- `Maximum Savings`: para cada resultado elegível, tenta enviar no máximo 30% dos tokens originais. Se isso não for seguro, usa compressão estrutural ou conteúdo original e informa o motivo.

Métricas diferenciarão:

- redução do conteúdo elegível;
- redução estimada do request completo;
- tokens reais informados pelo provider;
- redução bruta e líquida após recuperações;
- alvo atingido ou motivo de não atingimento.

## Elegibilidade

Virtualização automática será usada somente quando todas as condições forem verdadeiras:

- perfil `Maximum Savings` ativo;
- mensagem pertence a um resultado válido de tool;
- conteúdo textual detectado como JSON, tool output, RAG ou logs;
- conteúdo possui pelo menos 2.000 tokens estimados;
- Store pode gravar e reler o original com SHA-256 válido;
- Retriever compatível está conectado ao mesmo AI Agent;
- escopo e diretório do Store e Retriever são iguais;
- conteúdo não é código, binário ou bloco explicitamente protegido contra virtualização.

Sem Retriever, erro de armazenamento, schema inseguro ou falha de integridade, o perfil retorna à compressão estrutural atual. Nunca elimina conteúdo único apenas para atingir percentual.

## Fluxo de execução

1. Validar sequência de tool call e tool result, preservando role, nome, call ID, result ID e ordem.
2. Extrair texto do envelope n8n/LangChain sem alterar blocos não textuais.
3. Aplicar compressão estrutural atual e medir o resultado.
4. Se economia estrutural for menor que 70% e o conteúdo for elegível, armazenar o original exato.
5. Gerar preview limitado a 10%–30% do conteúdo original, priorizando a tarefa atual.
6. Executar Quality Guard específico para virtualização.
7. Substituir somente `content` do tool result pelo recibo compacto.
8. Enviar mensagens ao provider e registrar uso real.
9. Permitir que o agente recupere registros ou campos exatos pelo Retriever.

## Seleção do preview

Seleção será determinística, sem LLM compressor por padrão.

Para JSON tabular:

- schema e quantidade de registros;
- caminhos dos registros selecionados;
- registros com maior correspondência lexical à pergunta atual e aos argumentos da tool;
- primeiro registro apenas quando não houver pista de relevância;
- limite calculado pelo orçamento de preview.

Para RAG e texto estruturado:

- chunks relevantes por termos da tarefa;
- origem e caminho de cada chunk;
- chunks vizinhos somente se couberem no orçamento.

Para logs:

- erros fatais e mensagens de erro;
- grupos repetidos com contagem;
- primeiras e últimas ocorrências relevantes.

O preview será marcado como dado não confiável. Instruções encontradas dentro do resultado da tool não substituem system prompt nem regras do agente.

## Recibo enviado ao agente

Formato mínimo:

```xml
<context-resource
  id="ctx_..."
  type="json"
  original_tokens="17000"
  preview_tokens="2400"
  record_count="60"
  exact_retrieval="required"
>
  <schema>...</schema>
  <untrusted-preview>...</untrusted-preview>
  Use retrieve_context para qualquer valor, registro ou trecho ausente.
  Nunca invente conteúdo omitido.
</context-resource>
```

O recibo contém somente IDs e metadados calculados por código. Nenhum resumo semântico vira fonte primária.

## Armazenamento e recuperação

O `Token Saver Chat Model` reutilizará `FileSystemResourceStore`, `virtualizeContext` e `Token Saver Retriever` existentes.

Configuração de `Maximum Savings`:

- `Scope`: padrão `$workflow.id`;
- `Storage Directory`: diretório local atual do Token Saver;
- `TTL`: 24 horas;
- `Minimum Content Tokens`: 2.000;
- `Target Preview`: 20%;
- `Maximum Preview`: 30%;
- `Maximum Retrieval Tokens`: controlado no Retriever.

Queue mode exige diretório compartilhado entre workers. Como armazenamento ainda não é criptografado, a interface manterá aviso para não persistir secrets de produção. Conteúdo com padrão provável de credencial não será virtualizado automaticamente sem opt-in explícito.

## Quality Guard de virtualização

Validações obrigatórias:

- SHA-256 do recurso relido igual ao original;
- recibo aponta para recurso existente no mesmo escopo;
- preview é composto somente por trechos presentes no original;
- schema, record count, IDs e caminhos foram calculados deterministicamente;
- tool call/result mantêm IDs, roles e ordem;
- Retriever recupera valor exato de uma amostra antes da chamada ao provider;
- preview não excede 30% dos tokens elegíveis;
- nenhuma transformação semanticamente reescreve números, datas, valores ou negações.

Falha segue esta ordem:

1. tentar preview mais conservador;
2. usar compressão estrutural atual;
3. usar original;
4. registrar `fallbackReason` sem interromper o agente.

## Conversas sem tool output grande

O perfil mantém comportamento atual:

- últimas 3 mensagens intactas;
- system prompt intacto;
- correções do usuário intactas;
- deduplicação aproximada somente com polaridade compatível;
- nenhum corte de mensagens únicas.

Nesse cenário, `Maximum Savings` pode ficar abaixo de 70%. A métrica deve informar `target_not_reachable_unique_context`, não forçar redução insegura.

## Telemetria

`ModelOptimizationMetrics` ganhará:

- `eligibleTokensBefore`;
- `eligibleTokensAfter`;
- `eligibleSavingsPercent`;
- `virtualizedResourceIds`;
- `retrievalRequired`;
- `targetBandReached`;
- `targetNotReachedReason`;
- `storageFallbackUsed`.

`Token Savings` continuará separando estimativa de uso real do provider. Registro de telemetria deixará de ser consumido destrutivamente na primeira comparação, permitindo comparar o mesmo baseline com vários perfis na mesma execução. Limpeza ocorrerá por TTL ou término da execução.

## Testes

### Unitários

- JSON grande atinge pelo menos 70% de redução elegível;
- preview nunca passa de 30%;
- Store preserva original byte a byte;
- Retriever devolve registro e valor exatos;
- call IDs, result IDs, roles e ordem permanecem iguais;
- ausência de Retriever aciona fallback estrutural;
- falha de Store aciona fallback estrutural;
- código, binário e secrets não são virtualizados por padrão;
- telemetria suporta múltiplas comparações do mesmo baseline.

### Integração local

- baseline versus `Maximum Savings` com Gemini 2.5 Flash;
- mesma pergunta, temperatura, tool e registros;
- 5/5 fatos exatos preservados;
- resposta igual ao baseline para golden cases;
- tokens reais do provider medidos;
- recuperação usada quando dado solicitado não estiver no preview.

### Adversariais

- prompt injection dentro de tool output;
- JSON malformado;
- datas, moedas, booleanos e negações;
- registros muito grandes;
- resultado exato maior que orçamento do Retriever;
- storage expirado ou corrompido;
- scope divergente.

## Critérios de aceitação

- redução de 70% ou mais no conteúdo elegível em pelo menos 95% dos casos estruturados do conjunto de teste;
- 100% dos blocos armazenados passam SHA-256;
- 100% dos valores exatos do golden dataset recuperáveis;
- nenhuma queda em factual accuracy contra baseline no golden dataset;
- nenhuma taxa de alucinação superior ao baseline;
- fallback para estrutural/original em 100% das falhas injetadas;
- medição do provider identificada como `provider`, estimativas como `estimated`;
- interface informa claramente quando alvo não é aplicável ou não foi atingido.

## Fora do escopo

- prometer 70%–90% para prompts pequenos ou totalmente únicos;
- resumir system prompt com LLM;
- apagar original antes do TTL;
- substituir Retriever por suposições do modelo;
- publicar pacote no npm antes dos testes internos;
- backend criptografado, Redis, PostgreSQL ou S3 nesta versão.
