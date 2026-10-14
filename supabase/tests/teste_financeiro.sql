\set ON_ERROR_STOP 1
-- Financeiro: títulos da carga, baixa, estorno, parcelado, saldos.
-- Roda depois de teste_expedicao.sql.

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- A carga do teste anterior: 2 entregues ficam com título; devolvido e ausente têm o título cancelado
do $$ begin
  assert (select count(*) from lancamentos where origem = 'pedido' and ativo) = 2,
    format('títulos ativos dos entregues: %s', (select count(*) from lancamentos where origem = 'pedido' and ativo));
  assert (select count(*) from lancamentos where origem = 'pedido' and not ativo) = 2, 'devolvido e ausente cancelados';
  assert exists (select 1 from lancamentos where motivo_cancelamento = 'Pedido devolvido na entrega');
  assert exists (select 1 from lancamentos where motivo_cancelamento like 'Cliente ausente%');
end $$;

-- Cliente com condição 14/28 dias e boleto
insert into pessoas (razao_social, eh_cliente, condicao_pagamento_id, forma_pagamento_id)
  select 'Cliente Prazo', true, (select id from condicoes_pagamento where nome = '14/28 dias'), (select id from formas_pagamento where nome = 'Boleto');

do $$ declare pid uuid; exp uuid; begin
  insert into pedidos (cliente_id) select id from pessoas where razao_social = 'Cliente Prazo' returning id into pid;
  insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) select pid, id, 10, 9 from produtos where codigo = 'EMP1';
  perform pedido_confirmar(pid);
  insert into expedicoes (data, motorista_id) select current_date, id from pessoas where razao_social = 'Zé Motorista' returning id into exp;
  perform expedicao_incluir_pedidos(exp, array[pid]);
  perform expedicao_saida(exp);
  assert (select count(*) from lancamentos where origem_id = pid and ativo) = 2, 'duas parcelas';
  assert (select sum(valor) from lancamentos where origem_id = pid) = 90, 'soma das parcelas';
  assert (select data_vencimento from lancamentos where origem_id = pid and parcela = 2) = current_date + 28, 'vencimento da 2ª';
  assert (select count(*) from lancamentos l join contas_bancarias c on c.id = l.conta_bancaria_id where l.origem_id = pid and c.emite_boleto) = 2, 'boleto vai para a conta Sicredi';
end $$;

-- Proteções
select public.t_erro($$update lancamentos set data_quitacao = current_date where descricao like 'Pedido%parcela 1/2'$$, 'só pelas ações');
select public.t_erro($$update lancamentos set valor = 1 where descricao like 'Pedido%parcela 1/2'$$, 'Valor e cliente de título de pedido');
select public.t_erro($$delete from lancamentos$$, 'Use Cancelar');
select public.t_erro($$insert into lancamentos (tipo, descricao, valor, data_vencimento) values ('pagar', 'x', 1, current_date)$$, 'Use Novo lançamento');
update lancamentos set data_vencimento = data_vencimento + 2, observacao = 'Prorrogado a pedido do cliente' where descricao like 'Pedido%parcela 1/2';

-- Baixa parcial, estorno e baixa com juros
do $$ declare t uuid; sic uuid; r jsonb; begin
  select id into t from lancamentos where descricao like 'Pedido%parcela 1/2';
  select id into sic from contas_bancarias where nome = 'Sicredi';
  perform public.t_erro(format('select lancamento_baixar(%L, current_date, 50, %L)', t, sic), 'passa do valor do título');
  perform public.t_erro(format('select lancamento_baixar(%L, current_date + 1, 10, %L)', t, sic), 'não pode ser futura');
  perform public.t_erro(format('select lancamento_baixar(%L, current_date, 10, null)', t), 'Informe a conta');

  r := lancamento_baixar(t, current_date, 30, sic);
  assert (r->>'saldo')::numeric = 15, r::text;
  assert (select valor from lancamentos where id = t) = 30 and (select data_quitacao from lancamentos where id = t) = current_date;
  assert (select valor from lancamentos where id = (r->>'saldo_id')::uuid) = 15, 'saldo em aberto';
  perform public.t_erro(format('update lancamentos set valor = 1 where id = %L', t), 'estorne a baixa');

  perform lancamento_estornar(t);
  assert (select valor from lancamentos where id = t) = 45 and (select data_quitacao from lancamentos where id = t) is null, 'estorno junta o saldo';
  assert not (select ativo from lancamentos where id = (r->>'saldo_id')::uuid), 'saldo absorvido';

  r := lancamento_baixar(t, current_date, 47, sic, p_juros => 2);
  assert (r->>'saldo')::numeric = 0;
  assert (select valor_pago from lancamentos where id = t) = 47 and (select juros from lancamentos where id = t) = 2;
  perform public.t_erro(format('select lancamento_cancelar(%L, %L)', t, 'x'), 'Estorne a baixa');
end $$;

-- Conta a pagar parcelada mensal e pagamento pelo caixa
do $$ declare cx uuid; t uuid; begin
  perform lancamento_criar('pagar', 'Aluguel do galpão', 100, date '2026-01-31', 3, 30,
    p_plano_conta => (select id from plano_contas where codigo = '2.06'), p_centro_custo => (select id from centros_custo where nome = 'Administrativo'));
  assert (select count(*) from lancamentos where descricao like 'Aluguel do galpão%') = 3;
  assert (select string_agg(valor::text, ',' order by parcela) from lancamentos where descricao like 'Aluguel%') = '33.33,33.33,33.34';
  assert (select data_vencimento from lancamentos where descricao like 'Aluguel%' and parcela = 2) = date '2026-02-28', 'mês seguinte, último dia';
  select id into cx from contas_bancarias where nome = 'Caixa da empresa';
  select id into t from lancamentos where descricao like 'Aluguel%' and parcela = 1;
  perform lancamento_baixar(t, current_date, 33.33, cx);
  perform lancamento_cancelar((select id from lancamentos where descricao like 'Aluguel%' and parcela = 3), 'Contrato encerrado');
  assert (select situacao from vw_lancamentos where descricao like 'Aluguel%' and parcela = 3) = 'cancelado';
  assert (select situacao from vw_lancamentos where descricao like 'Aluguel%' and parcela = 2) = 'atrasado';
end $$;

-- Saldos e extrato
select nome, saldo_inicial, entradas, saidas, saldo_atual from vw_contas_saldos order by nome;
do $$ begin
  assert (select saldo_atual from vw_contas_saldos where nome = 'Sicredi') = 47, 'Sicredi recebeu 47';
  assert (select saldo_atual from vw_contas_saldos where nome = 'Caixa da empresa') = -33.33, 'Caixa pagou 33,33';
  assert (select count(*) from vw_extrato) = 2;
end $$;
select tipo, situacao, descricao, valor, valor_pago, conta_nome from vw_lancamentos where ativo order by tipo, data_vencimento;
reset role;

-- Vendedor não mexe no financeiro
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro($$select lancamento_criar('pagar', 'x', 10, current_date)$$, 'não tem permissão');
select public.t_erro($$select lancamento_baixar('00000000-0000-0000-0000-000000000000', current_date, 1, null)$$, 'não tem permissão');
do $$ begin assert (select count(*) from lancamentos) = 0, 'vendedor não vê lançamentos'; end $$;
reset role;
select 'FINANCEIRO OK' as resultado;
