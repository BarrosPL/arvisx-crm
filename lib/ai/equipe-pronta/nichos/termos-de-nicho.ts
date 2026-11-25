/**
 * OS RADICAIS DE RAMO QUE OS TEXTOS UNIVERSAIS DA EQUIPE PRONTA NÃO PODEM TER.
 *
 * As duas listas já existiam, cada uma dentro do seu teste
 * (`../papeis.test.ts` e `../gatilhos/fluxos.test.ts`). Vieram para cá SEM
 * MUDAR UM ITEM, para a cerca nova (`nichos.test.ts`) usar a mesma régua em vez
 * de uma terceira cópia. Cada teste continua barrando exatamente o que barrava:
 * `nichos.test.ts` fixa o conteúdo das duas, item por item.
 *
 * Moram dentro de `nichos/` porque esta é a única pasta da equipe pronta que
 * pode escrever palavra de ramo — a própria lista é feita delas.
 *
 * Radical, e não palavra, para pegar plural e derivado. Só se acrescenta: tirar
 * um item afrouxa a cerca dos papéis.
 */

/** A régua dos papéis e das regras comuns (`../papeis.test.ts`). */
export const TERMOS_DE_NICHO_DOS_PAPEIS = [
  "clínic",
  "clinic",
  "pacient",
  "odonto",
  "dentist",
  "dental",
  "médic",
  "medic",
  "consultório",
  "exame",
  "cirurgi",
  "tratamento",
  "procedimento",
  "imóve",
  "imóvel",
  "imovel",
  "imobili",
  "corretor",
  "alun",
  "matrícul",
  "matricul",
  "escola",
  "curso",
  "advog",
  "jurídic",
  "juridic",
  "processo judicial",
  "cidadania",
  "visto",
  "imigra",
  "restaurante",
  "cardápio",
  "salão",
  "estétic",
  "petshop",
  "veterin",
  "academia",
] as const;

/** A régua das orientações dos fluxos de gatilho (`../gatilhos/fluxos.test.ts`). */
export const TERMOS_DE_NICHO_DOS_FLUXOS = [
  "clínic",
  "pacient",
  "consultório",
  "tratamento",
  "procedimento",
  "imóve",
  "alun",
  "curso",
  "advog",
] as const;

/** A união das duas, sem repetição: a régua da cerca "só `nichos/` cita ramo". */
export const TERMOS_DE_NICHO: readonly string[] = [
  ...new Set<string>([...TERMOS_DE_NICHO_DOS_PAPEIS, ...TERMOS_DE_NICHO_DOS_FLUXOS]),
];
