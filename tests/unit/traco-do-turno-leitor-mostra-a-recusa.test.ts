import { describe, expect, it } from "vitest";

import { reciboDoTraco } from "@/lib/agent-engine/agent/recibo-do-traco";
import { LIMITE_DO_RESULTADO, MARCA_DE_CORTE } from "@/lib/agent-engine/agent/traco-do-turno";

/**
 * O LEITOR DO TRAÇO MOSTRA A RECUSA E O RESULTADO.
 *
 * O leitor (`GET /api/v1/ai/turn-traces`) nasceu sem devolver texto livre
 * nenhum — e por isso, quando o traço passou a guardar o que cada ferramenta
 * devolveu, ele precisava de uma exceção DELIBERADA e cercada: `resultado` sai,
 * mas re-higienizado e re-cortado aqui, sem confiar no que está no banco.
 *
 * O que este arquivo prende:
 *   1. `recusado` é um estado que o leitor conhece (antes viraria `null`);
 *   2. o código de uma recusa sobrevive — passá-lo pelo catálogo de erros de
 *      API trocaria todos por `internal_error`;
 *   3. `resultado` sai higienizado mesmo que o banco guarde dado pessoal ou
 *      chave (linha escrita por outra versão, ou à mão), e nunca passa do teto;
 *   4. linha antiga, sem o campo, devolve `resultado: null` — e o resto do
 *      recibo continua fechado como era.
 */
function recibo(ferramentas: unknown[]) {
  return reciboDoTraco({ ferramentas, skills: [], kb_sources: [] } as never).ferramentas;
}

describe("o leitor do traço mostra a recusa e o resultado", () => {
  it("recusa de agenda: estado, código e o que a ferramenta devolveu", () => {
    const resultado =
      '{"marcado":false,"motivo":"tipo_desconhecido","tipos_validos":[{"slug":"primeira-conversa","nome":"Primeira conversa"}]}';

    expect(
      recibo([
        {
          nome: "crm_find_and_book_appointment",
          estado: "recusado",
          erro: "tipo_desconhecido",
          duracao_ms: 38,
          resultado,
        },
      ]),
    ).toEqual([
      {
        nome: "crm_find_and_book_appointment",
        estado: "recusado",
        erro: "tipo_desconhecido",
        duracao_ms: 38,
        resultado,
      },
    ]);
  });

  it("código de recusa que é prosa, dado pessoal ou chave NÃO passa", () => {
    const [prosa, pessoal, chave] = recibo([
      { nome: "crm_get_contact", estado: "recusado", erro: "a pessoa não quis informar", duracao_ms: 1 },
      { nome: "crm_get_contact", estado: "recusado", erro: "recibo3201@example.test", duracao_ms: 1 },
      { nome: "crm_get_contact", estado: "recusado", erro: "sk-sintetica-nunca-usada", duracao_ms: 1 },
    ]);

    expect(prosa!.erro).toBe("internal_error");
    expect(pessoal!.erro).toBe("internal_error");
    expect(chave!.erro).toBe("internal_error");
  });

  it("fora de `recusado` o erro continua no catálogo fechado", () => {
    // O mesmo texto que passa como código de recusa NÃO passa como erro de falha:
    // a régua de identificador vale só para o estado que a justifica.
    const [falha] = recibo([
      { nome: "crm_get_contact", estado: "falhou", erro: "tipo_desconhecido", duracao_ms: 1 },
    ]);

    expect(falha!.erro).toBe("internal_error");
  });

  it("o resultado é re-higienizado na leitura, mesmo que o banco guarde dado pessoal", () => {
    const [f] = recibo([
      {
        nome: "crm_get_contact",
        estado: "ok",
        erro: null,
        duracao_ms: 12,
        resultado:
          '{"email":"recibo3201@example.test","telefone":"+5511999032010","cpf":"123.456.789-09","chave":"sk-sintetica-3201-nunca-usada","slug":"primeira-conversa"}',
      },
    ]);

    for (const proibido of [
      "recibo3201@example.test",
      "999032010",
      "123.456.789-09",
      "sk-sintetica",
    ]) {
      expect(f!.resultado).not.toContain(proibido);
    }
    expect(f!.resultado).toContain("primeira-conversa");
  });

  it("o resultado nunca passa do teto, mesmo que a linha no banco passe", () => {
    const [f] = recibo([
      { nome: "crm_get_contact", estado: "ok", erro: null, duracao_ms: 1, resultado: "x".repeat(5000) },
    ]);

    expect(f!.resultado).toHaveLength(LIMITE_DO_RESULTADO);
    expect(f!.resultado!.endsWith(MARCA_DE_CORTE)).toBe(true);
  });

  it("linha antiga (sem o campo) e resultado que não é texto devolvem `null`", () => {
    const [antiga, objeto, vazio] = recibo([
      { nome: "send_message", estado: "ok", erro: null, duracao_ms: 4 },
      { nome: "send_message", estado: "ok", erro: null, duracao_ms: 4, resultado: { body: "oi" } },
      { nome: "send_message", estado: "ok", erro: null, duracao_ms: 4, resultado: "" },
    ]);

    expect(antiga!.resultado).toBeNull();
    expect(objeto!.resultado).toBeNull();
    expect(vazio!.resultado).toBeNull();
  });

  it("o recibo de ferramenta continua fechado: só as cinco chaves", () => {
    const [f] = recibo([
      {
        nome: "crm_get_contact",
        estado: "recusado",
        erro: "fora_da_conversa",
        duracao_ms: 3,
        resultado: "{}",
        arguments: { body: "segredo" },
        extra: "x",
      },
    ]);

    expect(Object.keys(f!).sort()).toEqual(["duracao_ms", "erro", "estado", "nome", "resultado"]);
  });
});
