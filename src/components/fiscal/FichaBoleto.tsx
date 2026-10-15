import { formatarData, formatarDocumento, formatarMoeda } from "@/lib/utils";
import qrcode from "qrcode-generator";
import { barrasItf, DV_BANCO, formatarLinhaDigitavel, larguraItf, NOME_BANCO } from "@/lib/boleto";

export type Boleto = {
  id: string; status: string; nosso_numero: string | null; linha_digitavel: string | null; codigo_barras: string | null; pix_copia_cola: string | null;
  erro: string | null; pedido_numero: number | null; valor: number; data_vencimento: string; data_competencia: string; documento: string | null;
  parcela: number; total_parcelas: number; data_quitacao: string | null;
  pagador_nome: string | null; pagador_documento: string | null; pagador_logradouro: string | null; pagador_numero: string | null;
  pagador_complemento: string | null; pagador_bairro: string | null; pagador_cidade: string | null; pagador_uf: string | null; pagador_cep: string | null;
  conta_nome: string | null; banco_codigo: string | null; agencia: string | null; posto: string | null; conta: string | null; sicredi_codigo_beneficiario: string | null;
  beneficiario_nome: string; beneficiario_cnpj: string; beneficiario_endereco: string | null; beneficiario_cidade: string | null; beneficiario_uf: string | null;
  seu_numero?: string | null; boleto_multa?: number | null; boleto_juros_dia?: number | null;
};


export const EXEMPLO: Boleto = {
  id: "exemplo", status: "registrado", nosso_numero: "26/200001-7", linha_digitavel: "74891121110000100000000000000001000000000000000",
  codigo_barras: "74891000000000000001121110000100000000000000", pix_copia_cola: "00020101021226870014br.gov.bcb.pix2565qrpix.sicredi.com.br/qr/v2/cobv/EXEMPLO0000000000000000000000005204000053039865802BR5925ELOS EXEMPLO6012CAMPO GRANDE62070503***6304ABCD", erro: null, pedido_numero: 123,
  valor: 0, data_vencimento: new Date().toISOString().slice(0, 10), data_competencia: new Date().toISOString().slice(0, 10), documento: "123",
  parcela: 1, total_parcelas: 1, data_quitacao: null, pagador_nome: "CLIENTE DE EXEMPLO", pagador_documento: "00000000000000",
  pagador_logradouro: "Rua Exemplo", pagador_numero: "100", pagador_complemento: null, pagador_bairro: "Centro", pagador_cidade: "Campo Grande",
  pagador_uf: "MS", pagador_cep: "79000000", conta_nome: "Sicredi", banco_codigo: "748", agencia: "0000", posto: "00", conta: null,
  sicredi_codigo_beneficiario: "00000", beneficiario_nome: "", beneficiario_cnpj: "", beneficiario_endereco: null, beneficiario_cidade: null, beneficiario_uf: null,
};

const formatarPct = (v: number | null | undefined) => `${Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}%`;

// QR Code do Pix (boleto híbrido): um caminho SVG com os módulos escuros
function QrPix({ texto }: { texto: string }) {
  const qr = qrcode(0, "M");
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return (
    <svg viewBox={`0 0 ${n + 8} ${n + 8}`} style={{ width: "24mm", height: "24mm" }} role="img" aria-label="QR Code Pix" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

function CodigoBarras({ codigo }: { codigo: string }) {
  const barras = barrasItf(codigo);
  const w = larguraItf(codigo);
  if (!barras.length) return null;
  return (
    <svg viewBox={`0 0 ${w} 50`} preserveAspectRatio="none" style={{ width: "103mm", height: "13mm" }} role="img" aria-label="Código de barras">
      {barras.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={50} fill="#000" />)}
    </svg>
  );
}

function Campo({ rotulo, children, className = "", direita }: { rotulo: string; children: React.ReactNode; className?: string; direita?: boolean }) {
  return (
    <div className={`border-b border-l border-black px-1 py-0.5 ${className}`}>
      <div className="text-[7px] leading-tight uppercase">{rotulo}</div>
      <div className={`min-h-[13px] text-[10px] leading-tight font-medium ${direita ? "text-right" : ""}`}>{children}</div>
    </div>
  );
}

export function FichaBoleto({ b, exemplo }: { b: Boleto; exemplo?: boolean }) {
  const banco = b.banco_codigo ?? "748";
  const agenciaCodigo = [b.agencia, b.posto, b.sicredi_codigo_beneficiario].filter(Boolean).join(".");
  const pagadorEnd = [[b.pagador_logradouro, b.pagador_numero, b.pagador_complemento].filter(Boolean).join(", "), b.pagador_bairro].filter(Boolean).join(" · ");
  const pagadorCidade = [b.pagador_cep ? `CEP ${b.pagador_cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : null, [b.pagador_cidade, b.pagador_uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  const cabecalho = (
    <div className="flex items-end border-b-2 border-black">
      <div className="w-32 pb-0.5 text-base font-bold">{NOME_BANCO[banco] ?? `Banco ${banco}`}</div>
      <div className="border-x-2 border-black px-2 pb-0.5 text-base font-bold">{banco}-{DV_BANCO[banco] ?? "0"}</div>
      <div className="flex-1 pb-0.5 text-right font-mono text-[12px] font-bold tracking-tight">{formatarLinhaDigitavel(b.linha_digitavel)}</div>
    </div>
  );
  return (
    <section className="boleto relative mb-6 break-inside-avoid text-black">
      {exemplo && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <span className="-rotate-12 border-4 border-red-600/60 px-4 py-1 text-4xl font-black text-red-600/60">MODELO · SEM VALOR</span>
        </div>
      )}
      {/* Recibo do pagador */}
      <div className="mb-1 text-[9px]">Recibo do pagador</div>
      {cabecalho}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] border-r border-black">
        <Campo rotulo="Beneficiário">{b.beneficiario_nome} · CNPJ {formatarDocumento(b.beneficiario_cnpj)}</Campo>
        <Campo rotulo="Agência / código beneficiário">{agenciaCodigo}</Campo>
        <Campo rotulo="Nosso número">{b.nosso_numero}</Campo>
        <Campo rotulo="Vencimento" direita>{formatarData(b.data_vencimento)}</Campo>
        <Campo rotulo="Pagador">{b.pagador_nome}</Campo>
        <Campo rotulo="Nº documento">{b.seu_numero ?? <>{b.documento}{b.total_parcelas > 1 ? `/${b.parcela}` : ""}</>}</Campo>
        <Campo rotulo="Pedido">{b.pedido_numero}</Campo>
        <Campo rotulo="Valor do documento" direita>{formatarMoeda(b.valor)}</Campo>
      </div>
      <div className="mt-1 mb-3 text-right text-[8px]">Autenticação mecânica</div>
      <div className="mb-3 border-t border-dashed border-black" />

      {/* Ficha de compensação */}
      {cabecalho}
      <div className="grid grid-cols-[3fr_1fr] border-r border-black">
        <Campo rotulo="Local de pagamento">Pagável preferencialmente nas cooperativas do Sicredi ou em qualquer banco até o vencimento</Campo>
        <Campo rotulo="Vencimento" direita>{formatarData(b.data_vencimento)}</Campo>
        <Campo rotulo="Beneficiário">{b.beneficiario_nome} · CNPJ {formatarDocumento(b.beneficiario_cnpj)}{b.beneficiario_endereco ? ` · ${b.beneficiario_endereco} · ${b.beneficiario_cidade ?? ""}/${b.beneficiario_uf ?? ""}` : ""}</Campo>
        <Campo rotulo="Agência / código beneficiário" direita>{agenciaCodigo}</Campo>
      </div>
      <div className="grid grid-cols-[1fr_1fr_0.6fr_0.4fr_1fr_1fr] border-r border-black">
        <Campo rotulo="Data do documento">{formatarData(b.data_competencia)}</Campo>
        <Campo rotulo="Nº documento">{b.seu_numero ?? <>{b.documento}{b.total_parcelas > 1 ? `/${b.parcela}` : ""}</>}</Campo>
        <Campo rotulo="Espécie doc.">DMI</Campo>
        <Campo rotulo="Aceite">N</Campo>
        <Campo rotulo="Data processamento">{formatarData(b.data_competencia)}</Campo>
        <Campo rotulo="Nosso número" direita>{b.nosso_numero}</Campo>
      </div>
      <div className="grid grid-cols-[1fr_1fr_0.6fr_1fr_1fr_1fr] border-r border-black">
        <Campo rotulo="Uso do banco">{" "}</Campo>
        <Campo rotulo="Carteira">A</Campo>
        <Campo rotulo="Espécie">R$</Campo>
        <Campo rotulo="Quantidade">{" "}</Campo>
        <Campo rotulo="Valor">{" "}</Campo>
        <Campo rotulo="(=) Valor do documento" direita>{formatarMoeda(b.valor)}</Campo>
      </div>
      <div className="grid grid-cols-[5fr_1fr] border-r border-black">
        <div className="border-b border-l border-black px-1 py-0.5 text-[9px]">
          <div className="text-[7px] uppercase">Instruções (texto de responsabilidade do beneficiário)</div>
          <div>Referente ao pedido nº {b.pedido_numero}{b.total_parcelas > 1 ? ` · parcela ${b.parcela} de ${b.total_parcelas}` : ""}.</div>
          <div>
            {Number(b.boleto_multa) > 0 || Number(b.boleto_juros_dia) > 0
              ? <>Após o vencimento cobrar{Number(b.boleto_multa) > 0 ? ` multa de ${formatarPct(b.boleto_multa)}` : ""}{Number(b.boleto_multa) > 0 && Number(b.boleto_juros_dia) > 0 ? " e" : ""}{Number(b.boleto_juros_dia) > 0 ? ` juros de ${formatarPct(b.boleto_juros_dia)} ao dia` : ""}.</>
              : "Após o vencimento, sujeito a juros e multa conforme o cadastro do título no banco."}
          </div>
        </div>
        <div className="grid">
          <Campo rotulo="(−) Desconto" direita>{" "}</Campo>
          <Campo rotulo="(+) Juros / multa" direita>{" "}</Campo>
          <Campo rotulo="(=) Valor cobrado" direita>{" "}</Campo>
        </div>
      </div>
      <div className="border-r border-b border-l border-black px-1 py-0.5 text-[10px]">
        <div className="text-[7px] uppercase">Pagador</div>
        <div className="font-medium">{b.pagador_nome}{b.pagador_documento ? ` · ${b.pagador_documento.length > 11 ? "CNPJ" : "CPF"} ${formatarDocumento(b.pagador_documento)}` : ""}</div>
        <div>{pagadorEnd}</div>
        <div>{pagadorCidade}</div>
      </div>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="pt-1">{b.codigo_barras && <CodigoBarras codigo={b.codigo_barras} />}</div>
        <div className="text-right text-[8px]">Autenticação mecânica · Ficha de compensação</div>
      </div>
      {b.pix_copia_cola && (
        <div className="mt-2 flex items-center gap-3 border border-black p-1.5">
          <QrPix texto={b.pix_copia_cola} />
          <div className="min-w-0 text-[8px]">
            <div className="mb-0.5 text-[10px] font-bold">Pague com Pix</div>
            <div className="mb-1">Aponte a câmera do app do banco para o QR Code ou use o código abaixo (Pix copia e cola).</div>
            <div className="font-mono break-all">{b.pix_copia_cola}</div>
          </div>
        </div>
      )}
    </section>
  );
}

