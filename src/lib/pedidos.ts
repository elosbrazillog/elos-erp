// Rótulos e cores da situação do pedido e dos movimentos de estoque
export type StatusPedido =
  | "rascunho" | "aguardando_credito" | "aprovado" | "em_separacao" | "faturado"
  | "em_rota" | "entregue" | "devolvido" | "cancelado";

export type Tom = "neutro" | "ok" | "aviso" | "erro" | "acento";

export const STATUS_PEDIDO: Record<StatusPedido, { rotulo: string; tom: Tom }> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro" },
  aguardando_credito: { rotulo: "Aguardando crédito", tom: "aviso" },
  aprovado: { rotulo: "Aprovado", tom: "ok" },
  em_separacao: { rotulo: "Em separação", tom: "acento" },
  faturado: { rotulo: "Faturado", tom: "acento" },
  em_rota: { rotulo: "Em rota", tom: "acento" },
  entregue: { rotulo: "Entregue", tom: "ok" },
  devolvido: { rotulo: "Devolvido", tom: "erro" },
  cancelado: { rotulo: "Cancelado", tom: "erro" },
};

export const TIPO_MOVIMENTO: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste_entrada: "Ajuste (+)",
  ajuste_saida: "Ajuste (−)",
  perda: "Perda",
  transferencia_saida: "Transferência (saída)",
  transferencia_entrada: "Transferência (entrada)",
  devolucao: "Devolução",
};

export const ORIGEM_MOVIMENTO: Record<string, string> = {
  manual: "Manual",
  pedido: "Pedido",
  nota_entrada: "Nota de entrada",
  inventario: "Inventário",
  expedicao: "Expedição",
  transferencia: "Transferência",
};

/** Situação da validade de um lote */
export function situacaoValidade(dias: number | null | undefined): { rotulo: string; tom: Tom } | null {
  if (dias === null || dias === undefined) return null;
  if (dias < 0) return { rotulo: "Vencido", tom: "erro" };
  if (dias <= 30) return { rotulo: `Vence em ${dias} ${dias === 1 ? "dia" : "dias"}`, tom: "aviso" };
  return null;
}

/** Mensagem legível de um erro do Supabase */
export function mensagemErro(e: { message?: string } | null | undefined) {
  const m = e?.message ?? "Erro desconhecido";
  if (m.includes("row-level security")) return "Seu perfil não tem permissão para esta ação.";
  if (m.includes("Failed to fetch")) return "Sem conexão com o servidor. Tente de novo.";
  return m;
}

export const STATUS_CARGA = {
  montando: { rotulo: "Montando", tom: "neutro" },
  separando: { rotulo: "Em separação", tom: "acento" },
  carregado: { rotulo: "Carregada", tom: "acento" },
  em_rota: { rotulo: "Em rota", tom: "aviso" },
  concluida: { rotulo: "Concluída", tom: "ok" },
  cancelada: { rotulo: "Cancelada", tom: "erro" },
} as const satisfies Record<string, { rotulo: string; tom: Tom }>;

export const STATUS_ENTREGA: Record<string, { rotulo: string; tom: Tom }> = {
  pendente: { rotulo: "A entregar", tom: "neutro" },
  entregue: { rotulo: "Entregue", tom: "ok" },
  devolvido_total: { rotulo: "Devolvido", tom: "erro" },
  devolvido_parcial: { rotulo: "Devolução parcial", tom: "aviso" },
  ausente: { rotulo: "Cliente ausente", tom: "aviso" },
};

/** Endereço em uma linha e link para o mapa */
export function enderecoTexto(e: { logradouro?: string | null; endereco_numero?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null }) {
  const rua = [e.logradouro, e.endereco_numero].filter(Boolean).join(", ");
  return [rua, e.complemento, e.bairro, e.cidade && `${e.cidade}/${e.uf ?? ""}`].filter(Boolean).join(" · ");
}
export function linkMapa(e: { latitude?: number | null; longitude?: number | null; logradouro?: string | null; endereco_numero?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null }) {
  const q = e.latitude && e.longitude ? `${e.latitude},${e.longitude}` : [e.logradouro, e.endereco_numero, e.bairro, e.cidade, e.uf].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}
