# Onboarding guiado dentro do CRM

Depois das boas-vindas, a empresa nova entra direto no CRM e termina de se montar lá dentro. Um painel fixo
("Guia de montagem") mostra o que falta e qual é o próximo clique. Cada passo é feito na tela onde ele mora.

## Ligar e desligar

- `ONBOARDING_GUIADO=on` liga. Qualquer outro valor, ou a variável ausente, mantém o wizard de `/onboarding`.
- O compose do Easypanel (`deploy/arvisx/crm/docker-compose.easypanel.yml`) liga por padrão.
  Para voltar ao wizard: `ONBOARDING_GUIADO=off` no `.env` do serviço `crm` e redeploy.
- Só o serviço `crm-app` lê a variável. Worker e scheduler não mudam.
- Sem migration. O estado continua em `organizations.onboarding_state` e `onboarded_at`.

## O caminho

| Passo | Tela do CRM | Como é feito |
|---|---|---|
| Boas-vindas (nome, ramo, fuso, termos) | `/onboarding/welcome` | Página do wizard, antes de entrar no CRM |
| O telefone dele / Seu WhatsApp | Conexões (`/app/connections`) | Quadro no topo da tela |
| Treinar (só com IA no plano) | Agentes (`/app/ai/agents`) | Quadro no topo da tela |
| Onde ele organiza / Seu funil | Funis (`/app/kanban`) | Quadro no topo da tela |
| Ver ele atender (só com IA no plano) | qualquer tela | Ensaio dentro do painel do guia |
| Quem trabalha com ele / Sua equipe | Equipe (`/app/team`) | Quadro no topo da tela |
| Fim | qualquer tela | Botão "Começar a usar" no painel |

- Fora da tela do passo, o painel diz qual tela abrir, acende o item no menu e oferece o botão "Ir para …".
  "Equipe" não fica no menu lateral: ali vale o botão do painel.
- Na tela do passo, o quadro em destaque no topo tem o formulário. Ao concluir ou pular, a pessoa continua na
  mesma tela, já sem o quadro e com o resultado na lista de baixo.
- Em tela larga o conteúdo cede uma faixa à direita para o painel. No celular o painel nasce recolhido quando a
  pessoa já está na tela do passo.
- Só quem administra a empresa vê o guia. Os outros entram no CRM normalmente.
- Empresa suspensa continua indo para a tela de suspensão antes de qualquer coisa.

## Onde está no código

- `lib/onboarding/guia.ts`: a chave, a tela de cada passo, as missões e o destino do roteador. A ordem e o
  "cumprido" continuam em `lib/onboarding/passos.ts`.
- `app/app/layout.tsx`: o portão deixa entrar quem já fez as boas-vindas e renderiza o guia.
- `app/actions/onboarding/_seguir.ts`: `seguirNoRoteiro` encerra cada action. Com o guia ligado ela responde
  direto com a tela do CRM e manda refazer o layout de `/app`; no wizard, segue para `/onboarding`.
- `app/onboarding/layout.tsx`: com o guia ligado e as boas-vindas feitas, nenhuma página do wizard é desenhada
  (`destinoForaDoWizard`): quem chega por voltar do navegador, aba antiga ou link salvo volta ao CRM.
- `app/onboarding/page.tsx`: o roteador devolve a pessoa à tela do passo que ela acabou de resolver (usado pelos
  botões "Continuar" dos formulários, que recarregam a página).
- `app/app/_components/guia/`: `GuiaDoOnboarding` (servidor), `GuiaFlutuante` (painel) e `BlocoDoGuia` (quadro
  do passo, usado em Conexões, Agentes, Funis e Equipe).
- Os formulários e as actions são os do wizard, importados sem cópia.
- `app/actions/onboarding/finishOnboarding.ts`: `concluirOnboarding` é a conclusão sem `redirect`, usada pelo
  painel.

## O que não mudou

- As páginas `/onboarding/*` continuam existindo. Com o guia desligado, tudo funciona como antes.
- As boas-vindas continuam sendo uma página inteira, fora do CRM.
- O ensaio do agente não cria conversa no Inbox nem cartão no funil (é o mesmo ensaio do wizard).

## Correção de 14/11/2026: a tela antiga aparecia no meio do guia

As actions dos passos terminavam em `redirect("/onboarding")` e o roteador devolvia ao CRM. Como `/onboarding`
mora sob a casca do wizard, a navegação desenhava o cabeçalho e o indicador de passos antigos a cada passo
concluído ou pulado, e no último passo a pessoa ficava parada nela. Medido pela tela antes e depois
(`evidence/onboarding-guiado/correcao-2026-11-14/`). Hoje nenhuma action do guia passa por `/onboarding`.
