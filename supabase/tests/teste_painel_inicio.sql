\set ON_ERROR_STOP 1
-- Painel inicial. Roda depois de teste_comissoes.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; v jsonb; begin
  r := painel_resumo();
  assert jsonb_array_length(r->'vendedores') >= 1, 'vendedores';
  select x into v from jsonb_array_elements(r->'vendedores') x where x->>'nome' = 'João Vendedor';
  assert (v->>'comissao_mes')::numeric = (select sum(valor) from comissoes c join pessoas p on p.id = c.vendedor_id
           where p.razao_social = 'João Vendedor' and c.status = 'ativa' and c.competencia = date_trunc('month', current_date)::date), 'comissão mês';
  assert (v->>'percentual')::numeric = 3;
  assert jsonb_array_length(r->'diario') >= 28 and jsonb_array_length(r->'meses') = 6 and jsonb_array_length(r->'semanas') = 4;
  assert (r->>'faturado_mes')::numeric = (select sum(x) from jsonb_array_elements(r->'diario') e, lateral (select (e->>'valor')::numeric x) s);
  assert r ? 'pagar_aberto' and r ? 'estoque_baixo';
  r := painel_resumo(); -- segunda chamada na mesma sessão
  raise notice 'PAINEL INICIO OK';
end $$;
reset role;
-- vendedor (com carteira) não vê o bloco de vendas da empresa
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; begin
  r := painel_resumo();
  assert not (r ? 'vendedores'), 'vendedor não vê todos';
end $$;
reset role;
