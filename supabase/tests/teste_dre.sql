\set ON_ERROR_STOP 1
-- DRE, fluxo e classificação. Roda depois de teste_despesas.sql.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ declare r jsonb; lid uuid; adm uuid; desp uuid; rec numeric; tot numeric; n int; begin
  -- despesa sem categoria
  perform lancamento_criar('pagar', 'Conta de luz', 300, current_date);
  select id into lid from lancamentos where descricao like 'Conta de luz%' limit 1;
  assert (fin_resumo(date_trunc('month', current_date)::date, current_date + 60)->>'sem_classificacao')::int >= 1;
  assert exists (select 1 from fin_dre(date_trunc('month', current_date)::date, current_date + 60) where grupo = 'Sem classificação');
  select id into desp from plano_contas where codigo = '2.07';
  select id into adm from centros_custo limit 1;
  if adm is null then insert into centros_custo (nome) values ('Administrativo') returning id into adm; end if;
  perform public.t_erro(format('select fin_classificar(%L, (select id from plano_contas where codigo = %L), null)', lid, '1.01'), 'categoria de despesa');
  n := fin_classificar(lid, desp, adm);
  assert n = 1, n::text;
  assert (select grupo from fin_dre(date_trunc('month', current_date)::date, current_date + 60) where conta_codigo = '2.07') = 'Despesas administrativas';
  -- receitas de venda caem na receita bruta
  select sum(valor) into rec from fin_dre(date_trunc('month', current_date)::date - 400, current_date + 400) where grupo = 'Receita bruta';
  assert rec > 0, 'receita bruta';
  -- fluxo: saldo final = saldo inicial + movimentos
  select count(*) into n from fin_fluxo_caixa(current_date - 5, current_date + 5);
  assert n = 11;
  perform public.t_erro('select * from fin_fluxo_caixa(current_date, current_date - 1)', 'Período inválido');
  -- regime de caixa usa o que foi pago
  select coalesce(sum(valor), 0) into tot from fin_dre(current_date - 400, current_date, 'caixa') where tipo = 'receber';
  assert tot = (select coalesce(sum(valor_pago), 0) from lancamentos where tipo = 'receber' and ativo and data_quitacao between current_date - 400 and current_date), 'caixa';
end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro('select fin_resumo(current_date, current_date)', 'não tem permissão');
reset role;
\echo DRE OK
