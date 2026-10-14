\set ON_ERROR_STOP 1
-- Fase 2: pedido reserva o lote certo, trava de crédito, estoque e inventário.
-- Roda depois de teste_fluxo.sql (usuário admin 1111..., vendedor 2222...).

-- Auxiliares de teste
create or replace function public.t_erro(p_sql text, p_trecho text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_trecho in sqlerrm) = 0 then
      raise exception 'Erro diferente do esperado em [%]: % (esperava "%")', p_sql, sqlerrm, p_trecho;
    end if;
    raise notice 'ok, bloqueado: %', sqlerrm;
    return;
  end;
  raise exception 'Deveria ter dado erro: %', p_sql;
end $$;
grant execute on function public.t_erro(text, text) to authenticated;

create or replace function public.t_reserva(p_lote text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade_reservada), 0) from estoque_saldos s join lotes l on l.id = s.lote_id where l.numero = p_lote $$;
create or replace function public.t_saldo(p_lote text) returns numeric language sql as $$
  select coalesce(sum(s.quantidade), 0) from estoque_saldos s join lotes l on l.id = s.lote_id where l.numero = p_lote $$;
grant execute on function public.t_reserva(text), public.t_saldo(text) to authenticated;

-- Começa sem os pedidos do teste anterior
delete from pedidos;

-- Lote vencido com saldo (entra direto, como dado legado)
insert into produtos (empresa_id, codigo, nome, preco_venda, custo) select id, 'EMP1', 'Empada 25g', 10, 5 from empresas;
insert into lotes (empresa_id, produto_id, numero, validade) select empresa_id, id, 'VENCIDO', current_date - 1 from produtos where codigo = 'EMP1';
insert into estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade)
  select p.empresa_id, 'entrada', d.id, p.id, l.id, 50 from produtos p, depositos d, lotes l where p.codigo='EMP1' and d.padrao and l.numero='VENCIDO';

-- Usuário do financeiro
insert into auth.users (id, email, raw_user_meta_data)
  select '44444444-4444-4444-4444-444444444444', 'fin@elos.com', jsonb_build_object('nome','Fin','empresa_id',empresa_id,'perfil_id',id) from perfis where nome='Financeiro';

-- ===================== como administrador =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- Entradas: lote A vence em 10 dias, B em 60, C sem número (vira V+validade)
select estoque_entrada(p.id, d.id, 5, 'a', current_date + 10) from produtos p, depositos d where p.codigo='EMP1' and d.padrao;
select estoque_entrada(p.id, d.id, 20, 'B', current_date + 60, null, 5.2, 'NF 123') from produtos p, depositos d where p.codigo='EMP1' and d.padrao;
select estoque_entrada(p.id, d.id, 8, null, current_date + 90) from produtos p, depositos d where p.codigo='EMP1' and d.padrao;
do $$ begin
  assert public.t_saldo('A') = 5, 'lote A (número em maiúsculas)';
  assert exists (select 1 from lotes where numero = 'V' || to_char(current_date + 90, 'YYYYMMDD')), 'lote automático pela validade';
end $$;
select public.t_erro($$select estoque_entrada(p.id, d.id, 1, 'B', current_date + 61) from produtos p, depositos d where p.codigo='EMP1' and d.padrao$$, 'já está cadastrado com validade');
select public.t_erro($$select estoque_entrada(p.id, d.id, 1, 'X', current_date - 5) from produtos p, depositos d where p.codigo='EMP1' and d.padrao$$, 'validade informada já passou');
select public.t_erro($$select estoque_entrada(p.id, d.id, 1) from produtos p, depositos d where p.codigo='EMP1' and d.padrao$$, 'Informe a validade');
select public.t_erro($$insert into estoque_movimentos (tipo, deposito_id, produto_id, quantidade) select 'entrada', d.id, p.id, 1 from produtos p, depositos d where p.codigo='EMP1' and d.padrao$$, 'row-level security');

-- Preço da tabela do cliente
insert into tabelas_preco_itens (tabela_preco_id, produto_id, preco)
  select t.id, p.id, 9 from tabelas_preco t, produtos p where t.padrao and p.codigo = 'EMP1';

-- Pedido 1: cliente sem limite definido, 12 unidades -> A 5 + B 7 (vencido nunca)
insert into pessoas (razao_social, eh_cliente) values ('Cliente Livre', true);
insert into pedidos (cliente_id) select id from pessoas where razao_social = 'Cliente Livre';
insert into pedidos_itens (pedido_id, produto_id, quantidade)
  select pe.id, p.id, 12 from pedidos pe join pessoas c on c.id = pe.cliente_id, produtos p where c.razao_social='Cliente Livre' and p.codigo='EMP1';
do $$ declare v jsonb; t numeric; begin
  select valor_total into t from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social='Cliente Livre';
  assert t = 108, format('preço da tabela: esperado 108, veio %s', t);
  select pedido_confirmar(pe.id) into v from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social='Cliente Livre';
  assert v->>'status' = 'aprovado', v::text;
  assert public.t_reserva('A') = 5 and public.t_reserva('B') = 7 and public.t_reserva('VENCIDO') = 0,
    format('FEFO: A=%s B=%s venc=%s', public.t_reserva('A'), public.t_reserva('B'), public.t_reserva('VENCIDO'));
  assert (select count(*) from pedidos_reservas) = 2;
end $$;

-- Não dá para mexer na situação, nos itens nem nos valores pela tela
select public.t_erro($$update pedidos set status = 'faturado'$$, 'só muda pelas ações');
select public.t_erro($$update pedidos set valor_frete = 1 where status = 'aprovado'$$, 'Use Reabrir');
select public.t_erro($$update pedidos_itens set quantidade = 1 where pedido_id in (select id from pedidos where status='aprovado')$$, 'rascunho');
select public.t_erro($$delete from pedidos where status = 'aprovado'$$, 'Use Cancelar');
update pedidos set observacao = 'Entregar pela manhã' where status = 'aprovado';

-- Perda não pode consumir o que está reservado: B tem 20, 7 reservados
select public.t_erro($$select estoque_movimentar(s.id, 'perda', 14, 'quebra') from estoque_saldos s join lotes l on l.id = s.lote_id where l.numero = 'B'$$, 'Só há 13 disponível');
select public.t_erro($$select estoque_movimentar(s.id, 'perda', 1, '') from estoque_saldos s join lotes l on l.id = s.lote_id where l.numero = 'B'$$, 'motivo');
select estoque_movimentar(s.id, 'perda', 1, 'Embalagem rasgada') from estoque_saldos s join lotes l on l.id = s.lote_id where l.numero = 'B';
-- Transferência de 2 do lote B para Expedição
select estoque_movimentar(s.id, 'transferencia', 2, null, (select id from depositos where nome = 'Expedição'))
  from estoque_saldos s join lotes l on l.id = s.lote_id join depositos d on d.id = s.deposito_id where l.numero = 'B' and d.padrao;
do $$ begin assert public.t_saldo('B') = 19, format('B após perda e transferência (total nos 2 depósitos) = %s', public.t_saldo('B')); end $$;

-- Reabrir devolve a reserva; altera e confirma de novo
do $$ declare v jsonb; begin
  perform pedido_reabrir(id) from pedidos where status = 'aprovado';
  assert public.t_reserva('A') = 0 and public.t_reserva('B') = 0, 'reabrir libera reservas';
  update pedidos_itens set quantidade = 3;
  select pedido_confirmar(id) into v from pedidos where status = 'rascunho' and tipo = 'pedido';
  assert public.t_reserva('A') = 3 and public.t_reserva('B') = 0, 'nova reserva só no lote A';
end $$;

-- Pedido 2: estoque insuficiente não confirma e não deixa reserva pela metade
insert into pedidos (cliente_id) select id from pessoas where razao_social = 'Cliente Livre';
insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario)
  select pe.id, p.id, 1000, 10 from pedidos pe, produtos p where pe.status = 'rascunho' and p.codigo = 'EMP1';
select public.t_erro($$select pedido_confirmar(id) from pedidos where status = 'rascunho'$$, 'Estoque insuficiente');
do $$ begin
  assert (select status from pedidos where valor_total = 10000) = 'rascunho', 'continua rascunho';
  assert public.t_reserva('A') = 3, 'reserva do pedido 1 intacta';
end $$;
delete from pedidos where status = 'rascunho';

-- Pedido 3: cliente com limite de 50 e pedido de 90 -> trava
insert into pessoas (razao_social, eh_cliente, limite_credito) values ('Cliente Limite', true, 50);
insert into pedidos (cliente_id) select id from pessoas where razao_social = 'Cliente Limite';
insert into pedidos_itens (pedido_id, produto_id, quantidade)
  select pe.id, p.id, 10 from pedidos pe, produtos p where pe.status = 'rascunho' and p.codigo = 'EMP1';
do $$ declare v jsonb; begin
  select pedido_confirmar(id) into v from pedidos where status = 'rascunho';
  assert v->>'status' = 'aguardando_credito', v::text;
  assert v->>'motivo' like 'Limite de crédito excedido: limite R$ 50,00%este pedido R$ 90,00', v->>'motivo';
  assert public.t_reserva('A') = 5 and public.t_reserva('B') = 8, format('trava também reserva: A=%s B=%s', public.t_reserva('A'), public.t_reserva('B'));
end $$;

-- Pedido 4: cliente sem limite mas com título vencido (Lanchonete Teste do teste anterior)
insert into pedidos (cliente_id) select id from pessoas where razao_social = 'Lanchonete Teste';
insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario)
  select pe.id, p.id, 1, 10 from pedidos pe, produtos p where pe.status = 'rascunho' and p.codigo = 'EMP1';
do $$ declare v jsonb; begin
  select pedido_confirmar(id) into v from pedidos where status = 'rascunho';
  assert v->>'motivo' = 'Títulos vencidos em aberto: R$ 300,00', v->>'motivo';
end $$;

-- Orçamento: não confirma, converte em pedido com o mesmo número
insert into pedidos (cliente_id, tipo, validade) select id, 'orcamento', current_date + 7 from pessoas where razao_social = 'Cliente Livre';
select public.t_erro($$select pedido_confirmar(id) from pedidos where tipo = 'orcamento'$$, 'Converta em pedido');
do $$ declare n bigint; begin
  select numero into n from pedidos where tipo = 'orcamento';
  perform orcamento_converter(id) from pedidos where tipo = 'orcamento';
  assert (select tipo from pedidos where numero = n) = 'pedido', 'convertido';
end $$;
delete from pedidos where status = 'rascunho' and valor_total = 0;
reset role;

-- ===================== vendedor: não libera crédito =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.t_erro($$select pedido_liberar_credito('00000000-0000-0000-0000-000000000000')$$, 'não tem permissão');
select public.t_erro($$select estoque_entrada(p.id, d.id, 1, 'Z', current_date + 5) from produtos p, depositos d where p.codigo='EMP1' and d.padrao$$, 'não tem permissão');
reset role;

-- ===================== financeiro: libera e recusa =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform pedido_liberar_credito(pe.id) from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social = 'Cliente Limite';
  assert (select status from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social = 'Cliente Limite') = 'aprovado';
  assert (select credito_liberado_por from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social = 'Cliente Limite') = '44444444-4444-4444-4444-444444444444';
end $$;
select public.t_erro($$select pedido_recusar_credito(id, '') from pedidos where status = 'aguardando_credito'$$, 'motivo');
select pedido_recusar_credito(id, 'Cliente com 3 boletos atrasados') from pedidos where status = 'aguardando_credito';
reset role;

-- ===================== admin: cancelar e inventário =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  assert (select motivo_cancelamento from pedidos where status = 'cancelado') = 'Crédito recusado: Cliente com 3 boletos atrasados';
  assert public.t_reserva('A') = 5 and public.t_reserva('B') = 8, 'recusa liberou só a reserva do pedido recusado';
end $$;
select public.t_erro($$select pedido_cancelar(id, ' ') from pedidos where status = 'aprovado'$$, 'motivo');
select pedido_cancelar(pe.id, 'Cliente desistiu') from pedidos pe join pessoas c on c.id = pe.cliente_id where c.razao_social = 'Cliente Limite';
do $$ begin assert public.t_reserva('A') = 3 and public.t_reserva('B') = 0, 'cancelamento devolve reserva'; end $$;

-- Inventário da câmara fria: A contado 4 (sistema 5), lote novo encontrado com 6, B não contado
do $$ declare inv uuid; v jsonb; b_antes numeric; begin
  b_antes := public.t_saldo('B');
  select inventario_abrir(id, 'Contagem mensal') into inv from depositos where padrao;
  perform public.t_erro(format($q$select inventario_abrir(id) from depositos where padrao$q$), 'Já existe um inventário aberto');
  assert (select count(*) from inventarios_itens i join produtos p on p.id = i.produto_id where inventario_id = inv and p.codigo = 'EMP1') = 4, 'retrato: VENCIDO, A, B, V+90';
  update inventarios_itens i set quantidade_contada = 4 from lotes l where l.id = i.lote_id and l.numero = 'A' and i.inventario_id = inv;
  insert into inventarios_itens (inventario_id, produto_id, lote_numero, validade, quantidade_contada, quantidade_sistema)
    select inv, id, 'novo', current_date + 120, 6, 999 from produtos where codigo = 'EMP1';
  assert (select quantidade_sistema from inventarios_itens where lote_numero = 'novo') = 0, 'item novo começa com sistema 0';
  select inventario_concluir(inv) into v;
  assert (v->>'ajustes')::int = 2, v::text;
  assert public.t_saldo('A') = 4 and public.t_saldo('NOVO') = 6 and public.t_saldo('B') = b_antes,
    format('A=%s NOVO=%s B=%s', public.t_saldo('A'), public.t_saldo('NOVO'), public.t_saldo('B'));
  perform public.t_erro(format('update inventarios_itens set quantidade_contada = 1 where inventario_id = %L', inv), 'encerrado');
end $$;

-- Histórico e telas
select tipo, produto_codigo, lote_numero, quantidade_sinal, observacao, usuario_nome from vw_estoque_movimentos order by data, tipo;
select produto_codigo, quantidade, quantidade_reservada, disponivel, proxima_validade, lotes from vw_estoque_produtos where produto_codigo = 'EMP1';
select numero, tipo, status, cliente_nome, valor_total, qtd_itens, motivo_trava, motivo_cancelamento from vw_pedidos order by numero;
reset role;
select 'FASE 2 OK' as resultado;
