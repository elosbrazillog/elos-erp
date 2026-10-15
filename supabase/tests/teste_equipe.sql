\set ON_ERROR_STOP 1
-- Equipe, roteirização e etapas. Roda depois de teste_painel.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare exp uuid; ep uuid; ep2 uuid; pids uuid[]; m uuid; begin
  insert into pessoas (tipo_pessoa, razao_social, eh_motorista, cnh_numero, cnh_categoria, cnh_validade, chave_pix, data_admissao)
  values ('PF', 'Motorista Novo', true, '12345678900', 'D', current_date + 300, 'pix@x.com', current_date) returning id into m;
  insert into pessoas (tipo_pessoa, razao_social, eh_vendedor, supervisor_id, regiao, desconto_maximo)
  values ('PF', 'Vendedor Novo', true, (select id from pessoas where razao_social = 'João Vendedor'), 'Centro', 5);
  perform public.t_erro('insert into pessoas (razao_social, desconto_maximo) values (''x'', 150)', 'check');

  perform empresa_definir_saida(-20.47, -54.62);
  assert (select latitude from empresas limit 1) = -20.47;

  -- carga com dois pedidos aprovados
  select array_agg(id) into pids from (select id from pedidos where status = 'aprovado' and tipo = 'pedido' limit 2) x;
  assert cardinality(pids) = 2, 'precisa de 2 aprovados';
  insert into expedicoes (data, motorista_id) values (current_date, m) returning id into exp;
  perform expedicao_incluir_pedidos(exp, pids);
  perform endereco_coordenada_pedido(pids[1], -20.48, -54.63);
  perform expedicao_ordenar(exp, array[pids[2], pids[1]]);
  assert (select ordem_entrega from expedicoes_pedidos where expedicao_id = exp and pedido_id = pids[2]) = 1, 'roteirizado';
  perform expedicao_separar(exp);
  perform expedicao_saida(exp);
  select id into ep from expedicoes_pedidos where expedicao_id = exp and pedido_id = pids[1];
  select id into ep2 from expedicoes_pedidos where expedicao_id = exp and pedido_id = pids[2];
  assert (select etapa from vw_expedicao_pedidos where id = ep) = 'aguardando';

  perform expedicao_etapa(ep2, 'a_caminho', -20.475, -54.625);
  perform expedicao_etapa(ep, 'a_caminho');
  assert (select etapa from expedicoes_pedidos where id = ep2) = 'aguardando', 'só um a caminho por vez';
  assert (select a_caminho from vw_acompanhamento where id = exp) = 1;
  perform expedicao_etapa(ep, 'chegou', -20.48, -54.63);
  assert (select no_cliente from vw_acompanhamento where id = exp) = 1;
  assert (select chegou_em from expedicoes_pedidos where id = ep) is not null;

  perform expedicao_registrar_entrega(ep, 'entregue', null, -20.4801, -54.6301);
  assert (select coordenada_fonte from vw_expedicao_pedidos where id = ep) = 'entrega', 'entrega vale mais que geocodificada';
  perform public.t_erro(format('select expedicao_etapa(%L, %L)', ep, 'chegou'), 'já foi registrada');
  perform expedicao_registrar_entrega(ep2, 'devolvido_total', 'Avaria');
  assert (select status from expedicoes where id = exp) = 'concluida';
end $$;
reset role;
-- vendedor não define ponto de saída
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro('select empresa_definir_saida(1, 1)', 'não tem permissão');
reset role;
\echo EQUIPE OK
