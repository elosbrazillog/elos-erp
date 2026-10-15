-- =====================================================================
-- LIMPEZA DOS TESTES · Elos ERP
-- Apaga TODAS as operações (pedidos, entregas, financeiro, boletos,
-- comissões, estoque, notas) e zera a numeração.
-- MANTÉM os cadastros: empresa, usuários, clientes, fornecedores,
-- vendedores, motoristas, produtos, preços, rotas, veículos, contas
-- bancárias, plano de contas, centros de custo e metas.
-- Não tem como desfazer.
-- =====================================================================
begin;

truncate table
  public.cnab_retornos, public.cnab_remessas, public.boletos, public.comissoes,
  public.entregas_recebimentos, public.acertos, public.despesas_frota, public.rastreamento, public.visitas,
  public.expedicoes_pedidos, public.expedicoes,
  public.notas_fiscais_eventos, public.notas_fiscais,
  public.lancamentos,
  public.pedidos_reservas, public.pedidos_itens, public.pedidos,
  public.inventarios_itens, public.inventarios,
  public.estoque_movimentos, public.estoque_saldos, public.lotes;

-- Numeração volta ao começo (pedido nº 1, carga nº 1...)
update public.numeradores set ultimo = 0 where chave <> 'pessoa';  -- código dos clientes continua

-- Boletos: nosso número recomeça; a última remessa real enviada (pelo Atende) foi a nº 4
update public.contas_bancarias set cnab_proximo_numero = 1, cnab_ano = null, cnab_ultima_remessa = 4
 where banco_codigo = '748';

commit;

-- Conferência: tudo deve dar zero
select (select count(*) from public.pedidos) pedidos, (select count(*) from public.lancamentos) titulos,
       (select count(*) from public.boletos) boletos, (select count(*) from public.expedicoes) cargas,
       (select count(*) from public.estoque_saldos) estoque, (select count(*) from public.pessoas) cadastros_mantidos,
       (select count(*) from public.produtos) produtos_mantidos;
