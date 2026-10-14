\set ON_ERROR_STOP 1
-- Força de vendas e rastreamento. Roda depois de teste_relatorios.sql.

-- Vendedor 2222 ligado ao João; carteira: Cliente Livre e Cliente B
update usuarios set pessoa_id = (select id from pessoas where razao_social = 'João Vendedor') where id = '22222222-2222-2222-2222-222222222222';
update pessoas set vendedor_id = (select id from pessoas where razao_social = 'João Vendedor') where razao_social in ('Cliente Livre', 'Cliente B');
insert into pessoas_enderecos (empresa_id, pessoa_id, logradouro, numero, bairro, cidade, uf)
  select empresa_id, id, 'Rua das Flores', '100', 'Centro', 'Campo Grande', 'MS' from pessoas where razao_social = 'Cliente Livre';

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; r2 jsonb; n int; begin
  assert (select count(*) from pessoas where eh_cliente) = 2, format('carteira visível: %s', (select count(*) from pessoas where eh_cliente));
  assert (select count(*) from app_carteira()) = 2;
  assert (select count(*) from pedidos where vendedor_id <> (select id from pessoas where razao_social = 'João Vendedor')) = 0, 'só pedidos dele';
  assert (select count(*) from app_produtos()) >= 2;
  assert (select disponivel from app_produtos() where codigo = 'EMP1') >= 2;

  r := app_enviar_pedido('cel-001', (select id from pessoas where razao_social = 'Cliente Livre'),
         jsonb_build_array(jsonb_build_object('produto_id', (select id from produtos where codigo = 'EMP1'), 'quantidade', 2)),
         'Entregar cedo', null, -20.46, -54.62);
  assert r->>'status' = 'aprovado', r::text;
  assert not (r->>'ja_existia')::boolean;
  -- reenvio (sinal caiu no meio) não duplica
  r2 := app_enviar_pedido('cel-001', (select id from pessoas where razao_social = 'Cliente Livre'), '[{"produto_id":"00000000-0000-0000-0000-000000000000","quantidade":1}]');
  assert (r2->>'ja_existia')::boolean and r2->>'numero' = r->>'numero', r2::text;
  select count(*) into n from pedidos where id_local = 'cel-001';
  assert n = 1;
  assert (select vendedor_id from pedidos where id_local = 'cel-001') = (select id from pessoas where razao_social = 'João Vendedor'), 'vendedor forçado';
  assert (select origem from pedidos where id_local = 'cel-001') = 'app';
  assert exists (select 1 from visitas where resultado = 'pedido');

  -- cliente de outro vendedor
  perform public.t_erro(format('select app_enviar_pedido(%L, %L, %L::jsonb)', 'cel-002', (select id from pessoas where razao_social = 'Lanchonete Teste'),
    '[{"produto_id":"' || (select id from produtos where codigo = 'EMP1') || '","quantidade":1}]'), 'fora da sua carteira');

  -- sem estoque: fica em rascunho com o motivo para o escritório
  r := app_enviar_pedido('cel-003', (select id from pessoas where razao_social = 'Cliente B'),
         jsonb_build_array(jsonb_build_object('produto_id', (select id from produtos where codigo = 'EMP1'), 'quantidade', 5000)));
  assert r->>'status' = 'rascunho' and r->>'motivo' like 'Enviado pelo app e não confirmado: Estoque insuficiente%', r::text;
  assert (select count(*) from pedidos_reservas r join pedidos p on p.id = r.pedido_id where p.id_local = 'cel-003') = 0, 'sem reserva pela metade';

  perform app_registrar_visita('vis-001', (select id from pessoas where razao_social = 'Cliente B'), 'Estoque cheio, volta semana que vem');
  perform app_registrar_visita('vis-001', (select id from pessoas where razao_social = 'Cliente B'), 'repetido');
  assert (select count(*) from visitas where resultado = 'sem_pedido') = 1, 'visita não duplica';
  assert (select visita_hoje from app_carteira() where nome = 'Cliente B') = 'pedido', 'pedido no dia prevalece';

  r := app_resumo();
  assert (r->>'vendido')::numeric >= 18 and (r->>'carteira')::int = 2, r::text;
end $$;
select nome, endereco, rota_nome, em_atraso, ultimo_pedido_numero, ultimo_itens, visita_hoje from app_carteira();
select app_resumo();
reset role;

-- Motorista: posição e entrega com coordenada
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare exp uuid; begin
  insert into expedicoes (data, motorista_id) select current_date, id from pessoas where razao_social = 'Zé Motorista' returning id into exp;
  perform expedicao_incluir_pedidos(exp, array(select id from pedidos where id_local = 'cel-001'));
  perform expedicao_saida(exp);
  assert (select saiu_em from expedicoes where id = exp) is not null, 'hora de saída';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
select app_posicao((select id from vw_acompanhamento where status = 'em_rota' order by numero desc limit 1), -20.4697, -54.6201, 12);
select pg_sleep(0.05);
select app_posicao((select id from vw_acompanhamento where status = 'em_rota' order by numero desc limit 1), -20.4600, -54.6100, 10);
do $$ declare exp uuid; ep uuid; begin
  select id into exp from vw_acompanhamento where status = 'em_rota' order by numero desc limit 1;
  assert (select ultima_latitude from vw_acompanhamento where id = exp) = -20.4600, 'última posição';
  select id into ep from vw_expedicao_pedidos where expedicao_id = exp;
  perform expedicao_registrar_entrega(ep, 'entregue', null, -20.4612, -54.6123);
  assert (select entrega_latitude from vw_expedicao_pedidos where id = ep) = -20.4612;
  assert (select status from vw_acompanhamento where id = exp) = 'concluida' and (select concluida_em from vw_acompanhamento where id = exp) is not null;
end $$;
reset role;
do $$ begin
  assert (select latitude from pessoas_enderecos e join pessoas p on p.id = e.pessoa_id where p.razao_social = 'Cliente Livre') = -20.4612, 'endereço aprendeu a coordenada';
end $$;
select numero, status, rota_nome, motorista_nome, qtd_pedidos, entregues, pendentes, ultima_latitude, ultima_longitude from vw_acompanhamento;

-- Anônimo não lê nada novo
set role anon;
do $$ begin
  begin perform 1 from vw_acompanhamento; raise exception 'anon leu'; exception when insufficient_privilege then null; end;
  begin perform app_carteira(); raise exception 'anon chamou'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'FORCA DE VENDAS OK' as resultado;
