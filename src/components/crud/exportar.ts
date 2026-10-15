"use client";
import { dataLocal } from "@/lib/utils";

/** Gera e baixa uma planilha .xlsx no navegador */
export async function exportarExcel(nome: string, cabecalho: string[], linhas: (string | number)[][]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(nome.slice(0, 31));
  ws.addRow(cabecalho);
  ws.getRow(1).font = { bold: true };
  linhas.forEach((l) => ws.addRow(l));
  ws.columns.forEach((col, i) => {
    const maior = Math.max(cabecalho[i]?.length ?? 8, ...linhas.slice(0, 200).map((l) => String(l[i] ?? "").length));
    col.width = Math.min(50, Math.max(8, maior + 2));
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome} ${dataLocal()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lê a primeira aba de um .xlsx ou .csv e devolve objetos por cabeçalho */
export async function lerPlanilha(arquivo: File): Promise<Record<string, string>[]> {
  if (arquivo.name.toLowerCase().endsWith(".csv")) {
    const texto = await arquivo.text();
    const sep = (texto.split("\n")[0].match(/;/g)?.length ?? 0) > (texto.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim());
    const partir = (l: string) => {
      const out: string[] = [];
      let atual = "", aspas = false;
      for (const ch of l) {
        if (ch === '"') aspas = !aspas;
        else if (ch === sep && !aspas) { out.push(atual); atual = ""; }
        else atual += ch;
      }
      out.push(atual);
      return out.map((s) => s.trim());
    };
    const cab = partir(linhas[0]);
    return linhas.slice(1).map((l) => Object.fromEntries(partir(l).map((v, i) => [cab[i], v])));
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());
  const ws = wb.worksheets[0];
  const cab: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (cab[i - 1] = String(c.text ?? "").trim()));
  const out: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj: Record<string, string> = {};
    cab.forEach((h, i) => {
      const cel = row.getCell(i + 1);
      const v = cel.value;
      obj[h] = v instanceof Date ? v.toISOString().slice(0, 10) : String(cel.text ?? "").trim();
    });
    if (Object.values(obj).some(Boolean)) out.push(obj);
  });
  return out;
}
