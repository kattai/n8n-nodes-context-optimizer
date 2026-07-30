# n8n Context Optimizer — plano de implementação local

Data: 2026-07-29  
Especificação: `docs/specs/2026-07-29-n8n-context-optimizer-design.md`

## Objetivo

Entregar e validar localmente o pacote `n8n-nodes-context-optimizer`, com:

- nó normal `Context Optimizer`;
- subnó `Optimized Chat Model`;
- motor compartilhado;
- quatro perfis;
- compactação determinística e resumo opcional;
- validação com fallback;
- testes automatizados;
- instalação no n8n local;
- comparação inicial com o baseline do Lino.

## Princípios de execução

- Não publicar o pacote.
- Não alterar a instância corporativa.
- Não alterar o workflow baseline do Lino.
- Implementar com testes antes de cada unidade funcional.
- Preservar item linking no nó normal.
- Tratar o proxy de chat model como risco técnico antecipado.
- Interromper a integração do proxy se a API instalada do n8n não permitir preservar o contrato do modelo.

## Estrutura prevista

```text
packages/n8n-nodes-context-optimizer/
├── nodes/
│   ├── ContextOptimizer/
│   │   ├── ContextOptimizer.node.ts
│   │   └── context-optimizer.svg
│   └── OptimizedChatModel/
│       ├── OptimizedChatModel.node.ts
│       └── optimized-chat-model.svg
├── src/
│   └── core/
│       ├── types.ts
│       ├── profiles.ts
│       ├── normalize.ts
│       ├── token-estimator.ts
│       ├── protected-facts.ts
│       ├── deduplicate.ts
│       ├── deterministic-compressor.ts
│       ├── summary-compressor.ts
│       ├── invariant-validator.ts
│       ├── telemetry.ts
│       └── optimizer.ts
├── test/
│   ├── fixtures/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

O scaffold oficial pode ajustar nomes de arquivos de configuração. A estrutura gerada pelo tooling oficial prevalece.

## Fase 1 — scaffold e compatibilidade

### Tarefa 1.1 — registrar ambiente

Verificar:

- Node.js;
- npm;
- n8n local;
- versão de `n8n-workflow`;
- versão dos pacotes LangChain usados pelo n8n;
- comando oficial atual para scaffold;
- comando oficial atual para desenvolvimento local.

Aceite:

- versões registradas no README;
- pacote compila vazio;
- lint oficial executa.

### Tarefa 1.2 — criar scaffold

Criar o pacote com o gerador oficial atual de community nodes.

Configurar:

- nome do pacote;
- licença interna durante o laboratório;
- versão inicial `0.1.0`;
- dois nós exportados;
- nenhum credential type próprio.

Aceite:

- `npm install`;
- `npm run build`;
- `npm run lint`;
- pacote carregável pelo n8n local.

### Tarefa 1.3 — spike do proxy

Antes do motor completo, criar um wrapper mínimo que:

- receba um `ai_languageModel`;
- devolva um `ai_languageModel`;
- encaminhe `invoke`;
- encaminhe `stream`, quando disponível;
- preserve opções, callbacks e usage metadata.

Investigar dois modelos conectados:

- modelo principal;
- modelo resumidor opcional.

Aceite:

- workflow mínimo responde igual com e sem wrapper;
- nenhuma perda de mensagem, tool binding ou metadado;
- limitação encontrada é documentada antes de continuar.

## Fase 2 — contrato e motor determinístico

### Tarefa 2.1 — tipos e perfis

Criar tipos para:

- entrada;
- saída;
- mensagem normalizada;
- fato protegido;
- métricas;
- aviso;
- motivo de fallback;
- configuração resolvida.

Criar os perfis:

- Seguro;
- Equilibrado;
- Agressivo;
- Personalizado.

Testes:

- defaults corretos;
- perfil personalizado sobrescreve somente campos informados;
- limites inválidos são rejeitados.

### Tarefa 2.2 — normalização

Aceitar:

- string;
- array;
- objeto;
- histórico no formato de mensagens;
- campos vazios.

Preservar:

- ordem;
- papéis;
- origem;
- estrutura suficiente para reconstrução.

Testes:

- round-trip básico;
- Unicode e português;
- JSON válido e inválido;
- múltiplos itens n8n.

### Tarefa 2.3 — contagem estimada

Implementar estimador local desacoplado do provedor.

Requisitos:

- não realizar chamada externa;
- marcar resultado como estimado;
- contar antes e depois com o mesmo método;
- permitir troca futura do estimador.

Testes:

- string vazia;
- português;
- JSON;
- mensagens longas;
- resultado sempre não negativo.

### Tarefa 2.4 — fatos protegidos

Extrair:

- IDs;
- datas;
- horários;
- valores monetários;
- percentuais;
- quantidades;
- URLs;
- e-mails e telefones;
- nomes de tools;
- valores fornecidos em `protectedValues`;
- decisões e pendências estruturadas.

Testes:

- formatos brasileiros;
- números decimais;
- datas textuais;
- IDs alfanuméricos;
- duplicações;
- falsos positivos conhecidos.

### Tarefa 2.5 — deduplicação e validade

Implementar:

- duplicação exata;
- duplicação normalizada;
- repetição aproximada opcional;
- agrupamento de confirmações;
- expiração somente quando comprovável.

Testes:

- conteúdo recente nunca removido;
- tool output válido preservado;
- RAG repetido consolidado;
- mensagens diferentes não unidas indevidamente.

### Tarefa 2.6 — compressor determinístico

Implementar por perfil:

- janela recente integral;
- estado estruturado para histórico antigo;
- consolidação de RAG;
- redução segura de descrição de tools;
- orçamento de tokens.

Testes:

- snapshots por perfil;
- nenhuma alteração de fatos;
- economia monotônica entre perfis;
- mensagem atual idêntica.

### Tarefa 2.7 — validador e fallback

Validar:

- fatos protegidos;
- nomes e esquemas de tools;
- estrutura de saída;
- limite máximo de redução;
- resultado não vazio.

Testes:

- cada motivo de fallback;
- contexto original devolvido integralmente;
- métricas indicam fallback;
- erro interno não interrompe o item no modo padrão.

## Fase 3 — resumo opcional

### Tarefa 3.1 — contrato do resumidor

Criar prompt estruturado contendo:

- conteúdo elegível;
- fatos protegidos;
- orçamento;
- proibição de inferência;
- esquema de saída;
- campo de incertezas.

### Tarefa 3.2 — execução

Requisitos:

- chamar somente acima do limite;
- timeout configurável;
- nenhuma chamada quando a etapa local atingir a meta;
- validar todo resumo;
- fallback para resultado determinístico ou original.

Testes:

- modelo ausente;
- resposta válida;
- resposta inválida;
- alucinação de número;
- timeout;
- erro do provedor.

## Fase 4 — nós n8n

### Tarefa 4.1 — Context Optimizer

Parâmetros:

- campos de entrada;
- perfil;
- controles personalizados;
- uso do resumidor;
- comportamento de fallback;
- diagnóstico.

Execução:

- processar cada item;
- preservar `pairedItem`;
- anexar saídas sem apagar campos de entrada;
- usar o modelo resumidor conectado quando configurado.

Aceite:

- múltiplos itens;
- expressões;
- saída documentada;
- falha segura;
- execução visível no n8n.

### Tarefa 4.2 — Optimized Chat Model

Requisitos:

- envolver o modelo principal;
- aplicar o motor antes da chamada;
- preservar `invoke`, `batch`, `stream` e tool binding suportados;
- preservar callbacks e usage metadata;
- registrar métricas sem conteúdo por padrão.

Aceite:

- AI Agent funciona sem alteração de contrato;
- Gemini funciona no laboratório;
- tool calls continuam válidas;
- streaming não é anunciado se não estiver preservado.

## Fase 5 — instalação local

### Tarefa 5.1 — isolamento

Atualizar o launcher local para usar um diretório de usuário dedicado ao laboratório.

Não reutilizar o diretório padrão da conta se isso puder afetar outros testes.

### Tarefa 5.2 — instalação

Instalar o pacote compilado por link ou caminho local, conforme o método suportado pela versão instalada.

Aceite:

- os dois nós aparecem na busca;
- n8n inicia sem erro;
- remover o link remove os nós;
- nenhuma instalação remota.

## Fase 6 — workflows de teste

### Tarefa 6.1 — demonstração do Context Optimizer

Workflow mínimo:

- entrada manual ou chat;
- fixture grande;
- Context Optimizer;
- visualização de saída e métricas.

### Tarefa 6.2 — demonstração do proxy

Workflow mínimo:

- chat;
- AI Agent;
- Optimized Chat Model;
- Gemini;
- resposta;
- telemetria.

### Tarefa 6.3 — Lino Otimizado

Gerar uma cópia do baseline.

Alterações permitidas somente na cópia:

- fornecer prompt, histórico, RAG e mensagem ao otimizador;
- remover a memória direta do agente nessa variante;
- referenciar campos otimizados;
- adicionar telemetria do otimizador.

Não alterar:

- baseline;
- tools reais de consulta;
- mocks;
- regras funcionais;
- credenciais existentes.

## Fase 7 — avaliação

### Tarefa 7.1 — dataset

Criar casos cobrindo:

- conversa curta;
- conversa longa;
- consulta;
- RAG;
- tools;
- carrinho;
- orçamento;
- transferência;
- Locação Protegida;
- guardrails;
- mudança de decisão.

### Tarefa 7.2 — executor comparativo

Executar as mesmas entradas em:

- baseline;
- Context Optimizer;
- Optimized Chat Model.

Registrar:

- tokens;
- chamadas;
- latência;
- fatos;
- tools;
- resposta;
- fallback.

### Tarefa 7.3 — relatório

Gerar JSON e Markdown com:

- consolidado;
- resultado por cenário;
- falhas;
- economia;
- qualidade;
- recomendação por perfil.

## Portões de qualidade

Antes da integração n8n:

- build passa;
- lint passa;
- testes unitários passam;
- nenhum segredo no pacote.

Antes do Lino:

- os dois nós carregam;
- wrapper preserva o modelo;
- fallback foi exercitado;
- fixtures passam.

Conclusão do caso 1:

- perfil Equilibrado economiza 40% a 60% em média;
- qualidade é pelo menos 95%;
- fatos críticos têm 100% de preservação;
- nenhuma tool incorreta é causada pela compactação.

Se a meta não for atingida, o pacote continua experimental e não será instalado fora do laboratório.

## Ordem de execução

1. Scaffold e spike do proxy.
2. Motor determinístico.
3. Resumidor e validação.
4. Dois nós completos.
5. Instalação local.
6. Workflows mínimos.
7. Lino Otimizado.
8. Comparação e relatório.

## Fontes técnicas

- Documentação oficial de criação de nodes: https://docs.n8n.io/integrations/creating-nodes/
- Community nodes: https://docs.n8n.io/integrations/community-nodes/
- Item linking para node creators: https://docs.n8n.io/data/data-mapping/data-item-linking/item-linking-node-building/
- LangChain no n8n: https://docs.n8n.io/advanced-ai/langchain/langchain-n8n/
