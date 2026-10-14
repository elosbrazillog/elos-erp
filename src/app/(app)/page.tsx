import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { criarClienteServidor } from "@/lib/supabase/server";
import { obterSessao, pode } from "@/lib/sessao";
import { Cabecalho, Card } from "@/components/ui";

export const metadata = { title: "Painel" };

async function contar(tabela: string, filtro?: Record<string, unknown>) {
  const supabase = await criarClienteServidor();
  let q = supabase.from(tabela).select("id", { count: "exact", head: true }).eq("ativo", true);
  for (const [k, v] of Object.entries(filtro ?? {})) q = q.eq(k, v);
  const { count } = await q;
  return count ?? 0;
}

export default async function Painel() {
  const sessao = (await obterSessao())!;
  const supabase = await criarClienteServidor();
  const veCadastros = pode(sessao, "cadastros");

  const [clientes, produtos, rotas, vendedores, itensPreco, empresa, grupos] = veCadastros
    ? await Promise.all([
        contar("pessoas", { eh_cliente: true }),
        contar("produtos"),
        contar("rotas"),
        contar("pessoas", { eh_vendedor: true }),
        contar("tabelas_preco_itens"),
        supabase.from("empresas").select("cnpj, inscricao_estadual, cep").eq("id", sessao.empresaId).maybeSingle(),
        supabase.from("produtos").select("id", { count: "exact", head: true }).eq("ativo", true).is("grupo_tributario_id", null),
      ])
    : [0, 0, 0, 0, 0, { data: null }, { count: 0 }];

  const emp = (empresa as { data: { cnpj: string; inscricao_estadual: string | null; cep: string | null } | null }).data;
  const semGrupo = (grupos as { count: number | null }).count ?? 0;

  const etapas = [
    { feito: !!emp && emp.cnpj !== "00000000000000" && !!emp.inscricao_estadual && !!emp.cep, texto: "Completar CNPJ, inscrição estadual e endereço da empresa", rota: "/configuracoes/empresa" },
    { feito: produtos > 0, texto: "Cadastrar ou importar os produtos", rota: "/cadastros/importar" },
    { feito: produtos > 0 && semGrupo === 0, texto: "Definir NCM e grupo tributário de todos os produtos", rota: "/cadastros/produtos" },
    { feito: itensPreco > 0, texto: "Preencher a tabela de preço", rota: "/cadastros/tabelas-preco" },
    { feito: vendedores > 0, texto: "Cadastrar os vendedores (pessoa com papel Vendedor)", rota: "/cadastros/pessoas/novo" },
    { feito: rotas > 0, texto: "Criar as rotas com dias de visita", rota: "/cadastros/rotas" },
    { feito: clientes > 0, texto: "Cadastrar ou importar os clientes", rota: "/cadastros/importar" },
  ];
  const feitas = etapas.filter((e) => e.feito).length;

  return (
    <>
      <Cabecalho trilha={sessao.empresaNome} titulo={`Olá, ${sessao.nome.split(" ")[0]}`} />
      {veCadastros && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Clientes ativos", clientes, "/cadastros/pessoas"],
              ["Produtos ativos", produtos, "/cadastros/produtos"],
              ["Rotas", rotas, "/cadastros/rotas"],
              ["Vendedores", vendedores, "/cadastros/pessoas"],
            ].map(([r, v, h]) => (
              <Link key={String(r)} href={String(h)}>
                <Card className="p-4 transition-colors hover:border-accent">
                  <div className="text-xs text-muted">{r}</div>
                  <div className="tabular mt-1 text-2xl font-semibold">{String(v)}</div>
                </Card>
              </Link>
            ))}
          </div>
          <Card className="max-w-2xl">
            <div className="flex items-center justify-between border-b border-line p-4">
              <div>
                <div className="font-medium">Implantação do sistema</div>
                <div className="text-xs text-muted">O que falta para começar a vender pelo Elos ERP</div>
              </div>
              <div className="tabular text-sm text-muted">{feitas} de {etapas.length}</div>
            </div>
            <ul className="divide-y divide-line/70">
              {etapas.map((e) => (
                <li key={e.texto}>
                  <Link href={e.rota} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60">
                    {e.feito ? <CheckCircle2 size={18} className="text-ok" /> : <Circle size={18} className="text-muted" />}
                    <span className={e.feito ? "text-muted line-through" : ""}>{e.texto}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
      {!veCadastros && <p className="text-sm text-muted">Use o menu para acessar suas telas.</p>}
    </>
  );
}
