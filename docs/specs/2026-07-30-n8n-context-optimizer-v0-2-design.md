# n8n Context Optimizer v0.2 — compressão segura e contexto reversível

Data: 2026-07-30
Status: aprovado para detalhamento
Escopo: desenvolvimento e validação somente no n8n local

## 1. Decisões

- O pacote continuará sendo desenvolvido do zero.
- Não haverá dependência ou integração com Headroom, OmniRoute ou outro proxy.
- O foco será somente economia de tokens de entrada, preservação de qualidade e medição.
- O pacote terá cinco nós visíveis no total.
- Compressão determinística será o padrão.
- Compressão semântica será opcional, cacheada e sempre sujeita a fallback.
- O conteúdo original poderá ser armazenado e recuperado quando a virtualização estiver ativa.
- Nenhuma estratégia poderá reordenar chamadas de tools ou separar uma chamada de seu resultado.
- Falha de integridade sempre devolve o conteúdo original.

## 2. Evidência do laboratório atual

Os primeiros testes locais do Lino mostraram:

- `8,63%` de redução estimada no prompt normal;
- `7,01%` de redução estimada no prompt de Locação Protegida;
- `4,25%` de redução real nos tokens de entrada do Gemini no fluxo normal;
- `3,56%` de redução real nos tokens de entrada do Gemini no fluxo protegido;
- respostas de saudação funcionalmente idênticas;
- prompt estático como principal fonte de tokens;
- baixa economia do wrapper isolado em conversas curtas;
- falha de tool calling no laboratório com a mensagem:
  `Please ensure that function call turn comes immediately after a user turn or after a function response turn.`

A v0.2 deve primeiro corrigir e testar a ordem das mensagens de tools. Economia nunca justifica quebrar function calling.

## 3. Objetivo da v0.2

Reduzir tokens em quatro fontes diferentes:

1. prompts estáticos;
2. histórico de conversa;
3. documentos RAG e resultados de tools;
4. JSON, HTML e logs volumosos.

Metas por tipo de conteúdo:

| Conteúdo | Meta inicial | Observação |
|---|---:|---|
| Prompt estático | 10%–25% | Sem remover regra de negócio |
| Histórico longo | 30%–70% | Últimas mensagens intactas |
| JSON tabular | 50%–90% | Original recuperável |
| Logs repetitivos | 50%–95% | Erros fatais preservados |
| HTML | 40%–80% | Conteúdo principal e links preservados |
| Conversa curta | 0%–10% | Não forçar compressão insegura |

A meta do produto será economia líquida média de `20%–50%` em workloads adequados. O pacote não prometerá redução fixa para toda chamada.

## 4. Cinco nós visíveis

### 4.1 Context Optimizer

Nó principal já existente. Terá três operações:

#### `Build Agent Context`

Evolução do comportamento atual:

- otimiza system prompt, histórico, RAG e definições de tools separadamente;
- preserva a mensagem atual;
- mantém mensagens recentes completas;
- devolve contexto combinado e campos individuais;
- executa Quality Guard;
- pode criar referências para conteúdos virtualizados.

#### `Compile Static Prompt`

Compila prompts que mudam pouco:

- usa SHA-256 do prompt e das configurações como chave;
- reaproveita resultado cacheado;
- remove duplicação exata e formatação redundante;
- consolida instruções semanticamente somente quando um Compression Model estiver conectado e essa opção estiver ativa;
- preserva tool names, parâmetros, respostas exatas, números, datas, negações, regras marcadas e blocos protegidos;
- registra relatório de cobertura;
- devolve original quando a cobertura falhar.

O prompt compilado não será reprocessado em toda conversa quando o hash não mudar.

#### `Optimize Content`

Otimiza um conteúdo independente:

- auto detecta `text`, `json`, `logs`, `html`, `rag`, `tool_output` ou `code`;
- aceita orçamento máximo;
- aceita campos incluídos, excluídos e protegidos;
- pode armazenar o original;
- devolve conteúdo compacto, `resourceId`, manifesto e métricas.

### 4.2 Optimized Chat Model

Subnó já existente entre AI Agent e modelo.

Responsabilidades:

- preservar objetos `BaseMessage` e metadados do LangChain;
- validar sequência antes e depois da otimização;
- nunca remover ou reordenar `system`, `tool`, `function`, `tool_call` ou `tool_result`;
- manter chamada e resultado como unidade indivisível;
- aplicar redução somente onde a estrutura permitir;
- encaminhar `invoke`, `batch`, `stream`, `generate` e `bindTools`;
- registrar usage real do provedor;
- fazer fallback para mensagens originais quando a sequência resultante for inválida.

Primeiro critério da v0.2: tool calling precisa funcionar no Gemini antes de adicionar compressão avançada ao wrapper.

### 4.3 Context Store

Armazena conteúdo original para recuperação posterior.

Operações:

- `Store Resource`;
- `Inspect Resource`;
- `Delete Resource`;
- `Purge Expired Resources`.

Contrato mínimo:

```json
{
  "resourceId": "ctx_4f91a6c2",
  "contentType": "json",
  "originalHash": "sha256:...",
  "originalTokens": 42870,
  "createdAt": "2026-07-30T12:00:00-03:00",
  "expiresAt": "2026-07-31T12:00:00-03:00",
  "fields": ["id", "customer", "status"],
  "recordCount": 15820
}
```

Primeiro backend:

- filesystem local dentro do diretório configurado do n8n;
- conteúdo comprimido com gzip;
- manifesto JSON separado;
- gravação atômica;
- TTL padrão de 24 horas;
- limite de tamanho configurável;
- armazenamento somente quando explicitamente ativado.

A interface interna de armazenamento deve permitir Redis ou PostgreSQL em versão futura sem alterar contratos dos nós.

### 4.4 Context Retriever Tool

Tool conectada à entrada `ai_tool` do AI Agent.

Operações expostas ao modelo:

- `search_context`;
- `filter_records`;
- `get_exact_value`;
- `get_section`;
- `inspect_schema`;
- `get_original_fragment`.

Limites:

- máximo de resultados;
- máximo de tokens por recuperação;
- máximo de chamadas por execução;
- campos permitidos e bloqueados;
- acesso ao original completo desativado por padrão;
- motivo obrigatório para recuperação completa.

Cada resposta terá evidência:

```json
{
  "resourceId": "ctx_4f91a6c2",
  "exact": true,
  "path": "orders[28].total",
  "value": 12850
}
```

O agente receberá instrução curta: quando um valor exato não estiver no contexto compacto, deve usar a tool em vez de inferir.

### 4.5 Token Analytics

Agrega métricas recebidas dos outros nós.

Operações:

- `Analyze Item`;
- `Compare Runs`;
- `Aggregate Batch`;
- `Estimate Cost`.

Métricas:

- tokens originais;
- tokens enviados;
- tokens do compressor;
- tokens recuperados;
- tokens de saída;
- cache do provedor;
- economia bruta;
- economia líquida;
- latência;
- quantidade de fallbacks;
- falhas do Quality Guard;
- taxa de recuperação;
- perfil e estratégias usadas.

Fórmula:

```text
economia líquida =
tokens originais
- tokens enviados
- tokens do compressor
- tokens recuperados
- tokens do verificador
```

A v0.2 agregará dados fornecidos no fluxo. Leitura global do banco interno do n8n ficará fora do escopo.

## 5. Pipeline de otimização

1. Detectar o tipo de conteúdo.
2. Extrair blocos e fatos protegidos.
3. Estimar tokens.
4. Aplicar limpeza sem perda.
5. Aplicar compressor específico do tipo.
6. Medir a redução.
7. Aplicar seleção lexical quando permitido.
8. Virtualizar conteúdo excedente quando Store estiver ativo.
9. Usar Compression Model somente quando autorizado e necessário.
10. Executar Quality Guard.
11. Retornar otimizado ou original.
12. Emitir métricas sem persistir o prompt completo.

## 6. Compressores

### 6.1 Texto e prompts

- normalização de quebras e espaços;
- remoção de parágrafos exatamente duplicados;
- compactação de listas repetidas;
- remoção de cabeçalhos decorativos;
- preservação de palavras de negação e obrigação;
- blocos entre `<context-optimizer-protected>` preservados byte a byte.

Deduplicação semântica de regras ficará desligada nos perfis `Safe` e `Maximum Fidelity`.

### 6.2 JSON

- minificação;
- remoção opcional de `null` e strings vazias;
- seleção de campos;
- arrays de objetos convertidos em tabela;
- schema compartilhado;
- dicionário para valores repetidos;
- máximo de linhas no prompt;
- linhas restantes armazenadas no recurso original.

Transformações tabulares terão escape explícito e contagem de registros.

### 6.3 Logs

- remoção de ANSI;
- agrupamento de linhas idênticas;
- agrupamento por assinatura;
- preservação da primeira e última ocorrência;
- preservação exata de `ERROR`, `FATAL` e causa raiz;
- remoção opcional de timestamps e health checks.

### 6.4 HTML

- remoção de `script`, `style`, comentários, navegação e rodapé;
- extração de conteúdo visível;
- preservação de títulos, tabelas e links;
- registro da URL de origem quando fornecida.

### 6.5 RAG e tool outputs

- divisão em chunks;
- deduplicação exata;
- ranking lexical pela mensagem atual;
- preservação de chunks vizinhos;
- recibo estruturado do resultado;
- fatos exatos separados de resumo;
- original recuperável por `resourceId`.

### 6.6 Código

Na v0.2:

- código será tratado em modo conservador;
- imports, exports, assinaturas, tipos e mensagens de erro serão protegidos;
- nenhum resumo semântico será aplicado por padrão;
- AST multi-linguagem ficará para versão futura.

## 7. Quality Guard

Verificações determinísticas:

- hashes de blocos protegidos;
- IDs;
- números;
- valores monetários;
- percentuais;
- datas e horários;
- URLs;
- e-mails;
- telefones;
- negações;
- nomes de tools;
- parâmetros obrigatórios;
- quantidade de registros;
- validade de JSON;
- sequência de tool calls e results.

Níveis:

- `Fast`;
- `Strict`;
- `Critical`;
- `Custom`.

Comportamento padrão:

```text
Retry Conservatively
→ Lossless Only
→ Return Original
```

O resultado sempre informará `qualityPassed`, `fallbackUsed` e os motivos.

## 8. Perfis

### `Maximum Fidelity`

- somente transformações determinísticas reversíveis;
- armazenamento opcional;
- Quality Guard Critical;
- sem Compression Model.

### `Safe`

- Maximum Fidelity;
- seleção de campos e relevância lexical conservadora;
- últimas 10 mensagens completas;
- original recuperável.

### `Balanced`

- perfil padrão;
- últimas 6 mensagens completas;
- virtualização de conteúdo grande;
- Compression Model opcional e cacheado;
- Quality Guard Strict.

### `Aggressive`

- últimas 3 mensagens completas;
- ranking e orçamento rígidos;
- resumo semântico permitido;
- original e Retriever obrigatórios;
- Quality Guard Critical.

### `Custom`

Expõe todas as estratégias, orçamentos, proteção, armazenamento, recuperação e fallback.

## 9. Cache

Chave:

```text
SHA-256(
  conteúdo original
  + operação
  + perfil
  + configurações
  + tarefa atual quando relevante
)
```

O cache armazenará:

- prompt compilado;
- resumo semântico;
- índice lexical;
- manifesto do recurso;
- métricas de criação.

Mudança no prompt, nas regras protegidas ou nas configurações invalida o cache.

## 10. Segurança e privacidade

- armazenamento desativado por padrão fora de operações de virtualização;
- nenhuma credencial será registrada;
- telemetria não conterá prompt, histórico ou resposta completa;
- nomes de arquivo serão derivados de hashes, não de conteúdo;
- caminho final será validado para permanecer dentro do diretório do pacote;
- TTL será aplicado na leitura e na limpeza;
- recursos expirados não poderão ser recuperados;
- limites evitarão gravação ou recuperação ilimitada.

Criptografia em repouso, Redis, PostgreSQL, S3 e operação distribuída ficarão para versões posteriores.

## 11. Tratamento de erros

| Falha | Comportamento |
|---|---|
| Compressor local | Retornar original |
| Compression Model | Usar resultado determinístico |
| Quality Guard | Repetir conservador; depois original |
| Context Store | Continuar sem virtualização quando orçamento permitir |
| Retriever | Erro estruturado sem inventar dado |
| Recurso expirado | Informar expiração |
| Sequência de tools inválida | Encaminhar mensagens originais |
| Telemetria | Não interromper chamada do modelo |

## 12. Testes

### 12.1 Unitários

- detecção de conteúdo;
- JSON tabular e escape;
- compressão de logs;
- limpeza de HTML;
- cache e hash;
- TTL;
- storage traversal;
- protected facts;
- Quality Guard;
- recuperação exata;
- limites de recuperação;
- sequência Gemini de tool calls.

### 12.2 Integração

- cada um dos cinco nós no n8n local;
- Gemini com tools;
- invoke, batch e stream;
- Context Store seguido de Retriever Tool;
- falha de storage;
- falha de Compression Model;
- fallback original;
- telemetria real.

### 12.3 Evals

Conjunto baseline versus otimizado:

- saudação;
- consulta com tool;
- conversa longa;
- troca de decisão;
- números e datas;
- JSON grande;
- logs repetidos;
- RAG com fato exato;
- solicitação que exige recuperação;
- tentativa de recuperar campo bloqueado.

Critérios:

- `100%` de fatos protegidos preservados;
- `100%` de sequências de tools válidas;
- nenhuma regressão funcional causada pela compressão;
- qualidade mínima de `95%` na rubrica;
- economia líquida positiva para aplicar resultado;
- fallback correto em toda falha injetada.

## 13. Ordem de implementação

1. Corrigir tool calling e fortalecer testes do Optimized Chat Model.
2. Adicionar operações `Compile Static Prompt` e `Optimize Content`.
3. Implementar compressores e Quality Guard ampliado.
4. Implementar Context Store e Context Retriever Tool.
5. Implementar Token Analytics, cache e evals.
6. Criar nova cópia Lino v0.2 e comparar com baseline.

## 14. Fora do escopo

- roteamento de modelos;
- escolha automática de provedor;
- gateway OpenAI-compatible;
- billing;
- dashboard web;
- leitura global do banco interno do n8n;
- publicação no npm;
- instalação na instância corporativa;
- interceptação automática de todos os workflows;
- garantia de zero alucinação;
- AST completo para várias linguagens;
- armazenamento distribuído.

## 15. Critério de liberação local

A v0.2 estará pronta para teste do time quando:

- os cinco nós carregarem no n8n local;
- tool calling funcionar com Gemini;
- todos os testes automatizados passarem;
- Context Store e Retriever operarem com TTL;
- nenhum fato protegido for perdido;
- o Lino mantiver qualidade mínima de `95%`;
- relatório mostrar economia líquida por cenário;
- workflow corporativo permanecer intocado.
