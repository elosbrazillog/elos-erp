\set ON_ERROR_STOP 1
-- Gestão geral (só administrador). Roda depois de teste_historico.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; begin
  r := gestao_resumo(date_trunc('month', current_date)::date, current_date);
  assert (r->>'faturado')::numeric > 0, 'faturado ' || r::text;
  assert jsonb_array_length(r->'diario') = extract(day from current_date)::int;
  assert r ? 'receber_aberto' and r ? 'pedidos_status' and r ? 'estoque_valor' and r ? 'clientes_parados';
  assert jsonb_array_length(r->'vendedores') >= 1;
  raise notice 'GESTAO OK';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  perform gestao_resumo(current_date, current_date);
  raise exception 'vendedor não deveria ver';
exception when others then
  assert sqlerrm like 'Só o administrador%', sqlerrm;
end $$;
reset role;
