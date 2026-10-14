"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Save } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input } from "@/components/ui";
import { ACOES, MENU, type Permissoes } from "@/lib/menu";

type Perfil = { id: string; nome: string; descricao: string | null; administrador: boolean; permissoes: Permissoes; ativo: boolean; apenas_carteira: boolean };
const ROTULO_ACAO = { ver: "Ver", criar: "Criar", editar: "Editar", excluir: "Excluir" };

export function Perfis({ perfis, empresaId, podeEditar }: { perfis: Perfil[]; empresaId: string; podeEditar: boolean }) {
  const router = useRouter();
  const [lista, setLista] = useState(perfis);
  const [sujos, setSujos] = useState<Set<string>>(new Set());
  const [novoNome, setNovoNome] = useState("");
  useEffect(() => setLista(perfis), [perfis]);

  function marcar(pid: string, modulo: string, acao: string, v: boolean) {
    setLista((l) => l.map((p) => {
      if (p.id !== pid) return p;
      const atual = { ...(p.permissoes as Record<string, Record<string, boolean>>) };
      const mod = { ...(atual[modulo] ?? {}) , [acao]: v };
      if (acao === "ver" && !v) { mod.criar = false; mod.editar = false; mod.excluir = false; }
      if (acao !== "ver" && v) mod.ver = true;
      atual[modulo] = mod;
      return { ...p, permissoes: atual as Permissoes };
    }));
    setSujos((s) => new Set(s).add(pid));
  }

  async function salvar(p: Perfil) {
    const { error } = await criarClienteNavegador().from("perfis").update({ permissoes: p.permissoes, descricao: p.descricao, apenas_carteira: p.apenas_carteira }).eq("id", p.id);
    if (error) return toast.error("Não foi possível salvar", { description: error.message });
    setSujos((s) => { const n = new Set(s); n.delete(p.id); return n; });
    toast.success(`Perfil ${p.nome} salvo`, { description: "Vale no próximo carregamento de página de cada usuário." });
  }

  async function criar() {
    if (!novoNome.trim()) return;
    const { error } = await criarClienteNavegador().from("perfis").insert({ empresa_id: empresaId, nome: novoNome.trim(), permissoes: {} });
    if (error) return toast.error("Não foi possível criar", { description: error.code === "23505" ? "Já existe um perfil com esse nome." : error.message });
    setNovoNome("");
    router.refresh();
    toast.success("Perfil criado. Marque as permissões e salve.");
  }

  return (
    <>
      <Cabecalho trilha="Configurações" titulo="Perfis de acesso"
        acoes={podeEditar && (
          <div className="flex gap-2">
            <Input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do novo perfil" className="w-56" aria-label="Nome do novo perfil" />
            <Button variante="primario" onClick={criar}><Plus size={16} /> Criar</Button>
          </div>
        )}
      />
      <div className="space-y-4">
        {lista.map((p) => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div>
                <div className="font-medium">{p.nome} {p.administrador && <Badge tom="acento">acesso total</Badge>}</div>
                {p.descricao && <div className="text-xs text-muted">{p.descricao}</div>}
              </div>
              {podeEditar && !p.administrador && (
                <Button tamanho="p" variante={sujos.has(p.id) ? "primario" : "secundario"} onClick={() => salvar(p)} disabled={!sujos.has(p.id)}>
                  <Save size={14} /> Salvar
                </Button>
              )}
            </div>
            {!p.administrador && (
              <label className="flex items-start gap-2 border-b border-line/70 px-3 py-2 text-sm">
                <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" disabled={!podeEditar} checked={!!p.apenas_carteira}
                  onChange={(e) => { setLista((l) => l.map((x) => (x.id === p.id ? { ...x, apenas_carteira: e.target.checked } : x))); setSujos((s) => new Set(s).add(p.id)); }} />
                <span>
                  Vê só a própria carteira
                  <span className="block text-xs text-muted">Clientes e pedidos só do vendedor ligado ao usuário (Configurações › Usuários › Pessoa vinculada).</span>
                </span>
              </label>
            )}
            {!p.administrador && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="px-3 py-2 font-medium">Módulo</th>
                      {ACOES.map((a) => <th key={a} className="px-3 py-2 text-center font-medium">{ROTULO_ACAO[a]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {MENU.map((m) => (
                      <tr key={m.modulo} className="border-t border-line/70">
                        <td className="px-3 py-1.5">{m.titulo}</td>
                        {ACOES.map((a) => (
                          <td key={a} className="px-3 py-1.5 text-center">
                            <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={!podeEditar}
                              aria-label={`${m.titulo}: ${ROTULO_ACAO[a]}`}
                              checked={!!p.permissoes?.[m.modulo]?.[a]}
                              onChange={(e) => marcar(p.id, m.modulo, a, e.target.checked)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
