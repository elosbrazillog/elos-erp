\set ON_ERROR_STOP 1
-- Despesas da frota. Roda depois de teste_acerto.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare vei uuid; d uuid; begin
  insert into veiculos (placa, descricao) values ('TST1A23', 'Fiorino') returning id into vei;
  perform public.t_erro(format('select despesa_frota_lancar(%L, null, null, %L)', 'combustivel', vei), 'km atual');
  perform public.t_erro(format('select despesa_frota_lancar(%L, null, null, %L, null, null, null, false, 1000)', 'combustivel', vei), 'litros');
  perform public.t_erro(format('select despesa_frota_lancar(%L, null, null, %L, null, null, null, false, 1000, 40)', 'combustivel', vei), 'valor pago no litro');
  perform public.t_erro(format('select despesa_frota_lancar(%L, 100)', 'combustivel'), 'veículo');
  d := despesa_frota_lancar('combustivel', null, current_date - 7, vei, null, null, null, false, 10000, 40, 6.09, 'diesel');
  assert (select valor from despesas_frota where id = d) = 243.60, 'valor = litros x preço';
  perform public.t_erro(format('select despesa_frota_lancar(%L, null, null, %L, null, null, null, false, 9990, 30, 6)', 'combustivel', vei), 'precisa ser maior');
  d := despesa_frota_lancar('combustivel', null, current_date, vei, null, null, null, true, 10400, 40, 6.10, 'diesel');
  assert (select km_rodados from vw_despesas_frota where id = d) = 400;
  assert (select km_por_litro from vw_despesas_frota where id = d) = 10;
  assert (select custo_km from vw_despesas_frota where id = d) = 0.610, (select custo_km::text from vw_despesas_frota where id = d);
  perform public.t_erro(format('select despesa_frota_lancar(%L, 0)', 'pedagio'), 'Informe o valor');
  perform public.t_erro(format('select despesa_frota_lancar(%L, 10)', 'outros'), 'Descreva');
  d := despesa_frota_lancar('pedagio', 12.5, null, vei);
  perform despesa_frota_excluir(d);
  assert not exists (select 1 from vw_despesas_frota where id = d);
  perform public.t_erro(format('select despesa_frota_lancar(%L, 10, %L)', 'pedagio', current_date + 1), 'futura');
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro('select despesa_frota_lancar(''pedagio'', 10)', 'não tem permissão');
reset role;
\echo DESPESAS OK
