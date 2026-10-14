\set ON_ERROR_STOP 1
-- Metas. Roda depois de teste_forca_vendas.sql.
update pessoas set eh_vendedor = true, meta_mensal = 1000 where razao_social = 'João Vendedor';

-- Vendedor restrito: vê só a própria meta e não define meta
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ declare r jsonb; begin
  assert (select count(*) from metas_mes()) = 1, 'só ele';
  assert (select meta from metas_mes()) = 1000, 'meta do cadastro';
  r := app_resumo();
  assert (r->>'meta')::numeric = 1000 and not (r->>'meta_da_empresa')::boolean and r->'vendedores' = 'null'::jsonb, r::text;
  perform public.t_erro('select meta_definir(current_date, null, 5000)', 'não tem permissão');
end $$;
reset role;

-- Gestor: define meta do mês do vendedor e da empresa
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; v uuid := (select id from pessoas where razao_social = 'João Vendedor'); begin
  r := app_resumo();
  assert (r->>'meta_da_empresa')::boolean and (r->>'meta')::numeric = 1000, 'empresa = soma dos vendedores: ' || r::text;
  perform meta_definir(current_date, v, 1500);
  perform meta_definir(current_date + 1, v, 1800);  -- mesmo mês: substitui
  assert (select count(*) from metas) = 1;
  assert (select meta from metas_mes() where vendedor_id = v) = 1800 and (select meta_lancada from metas_mes() where vendedor_id = v);
  assert (app_resumo()->>'meta')::numeric = 1800;
  perform meta_definir(current_date, null, 9000);
  assert (app_resumo()->>'meta')::numeric = 9000, 'meta lançada da empresa';
  assert jsonb_array_length(app_resumo()->'vendedores') >= 1;
  perform meta_definir(current_date, null, null);
  assert (app_resumo()->>'meta')::numeric = 1800, 'apagou a da empresa';
  perform public.t_erro('select meta_definir(current_date, null, -1)', 'negativa');
  assert (select meta from metas_mes((current_date - interval '1 month')::date) where vendedor_id = v) = 1000, 'outro mês usa o cadastro';
end $$;
select vendedor_nome, meta, meta_lancada, vendido, pedidos, clientes, carteira from metas_mes();
reset role;
\echo METAS OK
