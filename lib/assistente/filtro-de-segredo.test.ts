import { describe, expect, it } from "vitest";

import {
  MARCA_DE_SEGREDO,
  detectarSegredo,
  mascararResultado,
  mascararSegredos,
  type TipoDeSegredo,
} from "./filtro-de-segredo";

/**
 * As chaves abaixo são FALSAS e montadas em tempo de execução, em pedaços, de
 * propósito: um literal com cara de chave real num arquivo versionado é
 * exatamente o que os varredores de segredo do repositório recusam.
 */
const corpo = (n: number) => "aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zA".repeat(4).slice(0, n);
const junta = (...partes: string[]) => partes.join("");

const SEGREDOS: Array<[string, TipoDeSegredo, string]> = [
  ["chave da Anthropic", "chave_de_ia", junta("sk", "-ant-", "api03-", corpo(40))],
  ["chave da OpenAI", "chave_de_ia", junta("sk", "-", corpo(48))],
  ["chave de projeto da OpenAI", "chave_de_ia", junta("sk", "-proj-", corpo(48))],
  ["chave da OpenRouter", "chave_de_ia", junta("sk", "-or-", "v1-", corpo(40))],
  ["chave do Google", "chave_de_ia", junta("AI", "za", corpo(35))],
  ["token de API do CRM", "token_do_crm", junta("dsk", "_", corpo(40))],
  ["token do GitHub", "token_de_servico", junta("gh", "p_", corpo(36))],
  ["token fino do GitHub", "token_de_servico", junta("github", "_pat_", corpo(40))],
  ["token do Slack", "token_de_servico", junta("xo", "xb-", "1234567890-", corpo(20))],
  ["chave da Stripe", "token_de_servico", junta("sk", "_live_", corpo(24))],
  ["chave da AWS", "chave_de_nuvem", junta("AK", "IA", "ABCDEFGHIJKLMNOP")],
  ["JWT", "jwt", junta("ey", "J", corpo(20), ".", "ey", "J", corpo(30), ".", corpo(30))],
  ["chave privada", "chave_privada", junta("-----BEGIN RSA ", "PRIVATE KEY-----\n", corpo(64), "\n-----END RSA PRIVATE KEY-----")],
  ["cabeçalho Bearer", "cabecalho_bearer", junta("Authorization: ", "Bearer ", corpo(32))],
];

describe("detectarSegredo: o que NÃO pode seguir para o modelo nem para o histórico", () => {
  for (const [nome, tipo, valor] of SEGREDOS) {
    it(`${nome} sozinha`, () => {
      expect(detectarSegredo(valor)).toBe(tipo);
    });
    it(`${nome} no meio de uma frase`, () => {
      expect(detectarSegredo(`oi Vix, configura aí pra mim: ${valor} obrigado`)).not.toBeNull();
    });
  }

  it.each([
    "minha senha é Abc12345",
    "a senha: tr0ub4dor&3",
    "password = hunter2!",
    "mi contraseña es Secreta99",
    "o token é a1b2c3d4e5",
    "api key: zzTop_2026",
  ])("senha ou token declarado: %s", (frase) => {
    expect(detectarSegredo(frase)).toBe("senha_declarada");
  });

  it.each([
    "o código é 482913",
    "meu código de verificação: 12345678",
    "chegou o code 993311 no celular",
  ])("código de login: %s", (frase) => {
    expect(detectarSegredo(frase)).toBe("codigo_de_login");
  });

  it("sequência longa de alta entropia sem prefixo conhecido", () => {
    expect(detectarSegredo(`cola isso: ${corpo(44)}`)).toBe("sequencia_de_alta_entropia");
  });
});

describe("detectarSegredo: o que PRECISA passar (falso positivo trava o suporte)", () => {
  it.each([
    "onde eu coloco a chave da IA?",
    "esqueci minha senha, como troco?",
    "a chave é configurada na tela de credenciais?",
    "meu token expirou, o que eu faço?",
    "quantos leads entraram essa semana?",
    "por que o agente não respondeu o João às 14h30?",
    "o lead cccccccc-6666-4000-8000-000000000001 está em qual etapa?",
    "o telefone dele é 11987654321",
    "o pedido 20261125 foi pago?",
    "tenho 123456 contatos importados",
    "o código do produto é 778899",
    "qual a diferença entre senha e código de verificação?",
    "o hash do arquivo é d41d8cd98f00b204e9800998ecf8427e",
    "https://app.exemplo.com.br/app/ai/credentials",
    "a proposta vence amanhã e o valor é R$ 12.500,00",
  ])("frase normal: %s", (frase) => {
    expect(detectarSegredo(frase)).toBeNull();
  });
});

describe("mascararSegredos e mascararResultado: a saída", () => {
  it("troca o segredo pela marca e mantém o resto", () => {
    const chave = SEGREDOS[0]![2];
    const saida = mascararSegredos(`a chave cadastrada é ${chave}, válida`);
    expect(saida).not.toContain(chave);
    expect(saida).toContain(MARCA_DE_SEGREDO);
    expect(saida.startsWith("a chave cadastrada é ")).toBe(true);
    expect(saida.endsWith(", válida")).toBe(true);
  });

  it("texto sem segredo volta idêntico", () => {
    const texto = "3 propostas vencem amanhã; a do João é a maior.";
    expect(mascararSegredos(texto)).toBe(texto);
  });

  it("nenhum segredo do corpus sobrevive dentro de um resultado aninhado", () => {
    const resultado = {
      itens: SEGREDOS.map(([nome, , valor]) => ({ nome, observacao: `nota do cliente: ${valor}` })),
    };
    const json = JSON.stringify(mascararResultado(resultado));
    for (const [, , valor] of SEGREDOS) expect(json).not.toContain(valor);
  });

  it("campo com nome de segredo perde o valor, mesmo curto", () => {
    const saida = mascararResultado({
      nome: "Conexão",
      api_key: "abc",
      webhook_secret: "x",
      access_token: "y",
      senha: "123",
      cpf_encrypted: "\\x00",
      provedor: "anthropic",
      tokens_in: 120,
    }) as Record<string, unknown>;
    expect(saida.api_key).toBe(MARCA_DE_SEGREDO);
    expect(saida.webhook_secret).toBe(MARCA_DE_SEGREDO);
    expect(saida.access_token).toBe(MARCA_DE_SEGREDO);
    expect(saida.senha).toBe(MARCA_DE_SEGREDO);
    expect(saida.cpf_encrypted).toBe(MARCA_DE_SEGREDO);
    expect(saida.provedor).toBe("anthropic");
    expect(saida.tokens_in).toBe(120);
    expect(saida.nome).toBe("Conexão");
  });
});
