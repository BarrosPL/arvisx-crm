---
impacto: capacidade_nova
secao: adicionado
titulo: Equipe de IA pronta age sem o cliente escrever, e a proposta ganha o botão de aprovar
---

A Equipe de IA pronta (plano Premium) passa a agir em cinco momentos em que o
cliente não escreveu nada. Quem já tem a equipe instalada precisa
**instalar de novo** (IA › Equipe pronta) para os gatilhos serem criados.

- **Resposta ao lembrete da agenda** — a resposta da pessoa ao lembrete vai
  para o agente de Agendamento, que confirma ou remarca.
- **Faltou ao compromisso** — a falta registrada inscreve a pessoa numa
  sequência do agente de Recuperação, que retoma e oferece um novo horário. O
  fluxo aparece em Follow-ups como "Equipe pronta · Faltou ao compromisso".
- **Proposta aprovada** — a tela da proposta ganha, para gestor, o botão
  **Aprovar e deixar o agente enviar**. Aprovou, o agente de Propostas envia na
  hora e o negócio vai para a etapa de proposta enviada. Editar o rascunho desfaz a
  aprovação.
- **Proposta parada** — o negócio que fica alguns dias na etapa de proposta
  enviada (5 por padrão) é retomado pelo agente de Recuperação. Aparece como a
  regra "Equipe pronta · Proposta sem resposta" em Automações e como um fluxo
  de mesmo nome em Follow-ups.
- **Negócio ganho** — nasce uma tarefa "Dar seguimento ao negócio ganho" para o
  dono do negócio (ou para a equipe, quando não há dono). Uma por negócio.

O pedido de desconto passa a virar um **caso** para a equipe decidir, na
Central: o agente continua a conversa e recebe a resposta da equipe.

Nenhum gatilho fala com o cliente fora das regras de sempre: canal em ensaio só
alcança os números de teste, conversa assumida por uma pessoa não recebe nada
do agente, a janela e o horário do canal são respeitados, quem pediu para parar
não recebe, e a equipe pausada ou fora do plano Premium não age. O agente de
Recuperação também não soma sequências: entre uma resposta da pessoa e a
seguinte, ela recebe no máximo o número de retomadas configurado.

**Mudança de comportamento para quem já usa a régua de silêncio.** O limite de
retomadas passa a valer também para a régua que já existia, e ela deixa de se
comportar como na versão anterior:

- **A régua não recomeça sozinha.** Antes, quem continuava sem responder
  recebia uma sequência de retomadas, depois outra, depois outra. Agora recebe
  uma, e a seguinte é encerrada sem enviar nada.
- **Quem nunca respondeu é retomado uma vez só.** O contato que nunca escreveu
  recebe uma sequência na vida. Ele só volta a ser retomado depois de mandar
  uma mensagem.
- **As sequências contam juntas.** Silêncio, falta ao compromisso e proposta
  parada dividem o mesmo limite. Quem já recebeu a régua de silêncio e depois
  falta a um compromisso, sem ter escrito nada no meio, não recebe a sequência
  de falta; quem recebeu a de proposta parada não recebe as outras.

Em Follow-ups, a sequência que não enviou aparece como "Encerrado sem enviar:
o limite de retomadas deste contato já foi usado". Se você dependia de a régua
insistir com quem não responde, aumente o número de retomadas no perfil em vez
de contar com o recomeço.

Quando o sistema não consegue conferir se a equipe está pausada (uma falha de
leitura no banco), a sequência espera cinco minutos e tenta de novo, em vez de
enviar.
