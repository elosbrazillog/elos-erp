"use client";
import { useEffect, useState } from "react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Input, Select, Textarea } from "@/components/ui";
import { cn, DIAS_SEMANA, formatarDocumento, formatarTelefone } from "@/lib/utils";
import { OPCOES_UF, type Campo, type Opcao, type Relacao } from "@/lib/entidades";

type Valor = unknown;

// Cache simples das opções de relação por sessão de página
const cacheRelacoes = new Map<string, Promise<Opcao[]>>();

export function carregarOpcoesRelacao(rel: Relacao): Promise<Opcao[]> {
  const chave = JSON.stringify(rel);
  if (!cacheRelacoes.has(chave)) {
    const supabase = criarClienteNavegador();
    let q = supabase.from(rel.tabela).select(`id, ${rel.rotulo}`).eq("ativo", true).order(rel.ordem ?? rel.rotulo).limit(2000);
    for (const [k, v] of Object.entries(rel.filtro ?? {})) q = q.eq(k, v);
    cacheRelacoes.set(
      chave,
      Promise.resolve(q).then(({ data }) =>
        ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({ valor: String(r.id), rotulo: String(r[rel.rotulo] ?? "") })),
      ),
    );
  }
  return cacheRelacoes.get(chave)!;
}

export function limparCacheRelacoes() {
  cacheRelacoes.clear();
}

export function useOpcoes(campo: Campo) {
  const [opcoes, setOpcoes] = useState<Opcao[]>(campo.opcoes ?? (campo.tipo === "uf" ? OPCOES_UF : []));
  useEffect(() => {
    if (campo.tipo === "relacao" && campo.relacao) {
      let vivo = true;
      carregarOpcoesRelacao(campo.relacao).then((o) => vivo && setOpcoes(o));
      return () => {
        vivo = false;
      };
    }
  }, [campo]);
  return opcoes;
}

/** Valor do banco -> valor exibido no input */
export function paraInput(campo: Campo, v: Valor): Valor {
  if (v === null || v === undefined) {
    if (campo.tipo === "booleano") return false;
    if (campo.tipo === "dias_semana") return [];
    return "";
  }
  if (campo.tipo === "lista_inteiros" && Array.isArray(v)) return v.join("/");
  if (campo.tipo === "documento") return formatarDocumento(v);
  if (campo.tipo === "telefone") return formatarTelefone(v);
  if (["select", "relacao", "uf"].includes(campo.tipo)) return String(v);
  return v;
}

/** Valor do input -> valor gravado no banco */
export function paraBanco(campo: Campo, v: Valor): Valor {
  if (campo.tipo === "booleano") return !!v;
  if (campo.tipo === "dias_semana") return Array.isArray(v) ? v : [];
  if (v === "" || v === undefined || v === null) return null;
  switch (campo.tipo) {
    case "numero":
    case "moeda":
      return Number(String(v).replace(",", "."));
    case "inteiro":
      return parseInt(String(v), 10);
    case "lista_inteiros":
      return String(v)
        .split(/[\/,;\s]+/)
        .filter(Boolean)
        .map((x) => parseInt(x, 10))
        .filter((x) => !Number.isNaN(x));
    case "documento":
    case "telefone":
    case "cep":
      return String(v).replace(/\D/g, "") || null;
    case "select":
      // indicador_ie e origem são números no banco
      return /^\d+$/.test(String(v)) && ["indicador_ie", "origem", "nfe_modalidade_frete"].includes(campo.nome) ? Number(v) : v;
    case "texto":
    case "textarea":
    case "email":
      return String(v).trim() || null;
    default:
      return v;
  }
}

/** Erro de validação de um campo ou null */
export function validarCampo(campo: Campo, v: Valor): string | null {
  const vazio = v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0);
  if (campo.obrigatorio && vazio && campo.tipo !== "booleano") return "Obrigatório";
  if (vazio) return null;
  if (campo.tipo === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) return "E-mail inválido";
  if (campo.tipo === "documento") {
    const d = String(v).replace(/\D/g, "");
    if (d.length !== 11 && d.length !== 14) return "CPF tem 11 dígitos e CNPJ 14";
  }
  if ((campo.tipo === "numero" || campo.tipo === "moeda") && Number.isNaN(Number(String(v).replace(",", ".")))) return "Número inválido";
  return null;
}

export function CampoInput({
  campo,
  valor,
  onChange,
  onBlur,
  erro,
  id,
  compacto,
}: {
  campo: Campo;
  valor: Valor;
  onChange: (v: Valor) => void;
  onBlur?: () => void;
  erro?: string | null;
  id?: string;
  compacto?: boolean;
}) {
  const opcoes = useOpcoes(campo);
  const cls = cn(erro && "border-bad", compacto && "h-8");
  const dis = campo.somenteLeitura;

  switch (campo.tipo) {
    case "booleano":
      return (
        <label className={cn("flex items-center gap-2 text-sm", !compacto && "h-9")}>
          <input id={id} type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!valor} disabled={dis} onChange={(e) => onChange(e.target.checked)} />
          {!compacto && campo.rotulo}
        </label>
      );
    case "textarea":
      return <Textarea id={id} className={cls} value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
    case "select":
    case "relacao":
    case "uf":
      return (
        <Select id={id} className={cls} value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
          <option value="">{campo.obrigatorio ? "Selecione..." : "—"}</option>
          {opcoes.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </Select>
      );
    case "dias_semana": {
      const sel = (Array.isArray(valor) ? valor : []) as number[];
      return (
        <div className="flex flex-wrap gap-1">
          {DIAS_SEMANA.map((d, i) => {
            const on = sel.includes(i);
            return (
              <button
                key={d}
                type="button"
                disabled={dis}
                aria-pressed={on}
                onClick={() => onChange(on ? sel.filter((x) => x !== i) : [...sel, i].sort())}
                className={cn("h-9 w-11 rounded-md border text-sm", on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface hover:bg-surface-2")}
              >
                {d}
              </button>
            );
          })}
        </div>
      );
    }
    case "numero":
    case "moeda":
      return (
        <Input id={id} className={cn(cls, "tabular text-right")} type="number" step={campo.tipo === "moeda" ? "0.01" : "any"} inputMode="decimal"
          value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      );
    case "inteiro":
      return <Input id={id} className={cn(cls, "tabular text-right")} type="number" step="1" inputMode="numeric" value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
    case "data":
      return <Input id={id} className={cls} type="date" value={String(valor ?? "").slice(0, 10)} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
    case "email":
      return <Input id={id} className={cls} type="email" value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
    case "telefone":
      return <Input id={id} className={cls} type="tel" inputMode="tel" value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)}
        onBlur={() => { onChange(formatarTelefone(valor)); onBlur?.(); }} />;
    case "documento":
      return <Input id={id} className={cls} inputMode="numeric" value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)}
        onBlur={() => { onChange(formatarDocumento(valor)); onBlur?.(); }} />;
    case "cep":
      return <Input id={id} className={cls} inputMode="numeric" maxLength={9} placeholder="00000-000" value={String(valor ?? "")} disabled={dis}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
    default:
      return <Input id={id} className={cls} value={String(valor ?? "")} disabled={dis} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />;
  }
}

/** Busca o endereço pelo CEP (ViaCEP) e devolve os campos preenchidos */
export async function buscarCep(cep: string) {
  const d = cep.replace(/\D/g, "");
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return null;
    return { logradouro: j.logradouro, bairro: j.bairro, cidade: j.localidade, uf: j.uf, codigo_ibge: j.ibge, complemento: j.complemento || undefined };
  } catch {
    return null;
  }
}
