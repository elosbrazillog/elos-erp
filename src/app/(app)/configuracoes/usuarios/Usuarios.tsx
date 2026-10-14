"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Input, Label, Select } from "@/components/ui";
import { formatarData } from "@/lib/utils";
import { convidarUsuario } from "./acoes";

type U = { id: string; nome: string; email: string; perfil_id: string | null; pessoa_id: string | null; ativo: boolean; criado_em: string };
type Op = { id: string; nome?: string; razao_social?: string };

export function Usuarios({ usuarios, perfis, pessoas, euId, podeEditar, podeConvidar }: {
  usuarios: U[]; perfis: Op[]; pessoas: Op[]; euId: string; podeEditar: boolean; podeConvidar: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", nome: "", perfilId: "" });
  const [pendente, iniciar] = useTransition();

  async function alterar(id: string, campos: Partial<U>) {
    const { error } = await criarClienteNavegador().from("usuarios").update(campos).eq("id", id);
    if (error) return toast.error("Não foi possível alterar", { description: error.message });
    toast.success("Usuário atualizado");
    router.refresh();
  }

  function convidar(e: React.FormEvent) {
    e.preventDefault();
    iniciar(async () => {
      const r = await convidarUsuario(form);
      if (r.erro) return void toast.error("Convite não enviado", { description: r.erro });
      toast.success("Convite enviado", { description: `${form.email} vai receber um e-mail para criar a senha.` });
      setForm({ email: "", nome: "", perfilId: "" });
      router.refresh();
    });
  }

  return (
    <>
      <Cabecalho trilha="Configurações" titulo="Usuários" />
      {podeConvidar && (
        <Card className="mb-4 p-4">
          <form onSubmit={convidar} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_200px_auto]">
            <div><Label htmlFor="cn">Nome</Label><Input id="cn" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div><Label htmlFor="ce">E-mail</Label><Input id="ce" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <Label htmlFor="cp">Perfil</Label>
              <Select id="cp" value={form.perfilId} onChange={(e) => setForm({ ...form, perfilId: e.target.value })}>
                <option value="">Selecione...</option>
                {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </Select>
            </div>
            <Button type="submit" variante="primario" disabled={pendente || !form.perfilId}><UserPlus size={16} /> {pendente ? "Enviando..." : "Convidar"}</Button>
          </form>
        </Card>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs text-muted">
                <th className="px-3 py-2 font-medium">Nome</th>
                <th className="px-3 py-2 font-medium">E-mail</th>
                <th className="px-3 py-2 font-medium">Perfil</th>
                <th className="px-3 py-2 font-medium">Vendedor / motorista vinculado</th>
                <th className="px-3 py-2 font-medium">Desde</th>
                <th className="px-3 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => {
                const eu = u.id === euId;
                return (
                  <tr key={u.id} className="border-b border-line/70">
                    <td className="px-3 py-2 font-medium">{u.nome}{eu && <span className="ml-2"><Badge tom="acento">você</Badge></span>}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">
                      <Select className="h-8 min-w-40" value={u.perfil_id ?? ""} disabled={!podeEditar || eu} onChange={(e) => alterar(u.id, { perfil_id: e.target.value || null })} aria-label="Perfil">
                        <option value="">Sem acesso</option>
                        {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Select className="h-8 min-w-48" value={u.pessoa_id ?? ""} disabled={!podeEditar} onChange={(e) => alterar(u.id, { pessoa_id: e.target.value || null })} aria-label="Pessoa vinculada">
                        <option value="">—</option>
                        {pessoas.map((p) => <option key={p.id} value={p.id}>{p.razao_social}</option>)}
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-muted">{formatarData(u.criado_em)}</td>
                    <td className="px-3 py-2">
                      {podeEditar && !eu ? (
                        <button onClick={() => alterar(u.id, { ativo: !u.ativo })} className="text-xs text-accent hover:underline">
                          {u.ativo ? "Ativo · desativar" : "Inativo · reativar"}
                        </button>
                      ) : u.ativo ? <Badge tom="ok">Ativo</Badge> : <Badge>Inativo</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
