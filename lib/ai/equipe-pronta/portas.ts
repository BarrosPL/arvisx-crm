/**
 * AS PORTAS DE PRODUÇÃO DO INSTALADOR — o que toca o mundo de fora.
 *
 * Cada porta é uma chamada ao que o produto JÁ usa para a mesma coisa pela
 * tela: o storage da base de conhecimento, a função de publicação do agente, a
 * do fluxo de follow-up, a da memória e a RPC do acesso da IA no canal. Nada
 * aqui decide regra; a regra é do instalador (`instalar.ts`).
 */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { publicarMemoriaDaOrg } from "@/lib/ai/memoria-da-org";
import { provedorOferecido } from "@/lib/ai/pontos/provedores-oferecidos";
import { BUCKET_DE_CONHECIMENTO } from "@/lib/ai/rag/ingest/documento";
import { publishFollowupFlowVersion } from "@/lib/followup/publish";
import { AgentSetupError, resolveSetupModel } from "@/lib/prospecting/agent-setup";
import { EquipeProntaError, type PortasDoInstalador } from "./instalar";

export function portasDeProducao(admin: SupabaseClient): PortasDoInstalador {
  return {
    async guardarTextoDaBase(orgId, texto) {
      // Texto colado vira arquivo `.md` no mesmo bucket dos documentos, como em
      // `POST /api/v1/ai/knowledge/sources`: um destino, um caminho de extração.
      const caminho = `${orgId}/${randomUUID()}.md`;
      const { error } = await admin.storage
        .from(BUCKET_DE_CONHECIMENTO)
        .upload(caminho, Buffer.from(texto, "utf8"), { contentType: "text/markdown", upsert: false });
      if (error) {
        throw new EquipeProntaError(
          "base_nao_guardada",
          "Não foi possível guardar o texto da base de conhecimento. Tente de novo.",
          500,
        );
      }
      return caminho;
    },

    async avisarQueAFonteMudou(orgId, fonteId) {
      await admin.rpc("emit_event" as never, {
        p_event_type: "knowledge_source.updated",
        p_entity_kind: "ai_knowledge_source",
        p_entity_id: fonteId,
        p_payload: { knowledge_source_id: fonteId, agent_id: null, source_type: "documento" },
        p_organization_id: orgId,
      } as never);
    },

    async publicarMemoria(orgId, userId, conteudo) {
      const r = await publicarMemoriaDaOrg(admin, orgId, userId, conteudo);
      if (!r.ok) {
        throw new EquipeProntaError(
          "memoria_nao_publicada",
          "Não foi possível gravar o resumo do negócio. Tente de novo.",
          500,
        );
      }
    },

    async publicarRegua({ orgId, pointerId, grafo, userId }) {
      const r = await publishFollowupFlowVersion(admin, {
        orgId,
        pointerId,
        graph: grafo,
        createdBy: userId,
      });
      if (!r.ok) {
        throw new EquipeProntaError(
          "regua_nao_publicada",
          "Não foi possível publicar o follow-up de recuperação. Tente de novo.",
          500,
        );
      }
    },

    async publicarAgente({ orgId, agentId, versionId }) {
      const r = await publishAgentVersion(admin, { orgId, agentId, versionId });
      return r.ok ? { ok: true } : { ok: false, code: r.code };
    },

    async porCanalEmEnsaio(orgId, canalId, telefones) {
      const { error } = await admin.rpc("fn_configurar_pre_go_live_canal", {
        p_org: orgId,
        p_canal: canalId,
        p_modo: "pre_go_live",
        p_numeros: telefones,
      });
      if (error) {
        throw new EquipeProntaError(
          "ensaio_nao_configurado",
          "A equipe foi instalada, mas não foi possível pôr o canal em ensaio. Confira o acesso da IA em Conexões.",
          500,
        );
      }
    },

    async escolherModelo(db, orgId, canalId) {
      try {
        const m = await resolveSetupModel(db, orgId, canalId, await provedorOferecido(admin));
        return { provider: m.provider, model: m.model, credential_id: m.credential_id };
      } catch (e) {
        if (e instanceof AgentSetupError) {
          throw new EquipeProntaError("sem_chave_de_ia", e.message, 422);
        }
        throw e;
      }
    },
  };
}
