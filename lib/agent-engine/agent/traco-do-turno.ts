/**
 * ═══ O TRAÇO DO TURNO — uma linha por execução do agente, chave `job_id` ═══
 *
 * Issue #2869: hoje o turno real é auditável em pedaços que moram longe um do
 * outro — `llm_calls` guarda cada chamada de modelo, `skill_activations` guarda
 * quais skills entraram, `event_log` guarda a cadeia de eventos — mas *nenhuma
 * linha responde "o que aconteceu NESTE turno"*: quem entrou no prompt, quais
 * fontes de conhecimento foram lidas, quais ferramentas o modelo chamou (e qual
 * falhou) e como o turno terminou. Sem isso, um turno que respondeu errado só se
 * explica lendo o código.
 *
 * Este módulo entrega a fatia mínima e honesta disso:
 *
 *   * o que JÁ existe é AGREGADO na hora de gravar (tokens/custo/latência de
 *     `llm_calls` do job, skills de `skill_activations` do job) — não se copia
 *     nem se duplica escrita;
 *   * o que NÃO existia é COLETADO no turno: cada chamada de ferramenta, com
 *     nome, estado, erro, duração e um RESUMO do que ela devolveu;
 *   * o que a organização tem ligado (fontes de conhecimento, com versão e
 *     hash) é fotografado junto.
 *
 * O que esta fatia AINDA NÃO grava — para não prometer o que não tem: o
 * snapshot/hash da composição do prompt, os trechos de KB efetivamente
 * recuperados, a comparação entre a resposta crua do modelo e o texto final e a
 * lista de decisões que a PRÉVIA pula. São as fatias seguintes; `is_dry_run`
 * já distingue as duas execuções desde já.
 *
 * Duas regras de ouro deste arquivo:
 *
 *   1. **O traço NUNCA derruba o turno.** Gravar é melhor-esforço: qualquer
 *      erro (permissão, coluna, banco fora) vira um `warn` e o turno segue. Um
 *      mecanismo de observabilidade que apaga o atendimento quando falha é pior
 *      do que não existir.
 *   2. **O traço NUNCA muda o resultado.** O envoltório de ferramentas registra
 *      e devolve o MESMO valor (e relança o mesmo erro) que a ferramenta
 *      devolveu — ele observa, não decide.
 */

import type pg from "pg";
import type { ToolSet } from "../edge/llm/run-model-call";
import type { Logger } from "../obs/logger";
import type { TurnAgentResolution } from "./resolve-turn-agent";
import { scrubMessage } from "@/lib/sentry/scrub";

/**
 * Como a chamada de uma ferramenta terminou, do ponto de vista de quem lê o traço.
 *
 * `recusado` é a RECUSA DE NEGÓCIO: a ferramenta rodou, não quebrou, e disse
 * não (`marcado: false`, `permitido: false`, `ok: false` com `codigo`, lista
 * vazia com `motivo`). Antes ela saía como `ok` — a ferramenta de fato não
 * falhou —, e o traço de um turno que NÃO marcou a consulta era idêntico ao de
 * um que marcou. Medido em ensaio: slug de agenda errado, recusa em 38 ms, o
 * agente chamou humano, e a linha dizia `estado: "ok"` sem o retorno.
 */
export type EstadoDaFerramenta = "ok" | "recusado" | "falhou" | "bloqueada";

export interface FerramentaNoTraco {
  nome: string;
  estado: EstadoDaFerramenta;
  /**
   * Em `falhou`/`bloqueada`, a mensagem do erro, truncada. Em `recusado`, o
   * CÓDIGO da recusa (`motivo`/`codigo`). `null` quando a chamada deu certo.
   */
  erro: string | null;
  duracao_ms: number;
  /**
   * O que a ferramenta DEVOLVEU, em JSON resumido (teto `LIMITE_DO_RESULTADO`,
   * corte avisado por `MARCA_DE_CORTE`). `null` quando não houve retorno (a
   * chamada lançou) ou ele não é serializável. Ausente nas linhas gravadas
   * antes deste campo existir.
   */
  resultado?: string | null;
  /**
   * O modelo marcou este `send_message` como a última ação do turno (knob
   * AGENT_STOP_AFTER_FINAL_SEND ≠ off). Ausente quando não marcou: a linha fica
   * idêntica à de antes do knob. É a régua da avaliação da parada do laço.
   */
  encerra_turno?: true;
}

/**
 * Teto de chamadas registradas por turno. Um turno que entra em laço chama
 * dezenas de ferramentas; o traço é para LEITURA HUMANA e para o teste de
 * regressão, não para reconstituir o histórico inteiro — a partir daqui o
 * `ferramentas_truncadas` avisa que a lista foi cortada, em vez de mentir.
 */
export const LIMITE_DE_FERRAMENTAS = 50;

/** Teto da mensagem de erro guardada. Stack trace inteiro não cabe e não ajuda. */
export const LIMITE_DO_ERRO = 300;

/**
 * Teto do resumo do resultado, JÁ CONTANDO a marca de corte. 50 chamadas × 600
 * caracteres é o pior caso da linha: cabe num jsonb sem virar o histórico da
 * conversa, e é o bastante para ler o motivo de uma recusa e a lista que veio
 * com ela.
 */
export const LIMITE_DO_RESULTADO = 600;

/** O fim de um resumo cortado. Sem ela, JSON cortado parece JSON quebrado. */
export const MARCA_DE_CORTE = "…[cortado]";

/** Chaves de provedor que o `scrubMessage` não conhece (ele cobre as de cobrança). */
const CHAVE_DE_PROVEDOR = /\b(?:sk-|AIza|github_pat_|gh[pousr]_)[\w-]{8,}/g;

/** JWT: três blocos base64url, e o primeiro é sempre `{"` codificado (`eyJ`). */
const JWT = /\beyJ[\w-]{8,}\.[\w-]{4,}\.[\w-]+/g;

/** `Bearer <credencial>` — o que vem depois é segredo, seja qual for a forma. */
const BEARER = /\b(Bearer\s+)[\w.~+/=-]{8,}/gi;

/**
 * Credencial em parâmetro de URL (`?token=…`, `&signature=…`): link assinado
 * de arquivo é o caso comum, e quem tem o link tem o arquivo.
 */
const SEGREDO_NA_URL =
  /([?&](?:token|access_token|signature|sig|x-amz-signature|api_key|apikey)=)[^&\s"'#\\]+/gi;

/**
 * Carimbo de tempo em MILISSEGUNDOS: 13 dígitos começando em 1 (de 2001 a
 * 2033), sem dígito colado. O padrão de CPF do `scrubMessage` pega os 11
 * primeiros e devolvia `[CPF]00` — o horário, que é o que se lê numa
 * investigação, sumia. Telefone não tem esta forma: o DDI 1 tem 11 dígitos, e
 * o brasileiro de 13 começa em 55. O grupo de captura faz o `split` devolver o
 * carimbo nas posições ímpares.
 */
const CARIMBO_EM_MS = /(?<![\d.+-])(1\d{12})(?!\d)/;

/**
 * A higiene do único texto livre do traço que o LEITOR devolve.
 *
 * Uma função, dois chamadores: a gravação (`resumirResultado`) e a leitura
 * (`recibo-do-traco.ts`, que a reaplica porque não confia no que já está no
 * banco). Tira e-mail, telefone, documento e chave; NÃO tira nome de pessoa —
 * nome não tem formato, e prometer isso seria mentir.
 */
export function higienizarTextoDoTraco(texto: string): string {
  const semCredencial = texto
    // JWT antes de tudo: os três blocos dele têm dígito e ponto, e a cadeia de
    // telefone/CPF comeria pedaço e deixaria o resto passar.
    .replace(JWT, "[CHAVE]")
    .replace(BEARER, "$1[CHAVE]")
    .replace(SEGREDO_NA_URL, "$1[CHAVE]")
    .replace(CHAVE_DE_PROVEDOR, "[CHAVE]");
  // O carimbo de tempo em milissegundos sai do texto ANTES do `scrubMessage`
  // e volta intacto (posições ímpares do `split`): é horário, não documento.
  return semCredencial
    .split(CARIMBO_EM_MS)
    .map((trecho, i) => (i % 2 === 1 ? trecho : scrubMessage(trecho)))
    .join("");
}

/**
 * O resumo do que a ferramenta devolveu, para o traço.
 *
 * ⚠️ Higienizado ANTES de cortar: o resultado de uma ferramenta pode carregar
 * telefone, e-mail e documento do contato (`crm_get_contact`), e o traço não é
 * lugar para uma segunda cópia disso. Passa pelo mesmo `scrubMessage` da
 * telemetria — ids, slugs, códigos e horários sobrevivem, que é o que se lê
 * numa investigação. Cortar primeiro poderia partir um e-mail ao meio e deixar
 * a metade passar.
 *
 * NUNCA lança: resultado circular ou com `BigInt` vira `null`, e o turno segue.
 */
export function resumirResultado(
  resultado: unknown,
  limite: number = LIMITE_DO_RESULTADO,
): string | null {
  if (resultado === undefined) return null;
  try {
    const texto: unknown = typeof resultado === "string" ? resultado : JSON.stringify(resultado);
    if (typeof texto !== "string") return null;
    const limpo = higienizarTextoDoTraco(texto);
    if (limpo.length <= limite) return limpo;
    return limpo.slice(0, Math.max(0, limite - MARCA_DE_CORTE.length)) + MARCA_DE_CORTE;
  } catch {
    return null;
  }
}

/** Um resumo que já vem pronto (do coletor) só é re-cortado, nunca re-higienizado. */
function resultadoNoTeto(resultado: string | null): string | null {
  if (resultado === null || resultado.length <= LIMITE_DO_RESULTADO) return resultado;
  return resultado.slice(0, LIMITE_DO_RESULTADO - MARCA_DE_CORTE.length) + MARCA_DE_CORTE;
}

/** O que se sabe do turno no momento de fechar a linha. */
export type StatusDoTurno = "completed" | "failed" | "aborted";

/**
 * O que o próprio turno SABE e o envoltório não: preenchido durante a execução
 * e lido na hora de gravar. Campo ausente significa "o turno não chegou lá" —
 * a linha guarda `null`, e não um zero que passaria por medição.
 */
export interface DesfechoDoTurno {
  messagesSent?: number;
  provider?: string | null;
  model?: string | null;
  abortReason?: string | null;
  /** O agente que o turno RESOLVEU (follow-up e caso não o recebem do chamador). */
  config?: TurnAgentResolution["config"] | null;
  /** Mensagens do histórico que de fato entraram na abertura, já depois da compactação. */
  historicoMensagens?: number;
}

export interface EntradaDoTraco {
  organizationId: string;
  /** `job_id` do turno real; `null` só na prévia (que não tem job). */
  jobId: string | null;
  /** `run_id` da prévia — chave do traço quando não há job. */
  previewRunId: string | null;
  conversationId: string | null;
  contactId: string | null;
  agentId: string | null;
  agentVersionId: string | null;
  isDryRun: boolean;
  status: StatusDoTurno;
  abortReason: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  provider: string | null;
  model: string | null;
  messagesSent: number;
  /** Quantas mensagens de histórico o turno carregou (a janela real, não a pedida). */
  historicoMensagens: number | null;
  /** Ids das fontes de conhecimento ligadas ao agente neste turno. */
  knowledgeSourceIds: readonly string[];
  ferramentas: readonly FerramentaNoTraco[];
  /** O coletor descartou chamadas pelo teto (ele já entrega a lista cortada). */
  ferramentasTruncadas?: boolean;
}

/** A linha, já normalizada — o que vai para o banco. */
export interface TracoDoTurno {
  organization_id: string;
  job_id: string | null;
  preview_run_id: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  is_dry_run: boolean;
  status: StatusDoTurno;
  abort_reason: string | null;
  error_code: string | null;
  error_message: string | null;
  provider: string | null;
  model: string | null;
  messages_sent: number;
  historico_mensagens: number | null;
  knowledge_source_ids: string[];
  ferramentas: FerramentaNoTraco[];
  ferramentas_truncadas: boolean;
}

/**
 * Coletor por turno. O estado vive no closure — como o breaker, ele nasce e
 * morre com o turno, e por isso não há como um turno ler a ferramenta do outro.
 */
export interface ColetorDeFerramentas {
  registrar(chamada: FerramentaNoTraco): void;
  listar(): FerramentaNoTraco[];
  /** `true` quando alguma chamada foi descartada pelo teto — o traço não mente. */
  truncado(): boolean;
}

export interface OpcoesDoColetor {
  /** Teto de chamadas guardadas (default `LIMITE_DE_FERRAMENTAS`). */
  limite?: number;
  /** Teto do texto de erro (default `LIMITE_DO_ERRO`). */
  limiteDoErro?: number;
}

export function criarColetorDeFerramentas(opcoes: OpcoesDoColetor = {}): ColetorDeFerramentas {
  const limite = opcoes.limite ?? LIMITE_DE_FERRAMENTAS;
  const limiteDoErro = opcoes.limiteDoErro ?? LIMITE_DO_ERRO;
  const chamadas: FerramentaNoTraco[] = [];
  let truncou = false;

  return {
    registrar(chamada: FerramentaNoTraco): void {
      if (chamadas.length >= limite) {
        // O corte é AVISADO, não silencioso: quem lê o traço precisa saber que
        // a lista está incompleta em vez de concluir que o turno parou ali.
        truncou = true;
        return;
      }
      chamadas.push({
        nome: chamada.nome,
        estado: chamada.estado,
        erro: chamada.erro === null ? null : chamada.erro.slice(0, limiteDoErro),
        duracao_ms: Math.max(0, Math.round(chamada.duracao_ms)),
        ...(chamada.resultado !== undefined
          ? { resultado: resultadoNoTeto(chamada.resultado) }
          : {}),
        ...(chamada.encerra_turno === true ? { encerra_turno: true } : {}),
      });
    },
    listar(): FerramentaNoTraco[] {
      return chamadas.slice();
    },
    truncado(): boolean {
      return truncou;
    },
  };
}

/** Convenção do repo: toda tool do run devolve `{ ok: boolean, ... }`. */
function ehResultadoDeFalha(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === false;
}

/**
 * A RECUSA DE NEGÓCIO: a ferramenta rodou e disse NÃO — não é falha dela.
 *
 * Duas formas existem no repo, e as duas contam:
 *
 *   1. `{ ok: false, codigo }` — o envelope de recusa nomeada (sem `error`,
 *      que é o envelope de FALHA e segue sendo `falhou`);
 *   2. o retorno das ferramentas MCP, que não usam `ok`: `motivo` em texto, ao
 *      lado de uma bandeira `false` no topo (`marcado`, `permitido`,
 *      `registrado`…) ou de uma `mensagem` para o modelo — é o formato de
 *      `{ horarios: [], motivo, mensagem }` e de `{ marcado: false, motivo }`.
 *
 * `ok: true` explícito nunca é recusa: quem diz que deu certo, deu certo.
 */
function ehRecusaDeNegocio(result: unknown): boolean {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if (r.ok === true) return false;
  // Erro técnico vestido de recusa não é recusa: a ferramenta QUEBROU.
  if (ehFalhaTecnica(result)) return false;
  if (r.ok === false) return typeof r.codigo === "string" && r.error === undefined;
  if (typeof r.motivo !== "string" || r.motivo.trim() === "") return false;
  return typeof r.mensagem === "string" || Object.values(r).some((v) => v === false);
}

/**
 * Códigos que têm a FORMA de recusa (`motivo`/`codigo`) e são erro técnico: a
 * ferramenta não disse "não", ela não conseguiu responder.
 */
const CODIGOS_DE_FALHA_TECNICA: ReadonlySet<string> = new Set(["internal_error", "erro_interno"]);

/**
 * A marca que as ferramentas põem no retorno quando o que capturaram foi erro
 * de servidor (5xx) e não limite de negócio — `semDerrubarOTurno`, em
 * `lib/mcp/tools/agendamento.ts`. O código de um 5xx pode ser qualquer um; a
 * marca é o que não depende de lista.
 */
export const MARCA_DE_FALHA_TECNICA = "falha_tecnica";

/**
 * A FALHA TÉCNICA com cara de recusa: o retorno tem `motivo`/`codigo`, mas o
 * que aconteceu foi erro interno. No traço isso é `falhou` — contar como
 * `recusado` esconderia defeito atrás de "a ferramenta disse não".
 *
 * `ok: true` explícito nunca é falha.
 */
function ehFalhaTecnica(result: unknown): boolean {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return false;
  const r = result as Record<string, unknown>;
  if (r.ok === true) return false;
  if (r[MARCA_DE_FALHA_TECNICA] === true) return true;
  return [r.motivo, r.codigo].some((c) => typeof c === "string" && CODIGOS_DE_FALHA_TECNICA.has(c));
}

/** O código da recusa — é ele que diz POR QUE a ferramenta disse não. */
function motivoDaRecusa(result: unknown): string | null {
  const r = result as { motivo?: unknown; codigo?: unknown };
  if (typeof r.motivo === "string" && r.motivo.trim() !== "") return r.motivo;
  return typeof r.codigo === "string" ? r.codigo : null;
}

/**
 * Bloqueio do circuit breaker é uma FALHA para quem lê o traço, mas de outra
 * natureza: não foi a ferramenta que quebrou, foi o próprio turno que a
 * interrompeu. Distinguir os dois é o que permite ler "a ferramenta não foi
 * chamada" da issue #2869 sem confundir com "a ferramenta falhou".
 */
function ehBloqueioDoBreaker(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const erro = (result as { error?: { code?: unknown } }).error;
  const codigo = erro?.code;
  return typeof codigo === "string" && codigo.startsWith("circuit_breaker");
}

function mensagemDoResultado(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null;
  const erro = (result as { error?: unknown }).error;
  if (typeof erro === "string") return erro;
  if (typeof erro === "object" && erro !== null) {
    const msg = (erro as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    const codigo = (erro as { code?: unknown }).code;
    if (typeof codigo === "string") return codigo;
  }
  return null;
}

type AnyExecute = (input: unknown, options: unknown) => unknown;
interface FerramentaEnvolvivel {
  execute?: AnyExecute;
}

/**
 * Envolve as ferramentas do run para REGISTRAR cada chamada no coletor do turno.
 *
 * Fica por FORA do breaker de propósito (`envolverFerramentasComTraco(
 * wrapToolsWithBreaker(...))`): assim o traço enxerga inclusive a chamada que o
 * breaker bloqueou — que é justamente a que mais falta faz numa investigação.
 *
 * Sem coletor, devolve o MESMO objeto: quem chama sem traço não paga nada.
 */
export function envolverFerramentasComTraco(
  tools: ToolSet,
  coletor: ColetorDeFerramentas | undefined,
  agora: () => number = () => Date.now(),
): ToolSet {
  if (coletor === undefined) return tools;

  const envolver = (nome: string, execute: AnyExecute): AnyExecute => {
    return async (input: unknown, options: unknown): Promise<unknown> => {
      const inicio = agora();
      const marca =
        typeof input === "object" && input !== null && (input as { encerra_turno?: unknown }).encerra_turno === true
          ? ({ encerra_turno: true } as const)
          : {};
      try {
        const resultado = await execute(input, options);
        // A ordem importa: o bloqueio do breaker também é `ok: false`, e a
        // recusa nomeada (`ok: false` + `codigo`) também — cada um tem de ser
        // reconhecido antes de cair em "falhou".
        const estado: EstadoDaFerramenta = ehBloqueioDoBreaker(resultado)
          ? "bloqueada"
          : ehRecusaDeNegocio(resultado)
            ? "recusado"
            : ehResultadoDeFalha(resultado) || ehFalhaTecnica(resultado)
              ? "falhou"
              : "ok";
        coletor.registrar({
          nome,
          estado,
          erro:
            estado === "ok"
              ? null
              : estado === "recusado"
                ? motivoDaRecusa(resultado)
                : // Falha técnica com forma de recusa não traz `error`: o que
                  // há para ler é o código.
                  (mensagemDoResultado(resultado) ??
                  (ehFalhaTecnica(resultado) ? motivoDaRecusa(resultado) : null)),
          duracao_ms: agora() - inicio,
          // O RETORNO, resumido — em todo estado. É o que faltava para provar a
          // causa de uma recusa sem reproduzir o turno.
          resultado: resumirResultado(resultado),
          ...marca,
        });
        // O MESMO valor que a ferramenta devolveu: o resumo é uma cópia em texto.
        return resultado;
      } catch (erro) {
        coletor.registrar({
          nome,
          estado: "falhou",
          erro: erro instanceof Error ? erro.message : String(erro),
          duracao_ms: agora() - inicio,
          // Não houve retorno: a chamada lançou. O que há para ler está em `erro`.
          resultado: null,
          ...marca,
        });
        // Relança o MESMO erro: observar não pode engolir a falha do turno.
        throw erro;
      }
    };
  };

  const envolvidas: ToolSet = {};
  for (const [nome, def] of Object.entries(tools)) {
    const ferramenta = def as FerramentaEnvolvivel;
    if (ferramenta.execute === undefined) {
      envolvidas[nome] = def;
      continue;
    }
    envolvidas[nome] = {
      ...def,
      execute: envolver(nome, ferramenta.execute.bind(def) as AnyExecute),
    } as typeof def;
  }
  return envolvidas;
}

/** Coluna uuid com `''` vira `NULL`: a prévia monta ids vazios para "cenário". */
function uuidOuNulo(valor: string | null): string | null {
  return valor === null || valor.trim() === "" ? null : valor;
}

/** Normaliza a entrada na linha do banco — sem I/O, sem relógio, sem closure. */
export function montarTracoDoTurno(entrada: EntradaDoTraco): TracoDoTurno {
  const limiteDoErro = LIMITE_DO_ERRO;
  return {
    organization_id: entrada.organizationId,
    job_id: entrada.jobId,
    preview_run_id: uuidOuNulo(entrada.previewRunId),
    conversation_id: uuidOuNulo(entrada.conversationId),
    contact_id: uuidOuNulo(entrada.contactId),
    agent_id: uuidOuNulo(entrada.agentId),
    agent_version_id: uuidOuNulo(entrada.agentVersionId),
    is_dry_run: entrada.isDryRun,
    status: entrada.status,
    abort_reason: entrada.abortReason,
    error_code: entrada.errorCode,
    error_message:
      entrada.errorMessage === null ? null : entrada.errorMessage.slice(0, limiteDoErro),
    provider: entrada.provider,
    model: entrada.model,
    messages_sent: Math.max(0, entrada.messagesSent),
    historico_mensagens: entrada.historicoMensagens,
    knowledge_source_ids: [...entrada.knowledgeSourceIds],
    ferramentas: entrada.ferramentas.slice(0, LIMITE_DE_FERRAMENTAS).map((f) => ({
      nome: f.nome,
      estado: f.estado,
      erro: f.erro === null ? null : f.erro.slice(0, limiteDoErro),
      duracao_ms: Math.max(0, Math.round(f.duracao_ms)),
      ...(f.resultado !== undefined ? { resultado: resultadoNoTeto(f.resultado) } : {}),
      ...(f.encerra_turno === true ? { encerra_turno: true as const } : {}),
    })),
    ferramentas_truncadas:
      entrada.ferramentasTruncadas === true || entrada.ferramentas.length > LIMITE_DE_FERRAMENTAS,
  };
}

/**
 * Grava a linha do turno. Melhor-esforço por contrato: NUNCA lança.
 *
 * Uma única instrução: os agregados saem de `llm_calls` e `skill_activations`
 * do próprio `job_id` (leitura indexada — 0585 e o índice desta migration) e a
 * organização já tem ligadas as fontes de conhecimento por `id`. Assim o turno
 * não paga três idas ao banco para descobrir o que o banco já sabe.
 *
 * Prévia (`job_id` nulo) usa `preview_run_id` como chave: o `on conflict` só
 * vale para o turno real, e a prévia é gravada uma vez por execução.
 */
export async function registrarTracoDoTurno(
  pool: pg.Pool,
  traco: TracoDoTurno,
  log?: Logger,
): Promise<void> {
  try {
    await pool.query(
      `with chamadas as (
         select coalesce(sum(input_tokens), 0)::int as tokens_in,
                coalesce(sum(output_tokens), 0)::int as tokens_out,
                coalesce(sum(cost_cents), 0)::numeric as cost_cents,
                coalesce(max(latency_ms), 0)::int as latency_ms,
                max(model) as model,
                max(provider) as provider
           from public.llm_calls
          where organization_id = $1 and job_id = $2
       ), skills as (
         select coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'nome', skill_name,
                      'versao_id', skill_version_id,
                      'gatilho', trigger
                    ) order by skill_name, created_at
                  ),
                  '[]'::jsonb
                ) as lista
           from public.skill_activations
          where organization_id = $1 and job_id = $2
       ), fontes as (
         select coalesce(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', id,
                      'versao', active_kb_version_id,
                      'hash', content_hash,
                      'ligada', is_active
                    ) order by id
                  ),
                  '[]'::jsonb
                ) as lista
           from public.ai_knowledge_sources
          where organization_id = $1 and id = any($3::uuid[])
       )
       insert into public.agent_turn_traces (
         organization_id, job_id, preview_run_id, conversation_id, contact_id,
         agent_id, agent_version_id, is_dry_run, status, abort_reason,
         error_code, error_message, provider, model, messages_sent,
         historico_mensagens, tokens_in, tokens_out, cost_cents, latency_ms,
         skills, ferramentas, kb_sources, ferramentas_truncadas
       )
       select $1, $2, $4, $5, $6,
              $7, $8, $9, $10, $11,
              $12, $13, coalesce($14, chamadas.provider), coalesce($15, chamadas.model), $16,
              $17, chamadas.tokens_in, chamadas.tokens_out, chamadas.cost_cents, chamadas.latency_ms,
              skills.lista, $18::jsonb, fontes.lista, $19
         from chamadas, skills, fontes
       on conflict (job_id) where job_id is not null do update set
         agent_id = excluded.agent_id,
         agent_version_id = excluded.agent_version_id,
         provider = excluded.provider,
         model = excluded.model,
         status = excluded.status,
         abort_reason = excluded.abort_reason,
         error_code = excluded.error_code,
         error_message = excluded.error_message,
         messages_sent = excluded.messages_sent,
         historico_mensagens = excluded.historico_mensagens,
         tokens_in = excluded.tokens_in,
         tokens_out = excluded.tokens_out,
         cost_cents = excluded.cost_cents,
         latency_ms = excluded.latency_ms,
         skills = excluded.skills,
         ferramentas = excluded.ferramentas,
         kb_sources = excluded.kb_sources,
         ferramentas_truncadas = excluded.ferramentas_truncadas,
         updated_at = now()`,
      [
        traco.organization_id,
        traco.job_id,
        traco.knowledge_source_ids,
        traco.preview_run_id,
        traco.conversation_id,
        traco.contact_id,
        traco.agent_id,
        traco.agent_version_id,
        traco.is_dry_run,
        traco.status,
        traco.abort_reason,
        traco.error_code,
        traco.error_message,
        traco.provider,
        traco.model,
        traco.messages_sent,
        traco.historico_mensagens,
        JSON.stringify(traco.ferramentas),
        traco.ferramentas_truncadas,
      ],
    );
  } catch (erro) {
    // Observabilidade que derruba o atendimento é pior do que não ter
    // observabilidade: aqui se avisa e o turno segue.
    log?.warn("traço do turno não gravado (o turno segue)", {
      job_id: traco.job_id,
      preview_run_id: traco.preview_run_id,
      erro: erro instanceof Error ? erro.message : String(erro),
    });
  }
}
