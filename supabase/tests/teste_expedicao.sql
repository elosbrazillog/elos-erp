\set ON_ERROR_STOP 1
-- Expedição: carga, separação, saída com baixa, entrega, devolução e ausente.
-- Roda depois de teste_fase2.sql.

-- Motorista (pessoa + usuário com perfil Motorista)
insert into pessoas (empresa_id, razao_social, eh_motorista) select id, 'Zé Motorista', true from empresas;
insert into auth.users (id, email, raw_user_meta_data)
  select '55555555-5555-5555-5555-555555555555', 'moto@elos.com', jsonb_build_object('nome','Zé','empresa_id',empresa_id,'perfil_id',id) from perfis where nome='Motorista';
update usuarios set pessoa_id = (select id from pessoas where razao_social = 'Zé Motorista') where id = '55555555-5555-5555-5555-555555555555';

create or replace function public.t_saldo_total(p_cod text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade), 0) from estoque_saldos s join produtos p on p.id = s.produto_id join depositos d on d.id = s.deposito_id where p.codigo = p_cod and d.padrao $$;
create or replace function public.t_reservado(p_cod text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade_reservada), 0) from estoque_saldos s join produtos p on p.id = s.produto_id where p.codigo = p_cod $$;
grant execute on function public.t_saldo_total(text), public.t_reservado(text) to authenticated;

-- ===================== admin monta a carga =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- Três pedidos novos de 2 empadas cada (A, B, C), além do pedido 2 já aprovado
insert into pessoas (razao_social, eh_cliente, ordem_visita) values ('Cliente B', true, 2), ('Cliente C', true, 1);
do $$ declare c text; pid uuid; begin
  foreach c in array array['Cliente Livre', 'Cliente B', 'Cliente C'] loop
    insert into pedidos (cliente_id) select id from pessoas where razao_social = c returning id into pid;
    insert into pedidos_itens (pedido_id, produto_id, quantidade) select pid, id, 2 from produtos where codigo = 'EMP1';
    perform pedido_confirmar(pid);
  end loop;
end $$;

do $$ declare exp uuid; n int; saldo_antes numeric; res_antes numeric; v jsonb; begin
  insert into expedicoes (data, motorista_id) select current_date, id from pessoas where razao_social = 'Zé Motorista' returning id into exp;
  assert (select status from expedicoes where id = exp) = 'montando';
  perform public.t_erro(format('update expedicoes set status = %L where id = %L', 'em_rota', exp), 'só muda pelas ações');
  perform public.t_erro(format('insert into expedicoes_pedidos (expedicao_id, pedido_id) select %L, id from pedidos limit 1', exp), 'Use as ações da carga');

  select expedicao_incluir_pedidos(exp, array_agg(id)) into n from pedidos where status = 'aprovado';
  assert n = 4, format('incluídos %s', n);
  assert (select count(*) from pedidos where status = 'em_separacao') = 4;
  -- ordem pela ordem de visita: Cliente C (1), Cliente B (2), depois os sem ordem
  assert (select c.razao_social from expedicoes_pedidos ep join pedidos p on p.id = ep.pedido_id join pessoas c on c.id = p.cliente_id
           where ep.expedicao_id = exp and ep.ordem_entrega = 1) = 'Cliente C', 'ordem de visita';
  perform public.t_erro(format('select expedicao_incluir_pedidos(%L, array_agg(id)) from pedidos where status = %L', exp, 'em_separacao'), 'não está aprovado');

  -- separação mostra os lotes reservados (FEFO)
  assert (select sum(quantidade) from vw_separacao where expedicao_id = exp) = 9, format('separação: %s', (select sum(quantidade) from vw_separacao where expedicao_id = exp));

  -- retirar e incluir de novo
  perform expedicao_retirar_pedido(exp, (select pedido_id from expedicoes_pedidos where expedicao_id = exp and ordem_entrega = 4));
  assert (select count(*) from pedidos where status = 'aprovado') = 1, 'retirado volta a aprovado';
  perform expedicao_incluir_pedidos(exp, array(select id from pedidos where status = 'aprovado'));

  perform expedicao_separar(exp);
  saldo_antes := public.t_saldo_total('EMP1');
  res_antes := public.t_reservado('EMP1');
  select expedicao_saida(exp) into v;
  assert (v->>'pedidos')::int = 4, v::text;
  assert public.t_saldo_total('EMP1') = saldo_antes - 9, format('baixa: antes %s depois %s', saldo_antes, public.t_saldo_total('EMP1'));
  assert public.t_reservado('EMP1') = res_antes - 9, 'reserva consumida';
  assert (select count(*) from pedidos_reservas) = 0;
  assert (select count(*) from pedidos where status = 'em_rota') = 4;
  perform public.t_erro(format('select expedicao_cancelar(%L)', exp), 'situação atual');
  perform public.t_erro(format('select pedido_cancelar(pedido_id, %L) from expedicoes_pedidos where expedicao_id = %L limit 1', 'x', exp), 'não pode mais ser cancelado');
end $$;
reset role;

-- ===================== motorista registra as entregas =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ declare exp uuid; saldo numeric; v jsonb; begin
  assert (select count(*) from pedidos) = 0, 'motorista não lê a tabela de pedidos';
  assert (select count(*) from vw_expedicao_pedidos) = 4, 'mas vê as entregas da carga';
  assert (select count(*) from vw_expedicao_itens) = 4, 'e os itens';
  select id into exp from vw_expedicoes where status = 'em_rota';

  perform expedicao_registrar_entrega((select id from vw_expedicao_pedidos where ordem_entrega = 1), 'entregue');
  perform public.t_erro(format('select expedicao_registrar_entrega(%L, %L)', (select id from vw_expedicao_pedidos where ordem_entrega = 1), 'entregue'), 'já foi registrada');
  perform public.t_erro(format('select expedicao_registrar_entrega(%L, %L, %L)', (select id from vw_expedicao_pedidos where ordem_entrega = 2), 'devolvido_total', ''), 'motivo');

  perform expedicao_registrar_entrega((select id from vw_expedicao_pedidos where ordem_entrega = 2), 'devolvido_total', 'Produto descongelado');
  perform expedicao_registrar_entrega((select id from vw_expedicao_pedidos where ordem_entrega = 3), 'ausente');
  select expedicao_registrar_entrega((select id from vw_expedicao_pedidos where ordem_entrega = 4), 'entregue') into v;
  assert (v->>'carga_concluida')::boolean, 'última entrega conclui a carga';
  assert (select status from vw_expedicoes where id = exp) = 'concluida';
  perform public.t_erro('select estoque_entrada(id, id, 1) from produtos limit 1', 'não tem permissão');
end $$;
reset role;

-- ===================== conferência =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  assert (select count(*) from pedidos where status = 'entregue') = 2, 'dois entregues';
  assert (select count(*) from pedidos where status = 'devolvido') = 1, 'um devolvido';
  assert (select count(*) from pedidos where status = 'aprovado') = 1, 'ausente volta a aprovado';
  assert (select count(*) from pedidos_reservas r join pedidos p on p.id = r.pedido_id where p.status = 'aprovado') > 0, 'ausente com reserva refeita';
end $$;
select ep.ordem_entrega, ep.cliente_nome, ep.status_entrega, ep.pedido_status, ep.motivo_devolucao from vw_expedicao_pedidos ep order by 1;
select tipo, lote_numero, quantidade_sinal, observacao from vw_estoque_movimentos where origem = 'expedicao' order by data, tipo;
select numero, status, qtd_pedidos, entregues, nao_entregues, pendentes, peso_total_kg, valor_total from vw_expedicoes;
reset role;
set role anon;
do $$ begin
  begin perform 1 from vw_expedicoes; raise exception 'anon leu vw_expedicoes'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'EXPEDICAO OK' as resultado;
