\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; begin
  r := app_resumo();
  assert jsonb_array_length(r->'diario') between 28 and 31, r::text;
  assert (r->>'vendido_hoje')::numeric > 0 and (r->>'pedidos_hoje')::int > 0, r::text;
  assert (r->>'faturado')::numeric > 0, 'faturado no mês: ' || r::text;
  assert (select sum((x->>'vendido')::numeric) from jsonb_array_elements(r->'diario') x) = (r->>'vendido')::numeric, 'série soma o mês';
  assert r ? 'comissao_hoje' and r ? 'comissao_mes';
end $$;
select jsonb_pretty(app_resumo() - 'diario');
reset role;
\echo PAINEL OK
