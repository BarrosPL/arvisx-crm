/**
 * O FILTRO DE ENTRADA NO TURNO: o encanamento da regra de
 * `../guardrails/filtro-de-entrada.ts`.
 *
 * Roda no handler do `inbound_turn`, ANTES de escolher o agente: escolher o
 * agente já consulta um modelo (o roteador), e o filtro existe para a mensagem
 * barrada não custar nenhuma chamada. É o irmão de
 * `escalarComercialAntesDoModelo`, com uma diferença: aqui ninguém é chamado.
 * A conversa não muda de dono nem de estado; a mensagem continua na caixa de
 * entrada, onde a equipe a vê.
 *
 * O que ele faz quando barra, nesta ordem:
 *
 *   1. envia a resposta curta da empresa, se a regra pede resposta, pela MESMA
 *      cadeia de guardrails de todo envio (`runBeforeSend`: opt-out, LGPD,
 *      janela, ritmo do número). Não repete: se a última mensagem que saiu na
 *      conversa já é esse mesmo texto, fica em silêncio;
 *   2. grava o marcador da regra na conversa, se houver;
 *   3. devolve o registro que o chamador grava no traço do turno.
 *
 * Nada aqui lança. Erro ao ler a configuração ou as mensagens: o filtro não
 * decide nada e o turno segue para o modelo, como seguia antes de ele existir.
 *
 * ## A resposta do filtro respeita o MODO ASSISTIDO
 *
 * O filtro roda antes de escolher o agente, então não sabe qual agente
 * responderia. Mas sabe o que o dreno sabe: se o número tem agente publicado em
 * modo assistido (`numeroTemAgenteAssistido`, a mesma pergunta do `canAssist`
 * de `edge/crm/drain.ts`). No modo assistido nada vai ao cliente sem uma pessoa
 * aprovar — e a resposta curta do filtro saía sozinha (revisão de 20/11, item
 * 2.29). Agora, com regra `reply` num número assim, o filtro NÃO decide: não
 * envia, não marca, não grava traço, e o turno segue para o agente assistido,
 * que propõe a resposta para a pessoa aprovar. Regra `silence` não envia nada e
 * continua barrando igual nos dois modos. Sem conseguir ler o modo, vale o
 * lado seguro: não envia sozinho.
 */
import type pg from 'pg';

import type { ChannelAdapter } from '../channel-adapter';
import { runBeforeSend, type TipoDeEnvio } from '../guardrails/before-send';
import {
  CHAVE_DO_FILTRO_DE_ENTRADA,
  NOME_DO_FILTRO_NO_TRACO,
  julgarEntrada,
  lerFiltroDeEntrada,
  type BloqueioDoFiltro,
} from '../guardrails/filtro-de-entrada';
import { deriveLgpdFromContact, type LgpdInput } from '../guardrails/lgpd/legal-basis';
import type { Logger } from '../obs/logger';
import type { JobClaim } from '../queue/claim';
import { detectAmbiguousOptOut, detectHumanHandoffRequest } from './human-handoff';
import type { FerramentaNoTraco } from './traco-do-turno';

/**
 * `seq` da resposta do filtro no ledger de envio. O turno barrado não envia
 * mais nada, então ela é a mensagem 1 do job; o replay do mesmo job depois de
 * uma queda deduplica por `(job_id, seq)`.
 */
export const SEQ_DA_RESPOSTA_DO_FILTRO = 1;

/**
 * O que o cliente disse e ainda não foi respondido: as mensagens recebidas
 * depois da última que saiu, da mais nova para a mais antiga. Mensagem sem
 * texto (mídia) vem como `''`.
 */
export async function falasPendentesDoCliente(
  pool: pg.Pool,
  tenantId: string,
  conversationId: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ body: string | null }>(
    `select m.body from messages m
     where m.organization_id = $1 and m.conversation_id = $2 and m.direction = 'inbound'
       and m.created_at > coalesce((select max(o.created_at) from messages o
         where o.organization_id = $1 and o.conversation_id = $2 and o.direction = 'outbound'), '-infinity')
     order by m.created_at desc limit 100`,
    [tenantId, conversationId],
  );
  return rows.map((m) => m.body ?? '');
}

export interface IdsDoFiltroDeEntrada {
  tenantId: string;
  leadId: string;
  conversationId: string;
  channelSessionId: string;
  jobId: string;
  jobClaim?: JobClaim;
}

export interface OpcoesDoFiltroDeEntrada {
  /** O canal nasce só se houver resposta a enviar. */
  channel: () => ChannelAdapter;
  now: Date;
  log: Logger;
  origem?: TipoDeEnvio;
  disclosureMode?: 'inject' | 'veto';
  sleep?: (ms: number) => Promise<void>;
}

export type DesfechoDoFiltroDeEntrada =
  | { barrou: false }
  | { barrou: true; bloqueio: BloqueioDoFiltro; respostaEnviada: boolean; registro: FerramentaNoTraco };

/**
 * O número tem agente publicado em modo assistido? A MESMA pergunta que o
 * dreno faz antes de enfileirar (`canAssist`, `edge/crm/drain.ts`): o agente
 * publicado direto no número, ou membro/reserva do roteador ativo dele.
 */
export async function numeroTemAgenteAssistido(
  pool: pg.Pool,
  tenantId: string,
  channelSessionId: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ available: boolean }>(
    `select exists(
       select 1 from ai_agents a
         join ai_agent_versions v on v.organization_id = a.organization_id and v.id = a.published_version_id
        where a.organization_id = $1 and a.archived_at is null
          and a.operation_mode = 'assisted' and v.status = 'published'
          and (v.channel_session_id = $2 or exists(
            select 1 from ai_routers r
             where r.organization_id = a.organization_id and r.channel_session_id = $2 and r.is_active
               and (r.fallback_agent_id = a.id or exists(
                 select 1 from ai_router_members m
                  where m.organization_id = r.organization_id and m.router_id = r.id and m.agent_id = a.id))))
     ) as available`,
    [tenantId, channelSessionId],
  );
  return rows[0]?.available === true;
}

/** Outra porta do começo do turno decide esta mensagem: pedido de pessoa ou opt-out. */
function outraPortaDecide(mensagem: string): boolean {
  return detectAmbiguousOptOut(mensagem) || detectHumanHandoffRequest(mensagem);
}

async function ultimaSaidaEhEsta(
  pool: pg.Pool,
  ids: IdsDoFiltroDeEntrada,
  texto: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ body: string | null }>(
    `select m.body from messages m
     where m.organization_id = $1 and m.conversation_id = $2 and m.direction = 'outbound'
     order by m.created_at desc limit 1`,
    [ids.tenantId, ids.conversationId],
  );
  return (rows[0]?.body ?? '').trim() === texto.trim();
}

/** Envia a resposta curta pela cadeia. Devolve se saiu e, se não, o código do porquê. */
async function enviarRespostaDoFiltro(
  pool: pg.Pool,
  ids: IdsDoFiltroDeEntrada,
  opts: OpcoesDoFiltroDeEntrada,
  texto: string,
): Promise<{ enviada: boolean; porque?: string }> {
  try {
    if (await ultimaSaidaEhEsta(pool, ids, texto)) return { enviada: false, porque: 'ja_respondido' };

    let optedOutThisTurn = false;
    let lgpd: LgpdInput | undefined;
    const { rows } = await pool.query<{
      is_blocked: boolean;
      is_anonymized: boolean;
      source: string | null;
      consent: Record<string, unknown> | null;
    }>(
      'select is_blocked, is_anonymized, source, consent from contacts where organization_id = $1 and id = $2',
      [ids.tenantId, ids.leadId],
    );
    const contato = rows[0];
    if (contato !== undefined) {
      optedOutThisTurn = contato.is_blocked === true;
      // Responde a quem escreveu: não é prospecção.
      lgpd = deriveLgpdFromContact(
        { source: contato.source, consent: contato.consent, is_anonymized: contato.is_anonymized },
        false,
      );
    }

    const chain = await runBeforeSend({
      pool,
      log: opts.log,
      tenantId: ids.tenantId,
      leadId: ids.leadId,
      jobId: ids.jobId,
      channelSessionId: ids.channelSessionId,
      body: texto,
      optedOutThisTurn,
      resposta: opts.origem !== 'disparo',
      // Texto fixo da empresa, igual para todo mundo de propósito: o gate de
      // variação de texto vetaria a segunda pessoa a recebê-lo.
      enforceSpinning: false,
      // Não é texto da IA: a restrição comercial não o julga.
      enforceCommercialRestriction: false,
      crmDailyLimit: null,
      now: opts.now,
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
      ...(lgpd !== undefined ? { lgpd } : {}),
      ...(opts.disclosureMode !== undefined ? { disclosureMode: opts.disclosureMode } : {}),
      send: (finalBody) =>
        opts.channel().send({
          tenantId: ids.tenantId,
          leadId: ids.leadId,
          jobId: ids.jobId,
          jobClaim: ids.jobClaim,
          seq: SEQ_DA_RESPOSTA_DO_FILTRO,
          conversationId: ids.conversationId,
          body: finalBody,
        }),
    });
    if (chain.status === 'vetoed') return { enviada: false, porque: chain.code };
    const kind = chain.outcome.kind;
    return kind === 'sent' || kind === 'already_sent' ? { enviada: true } : { enviada: false, porque: kind };
  } catch (err) {
    opts.log.warn('filtro de entrada: a resposta curta não saiu', {
      error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
    });
    return { enviada: false, porque: 'erro_no_envio' };
  }
}

/** Grava o marcador na conversa, sem duplicar. Devolve se gravou ou se já estava lá. */
async function marcarConversa(
  pool: pg.Pool,
  ids: IdsDoFiltroDeEntrada,
  marcador: string,
  log: Logger,
): Promise<boolean> {
  try {
    await pool.query(
      `update conversations
          set tags = coalesce(tags, '{}'::text[]) || $3::text
        where organization_id = $1 and id = $2
          and not (coalesce(tags, '{}'::text[]) @> array[$3::text])`,
      [ids.tenantId, ids.conversationId, marcador],
    );
    return true;
  } catch (err) {
    log.warn('filtro de entrada: o marcador não foi gravado na conversa', {
      error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
    });
    return false;
  }
}

/**
 * Julga as falas pendentes e, se a regra da empresa barrar, aplica a ação.
 * `barrou: true` quer dizer: não chame o roteador nem o redator neste turno.
 */
export async function aplicarFiltroDeEntrada(
  pool: pg.Pool,
  ids: IdsDoFiltroDeEntrada,
  opts: OpcoesDoFiltroDeEntrada,
): Promise<DesfechoDoFiltroDeEntrada> {
  const inicio = performance.now();
  let bloqueio: BloqueioDoFiltro;
  try {
    const { rows } = await pool.query<{ filtro: unknown }>(
      `select settings -> '${CHAVE_DO_FILTRO_DE_ENTRADA}' as filtro from organizations where id = $1`,
      [ids.tenantId],
    );
    const filtro = lerFiltroDeEntrada({ [CHAVE_DO_FILTRO_DE_ENTRADA]: rows[0]?.filtro });
    // Desligado é o estado de quase toda empresa: sai sem ler as mensagens.
    if (!filtro.enabled) return { barrou: false };
    const falas = await falasPendentesDoCliente(pool, ids.tenantId, ids.conversationId);
    const decisao = julgarEntrada(filtro, falas, outraPortaDecide);
    if (!decisao.barra) return { barrou: false };
    bloqueio = decisao;
  } catch (err) {
    opts.log.warn('filtro de entrada não lido — o turno segue para o modelo', {
      error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
    });
    return { barrou: false };
  }

  // A resposta automática respeita o modo assistido (ver o cabeçalho): num
  // número com agente assistido, regra `reply` não decide e o turno segue.
  if (bloqueio.acao === 'reply') {
    let assistido = true; // sem conseguir ler, não envia sozinho
    try {
      assistido = await numeroTemAgenteAssistido(pool, ids.tenantId, ids.channelSessionId);
    } catch (err) {
      opts.log.warn('filtro de entrada: modo do número não lido — a resposta automática não sai', {
        error: err instanceof Error ? err.message.slice(0, 160) : 'erro desconhecido',
      });
    }
    if (assistido) {
      opts.log.info(
        'filtro de entrada: regra de resposta num número com agente assistido — nada é enviado sozinho; o turno segue',
        { categoria: bloqueio.categoria },
      );
      return { barrou: false };
    }
  }

  const envio =
    bloqueio.acao === 'reply' && bloqueio.resposta !== null
      ? await enviarRespostaDoFiltro(pool, ids, opts, bloqueio.resposta)
      : null;
  const marcou =
    bloqueio.marcador !== null ? await marcarConversa(pool, ids, bloqueio.marcador, opts.log) : false;

  opts.log.info('turno barrado pelo filtro de entrada — nenhum modelo foi chamado', {
    categoria: bloqueio.categoria,
    acao: bloqueio.acao,
    resposta_enviada: envio?.enviada ?? false,
    ...(envio?.porque !== undefined ? { resposta_nao_enviada_por: envio.porque } : {}),
    marcador_gravado: marcou,
    mensagens: bloqueio.mensagens,
  });

  return {
    barrou: true,
    bloqueio,
    respostaEnviada: envio?.enviada ?? false,
    registro: {
      nome: NOME_DO_FILTRO_NO_TRACO,
      // `recusado`: a regra rodou, não quebrou, e disse não. O `erro` guarda o
      // código da categoria, como nas recusas das ferramentas.
      estado: 'recusado',
      erro: bloqueio.categoria,
      duracao_ms: performance.now() - inicio,
      // O termo é da lista da EMPRESA (configuração); a fala do cliente não
      // entra no traço.
      resultado: JSON.stringify({
        acao: bloqueio.acao,
        resposta_enviada: envio?.enviada ?? false,
        ...(envio?.porque !== undefined ? { resposta_nao_enviada_por: envio.porque } : {}),
        marcador: bloqueio.marcador,
        marcador_gravado: marcou,
        termo: bloqueio.termo,
        mensagens: bloqueio.mensagens,
      }),
    },
  };
}
