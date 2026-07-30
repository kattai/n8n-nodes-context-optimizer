# n8n Context Optimizer — desenho do community node

Data: 2026-07-29  
Status: aprovado para planejamento  
Escopo inicial: desenvolvimento e testes exclusivamente locais

## 1. Objetivo

Criar um pacote de community nodes para reduzir o consumo de tokens de agentes n8n sem degradar de forma relevante a qualidade, a continuidade da conversa ou a precisão das tools.

O primeiro caso de teste será o workflow local do Lino. O resultado esperado no perfil Equilibrado é:

- redução média entre 40% e 60% dos tokens;
- qualidade mínima de 95% em relação ao baseline;
- preservação integral de valores, datas, IDs, decisões, pendências e chamadas de tools;
- fallback para o contexto original quando a otimização não for segura.

O pacote não será publicado no npm durante esta fase.

## 2. Pacote e componentes

Nome de trabalho do pacote:

`n8n-nodes-context-optimizer`

O pacote terá dois nós visíveis e um motor interno compartilhado.

### 2.1 Context Optimizer

Nó de fluxo normal, instalado antes do AI Agent.

Responsabilidades:

- receber as partes do contexto explicitamente;
- normalizar formatos;
- eliminar duplicações;
- identificar fatos protegidos;
- compactar histórico e conteúdo recuperado;
- validar o resultado;
- devolver campos separados, contexto combinado e métricas.

Esse modo exige que o AI Agent utilize por expressão os campos produzidos pelo nó. No teste completo do Lino, o prompt, o histórico e o RAG deixarão de ser inseridos diretamente por outros componentes e passarão pelo otimizador.

### 2.2 Optimized Chat Model

Subnó de modelo conectado entre o AI Agent e o modelo original.

Responsabilidades:

- envolver o chat model existente;
- interceptar mensagens e opções antes da chamada;
- aplicar a mesma política de otimização;
- encaminhar a solicitação ao modelo original;
- preservar streaming e metadados de uso quando suportados;
- registrar a contagem real informada pelo provedor.

Esse modo busca permitir adoção com menos alterações nos workflows existentes.

### 2.3 Motor compartilhado

Biblioteca interna usada pelos dois nós.

Módulos previstos:

- normalização e serialização;
- estimativa de tokens;
- identificação de fatos e trechos protegidos;
- deduplicação exata e aproximada;
- classificação de relevância e validade;
- compactação determinística;
- resumo opcional por LLM;
- validação de invariantes;
- telemetria e explicação das decisões.

Os nós não terão implementações divergentes das regras de compactação.

## 3. Contrato do Context Optimizer

### 3.1 Entradas

| Campo | Tipo | Obrigatório | Função |
|---|---|---:|---|
| `systemPrompt` | string | não | Instruções permanentes do agente |
| `conversationHistory` | string, array ou objeto | não | Histórico anterior à mensagem atual |
| `retrievedContext` | string, array ou objeto | não | RAG, consultas e documentos recuperados |
| `toolDefinitions` | string, array ou objeto | não | Nomes, descrições e esquemas de tools |
| `currentMessage` | string | sim | Mensagem atual, sempre preservada integralmente |
| `protectedValues` | string ou array | não | Valores adicionais que não podem ser alterados |

Pelo menos um campo além de `currentMessage` deve conter contexto para a execução produzir economia.

### 3.2 Saídas

| Campo | Função |
|---|---|
| `optimizedSystemPrompt` | Prompt processado |
| `optimizedHistory` | Histórico processado |
| `optimizedRetrievedContext` | RAG e contexto processados |
| `optimizedToolDefinitions` | Tools processadas sem alteração de nomes ou esquema |
| `currentMessage` | Mensagem atual sem alterações |
| `optimizedContext` | Representação combinada pronta para uso |
| `optimization` | Métricas, estratégia, alertas e fallback |

O objeto `optimization` conterá:

- `profile`;
- `strategy`;
- `tokensBefore`;
- `tokensAfter`;
- `tokensAreEstimated`;
- `savingsTokens`;
- `savingsPercent`;
- `summaryModelUsed`;
- `protectedFactsCount`;
- `warnings`;
- `fallback`;
- `fallbackReason`;
- tempos por etapa.

## 4. Perfis

### 4.1 Seguro

- remove duplicações e conteúdo reconhecidamente expirado;
- mantém as 10 últimas interações completas;
- prioriza compactação determinística;
- meta indicativa de economia: 20% a 35%.

### 4.2 Equilibrado

- perfil padrão;
- resume histórico antigo;
- reduz RAG repetido;
- mantém as 6 últimas interações completas;
- usa o resumidor somente acima do limite configurado;
- meta de economia: 40% a 60%.

### 4.3 Agressivo

- transforma histórico antigo em estado estruturado;
- mantém as 3 últimas interações completas;
- aplica orçamento de tokens menor;
- exige validação de invariantes mais rígida;
- meta indicativa de economia: 60% a 75%.

### 4.4 Personalizado

Controles:

- orçamento máximo de tokens;
- limite para ativação do resumidor;
- quantidade de interações completas preservadas;
- campos, termos e valores protegidos;
- regras de expiração;
- deduplicação aproximada;
- redução de descrições de tools;
- timeout do resumidor;
- comportamento de fallback;
- telemetria e diagnóstico.

## 5. Pipeline de otimização

1. Normalizar os campos sem perder a estrutura de origem.
2. Extrair fatos protegidos e invariantes.
3. Separar conteúdo recente, permanente, temporário e expirado.
4. Remover duplicações exatas e aproximadas.
5. Aplicar compactação determinística.
6. Medir o contexto resultante.
7. Se o limite for ultrapassado, chamar o modelo resumidor.
8. Validar o resultado contra os fatos e invariantes.
9. Retornar o contexto otimizado ou executar fallback.

O resumidor nunca será chamado quando a etapa determinística já atingir o orçamento configurado.

## 6. Conteúdo protegido

O motor preservará:

- mensagem atual;
- instruções críticas marcadas;
- nomes de tools e parâmetros obrigatórios;
- IDs e chaves de correlação;
- números, valores monetários e quantidades;
- datas, horários e prazos;
- cidade, loja, equipamento e demais entidades operacionais;
- decisões confirmadas pelo usuário;
- objeções ainda não resolvidas;
- pendências e compromissos futuros;
- resultados de tools ainda válidos;
- estado de carrinho, orçamento e transferência.

As tools podem ter descrições reduzidas, mas seus nomes, tipos e esquemas não podem ser alterados.

## 7. Estratégia híbrida

### 7.1 Etapa local

A etapa local será sempre executada e não realizará chamadas externas.

Técnicas:

- remoção de repetições;
- normalização de espaços e estruturas;
- agrupamento de mensagens equivalentes;
- remoção de confirmações sem valor futuro;
- substituição de histórico antigo por estado estruturado;
- filtragem de resultados de tools expirados;
- consolidação de trechos RAG duplicados.

### 7.2 Resumo por LLM

O modelo resumidor será uma conexão configurável e separada do modelo principal.

O pedido de resumo conterá:

- conteúdo elegível;
- esquema obrigatório de saída;
- lista de fatos protegidos;
- limite de tokens;
- proibição de inferir ou criar fatos;
- pedido para registrar incertezas.

Ausência do modelo resumidor não impede o funcionamento. Nesse caso, o nó utiliza somente a etapa local.

## 8. Validação e fallback

Depois da compactação, o validador compara o resultado com os invariantes extraídos.

Motivos de fallback:

- valor protegido ausente ou alterado;
- data, quantidade ou ID alterado;
- nome ou esquema de tool incompatível;
- JSON inválido;
- resumo vazio;
- timeout;
- erro do modelo;
- economia insuficiente quando o resultado acrescenta risco;
- limite de redução excedido;
- erro interno.

Comportamento padrão: `fail open`.

Em `fail open`, o nó devolve o contexto original, marca `fallback: true` e registra o motivo. O AI Agent continua funcionando.

## 9. Contagem e telemetria

### 9.1 Context Optimizer

Como o nó executa antes do provedor, a contagem será estimada e marcada com `tokensAreEstimated: true`.

### 9.2 Optimized Chat Model

Quando o provedor retornar metadados de uso, o nó registrará a contagem real. A estimativa será mantida para comparação e diagnóstico.

### 9.3 Privacidade

Padrão:

- registrar métricas;
- não persistir o texto completo;
- não persistir credenciais;
- não persistir prompts ou respostas do usuário.

Diagnóstico local opcional:

- registro de conteúdo habilitado explicitamente;
- indicação visual de que o modo está ativo;
- arquivo local separado;
- possibilidade de desativação sem alterar o workflow.

## 10. Integração local

O pacote ficará dentro deste workspace e será construído em TypeScript.

Fluxo previsto:

1. criar o pacote com a estrutura oficial de community nodes;
2. compilar para JavaScript;
3. instalar por link local no ambiente do n8n;
4. iniciar o n8n apontando para a extensão local;
5. criar workflows mínimos para os dois nós;
6. criar uma cópia otimizada do Lino;
7. manter o workflow baseline separado e inalterado.

Não haverá publicação no npm nem instalação na instância corporativa durante esta fase.

## 11. Caso de teste Lino

Serão mantidas duas variantes locais:

- `Lino Baseline`: versão de referência já medida;
- `Lino Otimizado`: mesma lógica funcional com Context Optimizer.

No Lino Otimizado:

- o prompt será fornecido ao otimizador;
- o histórico será fornecido explicitamente;
- o RAG será fornecido explicitamente;
- a mensagem atual permanecerá integral;
- a memória original do AI Agent ficará fora desse teste;
- o agente usará por expressão os campos otimizados.

O Optimized Chat Model será validado primeiro em um workflow mínimo e, depois, em uma segunda variante do Lino.

## 12. Plano de testes

### 12.1 Testes unitários

- normalização de strings, arrays e objetos;
- deduplicação;
- extração de fatos protegidos;
- preservação de valores e datas;
- cálculo de métricas;
- limites dos quatro perfis;
- timeout e fallback;
- validação do resumo.

### 12.2 Testes de integração

- Context Optimizer sem resumidor;
- Context Optimizer com resumidor;
- Optimized Chat Model com Gemini;
- streaming quando suportado;
- metadados de uso;
- entradas vazias e grandes;
- falha do modelo resumidor;
- falha do modelo principal.

### 12.3 Testes do Lino

Cenários:

- saudação e descoberta de necessidade;
- consulta de equipamento;
- consulta de horário;
- consulta de estoque;
- RAG de nomes populares;
- cálculo de andaime;
- cálculo de deslocamento;
- carrinho;
- orçamento;
- transferência;
- Locação Protegida;
- guardrails;
- conversa longa com mudança de decisão.

Cada cenário será executado no baseline e na variante otimizada com as mesmas entradas.

## 13. Avaliação

Métricas:

- tokens de entrada;
- tokens de saída;
- tokens em cache;
- chamadas ao modelo;
- chamadas ao resumidor;
- latência;
- economia absoluta e percentual;
- preservação de fatos;
- acerto de tool e parâmetros;
- qualidade da resposta;
- ocorrência de fallback.

A qualidade será avaliada por:

- asserções determinísticas;
- comparação de fatos;
- comparação de tools;
- rubrica de resposta;
- avaliação humana nos casos limítrofes.

Critérios de aprovação do perfil Equilibrado:

- economia média entre 40% e 60%;
- qualidade mínima de 95%;
- nenhuma alteração de valor, data, ID ou decisão;
- nenhuma chamada incorreta de tool causada pela compactação;
- agente funcional quando o otimizador falha.

## 14. Limites da primeira versão

Fora do escopo:

- publicação pública;
- instalação na instância corporativa;
- painel web externo;
- cobrança ou licenciamento;
- banco de dados central;
- treinamento de modelo próprio;
- otimização automática de todos os workflows da conta;
- alteração de credenciais;
- suporte garantido a todos os provedores desde o primeiro build.

O primeiro provedor validado será Gemini. A arquitetura não deve bloquear outros provedores.

## 15. Entregáveis

- pacote local `n8n-nodes-context-optimizer`;
- nós Context Optimizer e Optimized Chat Model;
- motor compartilhado;
- testes unitários e de integração;
- workflow mínimo de demonstração;
- variante otimizada do Lino;
- relatório baseline versus otimizado;
- instruções de instalação e remoção local.
