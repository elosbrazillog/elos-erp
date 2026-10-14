\set ON_ERROR_STOP 1
-- 1) primeiro login vira administrador
insert into auth.users (id, email, raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111', 'marcos@elos.com', '{"nome":"Marcos"}');
select u.nome, p.nome as perfil from usuarios u join perfis p on p.id = u.perfil_id;

-- 2) como administrador logado
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into pessoas (razao_social, documento, eh_cliente, limite_credito) values ('Lanchonete Teste', '12.345.678/0001-90', true, 1000) returning codigo, documento;
insert into pessoas (razao_social, eh_vendedor) values ('João Vendedor', true);
insert into produtos (codigo, nome, preco_venda, peso_bruto_kg) values ('COX1', 'Coxinha 1kg', 25.5, 1.05);
insert into lotes (produto_id, numero, validade) select id, 'L001', current_date + 90 from produtos where codigo='COX1';
insert into estoque_movimentos (tipo, deposito_id, produto_id, lote_id, quantidade)
  select 'entrada', d.id, p.id, l.id, 100 from depositos d, produtos p, lotes l where d.padrao and p.codigo='COX1' and l.numero='L001';
insert into estoque_movimentos (tipo, deposito_id, produto_id, lote_id, quantidade)
  select 'perda', d.id, p.id, l.id, 3 from depositos d, produtos p, lotes l where d.padrao and p.codigo='COX1' and l.numero='L001';
select produto_nome, lote_numero, quantidade, dias_para_vencer from vw_estoque;
insert into pedidos (cliente_id, valor_frete) select id, 10 from pessoas where razao_social='Lanchonete Teste' returning numero;
insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario, desconto)
  select pe.id, p.id, 4, p.preco_venda, 2 from pedidos pe, produtos p;
update pedidos set valor_desconto = 5;
select numero, valor_produtos, valor_desconto, valor_frete, valor_total, peso_total_kg from pedidos;
insert into lancamentos (tipo, pessoa_id, descricao, valor, data_vencimento) select 'receber', id, 'Teste', 300, current_date - 3 from pessoas where razao_social='Lanchonete Teste';
select situacao, pessoa_nome from vw_lancamentos;
select limite_credito, em_aberto, em_atraso from vw_credito_clientes;
reset role;

-- 3) vendedor convidado: vê cadastros, não exclui, não vê financeiro
insert into auth.users (id, email, raw_user_meta_data)
  select '22222222-2222-2222-2222-222222222222', 'vend@elos.com', jsonb_build_object('nome','Vend','empresa_id',empresa_id,'perfil_id',id) from perfis where nome='Vendedor';
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as pessoas_visiveis from pessoas;
delete from pessoas;
select count(*) as pessoas_apos_delete from pessoas;
select count(*) as lancamentos_visiveis from lancamentos;
select count(*) as usuarios_visiveis from usuarios;
do $$ begin
  begin update estoque_movimentos set quantidade = 1; raise notice 'update movimentos permitido? linhas afetadas acima'; end;
end $$;
reset role;

-- 4) cadastro espontâneo sem convite fica sem acesso
insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333', 'estranho@x.com');
select count(*) as usuarios_total from usuarios;
