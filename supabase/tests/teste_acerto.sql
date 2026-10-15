\set ON_ERROR_STOP 1
-- Recebimento na entrega e acerto. Roda depois de teste_equipe.sql.
update pessoas set limite_credito = 100000, bloqueado = false where eh_cliente;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare exp uuid; p1 uuid; p2 uuid; p3 uuid; e1 uuid; e2 uuid; e3 uuid; r jsonb; a jsonb; v1 numeric; v2 numeric;
  din uuid := (select id from formas_pagamento where nome = 'Dinheiro');
  pix uuid := (select id from formas_pagamento where nome = 'PIX');
  bol uuid := (select id from formas_pagamento where nome = 'Boleto');
  avista uuid := (select id from condicoes_pagamento where nome = 'À vista');
  caixa uuid := (select id from contas_bancarias where nome = 'Caixa da empresa');
  banco uuid := (select id from contas_bancarias where nome = 'Sicredi');
  prod uuid := (select id from produtos where codigo = 'EMP1');
  cli uuid := (select id from pessoas where razao_social = 'Cliente Livre');
begin
  assert (select recebe_na_entrega from formas_pagamento where id = din) = 'dinheiro';
  assert (select recebe_na_entrega from formas_pagamento where id = bol) is null;
  perform estoque_entrada(prod, (select id from depositos order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1), 50, 'L-AC', current_date + 60, null, 10, 'teste acerto');
  -- três pedidos: dinheiro, PIX e boleto
  foreach p1 in array array[din, pix, bol] loop
    insert into pedidos (cliente_id, condicao_pagamento_id, forma_pagamento_id) values (cli, avista, p1) returning id into p2;
    insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) values (p2, prod, 2, 50);
    perform pedido_confirmar(p2);
  end loop;
  select id into p1 from pedidos where forma_pagamento_id = din and status = 'aprovado' order by criado_em desc limit 1;
  select id into p2 from pedidos where forma_pagamento_id = pix and status = 'aprovado' order by criado_em desc limit 1;
  select id into p3 from pedidos where forma_pagamento_id = bol and status = 'aprovado' order by criado_em desc limit 1;
  select valor_total into v1 from pedidos where id = p1;
  select valor_total into v2 from pedidos where id = p2;
  insert into expedicoes (data, motorista_id) values (current_date, (select id from pessoas where eh_motorista limit 1)) returning id into exp;
  perform expedicao_incluir_pedidos(exp, array[p1, p2, p3]);
  perform expedicao_separar(exp);
  perform expedicao_saida(exp);
  select id into e1 from expedicoes_pedidos where pedido_id = p1;
  select id into e2 from expedicoes_pedidos where pedido_id = p2;
  select id into e3 from expedicoes_pedidos where pedido_id = p3;

  -- valor não fecha
  perform public.t_erro(format('select expedicao_registrar_entrega(%L, %L, null, null, null, %L::jsonb)', e1, 'entregue',
    '[{"tipo":"dinheiro","valor":1}]'), 'não fecha');
  -- dividido: metade dinheiro, metade PIX
  perform expedicao_registrar_entrega(e1, 'entregue', null, null, null,
    jsonb_build_array(jsonb_build_object('tipo', 'dinheiro', 'valor', v1 - 30), jsonb_build_object('tipo', 'pix', 'valor', 30)));
  -- sem informar: vale a forma do pedido
  perform expedicao_registrar_entrega(e2, 'entregue');
  assert (select recebido_pix from vw_expedicao_pedidos where id = e2) = v2;
  -- acerto antes do fim
  perform public.t_erro(format('select acerto_registrar(%L, 0)', exp), 'depois que todas');
  perform expedicao_registrar_entrega(e3, 'entregue');
  assert (select count(*) from entregas_recebimentos where expedicao_pedido_id = e3) = 0, 'boleto não recebe na entrega';

  r := acerto_resumo(exp);
  assert (r->>'recebido_dinheiro')::numeric = v1 - 30 and (r->>'recebido_pix')::numeric = 30 + v2, r::text;
  assert (r->>'previsto_dinheiro')::numeric = v1 and (r->>'a_prazo')::numeric > 0, r::text;

  perform public.t_erro(format('select acerto_registrar(%L, 10, %L::jsonb, null, true, null, %L)', exp, '[]', banco), 'conta (caixa)');
  -- motorista entrega o dinheiro menos 20 de combustível
  a := acerto_registrar(exp, v1 - 30 - 20, '[{"descricao":"Combustível","valor":20}]'::jsonb, 'ok', true, caixa, banco);
  assert (a->>'diferenca')::numeric = 0, a::text;
  assert (a->>'titulos_baixados')::int = 3, a::text;
  assert not exists (select 1 from lancamentos where origem_id in (p1, p2) and ativo and data_quitacao is null), 'títulos quitados';
  assert (select count(*) from lancamentos where origem_id = p1 and ativo and data_quitacao is not null and conta_bancaria_id = caixa) = 1;
  assert exists (select 1 from lancamentos where origem_id = p3 and ativo and data_quitacao is null), 'boleto segue em aberto';
  perform public.t_erro(format('select acerto_registrar(%L, 0)', exp), 'já tem acerto');
  perform public.t_erro(format('select acerto_excluir(%L)', exp), 'baixou títulos');
  assert (acerto_resumo(exp)->'acerto'->>'dinheiro_entregue')::numeric = v1 - 50;
end $$;
reset role;
\echo ACERTO OK
