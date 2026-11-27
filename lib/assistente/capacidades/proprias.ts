/**
 * AS CAPACIDADES PRÓPRIAS DO VIX: ajuda, guia de telas, diagnóstico, leitura
 * de configuração e abrir chamado.
 *
 * Todas leem com o cliente de SESSÃO (`ctx.db`): o que a pessoa não vê pela
 * tela, não vê por aqui. Nenhuma devolve segredo; a de credencial lê a view
 * `_safe`, e ainda assim só os campos de estado.
 *
 * A única escrita é abrir chamado, que grava só na tabela do próprio
 * assistente e passa por cartão como toda escrita.
 */
import { z } from "zod";

import { buscar, indiceDeBusca } from "@/lib/ajuda/treinamento/busca";
import { treinamento } from "@/lib/ajuda/treinamento/conteudo";
import { roleAtLeast } from "@/lib/auth/types";
import { listarConexoesCaidas } from "@/lib/channels/health";
import { telaForaDoPlano } from "@/lib/cobranca/trava-do-plano";
import { capacidadesDaOrganizacao } from "@/lib/organizacao/capacidades";
import { modulosLigados } from "@/lib/instalacao/modulos";
import { NAV_CATALOG, type NavMetadata } from "@/lib/navigation/catalogo";
import { createAdminClient } from "@/lib/supabase/admin";

import { capacidade, type Capacidade } from "../tipos";

export const TESTE_DAS_PROPRIAS = "tests/invariants/assistente-proprias-isolamento.test.ts";

const DESTINOS = NAV_CATALOG as readonly NavMetadata[];

const semAcento = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Palavras de ligação: a busca da ajuda exige TODOS os termos, e elas nunca estão nos títulos. */
const PALAVRAS_DE_LIGACAO = new Set(
  "a o as os um uma uns umas de da do das dos em no na nos nas por pelo pela para pra com sem que e ou eu me meu minha meus minhas seu sua como qual quais onde quando quero preciso posso fazer faco faço ter tenho tem vou ser esta está sao são isso isto mais muito aqui la lá".split(
    " ",
  ),
);

function combinacoes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (tamanho === 0) return [[]];
  if (itens.length < tamanho) return [];
  const [primeiro, ...resto] = itens as [T, ...T[]];
  return [...combinacoes(resto, tamanho - 1).map((c) => [primeiro, ...c]), ...combinacoes(resto, tamanho)];
}

/**
 * A busca da ajuda exige todos os termos. Uma pergunta inteira ("como eu conecto
 * o WhatsApp da minha empresa") nunca casa, e o Vix responderia "a ajuda não
 * trouxe nada". Tenta a consulta como veio; sem resultado, tira as palavras de
 * ligação; sem resultado, junta o que cada palavra-chave achou, ordenado por
 * quantas palavras casaram.
 */
function buscarNaAjuda(indice: ReturnType<typeof indiceDeBusca>, consulta: string, limite: number) {
  const direto = buscar(indice, consulta, limite);
  if (direto.length > 0) return direto;
  const chaves = semAcento(consulta)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !PALAVRAS_DE_LIGACAO.has(w))
    // Radical: "conecto" e "conectar" são a mesma busca.
    .map((w) => (w.length >= 7 ? w.slice(0, 6) : w));
  if (chaves.length === 0) return [];
  const sem = buscar(indice, chaves.join(" "), limite);
  if (sem.length > 0) return sem;
  // Tira uma palavra por vez (a mais genérica costuma ser a que atrapalha), do maior grupo para o menor.
  for (let tamanho = chaves.length - 1; tamanho >= 2; tamanho--) {
    const achados = new Map<string, ReturnType<typeof buscar>[number]>();
    for (const grupo of combinacoes(chaves, tamanho)) {
      for (const r of buscar(indice, grupo.join(" "), limite)) if (!achados.has(r.href)) achados.set(r.href, r);
    }
    if (achados.size > 0) return [...achados.values()].slice(0, limite);
  }
  const pontos = new Map<string, { r: ReturnType<typeof buscar>[number]; n: number; melhor: number }>();
  for (const w of chaves) {
    buscar(indice, w, 20).forEach((r, posicao) => {
      const atual = pontos.get(r.href);
      if (atual) {
        atual.n += 1;
        atual.melhor = Math.min(atual.melhor, posicao);
      } else pontos.set(r.href, { r, n: 1, melhor: posicao });
    });
  }
  return [...pontos.values()]
    .sort((a, b) => b.n - a.n || a.melhor - b.melhor)
    .slice(0, limite)
    .map((x) => x.r);
}

// ───────────────────────────── ajuda ─────────────────────────────

const MAXIMO_DE_LICOES = 3;
const MAXIMO_DE_PASSOS = 8;
const MAXIMO_DO_TEXTO_DO_PASSO = 700;

/** Dúvida de uso: busca no treinamento do produto (`content/ajuda-curso/`). */
const ajudaBuscar = capacidade({
  nome: "ajuda_buscar",
  descricao:
    "Busca na ajuda do produto as lições que respondem a uma dúvida de USO. Passe PALAVRAS-CHAVE curtas (ex.: conexões whatsapp, criar agente), não a pergunta inteira; se vier vazio, tente outras palavras. Devolve o PASSO A PASSO já escrito, com o nome dos menus e dos botões como o usuário os vê. Responda com esse conteúdo, nas suas palavras. Nunca mande o usuário procurar nem ler a ajuda, e nunca cite endereços.",
  nivel: "ler",
  papelMinimo: "viewer",
  rotaDaTela: null,
  entrada: z.object({ consulta: z.string().trim().min(2).max(200) }),
  temInverso: "nao_se_aplica",
  teste: "lib/assistente/capacidades/proprias.test.ts",
  origem: { tipo: "propria" },
  executar: async ({ consulta }) => {
    const dados = treinamento();
    const achados = buscarNaAjuda(indiceDeBusca(dados), consulta, 12);
    const vistas = new Set<string>();
    const licoes: unknown[] = [];
    const historias: { titulo: string; resumo: string }[] = [];
    for (const r of achados) {
      if (r.tipo === "historia") {
        if (historias.length < 2) historias.push({ titulo: r.titulo, resumo: r.trecho });
        continue;
      }
      if (!r.ids || licoes.length >= MAXIMO_DE_LICOES) continue;
      const chave = `${r.ids.modulo}/${r.ids.licao}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      const modulo = dados.modulos.find((m) => m.id === r.ids?.modulo);
      const licao = modulo?.licoes.find((l) => l.id === r.ids?.licao);
      if (!modulo || !licao) continue;
      licoes.push({
        licao: licao.titulo,
        objetivo: licao.objetivo,
        // O nome do item de menu, como a pessoa lê, e não o endereço.
        tela_no_menu: DESTINOS.find((d) => d.href === modulo.tela)?.label ?? modulo.titulo,
        passos: licao.passos.slice(0, MAXIMO_DE_PASSOS).map((p) => ({
          passo: p.titulo,
          o_que_fazer: p.texto.slice(0, MAXIMO_DO_TEXTO_DO_PASSO),
          ...(p.dica ? { dica: p.dica.slice(0, 300) } : {}),
          ...(p.aviso ? { aviso: p.aviso.slice(0, 300) } : {}),
        })),
      });
    }
    return { licoes, ...(historias.length ? { historias_de_clientes: historias } : {}) };
  },
});

// ───────────────────────────── guia de telas ─────────────────────────────

/**
 * Apontar a tela certa. O `href` precisa existir no catálogo de navegação, e a
 * pessoa precisa alcançá-lo: papel, módulo, capacidade da empresa e plano. O
 * modelo nunca devolve endereço livre.
 */
const telasApontar = capacidade({
  nome: "telas_apontar",
  descricao:
    "Confere se uma tela do CRM existe e se ESTE usuário pode abri-la, e faz o painel mostrar o botão de abrir. Passe em `nome` o NOME da tela como aparece no menu do sistema (ex.: Conexões, Agentes, Credenciais de IA); NUNCA um endereço. Use sempre que for levar o usuário a uma tela. Se o nome não existir, a resposta traz `parecidas` com os nomes certos.",
  nivel: "ler",
  papelMinimo: "viewer",
  rotaDaTela: null,
  entrada: z.object({
    nome: z.string().trim().min(2).max(80).optional(),
    // Só para o código e os testes: o modelo não conhece endereços e passa o `nome`.
    href: z.string().trim().startsWith("/app").max(200).optional(),
  }),
  temInverso: "nao_se_aplica",
  teste: "lib/assistente/capacidades/proprias.test.ts",
  origem: { tipo: "propria" },
  executar: async ({ nome, href }, ctx) => {
    const procurado = nome ? semAcento(nome) : null;
    const destino = href
      ? DESTINOS.find((d) => d.href === href)
      : procurado
        ? (DESTINOS.find((d) => semAcento(d.label) === procurado) ??
          DESTINOS.find((d) => semAcento(d.label).includes(procurado)))
        : undefined;
    if (!destino) {
      const parecidas = procurado
        ? DESTINOS.filter((d) => procurado.split(" ").some((w) => w.length >= 3 && semAcento(d.label).includes(w)))
            .slice(0, 6)
            .map((d) => d.label)
        : [];
      return { existe: false, motivo: "tela_desconhecida", ...(parecidas.length ? { parecidas } : {}) };
    }
    if (destino.minRole && !roleAtLeast(ctx.papel, destino.minRole)) {
      return { existe: true, pode_abrir: false, motivo: "papel_insuficiente", nome: destino.label };
    }
    if (destino.modulo || destino.capacidade) {
      const admin = createAdminClient();
      if (destino.modulo && !(await modulosLigados(admin)).includes(destino.modulo)) {
        return { existe: true, pode_abrir: false, motivo: "recurso_desligado", nome: destino.label };
      }
      if (destino.capacidade && !(await capacidadesDaOrganizacao(admin, ctx.orgId)).includes(destino.capacidade)) {
        return { existe: true, pode_abrir: false, motivo: "recurso_desligado", nome: destino.label };
      }
    }
    if (await telaForaDoPlano(ctx.orgId, destino.href)) {
      return { existe: true, pode_abrir: false, motivo: "fora_do_plano", nome: destino.label, abrir: "/app/fora-do-plano" };
    }
    return { existe: true, pode_abrir: true, nome: destino.label, descricao: destino.description, abrir: destino.href };
  },
});

// ───────────────────────────── diagnóstico ─────────────────────────────

/** "Meu WhatsApp caiu?": as conexões da empresa e quais estão fora do ar. */
const diagnosticoCanais = capacidade({
  nome: "diagnostico_canais",
  descricao:
    "Lê o estado das conexões de canal da empresa (WhatsApp e outros): quantas existem e quais estão fora do ar agora. Use para responder 'meu WhatsApp caiu?' e como primeiro passo de 'por que o agente não respondeu?'.",
  nivel: "ler",
  papelMinimo: "viewer",
  rotaDaTela: { caminho: "/api/v1/channel-sessions", metodo: "GET" },
  entrada: z.object({}),
  temInverso: "nao_se_aplica",
  teste: TESTE_DAS_PROPRIAS,
  origem: { tipo: "propria" },
  executar: async (_entrada, ctx) => {
    const [caidas, todas] = await Promise.all([
      listarConexoesCaidas(ctx.db, ctx.orgId),
      ctx.db
        .from("channel_sessions")
        .select("id, display_name, status, provider")
        .eq("organization_id", ctx.orgId)
        .is("archived_at", null),
    ]);
    const linhas = (todas.data ?? []) as { id: string; display_name: string | null; status: string | null; provider: string | null }[];
    return {
      total_de_conexoes: linhas.length,
      conexoes: linhas.map((l) => ({ id: l.id, nome: l.display_name, status: l.status, tipo: l.provider })),
      fora_do_ar: caidas.map((c) => ({ id: c.id, nome: c.apelido, status: c.status })),
    };
  },
});

/**
 * "Por que o agente não respondeu?": os últimos turnos do agente numa conversa.
 * De gerente para cima, como a tela de Execuções.
 */
const diagnosticoTurno = capacidade({
  nome: "diagnostico_turno",
  descricao:
    "Lê os últimos turnos do agente de IA numa conversa: se respondeu, se abortou e por quê, erro, modelo e as ferramentas que chamou com o desfecho de cada uma. Use para explicar 'por que o agente não respondeu' ou 'por que fez isso'. Precisa do `conversation_id`.",
  nivel: "ler",
  papelMinimo: "manager",
  rotaDaTela: { caminho: "/api/v1/ai/turn-traces", metodo: "GET" },
  entrada: z.object({ conversation_id: z.string().uuid(), limite: z.number().int().min(1).max(5).optional() }),
  temInverso: "nao_se_aplica",
  teste: TESTE_DAS_PROPRIAS,
  origem: { tipo: "propria" },
  executar: async ({ conversation_id, limite }, ctx) => {
    const { data, error } = await ctx.db
      .from("agent_turn_traces")
      .select("id, status, abort_reason, error_code, error_message, model, messages_sent, is_dry_run, ferramentas, created_at")
      .eq("organization_id", ctx.orgId)
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: false })
      .limit(limite ?? 3);
    if (error) throw new Error("leitura_do_traco_falhou");
    return { turnos: data ?? [] };
  },
});

// ───────────────────────────── configuração ─────────────────────────────

/** A credencial de IA da empresa existe e é válida? Nunca o segredo. */
const configuracaoCredencialDeIa = capacidade({
  nome: "configuracao_credencial_de_ia",
  descricao:
    "Diz se a empresa tem credencial de IA cadastrada para os agentes de atendimento, de qual provedor, se está ativa e se foi validada. Nunca devolve a chave. Para cadastrar ou trocar a chave, mande o usuário à tela /app/ai/credentials.",
  nivel: "ler",
  papelMinimo: "manager",
  rotaDaTela: { caminho: "/api/v1/ai/credentials", metodo: "GET" },
  entrada: z.object({}),
  temInverso: "nao_se_aplica",
  teste: TESTE_DAS_PROPRIAS,
  origem: { tipo: "propria" },
  executar: async (_entrada, ctx) => {
    const { data, error } = await ctx.db
      .from("ai_provider_credentials_safe")
      .select("id, provider, label, is_active, validated_at, validation_error")
      .eq("organization_id", ctx.orgId);
    if (error) throw new Error("leitura_da_credencial_falhou");
    const linhas = (data ?? []) as {
      id: string;
      provider: string;
      label: string | null;
      is_active: boolean;
      validated_at: string | null;
      validation_error: string | null;
    }[];
    return {
      ia_configurada: linhas.length > 0,
      provedores: linhas.map((l) => ({
        provedor: l.provider,
        nome: l.label,
        ativa: l.is_active,
        validada: l.validated_at !== null,
        tem_erro_de_validacao: l.validation_error !== null,
      })),
    };
  },
});

/** Os agentes de IA da empresa e o estado de cada um. */
const configuracaoAgentes = capacidade({
  nome: "configuracao_agentes",
  descricao:
    "Lista os agentes de IA da empresa com o estado de cada um: publicado ou rascunho, pausado ou não. Use para saber o que a empresa já montou antes de recomendar algo.",
  nivel: "ler",
  papelMinimo: "manager",
  rotaDaTela: { caminho: "/api/v1/ai/agents", metodo: "GET" },
  entrada: z.object({}),
  temInverso: "nao_se_aplica",
  teste: TESTE_DAS_PROPRIAS,
  origem: { tipo: "propria" },
  executar: async (_entrada, ctx) => {
    const { data, error } = await ctx.db
      .from("ai_agents")
      .select("id, name, published_version_id, paused_at, created_at")
      .eq("organization_id", ctx.orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false });
    if (error) throw new Error("leitura_dos_agentes_falhou");
    const linhas = (data ?? []) as { id: string; name: string; published_version_id: string | null; paused_at: string | null }[];
    return {
      agentes: linhas.map((a) => ({
        id: a.id,
        nome: a.name,
        publicado: a.published_version_id !== null,
        pausado: a.paused_at !== null,
      })),
    };
  },
});

/** O que o plano da empresa NÃO libera, para o Vix explicar e oferecer o upgrade. */
const configuracaoPlano = capacidade({
  nome: "configuracao_plano",
  descricao:
    "Lista as telas do CRM que o plano da empresa NÃO libera. Use quando o usuário pedir algo que pode estar fora do plano: explique que a função não está no plano e que a troca de plano é feita em /app/settings/billing. Nunca contorne.",
  nivel: "ler",
  papelMinimo: "viewer",
  rotaDaTela: null,
  entrada: z.object({}),
  temInverso: "nao_se_aplica",
  teste: "lib/assistente/capacidades/proprias.test.ts",
  origem: { tipo: "propria" },
  executar: async (_entrada, ctx) => {
    const fora: { nome: string; tela: string }[] = [];
    for (const d of DESTINOS) {
      if (await telaForaDoPlano(ctx.orgId, d.href)) fora.push({ nome: d.label, tela: d.href });
    }
    return { fora_do_plano: fora, tudo_liberado: fora.length === 0 };
  },
});

// ───────────────────────────── chamado ─────────────────────────────

const entradaDoChamado = z.object({
  resumo: z.string().trim().min(10).max(500),
  /** O que o Vix já conferiu, em frases curtas. Texto, não dado bruto. */
  diagnostico: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
});

/**
 * Abrir chamado para a equipe da plataforma. É escrita (cartão), mas só grava
 * na tabela do próprio assistente: fica disponível mesmo com as escritas do
 * CRM desligadas.
 */
const suporteAbrirChamado = capacidade({
  nome: "suporte_abrir_chamado",
  descricao:
    "Propõe abrir um chamado para a equipe de suporte da plataforma, com um resumo do problema e o que você já conferiu. Use quando não conseguir resolver com as leituras e a ajuda. O chamado só é aberto depois que o usuário confirmar no cartão.",
  nivel: "escrever",
  papelMinimo: "viewer",
  rotaDaTela: null,
  entrada: entradaDoChamado,
  temInverso: false,
  teste: TESTE_DAS_PROPRIAS,
  origem: { tipo: "propria" },
  preparar: async ({ resumo }) => ({
    resumo: `Abrir um chamado para a equipe de suporte: ${resumo}`,
    itens: [{ id: "chamado", rotulo: resumo }],
  }),
  executar: async ({ resumo, diagnostico }, ctx) => {
    // Cliente de serviço: a tabela é escrita só pelo servidor. A organização e
    // o usuário são os da SESSÃO.
    const { data, error } = await createAdminClient()
      .from("assistente_chamados")
      .insert({
        organization_id: ctx.orgId,
        user_id: ctx.userId,
        resumo,
        diagnostico: { itens: diagnostico ?? [] },
      })
      .select("id")
      .single();
    if (error) throw new Error("chamado_nao_gravado");
    return { chamado_id: (data as { id: string }).id, aberto: true };
  },
});

export const CAPACIDADES_PROPRIAS: readonly Capacidade[] = [
  ajudaBuscar,
  telasApontar,
  diagnosticoCanais,
  diagnosticoTurno,
  configuracaoCredencialDeIa,
  configuracaoAgentes,
  configuracaoPlano,
  suporteAbrirChamado,
];
