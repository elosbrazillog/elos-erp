// Utilidades de impressão de boleto (padrão Febraban). Os números (nosso número,
// linha digitável e código de barras) vêm do banco no registro; aqui só desenhamos.

const ITF: Record<string, string> = {
  "0": "00110", "1": "10001", "2": "01001", "3": "11000", "4": "00101",
  "5": "10100", "6": "01100", "7": "00011", "8": "10010", "9": "01010",
};

/** Barras do código Interleaved 2 of 5: lista de [largura, é barra] em módulos (fina = 1, grossa = 3) */
export function barrasItf(codigo: string): { x: number; w: number }[] {
  const d = codigo.replace(/\D/g, "");
  if (d.length === 0 || d.length % 2 !== 0) return [];
  const seq: [number, boolean][] = [[1, true], [1, false], [1, true], [1, false]]; // início
  for (let i = 0; i < d.length; i += 2) {
    const b = ITF[d[i]], e = ITF[d[i + 1]];
    for (let k = 0; k < 5; k++) {
      seq.push([b[k] === "1" ? 3 : 1, true]);
      seq.push([e[k] === "1" ? 3 : 1, false]);
    }
  }
  seq.push([3, true], [1, false], [1, true]); // fim
  const barras: { x: number; w: number }[] = [];
  let x = 0;
  for (const [w, barra] of seq) {
    if (barra) barras.push({ x, w });
    x += w;
  }
  return barras;
}

export const larguraItf = (codigo: string) => {
  const b = barrasItf(codigo);
  return b.length ? b[b.length - 1].x + b[b.length - 1].w : 0;
};

/** 47 dígitos → "AAAAA.AAAAA BBBBB.BBBBBB CCCCC.CCCCCC D EEEEEEEEEEEEEE" */
export function formatarLinhaDigitavel(v: string | null) {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 47) return v ?? "";
  return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
}

export const NOME_BANCO: Record<string, string> = { "748": "Sicredi", "001": "Banco do Brasil", "104": "Caixa", "237": "Bradesco", "341": "Itaú", "756": "Sicoob" };
export const DV_BANCO: Record<string, string> = { "748": "X", "001": "9", "104": "0", "237": "2", "341": "7", "756": "0" };
