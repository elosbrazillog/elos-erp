"use client";
import { useEffect, useMemo, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Card, Vazio } from "@/components/ui";
import { formatarData, formatarMoeda } from "@/lib/utils";

type Credito = { limite_credito: number; em_aberto: number; em_atraso: number; bloqueado: boolean };
type Titulo = { id: string; descricao: string; valor: number; data_vencimento: string; situacao: string };

// Resumo de crédito e títulos em aberto do cliente
export function FinanceiroCliente({ id }: { id: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [credito, setCredito] = useState<Credito | null>(null);
  const [titulos, setTitulos] = useState<Titulo[]>([]);
  const [semPermissao, setSemPermissao] = useState(false);

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([
        supabase.from("vw_credito_clientes").select("*").eq("pessoa_id", id).maybeSingle(),
        supabase.from("vw_lancamentos").select("id, descricao, valor, data_vencimento, situacao").eq("pessoa_id", id).eq("tipo", "receber").eq("ativo", true)
          .is("data_quitacao", null).order("data_vencimento").limit(50),
      ]);
      if (c.error || t.error) setSemPermissao(true);
      setCredito((c.data as Credito) ?? null);
      setTitulos((t.data ?? []) as Titulo[]);
    })();
  }, [supabase, id]);

  if (semPermissao) return <Card><Vazio titulo="Sem acesso ao financeiro" texto="Seu perfil não permite ver contas a receber." /></Card>;
  const disponivel = credito ? Number(credito.limite_credito) - Number(credito.em_aberto) : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Limite de crédito", formatarMoeda(credito?.limite_credito ?? 0)],
          ["Em aberto", formatarMoeda(credito?.em_aberto ?? 0)],
          ["Em atraso", formatarMoeda(credito?.em_atraso ?? 0)],
          ["Disponível", formatarMoeda(disponivel)],
        ].map(([r, v]) => (
          <Card key={r} className="p-4">
            <div className="text-xs text-muted">{r}</div>
            <div className="tabular mt-1 text-lg font-semibold">{v}</div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="border-b border-line p-3 text-sm font-medium">Títulos em aberto</div>
        {titulos.length === 0 ? (
          <Vazio titulo="Nenhum título em aberto" />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {titulos.map((t) => (
                <tr key={t.id} className="border-b border-line/70">
                  <td className="px-3 py-2">{t.descricao}</td>
                  <td className="px-3 py-2">{formatarData(t.data_vencimento)}</td>
                  <td className="px-3 py-2">{t.situacao === "atrasado" ? <Badge tom="erro">Atrasado</Badge> : t.situacao === "vence_hoje" ? <Badge tom="aviso">Vence hoje</Badge> : <Badge>Em aberto</Badge>}</td>
                  <td className="tabular px-3 py-2 text-right">{formatarMoeda(t.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
