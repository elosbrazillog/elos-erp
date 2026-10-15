"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, FileUp, Printer, Settings2, Upload } from "lucide-react";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { Badge, Button, Card, Input, Label, Select, Vazio } from "@/components/ui";
import { Dialogo } from "@/components/ui/Dialogo";
import { cn, formatarData, formatarMoeda, formatarNumero } from "@/lib/utils";
import { mensagemErro } from "@/lib/pedidos";

type Boleto = {
  id: string; status: string; pedido_numero: number | null; pagador_nome: string | null; valor: number; data_vencimento: string;
  parcela: number; total_parcelas: number; data_quitacao: string | null; erro: string | null; pedido_id: string | null;
  nosso_numero: string | null; seu_numero: string | null; instrucao: string | null; remessa_numero: number | null; remessa_id: string | null;
  data_pagamento: string | null; valor_pago: number | null;
};
type Conta = {
  id: string; nome: string; agencia: string | null; posto: string | null; sicredi_codigo_beneficiario: string | null;
  cnab_byte: number; cnab_ano: number | null; cnab_proximo_numero: number; cnab_ultima_remessa: number;
  boleto_multa: number; boleto_juros_dia: number; boleto_hibrido: boolean; boleto_protesto_dias: number;
};
type Remessa = { id: string; numero: number; nome_arquivo: string; qtd_registros: number; qtd_baixas: number; valor_total: number; criado_em: string };
type Retorno = { id: string; nome_arquivo: string | null; numero: number | null; data_arquivo: string | null; criado_em: string; resumo: Resumo };
type Resumo = {
  registrados: number; recusados: number; liquidados: number; valor_liquidado: number; baixados: number; outros: number; nao_encontrados: number; pix: number;
  itens: { nosso_numero: string; seu_numero?: string; ocorrencia: string; msg: string; valor?: number }[];
};
type ResultadoRemessa = { id: string | null; numero?: number; nome?: string; conteudo?: string; qtd: number; baixas: number; valor: number;
  erros: { pagador: string; valor: number; erro: string }[] };

const SITUACAO: Record<string, { r: string; t: "neutro" | "ok" | "aviso" | "erro" | "acento" }> = {
  pendente: { r: "A enviar", t: "aviso" }, enviado: { r: "Enviado", t: "acento" }, registrado: { r: "Registrado", t: "acento" },
  pago: { r: "Pago", t: "ok" }, baixado: { r: "Baixado", t: "neutro" }, erro: { r: "Erro", t: "erro" }, cancelado: { r: "Cancelado", t: "neutro" },
  vencido: { r: "Vencido", t: "erro" },
};
const FILTROS = [
  ["abertos", "Em aberto"], ["enviar", "A enviar"], ["enviado", "Aguardando retorno"], ["registrado", "Registrados"],
  ["erro", "Com erro"], ["pago", "Pagos"], ["todos", "Todos"],
] as const;

function baixarArquivo(nome: string, conteudo: string) {
  // CNAB é texto ASCII com quebra CRLF; o conteúdo já vem sem acentos
  const blob = new Blob([conteudo], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function CobrancaSicredi({ de, ate }: { de: string; ate: string }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [lista, setLista] = useState<Boleto[] | null>(null);
  const [conta, setConta] = useState<Conta | null | undefined>(undefined);
  const [remessas, setRemessas] = useState<Remessa[]>([]);
  const [retornos, setRetornos] = useState<Retorno[]>([]);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>("abertos");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [gerando, setGerando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoRemessa | null>(null);
  const [retornoAberto, setRetornoAberto] = useState<{ nome: string | null; resumo: Resumo } | null>(null);
  const [config, setConfig] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const [b, c, r, t] = await Promise.all([
      supabase.from("vw_boletos").select("id, status, pedido_numero, pagador_nome, valor, data_vencimento, parcela, total_parcelas, data_quitacao, erro, pedido_id, nosso_numero, seu_numero, instrucao, remessa_numero, remessa_id, data_pagamento, valor_pago")
        .or(`and(data_vencimento.gte.${de},data_vencimento.lte.${ate}),status.in.(pendente,erro),instrucao.eq.baixa`)
        .order("data_vencimento").limit(2000),
      supabase.from("contas_bancarias").select("id, nome, agencia, posto, sicredi_codigo_beneficiario, cnab_byte, cnab_ano, cnab_proximo_numero, cnab_ultima_remessa, boleto_multa, boleto_juros_dia, boleto_hibrido, boleto_protesto_dias")
        .eq("ativo", true).eq("banco_codigo", "748").eq("emite_boleto", true).order("criado_em").limit(1),
      supabase.from("cnab_remessas").select("id, numero, nome_arquivo, qtd_registros, qtd_baixas, valor_total, criado_em").order("criado_em", { ascending: false }).limit(15),
      supabase.from("cnab_retornos").select("id, nome_arquivo, numero, data_arquivo, criado_em, resumo").order("criado_em", { ascending: false }).limit(15),
    ]);
    const erro = b.error ?? c.error ?? r.error ?? t.error;
    if (erro) toast.error("Não foi possível carregar", { description: mensagemErro(erro) });
    setLista((b.data ?? []) as Boleto[]);
    setConta(((c.data ?? [])[0] ?? null) as Conta | null);
    setRemessas((r.data ?? []) as Remessa[]);
    setRetornos((t.data ?? []) as Retorno[]);
  }, [supabase, de, ate]);
  useEffect(() => { void carregar(); }, [carregar]);

  const contagem = useMemo(() => {
    const l = lista ?? [];
    const soma = (f: (b: Boleto) => boolean) => ({ n: l.filter(f).length, v: l.filter(f).reduce((a, b) => a + Number(b.valor), 0) });
    return {
      enviar: soma((b) => (b.status === "pendente" || b.status === "erro") && !b.data_quitacao),
      baixas: soma((b) => b.instrucao === "baixa"),
      enviado: soma((b) => b.status === "enviado"),
      registrado: soma((b) => b.status === "registrado" && !b.data_quitacao),
      erro: soma((b) => b.status === "erro"),
    };
  }, [lista]);

  const visiveis = useMemo(() => (lista ?? []).filter((b) => {
    switch (filtro) {
      case "abertos": return !["cancelado", "pago", "baixado"].includes(b.status) || b.instrucao === "baixa";
      case "enviar": return b.status === "pendente" || b.status === "erro" || b.instrucao === "baixa";
      case "todos": return true;
      default: return b.status === filtro;
    }
  }), [lista, filtro]);

  async function gerarRemessa() {
    setGerando(true);
    const { data, error } = await supabase.rpc("remessa_gerar", { p_conta: conta?.id ?? null });
    setGerando(false);
    if (error) { toast.error("Remessa não gerada", { description: mensagemErro(error) }); return; }
    const r = data as ResultadoRemessa;
    if (r.id && r.nome && r.conteudo) baixarArquivo(r.nome, r.conteudo);
    setResultado(r);
    void carregar();
  }

  async function baixarDeNovo(id: string) {
    const { data, error } = await supabase.from("cnab_remessas").select("nome_arquivo, conteudo").eq("id", id).single();
    if (error || !data) { toast.error("Não foi possível baixar", { description: error ? mensagemErro(error) : undefined }); return; }
    baixarArquivo(data.nome_arquivo, data.conteudo);
  }

  async function lerRetorno(f: File) {
    const texto = new TextDecoder("iso-8859-1").decode(await f.arrayBuffer());
    const { data, error } = await supabase.rpc("retorno_processar", { p_conteudo: texto, p_nome: f.name });
    if (arquivo.current) arquivo.current.value = "";
    if (error) { toast.error("Retorno não processado", { description: mensagemErro(error) }); return; }
    setRetornoAberto({ nome: f.name, resumo: data as Resumo });
    void carregar();
  }

  async function acao(rpc: "boleto_pedir_baixa" | "boleto_reenviar", id: string, ok: string) {
    const { error } = await supabase.rpc(rpc, { p_boleto: id });
    if (error) { toast.error("Não foi possível", { description: mensagemErro(error) }); return; }
    toast.success(ok);
    void carregar();
  }

  if (!lista || conta === undefined) return <div className="py-10 text-center text-sm text-muted">Carregando...</div>;
  const configurada = !!conta && /^\d{4}$/.test(conta.agencia ?? "") && /^\d{1,2}$/.test(conta.posto ?? "") && /^\d{5}$/.test(conta.sicredi_codigo_beneficiario ?? "");
  const imprimiveis = visiveis.filter((b) => sel.has(b.id) && ["enviado", "registrado"].includes(b.status) && !b.data_quitacao);
  const aEnviar = contagem.enviar.n + contagem.baixas.n;

  return (
    <div className="space-y-3">
      {/* Conta e ações */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Cobrança Sicredi por arquivo (CNAB 400)</div>
            {conta ? (
              <div className="text-xs text-muted">
                {conta.nome} · cooperativa {conta.agencia ?? "?"} · posto {conta.posto ?? "?"} · beneficiário {conta.sicredi_codigo_beneficiario ?? "?"}
                {" · "}última remessa nº {conta.cnab_ultima_remessa} · multa {formatarNumero(Number(conta.boleto_multa))}% · juros {formatarNumero(Number(conta.boleto_juros_dia))}% ao dia
                {conta.boleto_hibrido ? " · com Pix" : ""}
              </div>
            ) : <div className="text-xs text-bad">Nenhuma conta Sicredi marcada para emitir boleto.</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            {conta && <Button onClick={() => setConfig(true)}><Settings2 size={15} /> Configurar</Button>}
            <Button onClick={() => arquivo.current?.click()} disabled={!configurada}><Upload size={15} /> Ler retorno</Button>
            <input ref={arquivo} type="file" accept=".crt,.CRT,.ret,.RET,.txt,.r01,.R01,.r02,.R02" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerRetorno(f); }} />
            <Button variante="primario" onClick={gerarRemessa} disabled={!configurada || gerando || aEnviar === 0}>
              <FileUp size={15} /> {gerando ? "Gerando..." : `Gerar remessa${aEnviar ? ` (${aEnviar})` : ""}`}
            </Button>
          </div>
        </div>
        {!configurada && conta && <p className="mt-2 text-xs text-warn">Complete cooperativa, posto e código do beneficiário em Configurar para numerar e enviar boletos.</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {([
          ["A enviar", contagem.enviar, "enviar", contagem.enviar.n > 0],
          ["Baixas a enviar", contagem.baixas, "enviar", false],
          ["Aguardando retorno", contagem.enviado, "enviado", false],
          ["Registrados em aberto", contagem.registrado, "registrado", false],
          ["Com erro", contagem.erro, "erro", contagem.erro.n > 0],
        ] as const).map(([r, c, f, alerta]) => (
          <button key={r} onClick={() => setFiltro(f)} className="text-left">
            <Card className={cn("p-3 transition-colors hover:border-accent", filtro === f && "border-accent")}>
              <div className="text-xs text-muted">{r}</div>
              <div className={cn("tabular text-lg font-semibold", alerta && r === "Com erro" && "text-bad")}>{c.n}</div>
              <div className="tabular text-xs text-muted">{formatarMoeda(c.v)}</div>
            </Card>
          </button>
        ))}
      </div>

      {/* Lista */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {FILTROS.map(([k, r]) => (
              <button key={k} onClick={() => { setFiltro(k); setSel(new Set()); }}
                className={cn("rounded-md px-2.5 py-1 text-xs", filtro === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2")}>{r}</button>
            ))}
          </div>
          {imprimiveis.length > 0 && (
            <a href={`/imprimir/boletos?boletos=${imprimiveis.slice(0, 300).map((b) => b.id).join(",")}`} target="_blank" rel="noreferrer">
              <Button tamanho="p"><Printer size={14} /> Imprimir {imprimiveis.length}</Button>
            </a>
          )}
        </div>
        {visiveis.length === 0 ? <Vazio titulo="Nenhum boleto aqui" texto="Os boletos aparecem quando os pedidos com forma de pagamento boleto são faturados." /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted uppercase">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" aria-label="Selecionar todos" checked={visiveis.length > 0 && visiveis.every((b) => sel.has(b.id))}
                      onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((b) => b.id)) : new Set())} />
                  </th>
                  <th className="px-2 py-2 font-medium">Vencimento</th>
                  <th className="px-2 py-2 font-medium">Pagador</th>
                  <th className="px-2 py-2 font-medium">Documento</th>
                  <th className="px-2 py-2 font-medium">Nosso número</th>
                  <th className="px-2 py-2 text-right font-medium">Valor</th>
                  <th className="px-2 py-2 font-medium">Situação</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {visiveis.map((b) => {
                  const st = SITUACAO[b.status] ?? { r: b.status, t: "neutro" as const };
                  return (
                    <tr key={b.id} className={cn(sel.has(b.id) && "bg-accent-soft/40")}>
                      <td className="px-3 py-2">
                        <input type="checkbox" aria-label="Selecionar" checked={sel.has(b.id)}
                          onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">{formatarData(b.data_vencimento)}</td>
                      <td className="max-w-56 truncate px-2 py-2">{b.pagador_nome}</td>
                      <td className="px-2 py-2 text-xs whitespace-nowrap">{b.seu_numero ?? (b.pedido_numero ? `P ${b.pedido_numero}` : "—")}</td>
                      <td className="tabular px-2 py-2 text-xs whitespace-nowrap">{b.nosso_numero ?? <span className="text-muted">sem número</span>}</td>
                      <td className="tabular px-2 py-2 text-right whitespace-nowrap">
                        {formatarMoeda(b.valor)}
                        {b.valor_pago ? <div className="text-xs text-ok">pago {formatarMoeda(b.valor_pago)}</div> : null}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge tom={st.t}>{st.r}</Badge>
                          {b.instrucao === "baixa" && <Badge tom="aviso">Baixa a enviar</Badge>}
                          {b.remessa_numero && b.status === "enviado" && <span className="text-xs text-muted">remessa {b.remessa_numero}</span>}
                          {b.data_pagamento && <span className="text-xs text-muted">em {formatarData(b.data_pagamento)}</span>}
                        </div>
                        {b.erro && <div className="mt-0.5 max-w-80 text-xs text-bad">{b.erro}</div>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {["enviado", "registrado"].includes(b.status) && !b.data_quitacao && (
                          <a href={`/imprimir/boletos?boletos=${b.id}`} target="_blank" rel="noreferrer" className="mr-2 text-xs text-accent underline">imprimir</a>
                        )}
                        {b.status === "enviado" && <button className="mr-2 text-xs text-muted underline" onClick={() => acao("boleto_reenviar", b.id, "Volta na próxima remessa")}>reenviar</button>}
                        {["enviado", "registrado", "pendente", "erro"].includes(b.status) && !b.instrucao && (
                          <button className="text-xs text-muted underline" onClick={() => acao("boleto_pedir_baixa", b.id,
                            b.status === "pendente" || b.status === "erro" ? "Boleto cancelado" : "A baixa vai na próxima remessa")}>baixar</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Histórico */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="border-b border-line px-4 py-2.5 text-sm font-medium">Remessas geradas</div>
          {remessas.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Nenhuma remessa ainda.</p> : (
            <ul className="divide-y divide-line/70">
              {remessas.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <div>
                    <div className="font-medium">{r.nome_arquivo} <span className="font-normal text-muted">· nº {r.numero}</span></div>
                    <div className="text-xs text-muted">
                      {new Date(r.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {r.qtd_registros} {r.qtd_registros === 1 ? "boleto" : "boletos"} · {formatarMoeda(r.valor_total)}
                      {r.qtd_baixas ? ` · ${r.qtd_baixas} ${r.qtd_baixas === 1 ? "baixa" : "baixas"}` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {r.qtd_registros > 0 && (
                      <a href={`/imprimir/boletos?remessa=${r.id}`} target="_blank" rel="noreferrer"><Button tamanho="p"><Printer size={14} /> Boletos</Button></a>
                    )}
                    <Button tamanho="p" onClick={() => baixarDeNovo(r.id)}><Download size={14} /> Arquivo</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <div className="border-b border-line px-4 py-2.5 text-sm font-medium">Retornos lidos</div>
          {retornos.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Nenhum retorno lido. Baixe o arquivo .CRT no internet banking do Sicredi e use “Ler retorno”.</p> : (
            <ul className="divide-y divide-line/70">
              {retornos.map((r) => (
                <li key={r.id}>
                  <button className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2/60" onClick={() => setRetornoAberto({ nome: r.nome_arquivo, resumo: r.resumo })}>
                    <div className="font-medium">{r.nome_arquivo ?? "Retorno"}{r.numero ? <span className="font-normal text-muted"> · nº {r.numero}</span> : null}</div>
                    <div className="text-xs text-muted">{textoResumo(r.resumo)} · lido em {new Date(r.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-muted">
        Como funciona: o boleto ganha nosso número e código de barras no faturamento. Gere a remessa, envie o arquivo .CRM pela área de Cobrança do internet banking do Sicredi
        (envio de arquivo de remessa) e imprima os boletos. No dia seguinte, baixe o retorno (.CRT) e leia aqui: os boletos passam a
        registrados e os pagos dão baixa sozinhos no contas a receber.
      </p>

      {resultado && (
        <Dialogo aberto titulo={resultado.id ? `Remessa nº ${resultado.numero} gerada` : "Nenhuma remessa gerada"} aoFechar={() => setResultado(null)}
          rodape={<>
            {resultado.id && resultado.qtd > 0 && <a href={`/imprimir/boletos?remessa=${resultado.id}`} target="_blank" rel="noreferrer"><Button><Printer size={15} /> Imprimir boletos</Button></a>}
            {resultado.id && resultado.nome && resultado.conteudo && <Button onClick={() => baixarArquivo(resultado.nome!, resultado.conteudo!)}><Download size={15} /> Baixar de novo</Button>}
            <Button variante="primario" onClick={() => setResultado(null)}>Fechar</Button>
          </>}>
          {resultado.id ? (
            <div className="space-y-1 text-sm">
              <p>O arquivo <b>{resultado.nome}</b> foi baixado. Envie no internet banking do Sicredi.</p>
              <p>{resultado.qtd} {resultado.qtd === 1 ? "boleto" : "boletos"} · {formatarMoeda(resultado.valor)}{resultado.baixas ? ` · ${resultado.baixas} ${resultado.baixas === 1 ? "pedido de baixa" : "pedidos de baixa"}` : ""}</p>
            </div>
          ) : <p className="text-sm">Todos os boletos a enviar têm problema no cadastro:</p>}
          {resultado.erros.length > 0 && (
            <div className="mt-3 rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
              <div className="font-medium">Ficaram fora da remessa ({resultado.erros.length})</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {resultado.erros.map((e, i) => <li key={i}>{e.pagador} · {formatarMoeda(e.valor)}: {e.erro}</li>)}
              </ul>
              <p className="mt-1 text-xs text-muted">Corrija o cadastro do cliente e gere outra remessa.</p>
            </div>
          )}
        </Dialogo>
      )}

      {retornoAberto && (
        <Dialogo aberto largo titulo={`Retorno ${retornoAberto.nome ?? ""}`} descricao={textoResumo(retornoAberto.resumo)} aoFechar={() => setRetornoAberto(null)}
          rodape={<Button variante="primario" onClick={() => setRetornoAberto(null)}>Fechar</Button>}>
          {retornoAberto.resumo.itens.length === 0 ? <p className="text-sm text-muted">O arquivo não tinha ocorrências.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted uppercase"><tr><th className="py-1 font-medium">Nosso número</th><th className="py-1 font-medium">Documento</th><th className="py-1 text-right font-medium">Valor</th><th className="py-1 pl-3 font-medium">O que aconteceu</th></tr></thead>
              <tbody className="divide-y divide-line/70">
                {retornoAberto.resumo.itens.map((i, k) => (
                  <tr key={k}>
                    <td className="tabular py-1.5 text-xs">{i.nosso_numero}</td>
                    <td className="py-1.5 text-xs">{i.seu_numero ?? "—"}</td>
                    <td className="tabular py-1.5 text-right">{i.valor ? formatarMoeda(i.valor) : "—"}</td>
                    <td className={cn("py-1.5 pl-3 text-xs", /falhou|Recusado|não encontrado|dobro/i.test(i.msg) && "text-bad")}>{i.msg}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Dialogo>
      )}

      {config && conta && <Configurar conta={conta} aoFechar={(mudou) => { setConfig(false); if (mudou) void carregar(); }} />}
    </div>
  );
}

function textoResumo(r: Resumo) {
  const p: string[] = [];
  if (r.registrados) p.push(`${r.registrados} registrados`);
  if (r.liquidados) p.push(`${r.liquidados} pagos (${formatarMoeda(r.valor_liquidado)})`);
  if (r.recusados) p.push(`${r.recusados} recusados`);
  if (r.baixados) p.push(`${r.baixados} baixados`);
  if (r.outros) p.push(`${r.outros} outras ocorrências`);
  if (r.nao_encontrados) p.push(`${r.nao_encontrados} não encontrados`);
  return p.join(" · ") || "sem ocorrências";
}

function Configurar({ conta, aoFechar }: { conta: Conta; aoFechar: (mudou: boolean) => void }) {
  const supabase = useMemo(() => criarClienteNavegador(), []);
  const [f, setF] = useState({
    agencia: conta.agencia ?? "", posto: conta.posto ?? "", codigo: conta.sicredi_codigo_beneficiario ?? "",
    byte: String(conta.cnab_byte), proximo: String(conta.cnab_proximo_numero), ultima: String(conta.cnab_ultima_remessa),
    multa: String(conta.boleto_multa).replace(".", ","), juros: String(conta.boleto_juros_dia).replace(".", ","),
    hibrido: conta.boleto_hibrido, protesto: String(conta.boleto_protesto_dias),
  });
  const [salvando, setSalvando] = useState(false);
  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
  const ano = new Date().getFullYear() % 100;
  const seqAtual = conta.cnab_ano === ano ? conta.cnab_proximo_numero : 1;

  async function salvar() {
    if (!/^\d{4}$/.test(f.agencia) || !/^\d{1,2}$/.test(f.posto) || !/^\d{5}$/.test(f.codigo)) {
      toast.error("Cooperativa com 4 dígitos, posto com até 2 e código do beneficiário com 5."); return;
    }
    setSalvando(true);
    const { error } = await supabase.from("contas_bancarias").update({
      agencia: f.agencia, posto: f.posto.padStart(2, "0"), sicredi_codigo_beneficiario: f.codigo,
      cnab_byte: Number(f.byte), cnab_proximo_numero: Number(f.proximo), cnab_ano: ano, cnab_ultima_remessa: Number(f.ultima),
      boleto_multa: num(f.multa), boleto_juros_dia: num(f.juros), boleto_hibrido: f.hibrido, boleto_protesto_dias: Number(f.protesto),
    }).eq("id", conta.id);
    setSalvando(false);
    if (error) { toast.error("Não foi possível salvar", { description: mensagemErro(error) }); return; }
    toast.success("Configuração salva");
    aoFechar(true);
  }

  const campo = (k: keyof typeof f, rotulo: string, ajuda?: string, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div>
      <Label htmlFor={`cnab-${k}`}>{rotulo}</Label>
      <Input id={`cnab-${k}`} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
      {ajuda && <p className="mt-0.5 text-[11px] text-muted">{ajuda}</p>}
    </div>
  );
  return (
    <Dialogo aberto titulo="Configurar cobrança Sicredi" descricao={conta.nome} aoFechar={() => aoFechar(false)}
      rodape={<><Button onClick={() => aoFechar(false)}>Cancelar</Button><Button variante="primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button></>}>
      <div className="grid grid-cols-3 gap-3">
        {campo("agencia", "Cooperativa", undefined, { inputMode: "numeric", maxLength: 4 })}
        {campo("posto", "Posto", undefined, { inputMode: "numeric", maxLength: 2 })}
        {campo("codigo", "Cód. beneficiário", undefined, { inputMode: "numeric", maxLength: 5 })}
        <div>
          <Label htmlFor="cnab-byte">Byte do nosso nº</Label>
          <Select id="cnab-byte" value={f.byte} onChange={(e) => setF({ ...f, byte: e.target.value })}>
            {[2, 3, 4, 5, 6, 7, 8, 9].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </div>
        {campo("proximo", "Próximo número", `Atual no ano: ${seqAtual}`, { inputMode: "numeric" })}
        {campo("ultima", "Última remessa enviada", "A próxima sai com este + 1", { inputMode: "numeric" })}
        {campo("multa", "Multa (%)", undefined, { inputMode: "decimal" })}
        {campo("juros", "Juros ao dia (%)", "0,10 ao dia ≈ 3% ao mês", { inputMode: "decimal" })}
        {campo("protesto", "Protestar após (dias)", "0 = não protestar", { inputMode: "numeric" })}
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.hibrido} onChange={(e) => setF({ ...f, hibrido: e.target.checked })} />
        Boleto híbrido (o Sicredi devolve o Pix copia e cola no retorno)
      </label>
      <p className="mt-3 rounded-md bg-surface-2 p-2.5 text-xs text-muted">
        O sistema anterior (Atende) usava o byte 4. Usar outro byte aqui (o padrão é 5) evita repetir nosso número se os dois sistemas emitirem boletos ao mesmo tempo.
        Se o Atende mandar mais remessas, ajuste “Última remessa enviada” para o número dele antes de gerar a próxima.
      </p>
    </Dialogo>
  );
}
