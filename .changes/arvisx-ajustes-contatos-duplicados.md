---
impacto: capacidade_nova
secao: adicionado
titulo: Contatos duplicados por agente — achar os cadastros repetidos
---

Uma capacidade para o agente externo ajudar a cuidar da base sem a tela.

- **Achar duplicados** — `crm_find_duplicate_contacts` devolve os grupos de
  contatos que parecem a mesma pessoa: mesmo telefone (com ou sem o nono
  dígito), mesmo e-mail, telefone em conflito ou nome parecido. É a mesma
  detecção da tela de Duplicados. Só leitura. Não funciona dentro de um
  atendimento, e contato marcado como pessoal não aparece.

**O agente não junta contatos.** Juntar continua sendo feito por uma pessoa com
papel de gerente, na tela de Duplicados, como antes: sem registro e sem
desfazer. Não há ferramenta de agente para juntar nem para desfazer uma junção,
nem para token marcado como "tratado como gerente".

Mudança de banco (migration 9813): a tabela `fusoes_de_contatos`, lida e
gravada só pelo servidor, e três funções que juntam guardando registro e
desfazem a junção. Nenhum caminho do produto as usa nesta versão; elas ficam
instaladas para a tela poder passar a guardar registro. A tabela guarda
identificadores e nomes de campo, nunca telefone, e-mail ou etiqueta. Nenhuma
linha existente muda. Os limites estão em `docs/arvisx/SUPERFICIE-DE-AGENTE.md`.
