\set ON_ERROR_STOP 1
-- Comissões. Roda depois de teste_dre.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare vend uuid := (select id from pessoas where razao_social = 'João Vendedor'); p1 uuid; p2 uuid; t record; r jsonb;
  cli uuid := (select id from pessoas where razao_social = 'Cliente Livre');
  prod uuid := (select id from produtos where codigo = 'EMP1');
  bol uuid := (select id from formas_pagamento where nome = 'Boleto');
begin
  assert coalesce((select comissao_percentual from pessoas where id = vend), (select comissao_padrao from empresas limit 1)) = 3, 'vendedor com 3%';
  perform estoque_entrada(prod, (select id from depositos order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1), 20, 'L-COM', current_date + 60, null, 10, 'teste comissão');
  for i in 1..2 loop
    insert into pedidos (cliente_id, vendedor_id, forma_pagamento_id) values (cli, vend, bol) returning id into p2;
    insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) values (p2, prod, 2, 50);
    perform pedido_confirmar(p2);
    if i = 1 then p1 := p2; end if;
  end loop;
  perform pedido_faturar_lote(array[p1, p2]);
  assert (select count(*) from comissoes where pedido_id in (p1, p2) and status = 'ativa') = 2;
  assert (select valor from comissoes where pedido_id = p1) = round((select valor_total from pedidos where id = p1) * 0.03, 2);
  select * into t from lancamentos where origem = 'comissao' and origem_id = vend and ativo;
  assert t.valor = (select sum(valor) from comissoes where vendedor_id = vend and status = 'ativa' and competencia = date_trunc('month', current_date)::date), 'título = soma';
  assert t.data_vencimento = (date_trunc('month', current_date) + interval '1 month')::date + 4, 'vence dia 5';
  assert t.tipo = 'pagar' and (select codigo from plano_contas where id = t.plano_conta_id) = '2.03';
  -- estorno tira do título
  perform pedido_estornar_faturamento(p1, 'teste');
  assert (select status from comissoes where pedido_id = p1) = 'estornada';
  assert (select valor from lancamentos where id = t.id) = (select valor from comissoes where pedido_id = p2), 'título recalculado';
  -- paga o mês e estorna o outro: vira desconto no mês atual
  perform lancamento_baixar(t.id, current_date, (select valor from lancamentos where id = t.id), (select id from contas_bancarias where nome = 'Caixa da empresa'));
  perform pedido_estornar_faturamento(p2, 'teste 2');
  assert exists (select 1 from comissoes where pedido_id = p2 and valor < 0 and status = 'ativa'), 'desconto';
  -- refatura p1: comissão nova
  perform pedido_faturar_lote(array[p1]);
  assert (select count(*) from comissoes where pedido_id = p1 and status = 'ativa' and valor > 0) = 1;
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; begin
  r := app_comissoes();
  assert (r->>'percentual')::numeric = 3 and (r->>'dia_pagamento')::int = 5, r::text;
  assert jsonb_array_length(r->'historico') >= 1 and r->'por_vendedor' = 'null'::jsonb, r::text;
  assert (select count(*) from comissoes) = (select count(*) from comissoes where vendedor_id = (select id from pessoas where razao_social = 'João Vendedor')), 'vendedor só vê as dele';
end $$;
select jsonb_pretty(app_comissoes());
reset role;
\echo COMISSOES OK
