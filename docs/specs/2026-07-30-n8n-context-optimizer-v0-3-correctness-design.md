# n8n Context Optimizer v0.3 — segurança, limites reais e medição verificável

Data: 2026-07-30  
Status: aprovado conceitualmente pelo pedido “corrija e veja se é mesmo eficiente”  
Escopo: pacote e workflows do laboratório local; nenhum workflow corporativo

## 1. Objetivo

Corrigir falhas reproduzidas na v0.2.1 e medir novamente a redução real de tokens no Gemini. A v0.3 só considera uma otimização válida quando:

1. o resultado usa menos tokens que o original;
2. o orçamento configurado é respeitado;
3. regras, negações, fatos exatos e estrutura permanecem válidos;
4. conteúdo omitido continua recuperável sem expor campos bloqueados;
5. tokens reais do provedor confirmam a economia.

## 2. Abordagens consideradas

### A. Patch agressivo com resumo semântico

Usaria LLM para resumir histórico e dados com maior frequência. Produz mais economia, porém adiciona custo, latência e risco de omissão. Rejeitada como padrão.

### B. Camada externa de proxy

Interceptaria todas as chamadas de modelos. Facilitaria métricas globais, mas criaria serviço adicional, autenticação, rede e manutenção. Fora do escopo.

### C. Correção conservadora dentro dos cinco nós

Mantém pacote nativo do n8n, usa transformações determinísticas primeiro, recuperação exata e fallback para original. Escolhida.

## 3. Context Optimizer

### 3.1 Deduplicação segura

- Deduplicação exata continua habilitada.
- Deduplicação aproximada nunca combina unidades com polaridade diferente.
- Palavras de negação, obrigação e proibição entram no conjunto protegido.
- Mudança de `deve` para `não deve`, `permitido` para `proibido` ou equivalente invalida a compressão.
- Perfil `Balanced` deixa deduplicação aproximada desabilitada por padrão até os testes de equivalência cobrirem português e inglês.

### 3.2 Histórico

- Mensagem atual, system messages e sequência de tools permanecem intactas.
- Fatos antigos não são descartados só por estarem fora da janela recente.
- Mensagens antigas são removidas apenas quando duplicatas exatas.
- Trimming sem memória estruturada fica desabilitado por padrão.
- Perfil agressivo pode limitar histórico somente quando uma opção explícita autorizar perda e houver resumo recuperável.

### 3.3 Conteúdo por tipo

- `code` recebe compressor próprio e conservador.
- Código mantém separadores YAML, indentação, comentários, imports, delimitadores e ordem.
- JSON `includeFields` e `excludeFields` atuam apenas no nível documentado.
- Campos aninhados exigem caminhos explícitos.
- Resultado maior ou igual ao original faz fallback para original com `no_positive_savings`.

### 3.4 Orçamento rígido

- `Maximum Input Tokens` vira limite real, não apenas telemetria.
- Preview reserva tokens para recibo e instruções de recuperação antes de selecionar conteúdo.
- Primeiro item também precisa caber.
- Se nenhum item couber, retorna somente recibo válido.
- Se o recibo sozinho ultrapassar orçamento, virtualização falha e devolve conteúdo original com aviso.

### 3.5 Virtualização

- Manifesto armazenado recebe `fields` e `recordCount`.
- `qualityPassed` só é verdadeiro após validar recibo, resource ID, hash e orçamento.
- Preview é marcado como dado não confiável e não pode fechar seus próprios delimitadores.
- Virtualização só é considerada concluída quando o original foi persistido e pode ser lido novamente.

## 4. Context Retriever Tool

### 4.1 Schema por operação

O schema vira união discriminada:

- `search_context`: exige `query`;
- `filter_records`: exige `filters`;
- `get_exact_value`: exige `path`;
- `get_section`: exige `section`;
- `inspect_schema`: não aceita parâmetros desnecessários;
- `get_original_fragment`: exige `start` e `end`.

### 4.2 Proteção profunda

- `blockedFields` é aplicado recursivamente.
- Bloqueio usa nome de campo em qualquer nível do caminho.
- `search_context`, `get_exact_value`, `filter_records`, seções e fragmentos passam pelo mesmo redator.
- Solicitar objeto pai ou índice de array não contorna bloqueio.
- Para texto não estruturado, operações brutas são negadas quando há campos bloqueados que não podem ser redigidos com segurança.
- `allowedFields` também é aplicado recursivamente.

### 4.3 Evidência

Cada resposta informa:

- operação;
- resource ID;
- caminho;
- se é exata;
- se sofreu redaction;
- se foi truncada;
- tokens estimados.

## 5. Context Store

- SHA-256 é verificado em toda leitura.
- Corrupção devolve erro estruturado e nunca chega ao agente.
- Inspeção e exclusão podem exigir scope.
- TTL expirado pode ser removido durante leitura.
- Purge continua disponível para execução agendada.
- Persistência local continua sem criptografia nesta versão; documentação proíbe dados sensíveis reais até backend criptografado.
- Queue mode exige diretório compartilhado.

## 6. Optimized Chat Model

- Não descarta mensagens antigas únicas no perfil `Safe` ou `Balanced`.
- Só remove mensagens repetidas de forma exata.
- Tool calls, tool results, IDs, ordem e adjacência permanecem intactos.
- Tool output só é substituído quando menor e aprovado pelo Quality Guard.
- Streaming registra sucesso somente após o stream terminar; falhas durante iteração são observadas.
- Métricas diferenciam estimativa, input real, output real, cache e reasoning.

## 7. Token Analytics

Dados deixam de ser misturados:

- `estimated.originalInput`;
- `estimated.optimizedInput`;
- `actual.providerInput`;
- `actual.providerOutput`;
- `actual.cachedInput`;
- `actual.reasoning`;
- `overhead.compressor`;
- `overhead.retrieval`;
- `overhead.verifier`.

Custos incluem reasoning quando o provedor o cobra como output. O nó informa claramente quando uma métrica é estimada ou real. Comparação A/B usa tokens reais do mesmo modelo, pergunta e resposta esperada.

## 8. Compression Model

- Timeout precisa cancelar a chamada quando o modelo aceitar `AbortSignal`.
- Tokens do compressor entram no overhead.
- Resultado vazio, timeout ou perda de invariantes retorna contexto original.
- Compressão semântica continua desligada por padrão.

## 9. Testes obrigatórios

### 9.1 Segurança

- Senha bloqueada não aparece por busca, caminho aninhado, objeto pai, seção ou fragmento.
- Cross-scope continua bloqueado.
- Arquivo alterado falha na verificação de hash.

### 9.2 Qualidade

- `deve` e `não deve` permanecem separados.
- Preferência antiga necessária para pergunta atual não desaparece.
- YAML mantém `---`.
- JSON inclui objeto aninhado sem esvaziá-lo.
- Tool sequence Gemini permanece válida.

### 9.3 Orçamento

- Preview nunca ultrapassa limite.
- `Maximum Input Tokens` nunca ultrapassa limite quando modo rígido estiver ativo.
- Conteúdo sem economia retorna original.

### 9.4 Medição real

Executar dois workflows:

```text
Chat → Agent 12K → Resposta
Chat → Context Optimizer → Token Analytics → Agent 12K → Resposta
```

Aceite:

- mesmo Gemini 2.5 Flash;
- mesma pergunta;
- mesma resposta funcional;
- tokens reais extraídos do `tokenUsage`;
- economia positiva;
- nenhuma falha de qualidade;
- resultado documentado com execution IDs.

## 10. Compatibilidade e release

- Versão: `0.3.0`.
- Atualizar `package.json`, lockfile, changelog e README.
- Não publicar no npm.
- Gerar tarball local.
- Instalar somente em `~/.n8n/nodes`.
- Reiniciar n8n local e repetir smoke tests.
- Atualizar dependências somente em versões compatíveis com n8n local; nunca usar `npm audit fix --force`.

## 11. Fora do escopo

- Proxy global de LLM.
- Dashboard multiusuário.
- Publicação npm.
- Alteração de workflows corporativos.
- Criptografia gerenciada, Redis, PostgreSQL ou S3 nesta release.

## 12. Condição de conclusão

V0.3 está pronta quando todos os testes unitários, build e lint passam; reproduções de segurança falham de forma segura; workflow A/B confirma economia real; pacote reinstalado funciona no n8n local; documentação diferencia estimativa de uso real.
