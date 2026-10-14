"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select, Textarea, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { carregarOpcoesRelacao } from "@/components/crud/CampoInput";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { STATUS_CARGA, mensagemErro } from "@/lib/pedidos";
import type { Opcao } from "@/lib/entidades";

export type Carga = {
  id: string; numero: number; data: string; status: keyof typeof STATUS_CARGA; observacao: string | null;
  rota_id: string | null; motorista_id: string | null; veiculo_id: string | null;
  rota_nome: string | null; motorista_nome: string | null; veiculo_placa: string | null; veiculo_descricao: string | null; capacidade_kg: number | null;
  qtd_pedidos: number; peso_total_kg: number; valor_total: number; entregues: number; pendentes: number; nao_entregues: number;
};

const FILTROS = [
  { rotulo: "Em aberto", status: ["montando", "separando", "em_rota"] },
  { rotulo: "Concluídas", status: ["concluida"] },
  { rotulo: "Canceladas", status: ["cancelada"] },
  { rotulo: "Todas", status: null },
] as const;

export function useOpcoesCarga() {
  const [o, setO] = useState<{ rotas: Opcao[]; motoristas: Opcao[]; veiculos: Opcao[] }>({ rotas: [], motoristas: [], veiculos: [] });
  useEffect(() => {
    Promise.all([
      carregarOpcoesRelacao({ tabela: "rotas", rotulo: "nome" }),
      carregarOpcoesRelacao({ tabela: "pessoas", rotulo: "razao_social", filtro: { eh_motorista: true } }),
      carregarOpcoesRelacao({ tabela: "veiculos", rotulo: "placa" }),
    ]).then(([rotas, motoristas, veiculos]) => setO({ rotas, motoristas, veiculos }));
  }, []);
  return o;
}

export function ListaCargas({ podeCriar }: { podeCriar: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const opcoes = useOpcoesCarga();
  const [cargas, setCargas] = useState<Carga[] | null>(null);
  const [filtro, setFiltro] = useState(0);
  const [nova, setNova] = useState(false);
  const [f, setF] = useState({ data: new Date().toISOString().slice(0, 10), rota_id: "", motorista_id: "", veiculo_id: "", observacao: "" });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let q = supabase.from("vw_expedicoes").select("*").order("data", { ascending: false }).order("numero", { ascending: false }).limit(300);
    const st = FILTROS[filtro].status;
    if (st) q = q.in("status", [...st]);
    q.then(({ data, error }) => {
      if (error) return toast.error("Não foi possível carregar as cargas", { description: mensagemErro(error) });
      setCargas(data as Carga[]);
    });
  }, [supabase, filtro]);

  async function criar() {
    if (!f.data) return toast.error("Informe a data da carga");
    setSalvando(true);
    const { data, error } = await supabase.from("expedicoes").insert({
      data: f.data, rota_id: f.rota_id || null, motorista_id: f.motorista_id || null, veiculo_id: f.veiculo_id || null, observacao: f.observacao || null,
    }).select("id").single();
    setSalvando(false);
    if (error) return toast.error("Não foi possível criar a carga", { description: mensagemErro(error) });
    router.push(`/expedicao/cargas/${data.id}`);
  }

  return (
    <>
      <Cabecalho trilha="Expedição" titulo="Cargas"
        acoes={podeCriar && <Button variante="primario" onClick={() => setNova(true)}><Plus size={16} /> Nova carga</Button>} />
      <Card>
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
          {FILTROS.map((x, i) => (
            <button key={x.rotulo} onClick={() => setFiltro(i)}
              className={cn("rounded-full border px-3 py-1 text-xs", filtro === i ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink")}>{x.rotulo}</button>
          ))}
        </div>
        {cargas === null ? <div className="px-4 py-10 text-center text-sm text-muted">Carregando...</div>
          : cargas.length === 0 ? <Vazio titulo="Nenhuma carga" texto={podeCriar ? "Crie uma carga para juntar os pedidos aprovados de uma rota e mandar para entrega." : undefined} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Nº</th>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Rota</th>
                    <th className="hidden px-3 py-2 font-medium md:table-cell">Motorista</th>
                    <th className="hidden px-3 py-2 font-medium lg:table-cell">Veículo</th>
                    <th className="px-3 py-2 text-right font-medium">Pedidos</th>
                    <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Peso</th>
                    <th className="px-3 py-2 text-right font-medium">Valor</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {cargas.map((c) => {
                    const st = STATUS_CARGA[c.status];
                    const excesso = c.capacidade_kg && Number(c.peso_total_kg) > Number(c.capacidade_kg);
                    return (
                      <tr key={c.id} onClick={() => router.push(`/expedicao/cargas/${c.id}`)} className="cursor-pointer border-b border-line/70 hover:bg-surface-2/70">
                        <td className="tabular px-3 py-2">{c.numero}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatarData(c.data)}</td>
                        <td className="px-3 py-2">{c.rota_nome ?? <span className="text-muted/50">—</span>}</td>
                        <td className="hidden px-3 py-2 md:table-cell">{c.motorista_nome ?? <span className="text-bad">Sem motorista</span>}</td>
                        <td className="hidden px-3 py-2 lg:table-cell">{c.veiculo_placa ?? <span className="text-muted/50">—</span>}</td>
                        <td className="tabular px-3 py-2 text-right">
                          {c.qtd_pedidos}
                          {c.status === "em_rota" && <div className="text-xs text-muted">{c.pendentes} a entregar</div>}
                        </td>
                        <td className={cn("tabular hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell", excesso && "text-bad")}>{formatarNumero(c.peso_total_kg)} kg</td>
                        <td className="tabular px-3 py-2 text-right whitespace-nowrap">{formatarMoeda(c.valor_total)}</td>
                        <td className="px-3 py-2"><Badge tom={st.tom}>{st.rotulo}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Dialogo aberto={nova} titulo="Nova carga" descricao="Depois de criar, você inclui os pedidos aprovados." aoFechar={() => setNova(false)}
        rodape={<><Button onClick={() => setNova(false)}>Voltar</Button><Button variante="primario" disabled={salvando} onClick={criar}>Criar carga</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <div><Label obrigatorio htmlFor="c-data">Data de saída</Label><Input id="c-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
          <div>
            <Label htmlFor="c-rota">Rota</Label>
            <Select id="c-rota" value={f.rota_id} onChange={(e) => setF({ ...f, rota_id: e.target.value })}>
              <option value="">—</option>{opcoes.rotas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="c-mot">Motorista</Label>
            <Select id="c-mot" value={f.motorista_id} onChange={(e) => setF({ ...f, motorista_id: e.target.value })}>
              <option value="">—</option>{opcoes.motoristas.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="c-vei">Veículo</Label>
            <Select id="c-vei" value={f.veiculo_id} onChange={(e) => setF({ ...f, veiculo_id: e.target.value })}>
              <option value="">—</option>{opcoes.veiculos.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </Select>
          </div>
          <div className="col-span-2"><Label htmlFor="c-obs">Observação</Label><Textarea id="c-obs" className="min-h-16" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></div>
          {opcoes.motoristas.length === 0 && (
            <p className="col-span-2 text-xs text-warn">Nenhum motorista cadastrado. Marque o papel Motorista no cadastro da pessoa (Cadastros › Clientes e fornecedores) antes da saída da carga.</p>
          )}
        </div>
      </Dialogo>
    </>
  );
}
