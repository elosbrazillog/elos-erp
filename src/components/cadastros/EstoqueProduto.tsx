"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Card, Vazio } from "@/components/ui";
import { formatarData, formatarNumero } from "@/lib/utils";
import { situacaoValidade } from "@/lib/pedidos";

type Lote = { id: string; deposito_nome: string; lote_numero: string | null; validade: string | null; dias_para_vencer: number | null; quantidade: number; quantidade_reservada: number; disponivel: number };

/** Aba do produto: saldo por lote e depósito */
export function EstoqueProduto({ id }: { id: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [semPermissao, setSemPermissao] = useState(false);

  useEffect(() => {
    supabase.from("vw_estoque").select("*").eq("produto_id", id).order("validade", { nullsFirst: false }).then(({ data, error }) => {
      if (error) setSemPermissao(true);
      setLotes((data ?? []) as Lote[]);
    });
  }, [supabase, id]);

  if (semPermissao) return <Card><Vazio titulo="Sem acesso ao estoque" /></Card>;
  if (!lotes) return <div className="py-8 text-center text-sm text-muted">Carregando...</div>;
  const soma = (k: keyof Lote) => lotes.reduce((a, l) => a + Number(l[k] ?? 0), 0);

  return (
    <Card>
      {lotes.length === 0 ? (
        <Vazio titulo="Sem estoque" texto="Lance a entrada em Estoque › Saldos por lote." acao={<Link href="/estoque/saldos" className="text-sm text-accent hover:underline">Ir para o estoque</Link>} />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Lote</th>
              <th className="px-3 py-2 font-medium">Validade</th>
              <th className="px-3 py-2 font-medium">Depósito</th>
              <th className="px-3 py-2 text-right font-medium">Quantidade</th>
              <th className="px-3 py-2 text-right font-medium">Reservado</th>
              <th className="px-3 py-2 text-right font-medium">Disponível</th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => {
              const sv = situacaoValidade(l.dias_para_vencer);
              return (
                <tr key={l.id} className="border-b border-line/70">
                  <td className="px-3 py-2">{l.lote_numero ?? "sem lote"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatarData(l.validade)}{sv && <span className="ml-2"><Badge tom={sv.tom}>{sv.rotulo}</Badge></span>}</td>
                  <td className="px-3 py-2">{l.deposito_nome}</td>
                  <td className="tabular px-3 py-2 text-right">{formatarNumero(l.quantidade)}</td>
                  <td className="tabular px-3 py-2 text-right">{formatarNumero(l.quantidade_reservada)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">{formatarNumero(l.disponivel)}</td>
                </tr>
              );
            })}
            <tr className="font-medium">
              <td className="px-3 py-2" colSpan={3}>Total</td>
              <td className="tabular px-3 py-2 text-right">{formatarNumero(soma("quantidade"))}</td>
              <td className="tabular px-3 py-2 text-right">{formatarNumero(soma("quantidade_reservada"))}</td>
              <td className="tabular px-3 py-2 text-right">{formatarNumero(soma("disponivel"))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </Card>
  );
}
