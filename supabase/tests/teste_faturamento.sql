\set ON_ERROR_STOP 1
-- Alteração pelo vendedor, faturamento em lote e boletos. Roda depois de teste_metas.sql.
update pessoas set limite_credito = 100000, bloqueado = false where razao_social = 'Cliente Livre';
select set_config('t.livre', (select id::text from pessoas where razao_social = 'Cliente Livre'), false);
select set_config('t.emp1', (select id::text from produtos where codigo = 'EMP1'), false);
select set_config('t.boleto', (select id::text from formas_pagamento where nome = 'Boleto'), false);
select set_config('t.dinheiro', (select id::text from formas_pagamento where not gera_boleto order by nome limit 1), false);
select set_config('t.cond', (select id::text from condicoes_pagamento where nome = '14/28 dias'), false);

-- Vendedor: pedido com pagamento escolhido e alteração antes de faturar
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; pid uuid; d jsonb; begin
  assert jsonb_array_length(app_pagamentos()->'formas') >= 2;
  assert (select count(*) from app_carteira() where condicao_pagamento_id is not null or forma_pagamento_id is not null) >= 0;
  r := app_enviar_pedido('fat-1', current_setting('t.livre')::uuid,
         jsonb_build_array(jsonb_build_object('produto_id', current_setting('t.emp1'), 'quantidade', 1)),
         null, null, null, null, current_setting('t.cond')::uuid, current_setting('t.boleto')::uuid);
  assert r->>'status' = 'aprovado', r::text;
  pid := (r->>'pedido_id')::uuid;
  assert (select forma_pagamento_id from pedidos where id = pid) = current_setting('t.boleto')::uuid, 'forma escolhida';
  d := app_pedido(pid);
  assert (d->>'pode_alterar')::boolean and jsonb_array_length(d->'itens') = 1, d::text;

  -- troca a forma para dinheiro e a quantidade para 2
  r := app_alterar_pedido(pid, 'alt-1', jsonb_build_array(jsonb_build_object('produto_id', current_setting('t.emp1'), 'quantidade', 2)),
         null, current_setting('t.dinheiro')::uuid, 'Trocou pagamento', null);
  assert r->>'status' = 'aprovado' and not (r->>'ja_existia')::boolean, r::text;
  assert (select forma_pagamento_id from pedidos where id = pid) = current_setting('t.dinheiro')::uuid, 'forma alterada';
  assert (select condicao_pagamento_id from pedidos where id = pid) = current_setting('t.cond')::uuid, 'condição mantida';
  assert (select quantidade from pedidos_itens where pedido_id = pid and ativo) = 2;
  assert (select sum(quantidade) from pedidos_reservas where pedido_id = pid) = 2, 'reserva refeita';
  -- reenvio da mesma alteração não refaz
  r := app_alterar_pedido(pid, 'alt-1', '[]'::jsonb);
  assert (r->>'ja_existia')::boolean;
  assert (select quantidade from pedidos_itens where pedido_id = pid and ativo) = 2;
  perform set_config('t.pid', pid::text, false);
  perform public.t_erro('select pedido_faturar_lote(array[''' || pid || '''::uuid])', 'não tem permissão');
end $$;
reset role;

-- Escritório põe o pedido numa carga montando; vendedor ainda pode alterar (sai da carga)
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare exp uuid; begin
  insert into expedicoes (data) values (current_date) returning id into exp;
  perform expedicao_incluir_pedidos(exp, array[current_setting('t.pid')::uuid]);
  perform set_config('t.exp', exp::text, false);
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; pid uuid := current_setting('t.pid')::uuid; begin
  assert (app_pedido(pid)->>'pode_alterar')::boolean, 'em carga montando ainda altera';
  r := app_alterar_pedido(pid, 'alt-2', jsonb_build_array(jsonb_build_object('produto_id', current_setting('t.emp1'), 'quantidade', 2)),
         null, current_setting('t.boleto')::uuid, null, null);
  assert r->>'status' = 'aprovado' and (r->>'saiu_da_carga')::boolean, r::text;
end $$;
reset role;

-- Faturamento em lote
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; pid uuid := current_setting('t.pid')::uuid; rasc uuid; begin
  assert not exists (select 1 from expedicoes_pedidos where pedido_id = pid), 'saiu da carga';
  select id into rasc from pedidos where status = 'rascunho' and tipo = 'pedido' limit 1;
  assert exists (select 1 from vw_faturamento where id = pid and faturado_em is null);
  r := pedido_faturar_lote(array[pid, rasc]);
  assert (r->>'faturados')::int = 1 and (r->>'boletos')::int = 2 and jsonb_array_length(r->'erros') = (case when rasc is null then 0 else 1 end), r::text;
  assert (select faturado_em from pedidos where id = pid) is not null;
  assert (select count(*) from lancamentos where origem_id = pid and ativo) = 2, 'títulos no faturamento';
  assert (select count(*) from vw_boletos where pedido_id = pid and status = 'pendente') = 2;
  r := pedido_faturar_lote(array[pid]);
  assert (r->'erros'->0->>'motivo') like '%já está faturado%', r::text;
  perform public.t_erro(format('update pedidos set faturado_em = null where id = %L', pid), 'só muda pelas ações');
  perform public.t_erro(format('select pedido_cancelar(%L, %L)', pid, 'teste'), 'estorne o faturamento');
  perform public.t_erro(format('select pedido_reabrir(%L)', pid), 'já faturado');
end $$;
reset role;

-- Vendedor não altera faturado, mas consulta e vê os boletos
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare pid uuid := current_setting('t.pid')::uuid; d jsonb; begin
  d := app_pedido(pid);
  assert not (d->>'pode_alterar')::boolean and d->>'faturado_em' is not null and jsonb_array_length(d->'titulos') = 2, d::text;
  perform public.t_erro(format('select app_alterar_pedido(%L, %L, %L::jsonb)', pid, 'alt-3', '[{"produto_id":"' || current_setting('t.emp1') || '","quantidade":1}]'), 'já foi faturado');
  assert (select count(*) from vw_boletos where pedido_id = pid) = 2;
  assert (select count(*) from vw_faturamento) = 0, 'vendedor não vê a fila de faturamento';
end $$;
reset role;

-- Estorno do faturamento e refaturamento
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare pid uuid := current_setting('t.pid')::uuid; r jsonb; begin
  perform pedido_estornar_faturamento(pid, 'Teste de estorno');
  assert (select faturado_em from pedidos where id = pid) is null;
  assert (select count(*) from boletos where pedido_id = pid and status = 'cancelado') = 2;
  assert (select count(*) from lancamentos where origem_id = pid and ativo) = 0, 'títulos cancelados';
  r := pedido_faturar_lote(array[pid]);
  assert (r->>'boletos')::int = 2, r::text;
  assert (select count(*) from boletos where pedido_id = pid and status = 'pendente') = 2;
end $$;
select numero, status, faturado_em is not null as faturado, forma_nome, boletos from vw_faturamento;
select pedido_numero, status, valor, data_vencimento, pagador_nome, conta_nome from vw_boletos;
reset role;
\echo FATURAMENTO OK
