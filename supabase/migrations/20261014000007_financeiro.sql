-- =====================================================================
-- Fase 5a · Financeiro
-- Contas a receber nascem na saída da carga, pela condição de pagamento
-- do pedido; devolução ou cliente ausente cancelam os títulos em aberto.
-- Lançamentos manuais parcelados, baixa (com parcial, juros, multa e
-- desconto), estorno e cancelamento só pelas funções.
-- =====================================================================

alter table public.lancamentos
  add column if not exists titulo_pai_id uuid references public.lancamentos(id),
  add column if not exists motivo_cancelamento text,
  add column if not exists cancelado_em timestamptz,
  add column if not exists baixado_por uuid,
  add column if not exists baixado_em timestamptz;

create index if not exists lancamentos_origem_idx on public.lancamentos (origem, origem_id);
create index if not exists lancamentos_quitacao_idx on public.lancamentos (empresa_id, conta_bancaria_id, data_quitacao);

-- ---------------------------------------------------------------------
-- Proteção: quitação, cancelamento e criação só pelas funções
-- ---------------------------------------------------------------------
create or replace function public.fn_lancamento_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Use Novo lançamento.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamentos não são excluídos. Use Cancelar.';
  end if;
  if (new.data_quitacao, new.valor_pago, new.juros, new.multa, new.desconto, new.ativo, new.tipo, new.origem, new.origem_id, new.empresa_id, new.titulo_pai_id)
     is distinct from
     (old.data_quitacao, old.valor_pago, old.juros, old.multa, old.desconto, old.ativo, old.tipo, old.origem, old.origem_id, old.empresa_id, old.titulo_pai_id) then
    raise exception 'Baixa, estorno e cancelamento só pelas ações do financeiro.';
  end if;
  if not old.ativo then
    raise exception 'Lançamento cancelado não pode ser alterado.';
  end if;
  if old.data_quitacao is not null
     and (new.valor, new.pessoa_id, new.data_vencimento, new.conta_bancaria_id, new.forma_pagamento_id)
         is distinct from (old.valor, old.pessoa_id, old.data_vencimento, old.conta_bancaria_id, old.forma_pagamento_id) then
    raise exception 'Lançamento quitado: estorne a baixa antes de alterar.';
  end if;
  if old.origem = 'pedido' and (new.valor, new.pessoa_id) is distinct from (old.valor, old.pessoa_id) then
    raise exception 'Valor e cliente de título de pedido não mudam aqui. Para renegociar, cancele e lance de novo.';
  end if;
  return new;
end;
$$;
create trigger trg_lancamentos_protege before insert or update or delete on public.lancamentos
  for each row execute function public.fn_lancamento_protege();

-- ---------------------------------------------------------------------
-- Títulos do pedido
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_gerar_titulos(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_dias integer[];
  v_n integer;
  v_parcela numeric;
  v_conta uuid;
  v_plano uuid;
  i integer;
begin
  if exists (select 1 from public.lancamentos where origem = 'pedido' and origem_id = p_pedido and ativo) then
    return 0;
  end if;
  select pe.*, cp.parcelas_dias, fp.gera_boleto
    into p
    from public.pedidos pe
    left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
   where pe.id = p_pedido;
  if p.valor_total <= 0 then return 0; end if;

  v_dias := coalesce(nullif(p.parcelas_dias, '{}'), '{0}');
  v_n := cardinality(v_dias);
  v_parcela := round(p.valor_total / v_n, 2);
  select id into v_plano from public.plano_contas where empresa_id = p.empresa_id and codigo = '1.01' and ativo;
  if coalesce(p.gera_boleto, false) then
    select id into v_conta from public.contas_bancarias where empresa_id = p.empresa_id and emite_boleto and ativo order by criado_em limit 1;
  end if;

  perform set_config('elos.regra', '1', true);
  for i in 1..v_n loop
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, origem_id)
    values (p.empresa_id, 'receber', p.cliente_id, v_plano, v_conta, p.forma_pagamento_id,
      'Pedido nº ' || p.numero || case when v_n > 1 then format(' · parcela %s/%s', i, v_n) else '' end,
      p.numero::text, i, v_n,
      case when i < v_n then v_parcela else p.valor_total - v_parcela * (v_n - 1) end,
      current_date, current_date + v_dias[i], 'pedido', p.id);
  end loop;
  return v_n;
end;
$$;

create or replace function public.fn_pedido_cancelar_titulos(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('elos.regra', '1', true);
  update public.lancamentos
     set ativo = false, cancelado_em = now(), motivo_cancelamento = p_motivo
   where origem = 'pedido' and origem_id = p_pedido and ativo and data_quitacao is null;
end;
$$;

-- Liga o financeiro à situação do pedido
create or replace function public.fn_pedido_financeiro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_regra text := current_setting('elos.regra', true);
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then
    perform public.fn_pedido_gerar_titulos(new.id);
  elsif new.status = 'devolvido' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Pedido devolvido na entrega');
  elsif new.status = 'aprovado' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  -- devolve o sinal de regra como estava (a função chamadora ainda pode precisar)
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;
create trigger trg_pedidos_financeiro after update of status on public.pedidos
  for each row execute function public.fn_pedido_financeiro();

-- ---------------------------------------------------------------------
-- Ações do financeiro
-- ---------------------------------------------------------------------

-- Novo lançamento, à vista ou parcelado
create or replace function public.lancamento_criar(
  p_tipo text, p_descricao text, p_valor_total numeric, p_primeiro_vencimento date,
  p_parcelas integer default 1, p_intervalo_dias integer default 30,
  p_pessoa uuid default null, p_documento text default null, p_plano_conta uuid default null,
  p_centro_custo uuid default null, p_forma uuid default null, p_conta uuid default null,
  p_competencia date default null, p_observacao text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_parcela numeric;
  i integer;
begin
  perform public.fn_exigir('financeiro', 'criar');
  if p_tipo not in ('receber', 'pagar') then raise exception 'Tipo inválido.'; end if;
  if coalesce(trim(p_descricao), '') = '' then raise exception 'Informe a descrição.'; end if;
  if coalesce(p_valor_total, 0) <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_primeiro_vencimento is null then raise exception 'Informe o vencimento.'; end if;
  if coalesce(p_parcelas, 1) < 1 or p_parcelas > 120 then raise exception 'Número de parcelas inválido (1 a 120).'; end if;
  if p_pessoa is not null and not exists (select 1 from public.pessoas where id = p_pessoa and empresa_id = v_emp) then
    raise exception 'Pessoa não encontrada.';
  end if;

  v_parcela := round(p_valor_total / p_parcelas, 2);
  perform set_config('elos.regra', '1', true);
  for i in 1..p_parcelas loop
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, observacao)
    values (v_emp, p_tipo, p_pessoa, p_plano_conta, p_centro_custo, p_conta, p_forma,
      trim(p_descricao) || case when p_parcelas > 1 then format(' · parcela %s/%s', i, p_parcelas) else '' end,
      nullif(trim(p_documento), ''), i, p_parcelas,
      case when i < p_parcelas then v_parcela else p_valor_total - v_parcela * (p_parcelas - 1) end,
      coalesce(p_competencia, p_primeiro_vencimento),
      case when p_intervalo_dias = 30 then (p_primeiro_vencimento + make_interval(months => i - 1))::date
           else p_primeiro_vencimento + coalesce(p_intervalo_dias, 30) * (i - 1) end,
      'manual', nullif(trim(p_observacao), ''));
  end loop;
  perform set_config('elos.regra', '', true);
  return p_parcelas;
end;
$$;

-- Baixa: valor pago = principal + juros + multa - desconto.
-- Se o principal pago for menor que o título, o saldo vira um novo título.
create or replace function public.lancamento_baixar(
  p_lancamento uuid, p_data date, p_valor_pago numeric, p_conta uuid,
  p_juros numeric default 0, p_multa numeric default 0, p_desconto numeric default 0,
  p_forma uuid default null, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
  v_principal numeric;
  v_saldo numeric;
  v_novo uuid;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou cancelado.'; end if;
  if l.data_quitacao is not null then raise exception 'Este lançamento já está quitado.'; end if;
  if p_data is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_data > current_date then raise exception 'A data do pagamento não pode ser futura.'; end if;
  if coalesce(p_valor_pago, 0) <= 0 then raise exception 'Informe o valor pago.'; end if;
  if p_conta is null or not exists (select 1 from public.contas_bancarias where id = p_conta and empresa_id = l.empresa_id) then
    raise exception 'Informe a conta (banco ou caixa) do pagamento.';
  end if;
  if coalesce(p_juros, 0) < 0 or coalesce(p_multa, 0) < 0 or coalesce(p_desconto, 0) < 0 then
    raise exception 'Juros, multa e desconto não podem ser negativos.';
  end if;

  v_principal := round(p_valor_pago - coalesce(p_juros, 0) - coalesce(p_multa, 0) + coalesce(p_desconto, 0), 2);
  if v_principal > l.valor + 0.009 then
    raise exception 'O valor pago passa do valor do título em %. Lance a diferença como juros ou multa.', public.fn_brl(v_principal - l.valor);
  end if;
  if v_principal <= 0 then raise exception 'O valor pago não cobre nada do título.'; end if;
  v_saldo := round(l.valor - v_principal, 2);

  perform set_config('elos.regra', '1', true);
  if v_saldo > 0 then
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, conta_bancaria_id, forma_pagamento_id,
      descricao, documento, parcela, total_parcelas, valor, data_competencia, data_vencimento, origem, origem_id, titulo_pai_id, observacao)
    values (l.empresa_id, l.tipo, l.pessoa_id, l.plano_conta_id, l.centro_custo_id, l.conta_bancaria_id, l.forma_pagamento_id,
      l.descricao || ' · saldo', l.documento, l.parcela, l.total_parcelas, v_saldo, l.data_competencia, l.data_vencimento, l.origem, l.origem_id, l.id,
      'Saldo da baixa parcial de ' || to_char(p_data, 'DD/MM/YYYY'))
    returning id into v_novo;
  end if;

  update public.lancamentos
     set valor = v_principal, data_quitacao = p_data, valor_pago = p_valor_pago,
         juros = coalesce(p_juros, 0), multa = coalesce(p_multa, 0), desconto = coalesce(p_desconto, 0),
         conta_bancaria_id = p_conta, forma_pagamento_id = coalesce(p_forma, l.forma_pagamento_id),
         observacao = coalesce(nullif(trim(p_observacao), ''), l.observacao),
         baixado_por = auth.uid(), baixado_em = now()
   where id = l.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('saldo', v_saldo, 'saldo_id', v_novo);
end;
$$;

-- Estorno: desfaz a baixa; um saldo em aberto gerado por ela volta para o título
create or replace function public.lancamento_estornar(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
  f public.lancamentos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou cancelado.'; end if;
  if l.data_quitacao is null then raise exception 'Este lançamento não está quitado.'; end if;

  perform set_config('elos.regra', '1', true);
  select * into f from public.lancamentos where titulo_pai_id = l.id and ativo for update;
  if found then
    if f.data_quitacao is not null then
      raise exception 'O saldo desta baixa já foi pago. Estorne primeiro o saldo (%).', f.descricao;
    end if;
    update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = 'Juntado ao título no estorno' where id = f.id;
    update public.lancamentos set valor = valor + f.valor where id = l.id;
  end if;
  update public.lancamentos
     set data_quitacao = null, valor_pago = null, juros = 0, multa = 0, desconto = 0, baixado_por = null, baixado_em = null
   where id = l.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.lancamento_cancelar(p_lancamento uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.lancamentos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into l from public.lancamentos where id = p_lancamento and empresa_id = public.empresa_atual() for update;
  if not found or not l.ativo then raise exception 'Lançamento não encontrado ou já cancelado.'; end if;
  if l.data_quitacao is not null then raise exception 'Estorne a baixa antes de cancelar.'; end if;
  perform set_config('elos.regra', '1', true);
  update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = trim(p_motivo) where id = l.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------
drop view if exists public.vw_lancamentos;
create view public.vw_lancamentos
with (security_invoker = true)
as
select l.*,
       case
         when not l.ativo then 'cancelado'
         when l.data_quitacao is not null then 'quitado'
         when l.data_vencimento < current_date then 'atrasado'
         when l.data_vencimento = current_date then 'vence_hoje'
         else 'em_aberto'
       end as situacao,
       case when l.ativo and l.data_quitacao is null and l.data_vencimento < current_date
            then current_date - l.data_vencimento else 0 end as dias_atraso,
       p.razao_social as pessoa_nome,
       p.nome_fantasia as pessoa_fantasia,
       p.codigo as pessoa_codigo,
       pc.codigo as plano_conta_codigo,
       pc.nome as plano_conta_nome,
       cc.nome as centro_custo_nome,
       cb.nome as conta_nome,
       fp.nome as forma_nome
  from public.lancamentos l
  left join public.pessoas p on p.id = l.pessoa_id
  left join public.plano_contas pc on pc.id = l.plano_conta_id
  left join public.centros_custo cc on cc.id = l.centro_custo_id
  left join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
  left join public.formas_pagamento fp on fp.id = l.forma_pagamento_id;

-- Saldo de cada conta: saldo inicial + recebido - pago desde a data do saldo inicial
create or replace view public.vw_contas_saldos
with (security_invoker = true)
as
select cb.id, cb.empresa_id, cb.nome, cb.banco_codigo, cb.saldo_inicial, cb.data_saldo_inicial, cb.ativo,
       coalesce(sum(l.valor_pago) filter (where l.tipo = 'receber'), 0) as entradas,
       coalesce(sum(l.valor_pago) filter (where l.tipo = 'pagar'), 0) as saidas,
       cb.saldo_inicial
         + coalesce(sum(l.valor_pago) filter (where l.tipo = 'receber'), 0)
         - coalesce(sum(l.valor_pago) filter (where l.tipo = 'pagar'), 0) as saldo_atual
  from public.contas_bancarias cb
  left join public.lancamentos l on l.conta_bancaria_id = cb.id and l.ativo and l.data_quitacao is not null
                                and l.data_quitacao >= cb.data_saldo_inicial
 group by cb.id;

-- Extrato: tudo que entrou e saiu de cada conta
create or replace view public.vw_extrato
with (security_invoker = true)
as
select l.id, l.empresa_id, l.conta_bancaria_id, cb.nome as conta_nome, l.data_quitacao as data, l.tipo,
       l.descricao, l.documento, p.razao_social as pessoa_nome, p.nome_fantasia as pessoa_fantasia,
       pc.nome as plano_conta_nome, fp.nome as forma_nome,
       l.valor, l.juros, l.multa, l.desconto, l.valor_pago,
       case when l.tipo = 'receber' then l.valor_pago else -l.valor_pago end as valor_sinal
  from public.lancamentos l
  join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
  left join public.pessoas p on p.id = l.pessoa_id
  left join public.plano_contas pc on pc.id = l.plano_conta_id
  left join public.formas_pagamento fp on fp.id = l.forma_pagamento_id
 where l.ativo and l.data_quitacao is not null and l.data_quitacao >= cb.data_saldo_inicial;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
revoke execute on function public.fn_pedido_gerar_titulos(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_cancelar_titulos(uuid, text) from public, anon, authenticated;

do $$ declare f text; begin foreach f in array array[
  'lancamento_criar(text, text, numeric, date, integer, integer, uuid, text, uuid, uuid, uuid, uuid, date, text)',
  'lancamento_baixar(uuid, date, numeric, uuid, numeric, numeric, numeric, uuid, text)',
  'lancamento_estornar(uuid)', 'lancamento_cancelar(uuid, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
