-- =====================================================================
-- Dados iniciais da Elos
-- CNPJ e dados cadastrais ficam provisórios e são ajustados em
-- Configurações > Empresa pelo administrador.
-- =====================================================================

do $$
declare
  e uuid;
  todos jsonb := '{"ver": true, "criar": true, "editar": true, "excluir": true}';
  sem_excluir jsonb := '{"ver": true, "criar": true, "editar": true, "excluir": false}';
  ver jsonb := '{"ver": true, "criar": false, "editar": false, "excluir": false}';
begin
  insert into public.empresas (cnpj, razao_social, nome_fantasia, regime_tributario, cidade, uf, codigo_ibge)
  values ('00000000000000', 'Elos Distribuidora (ajustar razão social)', 'Elos', 'simples_nacional', 'Campo Grande', 'MS', '5002704')
  returning id into e;

  -- Perfis de acesso
  insert into public.perfis (empresa_id, nome, descricao, administrador, permissoes) values
  (e, 'Administrador', 'Acesso total ao sistema', true, '{}'),
  (e, 'Escritório', 'Cadastros, pedidos, expedição e notas',
     false, jsonb_build_object('cadastros', sem_excluir, 'vendas', sem_excluir, 'expedicao', sem_excluir,
                               'estoque', sem_excluir, 'fiscal', sem_excluir, 'financeiro', ver, 'relatorios', ver)),
  (e, 'Financeiro', 'Contas a pagar e receber, boletos e crédito',
     false, jsonb_build_object('cadastros', sem_excluir, 'vendas', ver, 'financeiro', todos, 'fiscal', ver, 'relatorios', ver)),
  (e, 'Vendedor', 'App de força de vendas: carteira, pedidos e metas',
     false, jsonb_build_object('cadastros', ver, 'vendas', '{"ver": true, "criar": true, "editar": true, "excluir": false}'::jsonb)),
  (e, 'Expedição', 'Separação, carga e estoque',
     false, jsonb_build_object('cadastros', ver, 'vendas', ver, 'expedicao', sem_excluir, 'estoque', sem_excluir)),
  (e, 'Motorista', 'Entregas no celular',
     false, jsonb_build_object('cadastros', ver, 'expedicao', '{"ver": true, "criar": false, "editar": true, "excluir": false}'::jsonb));

  -- Unidades
  insert into public.unidades (empresa_id, sigla, descricao) values
  (e, 'UN', 'Unidade'), (e, 'PCT', 'Pacote'), (e, 'CX', 'Caixa'), (e, 'KG', 'Quilograma'), (e, 'FD', 'Fardo');

  -- Formas de pagamento (código tPag da NF-e)
  insert into public.formas_pagamento (empresa_id, nome, codigo_nfe, gera_boleto) values
  (e, 'Boleto', '15', true),
  (e, 'PIX', '17', false),
  (e, 'Dinheiro', '01', false),
  (e, 'Cartão de débito', '04', false),
  (e, 'Cartão de crédito', '03', false),
  (e, 'Transferência bancária', '18', false);

  -- Condições de pagamento
  insert into public.condicoes_pagamento (empresa_id, nome, parcelas_dias) values
  (e, 'À vista', '{0}'),
  (e, '7 dias', '{7}'),
  (e, '14 dias', '{14}'),
  (e, '21 dias', '{21}'),
  (e, '28 dias', '{28}'),
  (e, '14/28 dias', '{14,28}'),
  (e, '28/35/42 dias', '{28,35,42}');

  -- Depósitos
  insert into public.depositos (empresa_id, nome, tipo, padrao) values
  (e, 'Câmara fria', 'camara_fria', true),
  (e, 'Expedição', 'expedicao', false),
  (e, 'Avarias e vencidos', 'avaria', false);

  -- Categorias de produto (linha de congelados da Elos)
  insert into public.categorias (empresa_id, nome) values
  (e, 'Salgados'), (e, 'Pão de queijo'), (e, 'Pães'), (e, 'Doces');

  insert into public.marcas (empresa_id, nome) values (e, 'Top Sabores');

  -- Tabela de preço padrão
  insert into public.tabelas_preco (empresa_id, nome, padrao) values (e, 'Tabela padrão', true);

  -- Grupo tributário inicial (Simples Nacional, sem ST) — validar com o contador
  insert into public.grupos_tributarios (empresa_id, nome, cfop_dentro_uf, cfop_fora_uf, csosn, observacao) values
  (e, 'Simples Nacional - tributado sem ST', '5102', '6102', '102', 'Grupo inicial. Validar CSOSN, CFOP e ICMS-ST com o contador antes de emitir em produção.');

  -- Centros de custo
  insert into public.centros_custo (empresa_id, nome) values
  (e, 'Comercial'), (e, 'Logística'), (e, 'Administrativo');

  -- Conta inicial
  insert into public.contas_bancarias (empresa_id, nome, banco_codigo, emite_boleto) values
  (e, 'Sicredi', '748', true),
  (e, 'Caixa da empresa', null, false);

  -- Plano de contas gerencial simples
  insert into public.plano_contas (empresa_id, codigo, nome, tipo, grupo_dre) values
  (e, '1', 'Receitas', 'receita', null),
  (e, '1.01', 'Venda de mercadorias', 'receita', 'Receita bruta'),
  (e, '1.02', 'Outras receitas', 'receita', 'Outras receitas'),
  (e, '1.03', 'Receitas financeiras', 'receita', 'Resultado financeiro'),
  (e, '2', 'Custos e despesas', 'despesa', null),
  (e, '2.01', 'Compra de mercadorias', 'despesa', 'Custo das mercadorias'),
  (e, '2.02', 'Fretes e entregas', 'despesa', 'Despesas comerciais'),
  (e, '2.03', 'Comissões de vendedores', 'despesa', 'Despesas comerciais'),
  (e, '2.04', 'Combustível e manutenção de veículos', 'despesa', 'Despesas comerciais'),
  (e, '2.05', 'Salários e encargos', 'despesa', 'Despesas com pessoal'),
  (e, '2.06', 'Aluguel e condomínio', 'despesa', 'Despesas administrativas'),
  (e, '2.07', 'Energia elétrica', 'despesa', 'Despesas administrativas'),
  (e, '2.08', 'Água, telefone e internet', 'despesa', 'Despesas administrativas'),
  (e, '2.09', 'Contabilidade e sistemas', 'despesa', 'Despesas administrativas'),
  (e, '2.10', 'Impostos (DAS do Simples)', 'despesa', 'Impostos sobre vendas'),
  (e, '2.11', 'Tarifas bancárias e juros', 'despesa', 'Resultado financeiro'),
  (e, '2.12', 'Marketing e tráfego pago', 'despesa', 'Despesas comerciais'),
  (e, '2.13', 'Perdas e avarias', 'despesa', 'Custo das mercadorias'),
  (e, '2.99', 'Outras despesas', 'despesa', 'Outras despesas');

  update public.plano_contas c set pai_id = p.id
    from public.plano_contas p
   where c.empresa_id = e and p.empresa_id = e
     and p.codigo = split_part(c.codigo, '.', 1) and c.codigo like '%.%';
end;
$$;
