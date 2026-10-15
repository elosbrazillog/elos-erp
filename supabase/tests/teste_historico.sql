\set ON_ERROR_STOP 1
-- Histórico de vendas do sistema anterior. Roda depois de teste_cnab.sql.
insert into pessoas (empresa_id, razao_social, eh_vendedor) select id, 'Zuleica Vendas', true from empresas limit 1;
update empresas set comissao_historico_desde = date_trunc('month', current_date)::date;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; antes numeric; cli uuid := (select id from pessoas where razao_social = 'Cliente Livre'); begin
  select vendido into antes from metas_mes(current_date) where vendedor_nome = 'João Vendedor';
  r := historico_importar(jsonb_build_array(
    jsonb_build_object('pedido', '9001', 'linha', 1, 'status', 'Pedido Faturado', 'data', current_date, 'quantidade', 2, 'preco', 10, 'total', 20,
      'documento', '67.807.267/0001-66', 'cliente', 'Cliente Livre', 'vendedor', 'JOÃO', 'produto_codigo', 'EMP1', 'produto_nome', 'Empada'),
    jsonb_build_object('pedido', '9001', 'linha', 2, 'status', 'Pedido Faturado', 'data', current_date, 'quantidade', 1, 'preco', 5, 'total', 5,
      'documento', '67807267000166', 'cliente', 'Cliente Livre', 'vendedor', 'JOÃO', 'produto_codigo', 'XX', 'produto_nome', 'Outro'),
    jsonb_build_object('pedido', '9002', 'linha', 1, 'status', 'Pedido Nao Faturado', 'quantidade', 1, 'preco', 7, 'total', 7, 'cliente', 'Fulano')));
  assert (r->>'linhas')::int = 2 and (r->>'pedidos')::int = 2 and (r->>'ignoradas')::int = 1, r::text;
  assert (select count(*) from vendas_historico where pedido_codigo = '9001' and cliente_id = cli) = 2, 'cliente ligado pelo CNPJ';
  assert (select produto_id from vendas_historico where pedido_codigo = '9001' and linha = 1) = (select id from produtos where codigo = 'EMP1');
  assert not exists (select 1 from vendas_historico where pedido_codigo = '9002'), 'não faturado fica de fora';
  -- reimportar substitui
  perform historico_importar(jsonb_build_array(jsonb_build_object('pedido', '9001', 'linha', 1, 'status', 'Pedido Faturado', 'data', current_date,
      'quantidade', 3, 'preco', 10, 'total', 30, 'documento', '67807267000166', 'cliente', 'Cliente Livre', 'vendedor', 'JOÃO', 'produto_codigo', 'EMP1')));
  assert (select count(*) from vendas_historico where pedido_codigo = '9001') = 1;
  r := historico_resumo(current_date - 30, current_date);
  assert (r->>'total')::numeric = 30 and (r->>'pedidos')::int = 1 and (r->>'nao_faturados')::int = 0, r::text;
  assert (select vendido from metas_mes(current_date) where vendedor_nome = 'João Vendedor') = coalesce(antes, 0) + 30, 'histórico conta na meta';
  assert (select ultimo_pedido_numero from app_carteira() where id = cli) = 9001 or
         (select ultimo_pedido_data from app_carteira() where id = cli) >= current_date, 'último pedido';
  -- comissão sobre o histórico: vira o título do mês da vendedora, vencendo dia 5
  perform historico_importar(jsonb_build_array(jsonb_build_object('pedido', '9101', 'linha', 1, 'status', 'Pedido Faturado', 'data', current_date,
      'quantidade', 3, 'preco', 10, 'total', 30, 'documento', '67807267000166', 'cliente', 'Cliente Livre', 'vendedor', 'ZULEICA SOUZA', 'produto_codigo', 'EMP1')));
  assert (select valor from comissoes where historico_codigo = '9101' and status = 'ativa') = 0.90, 'comissão 3% do histórico';
  assert exists (select 1 from lancamentos where origem = 'comissao' and ativo and data_quitacao is null and valor = 0.90
            and origem_id = (select id from pessoas where razao_social = 'Zuleica Vendas')
            and data_vencimento = (date_trunc('month', current_date) + interval '1 month')::date + 4), 'título dia 5';
  -- histórico antes da data de corte não gera comissão
  perform historico_importar(jsonb_build_array(jsonb_build_object('pedido', '8001', 'linha', 1, 'status', 'Pedido Faturado',
      'data', date_trunc('month', current_date)::date - 20, 'quantidade', 1, 'preco', 100, 'total', 100, 'documento', '67807267000166',
      'cliente', 'Cliente Livre', 'vendedor', 'ZULEICA SOUZA', 'produto_codigo', 'EMP1')));
  assert not exists (select 1 from comissoes where historico_codigo = '8001'), 'mês antigo fica sem comissão';
  -- reimportar com valor novo refaz a comissão e o título
  perform historico_importar(jsonb_build_array(jsonb_build_object('pedido', '9101', 'linha', 1, 'status', 'Pedido Faturado', 'data', current_date,
      'quantidade', 4, 'preco', 10, 'total', 40, 'documento', '67807267000166', 'cliente', 'Cliente Livre', 'vendedor', 'ZULEICA SOUZA', 'produto_codigo', 'EMP1')));
  assert (select valor from comissoes where historico_codigo = '9101' and status = 'ativa') = 1.20, 'comissão refeita';
  assert (select count(*) from comissoes where historico_codigo = '9101') = 1;
  assert exists (select 1 from lancamentos where origem = 'comissao' and ativo and valor = 1.20
            and origem_id = (select id from pessoas where razao_social = 'Zuleica Vendas')), 'título refeito';
  raise notice 'HISTORICO OK';
end $$;
reset role;
