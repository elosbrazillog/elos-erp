"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp, Upload } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Cabecalho, Card, Select } from "@/components/ui";
import { documentoValido } from "@/lib/utils";
import { exportarExcel, lerPlanilha } from "@/components/crud/exportar";

type Tipo = "clientes" | "produtos";
type Linha = Record<string, string>;
type Mapeado = { dados: Record<string, unknown>; extras: Record<string, string>; erros: string[]; aviso?: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Cabeçalhos aceitos (sem acento, sem espaço) por campo
const MAPA: Record<Tipo, Record<string, string[]>> = {
  clientes: {
    documento: ["cnpj", "cpf", "cnpjcpf", "cpfcnpj", "documento"],
    razao_social: ["razaosocial", "nome", "cliente", "razao"],
    nome_fantasia: ["fantasia", "nomefantasia"],
    inscricao_estadual: ["ie", "inscricaoestadual", "inscestadual"],
    telefone: ["telefone", "fone", "tel"],
    whatsapp: ["whatsapp", "celular", "zap"],
    email: ["email", "e-mail"],
    limite_credito: ["limite", "limitedecredito", "limitecredito"],
    _cep: ["cep"],
    _logradouro: ["endereco", "logradouro", "rua"],
    _numero: ["numero", "num", "n"],
    _bairro: ["bairro"],
    _cidade: ["cidade", "municipio"],
    _uf: ["uf", "estado"],
    _rota: ["rota"],
    _vendedor: ["vendedor", "representante"],
  },
  produtos: {
    codigo: ["codigo", "cod", "sku", "referencia"],
    nome: ["nome", "descricao", "produto"],
    codigo_barras: ["ean", "codigodebarras", "codbarras", "gtin"],
    ncm: ["ncm"],
    custo: ["custo", "precodecusto", "precocusto"],
    preco_venda: ["preco", "precodevenda", "precovenda", "valor"],
    peso_bruto_kg: ["peso", "pesokg", "pesobruto"],
    validade_dias: ["validade", "validadedias", "diasvalidade"],
    unidades_por_caixa: ["unidadesporcaixa", "qtdcaixa", "embalagem"],
    _unidade: ["unidade", "un", "und"],
    _categoria: ["categoria", "grupo", "linha"],
  },
};

const MODELO: Record<Tipo, string[]> = {
  clientes: ["CNPJ", "Razão social", "Fantasia", "IE", "Telefone", "WhatsApp", "E-mail", "Limite", "CEP", "Endereço", "Número", "Bairro", "Cidade", "UF", "Rota", "Vendedor"],
  produtos: ["Código", "Nome", "EAN", "NCM", "Unidade", "Categoria", "Custo", "Preço", "Peso", "Validade", "Unidades por caixa"],
};

function numeroBR(v: string) {
  if (!v) return null;
  const s = v.replace(/[R$\s]/g, "");
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isNaN(n) ? NaN : n;
}

function mapear(tipo: Tipo, linha: Linha): Mapeado {
  const porNorma = Object.fromEntries(Object.entries(linha).map(([k, v]) => [norm(k), String(v ?? "").trim()]));
  const dados: Record<string, unknown> = {};
  const extras: Record<string, string> = {};
  for (const [campo, nomes] of Object.entries(MAPA[tipo])) {
    const v = nomes.map((n) => porNorma[norm(n)]).find((x) => x !== undefined && x !== "");
    if (v === undefined) continue;
    if (campo.startsWith("_")) extras[campo.slice(1)] = v;
    else dados[campo] = v;
  }
  const erros: string[] = [];
  if (tipo === "clientes") {
    if (!dados.razao_social) erros.push("sem razão social");
    if (dados.documento) {
      const d = String(dados.documento).replace(/\D/g, "");
      if (!documentoValido(d)) erros.push("CNPJ/CPF inválido");
      dados.documento = d;
      dados.tipo_pessoa = d.length === 11 ? "PF" : "PJ";
    }
    for (const k of ["telefone", "whatsapp"]) if (dados[k]) dados[k] = String(dados[k]).replace(/\D/g, "");
    if (dados.limite_credito !== undefined) {
      const n = numeroBR(String(dados.limite_credito));
      if (Number.isNaN(n)) erros.push("limite inválido");
      dados.limite_credito = n ?? 0;
    }
    dados.eh_cliente = true;
  } else {
    if (!dados.codigo) erros.push("sem código");
    if (!dados.nome) erros.push("sem nome");
    for (const k of ["custo", "preco_venda", "peso_bruto_kg"]) {
      if (dados[k] === undefined) continue;
      const n = numeroBR(String(dados[k]));
      if (Number.isNaN(n)) erros.push(`${k.replace("_", " ")} inválido`);
      dados[k] = n;
    }
    for (const k of ["validade_dias", "unidades_por_caixa"]) if (dados[k] !== undefined) dados[k] = parseInt(String(dados[k]), 10) || null;
    if (dados.ncm) dados.ncm = String(dados.ncm).replace(/\D/g, "");
  }
  return { dados, extras, erros };
}

export function Importador() {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [tipo, setTipo] = useState<Tipo>("clientes");
  const [linhas, setLinhas] = useState<Mapeado[]>([]);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);

  async function abrir(arquivo?: File) {
    if (!arquivo) return;
    try {
      const brutas = await lerPlanilha(arquivo);
      setLinhas(brutas.map((l) => mapear(tipo, l)));
      setNomeArquivo(arquivo.name);
    } catch (e) {
      toast.error("Não foi possível ler a planilha", { description: (e as Error).message });
    }
  }

  // Busca por nome; cria se não existir
  async function idsPorNome(tabela: string, coluna: string, nomes: string[], extra: Record<string, unknown> = {}) {
    const unicos = [...new Set(nomes.filter(Boolean))];
    const mapa = new Map<string, string>();
    if (!unicos.length) return mapa;
    let q = supabase.from(tabela).select(`id, ${coluna}`);
    for (const [k, v] of Object.entries(extra)) q = q.eq(k, v as string);
    const { data } = await q;
    for (const r of (data ?? []) as unknown as Record<string, string>[]) mapa.set(norm(r[coluna]), r.id);
    const faltando = unicos.filter((n) => !mapa.has(norm(n)));
    if (faltando.length) {
      const novos = faltando.map((n) => ({ [coluna]: n, ...extra, ...(tabela === "unidades" ? { descricao: n } : {}) }));
      const { data: criados, error } = await supabase.from(tabela).insert(novos).select(`id, ${coluna}`);
      if (error) throw new Error(`${tabela}: ${error.message}`);
      for (const r of (criados ?? []) as unknown as Record<string, string>[]) mapa.set(norm(r[coluna]), r.id);
    }
    return mapa;
  }

  async function importar() {
    const validas = linhas.filter((l) => !l.erros.length);
    if (!validas.length) return;
    setImportando(true);
    setProgresso(0);
    let inseridos = 0, atualizados = 0, falhas = 0;
    try {
      if (tipo === "clientes") {
        const rotas = await idsPorNome("rotas", "nome", validas.map((l) => l.extras.rota));
        const vendedores = await idsPorNome("pessoas", "razao_social", validas.map((l) => l.extras.vendedor), { eh_vendedor: true });
        const { data: existentes } = await supabase.from("pessoas").select("id, documento").not("documento", "is", null);
        const porDoc = new Map((existentes ?? []).map((p) => [p.documento as string, p.id as string]));
        for (let i = 0; i < validas.length; i++) {
          const { dados, extras } = validas[i];
          const reg = { ...dados } as Record<string, unknown>;
          if (extras.rota) reg.rota_id = rotas.get(norm(extras.rota));
          if (extras.vendedor) reg.vendedor_id = vendedores.get(norm(extras.vendedor));
          const existente = reg.documento ? porDoc.get(String(reg.documento)) : undefined;
          const r = existente
            ? await supabase.from("pessoas").update(reg).eq("id", existente).select("id").single()
            : await supabase.from("pessoas").insert(reg).select("id").single();
          if (r.error) { falhas++; validas[i].aviso = r.error.message; continue; }
          if (existente) atualizados++;
          else inseridos++;
          if (!existente && (extras.logradouro || extras.cidade)) {
            await supabase.from("pessoas_enderecos").insert({
              pessoa_id: r.data.id, tipo: "principal", cep: extras.cep?.replace(/\D/g, "") || null,
              logradouro: extras.logradouro || "—", numero: extras.numero || null, bairro: extras.bairro || null,
              cidade: extras.cidade || "Campo Grande", uf: (extras.uf || "MS").toUpperCase().slice(0, 2),
            });
          }
          setProgresso(Math.round(((i + 1) / validas.length) * 100));
        }
      } else {
        const categorias = await idsPorNome("categorias", "nome", validas.map((l) => l.extras.categoria));
        const unidades = await idsPorNome("unidades", "sigla", validas.map((l) => l.extras.unidade?.toUpperCase()));
        const { data: grupo } = await supabase.from("grupos_tributarios").select("id").eq("ativo", true).order("criado_em").limit(1).maybeSingle();
        const { data: existentes } = await supabase.from("produtos").select("id, codigo");
        const porCodigo = new Map((existentes ?? []).map((p) => [String(p.codigo), String(p.id)]));
        for (let i = 0; i < validas.length; i++) {
          const { dados, extras } = validas[i];
          const reg = { ...dados } as Record<string, unknown>;
          if (extras.categoria) reg.categoria_id = categorias.get(norm(extras.categoria));
          if (extras.unidade) reg.unidade_id = unidades.get(norm(extras.unidade.toUpperCase()));
          const existente = porCodigo.get(String(reg.codigo));
          if (!existente && grupo) reg.grupo_tributario_id = grupo.id;
          const r = existente
            ? await supabase.from("produtos").update(reg).eq("id", existente)
            : await supabase.from("produtos").insert(reg);
          if (r.error) { falhas++; validas[i].aviso = r.error.message; continue; }
          if (existente) atualizados++;
          else inseridos++;
          setProgresso(Math.round(((i + 1) / validas.length) * 100));
        }
      }
      toast.success("Importação concluída", { description: `${inseridos} novos, ${atualizados} atualizados${falhas ? `, ${falhas} com erro` : ""}.` });
      setLinhas([...linhas]);
    } catch (e) {
      toast.error("Importação interrompida", { description: (e as Error).message });
    }
    setImportando(false);
  }

  const comErro = linhas.filter((l) => l.erros.length).length;
  const colunas = linhas.length ? Object.keys(MAPA[tipo]).filter((c) => linhas.some((l) => (c.startsWith("_") ? l.extras[c.slice(1)] : l.dados[c]) !== undefined)) : [];

  return (
    <>
      <Cabecalho trilha="Cadastros" titulo="Importar planilha" />
      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">O que importar</div>
            <Select value={tipo} onChange={(e) => { setTipo(e.target.value as Tipo); setLinhas([]); setNomeArquivo(""); }} className="w-48" aria-label="Tipo de importação">
              <option value="clientes">Clientes</option>
              <option value="produtos">Produtos</option>
            </Select>
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink hover:brightness-110">
            <FileUp size={16} /> Escolher arquivo
            <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => abrir(e.target.files?.[0])} />
          </label>
          <Button onClick={() => exportarExcel(`Modelo ${tipo}`, MODELO[tipo], [])}><Download size={16} /> Baixar modelo</Button>
        </div>
        <p className="mt-3 max-w-3xl text-xs text-muted">
          Aceita .xlsx ou .csv com cabeçalho na primeira linha. Os nomes das colunas podem variar (ex.: “CNPJ” ou “CPF/CNPJ”, “Preço” ou “Preço de venda”).
          {tipo === "clientes"
            ? " Clientes com CNPJ/CPF já cadastrado são atualizados. Rotas e vendedores que não existirem são criados."
            : " Produtos com código já cadastrado são atualizados. Categorias e unidades que não existirem são criadas, e produtos novos recebem o grupo tributário padrão."}
        </p>
      </Card>

      {linhas.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b border-line p-3 text-sm">
            <span className="font-medium">{nomeArquivo}</span>
            <Badge tom="ok">{linhas.length - comErro} prontas</Badge>
            {comErro > 0 && <Badge tom="erro">{comErro} com erro (serão ignoradas)</Badge>}
            <div className="ml-auto flex items-center gap-3">
              {importando && <span className="tabular text-xs text-muted">{progresso}%</span>}
              <Button variante="primario" onClick={importar} disabled={importando || linhas.length === comErro}>
                <Upload size={16} /> {importando ? "Importando..." : `Importar ${linhas.length - comErro} linhas`}
              </Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2">
                <tr className="text-left text-muted">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Situação</th>
                  {colunas.map((c) => <th key={c} className="px-2 py-2 font-medium whitespace-nowrap">{c.replace(/^_/, "").replace(/_/g, " ")}</th>)}
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 500).map((l, i) => (
                  <tr key={i} className="border-t border-line/70">
                    <td className="tabular px-2 py-1.5 text-muted">{i + 2}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {l.erros.length ? <Badge tom="erro">{l.erros.join(", ")}</Badge> : l.aviso ? <Badge tom="aviso">{l.aviso}</Badge> : <Badge tom="ok">ok</Badge>}
                    </td>
                    {colunas.map((c) => <td key={c} className="px-2 py-1.5 whitespace-nowrap">{String((c.startsWith("_") ? l.extras[c.slice(1)] : l.dados[c]) ?? "")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {linhas.length > 500 && <p className="p-3 text-xs text-muted">Mostrando as primeiras 500 linhas. Todas serão importadas.</p>}
          </div>
        </Card>
      )}
    </>
  );
}
