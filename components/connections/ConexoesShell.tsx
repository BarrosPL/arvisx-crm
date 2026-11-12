"use client";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { RedesSociaisClient } from "./RedesSociaisClient";
import { CanalGraphParceiroClient } from "./CanalGraphParceiroClient";
import { CanalOficialClient } from "./CanalOficialClient";
import { CanalVozClient } from "./CanalVozClient";
import { ConnectionsClient } from "./ConnectionsClient";
import { TemplatesClient } from "./TemplatesClient";
import { TemplatesParceiroClient } from "./TemplatesParceiroClient";
import { TelefoniaClient } from "./TelefoniaClient";
import { useT } from "@/hooks/i18n/useT";
import { rotaDeTemplates } from "@/lib/channels/templates-fonte";

/**
 * Conexões — TODOS os canais em um lugar só.
 *
 * ─── Por que isto existe ────────────────────────────────────────────────────
 * Conectar o número por QR ficava aqui; conectar o número OFICIAL ficava em
 * Configurações; os templates, que só existem por causa do canal oficial, ficavam
 * numa terceira tela. Três lugares para uma coisa só — e o usuário precisava saber
 * de antemão que a resposta para "conectar meu WhatsApp" dependia de QUAL WhatsApp.
 *
 * A pergunta que a tela responde é "por onde meu negócio fala com o cliente". A
 * resposta é uma lista de canais, não um mapa do nosso código: quem instala não
 * sabe (nem deve saber) que um passa por QR e o outro por credencial da Meta.
 *
 * Templates entram como sub-aba do canal oficial, e não como item de topo, porque
 * eles NÃO existem fora dele: num canal por QR não há template a aprovar. Promovê-los
 * a item de primeiro nível sugeriria uma escolha que não existe.
 *
 * ─── A aba vive na URL ──────────────────────────────────────────────────────
 * `?aba=` e `?sub=` em vez de estado só em memória: as rotas antigas
 * (`/app/settings/canal-oficial`, `/app/settings/templates`) redirecionam para cá
 * apontando a aba certa, e um link colado no chat abre onde deveria. Aba que só
 * existe em `useState` transforma todo link salvo em "abre e procura de novo".
 */
export function ConexoesShell({
  wahaConfigured,
  wacallsConfigured,
  graphParceiro = null,
}: {
  wahaConfigured: boolean;
  wacallsConfigured: boolean;
  /**
   * O canal parceiro que espelha a Cloud API (recorte do #1130) é OPCIONAL DA
   * INSTALAÇÃO e nasce desligado (decisão do dono, doc 54). `null` = a
   * instalação não o liga, e a aba nem é montada — nem por `?aba=` na URL.
   * O rótulo vem do servidor porque a tela não pode nomear provider.
   */
  graphParceiro?: { label: string } | null;
}) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const abaParam = params.get("aba");
  const aba =
    abaParam === "sociais"
      ? "sociais"
      : abaParam === "oficial"
      ? "oficial"
      : abaParam === "telefonia"
        ? "telefonia"
        : abaParam === "voz"
          ? "voz"
          : abaParam === "graph" && graphParceiro
            ? "graph"
            : "numeros";
  // `?aba=parceiro` não é mais uma aba (decisão do dono, 12/11/2026: o cliente não
  // vê a conexão do WhatsApp por parceiro). Cai na aba padrão, como qualquer valor
  // desconhecido, para os links antigos e a volta de `app/auth/partner-return`
  // não abrirem uma tela vazia. Os componentes do parceiro (`CanalParceiroClient`,
  // `TemplatesParceiroClient` sem rota) e o backend dele continuam no repositório.
  const sub = params.get("sub") === "templates" ? "templates" : "conexao";

  const irPara = (proximaAba: string, proximaSub?: string): void => {
    const q = new URLSearchParams();
    if (proximaAba !== "numeros") q.set("aba", proximaAba);
    if (proximaSub && proximaSub !== "conexao") q.set("sub", proximaSub);
    const qs = q.toString();
    // `scroll: false`: trocar de aba não é navegar para outra página; jogar o
    // usuário para o topo a cada clique faz a tela parecer que recarregou.
    router.replace(qs ? `/app/connections?${qs}` : "/app/connections", { scroll: false });
  };

  return (
    <Tabs value={aba} onValueChange={(v) => irPara(v, sub)} className="flex flex-col gap-4">
      <TabsList className="h-auto max-w-full flex-wrap justify-start">
        {/* Rótulos pelo que o usuário RECONHECE, não pelo nome técnico do motor por
            trás: ele sabe se leu um QR ou se tem conta na Meta; a sigla do provedor
            não diz nada a quem instalou o sistema para vender.

            Este comentário já citou a sigla como exemplo — e o `lint:channels`
            reprovou, porque o regex da doutrina não distingue prosa de código
            (limitação registrada no próprio `scripts/lint-channels.ts`). Reescrever
            a frase custou menos que abrir exceção no gate, e o gate continua
            estrito: o dia em que alguém escrever o nome do provider aqui DE VERDADE,
            ele reprova igual. */}
        <TabsTrigger value="numeros">{t("Números por QR")}</TabsTrigger>
        <TabsTrigger value="oficial">{t("API Oficial (Meta)")}</TabsTrigger>
        <TabsTrigger value="telefonia">{t("Telefone")}</TabsTrigger>
        {/* O valor continua `sociais` (links salvos e as voltas de OAuth dependem
            dele); o rótulo diz o que a aba conecta: Messenger e Instagram, direto
            pela Meta. */}
        <TabsTrigger value="sociais">{t("Facebook / Instagram")}</TabsTrigger>
        <TabsTrigger value="voz">{t("Chamada de voz")}</TabsTrigger>
        {graphParceiro && <TabsTrigger value="graph">{graphParceiro.label}</TabsTrigger>}
      </TabsList>

      <TabsContent value="numeros" className="mt-0">
        <ConnectionsClient wahaConfigured={wahaConfigured} />
      </TabsContent>

      <TabsContent value="telefonia" className="mt-0">
        <TelefoniaClient />
      </TabsContent>
      <TabsContent value="sociais" className="mt-0"><RedesSociaisClient /></TabsContent>

      <TabsContent value="voz" className="mt-0">
        <CanalVozClient wacallsConfigured={wacallsConfigured} />
      </TabsContent>

      {graphParceiro && (
        <TabsContent value="graph" className="mt-0">
          {/* Sub-abas como nas demais: conectar e gerenciar modelos são tarefas
              diferentes. O componente de modelos é o MESMO do outro parceiro,
              apontado para a rota desta fonte. */}
          <Tabs value={sub} onValueChange={(v) => irPara("graph", v)} className="flex flex-col gap-4">
            <TabsList>
              <TabsTrigger value="conexao">{t("Conexão")}</TabsTrigger>
              <TabsTrigger value="templates">{t("Modelos")}</TabsTrigger>
            </TabsList>
            <TabsContent value="conexao" className="mt-0">
              <CanalGraphParceiroClient />
            </TabsContent>
            <TabsContent value="templates" className="mt-0">
              {/* Editar e apagar valem aqui como no outro parceiro: desde a
                  #1734 o alvo resolve o id da variante (nome + idioma) antes de
                  falar com a plataforma, então a tela apaga UMA tradução, não
                  todas (#1728 era este o motivo de ficar desligado). */}
              <TemplatesParceiroClient rota={rotaDeTemplates("graph")} />
            </TabsContent>
          </Tabs>
        </TabsContent>
      )}

      <TabsContent value="oficial" className="mt-0">
        <Tabs value={sub} onValueChange={(v) => irPara("oficial", v)} className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="conexao">{t("Conexão")}</TabsTrigger>
            {/* "Templates da Meta", não "Templates": a barra lateral já tem um item
                com esse nome que significa OUTRA coisa — respostas rápidas salvas
                pelo atendente (`/app/templates`). Dois conceitos com o mesmo rótulo
                fazem o operador clicar no errado e concluir que a tela está quebrada.
                A colisão é anterior a esta mudança; o que dá para fazer aqui é não
                agravá-la. */}
            <TabsTrigger value="templates">{t("Templates da Meta")}</TabsTrigger>
          </TabsList>
          <TabsContent value="conexao" className="mt-0">
            <CanalOficialClient />
          </TabsContent>
          <TabsContent value="templates" className="mt-0">
            <TemplatesClient />
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  );
}
