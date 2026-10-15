-- =====================================================================
-- Fase 5c · Comissão automática dos vendedores
-- Cada pedido faturado gera a comissão do vendedor (3% por padrão).
-- As comissões do mês viram um título a pagar por vendedor, com
-- vencimento no dia 5 do mês seguinte. Estorno ou devolução descontam.
-- =====================================================================

alter table public.empresas
  add column if not exists comissao_padrao numeric(6,3) not null default 3 check (comissao_padrao between 0 and 100),
  add column if not exists comissao_dia_pagamento integer not null default 5 check (comissao_dia_pagamento between 1 and 28);

update public.pessoas set comissao_percentual = 3 where eh_vendedor and coalesce(comissao_percentual, 0) = 0;

alter table public.lancamentos drop constraint if exists lancamentos_origem_check;
alter table public.lancamentos add constraint lancamentos_origem_check
  check (origem in ('manual', 'pedido', 'nota_entrada', 'ofx', 'comissao'));

create table public.comissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid not null references public.pessoas(id),
  pedido_id uuid references public.pedidos(id),
  competencia date not null check (extract(day from competencia) = 1),
  base numeric(14,2) not null,
  percentual numeric(6,3) not null,
  valor numeric(14,2) not null,
  status text not null default 'ativa' check (status in ('ativa', 'estornada')),
  descricao text,
  criado_em timestamptz not null default now()
);
create unique index comissoes_pedido_ativa_un on public.comissoes (pedido_id) where status = 'ativa' and valor > 0;
create index comissoes_vendedor_idx on public.comissoes (empresa_id, vendedor_id, competencia);
alter table public.comissoes enable row level security;
create policy "comissoes_ver" on public.comissoes for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('financeiro', 'ver')
              or (public.tem_permissao('vendas', 'ver') and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()))));

-- Mantém o título a pagar do mês do vendedor igual à soma das comissões
create or replace function public.fn_comissao_titulo(p_vendedor uuid, p_competencia date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid;
  v_total numeric;
  v_qtd integer;
  t public.lancamentos;
  v_dia integer;
  v_nome text;
  v_plano uuid;
  v_centro uuid;
  v_regra text := current_setting('elos.regra', true);
  v_existe boolean;
begin
  select empresa_id, razao_social into v_emp, v_nome from public.pessoas where id = p_vendedor;
  select coalesce(sum(valor), 0), count(*) filter (where pedido_id is not null and valor > 0) into v_total, v_qtd
    from public.comissoes where vendedor_id = p_vendedor and competencia = p_competencia and status = 'ativa';
  select * into t from public.lancamentos
   where empresa_id = v_emp and origem = 'comissao' and origem_id = p_vendedor and data_competencia = p_competencia and ativo
   order by criado_em limit 1;
  v_existe := found;

  perform set_config('elos.regra', '1', true);
  if v_existe then
    if t.data_quitacao is null then
      if v_total > 0 then
        update public.lancamentos set valor = round(v_total, 2),
               observacao = format('%s pedido(s) faturado(s) em %s', v_qtd, to_char(p_competencia, 'MM/YYYY'))
         where id = t.id;
      else
        update public.lancamentos set ativo = false, cancelado_em = now(), motivo_cancelamento = 'Sem comissão no mês' where id = t.id;
      end if;
    end if;
  elsif v_total > 0 then
    select comissao_dia_pagamento into v_dia from public.empresas where id = v_emp;
    select id into v_plano from public.plano_contas where empresa_id = v_emp and codigo = '2.03' and ativo;
    select id into v_centro from public.centros_custo where empresa_id = v_emp and ativo and nome ilike 'comercial%' order by nome limit 1;
    insert into public.lancamentos (empresa_id, tipo, pessoa_id, plano_conta_id, centro_custo_id, descricao, documento, parcela, total_parcelas,
      valor, data_competencia, data_vencimento, origem, origem_id, observacao)
    values (v_emp, 'pagar', p_vendedor, v_plano, v_centro,
      format('Comissão %s · %s', to_char(p_competencia, 'MM/YYYY'), v_nome), 'COM-' || to_char(p_competencia, 'YYYY-MM'), 1, 1,
      round(v_total, 2), p_competencia, (p_competencia + interval '1 month')::date + (v_dia - 1), 'comissao', p_vendedor,
      format('%s pedido(s) faturado(s) em %s', v_qtd, to_char(p_competencia, 'MM/YYYY')));
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
end;
$$;

-- Gera a comissão de um pedido faturado
create or replace function public.fn_comissao_gerar(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_comp date := date_trunc('month', current_date)::date;
begin
  select pe.id, pe.empresa_id, pe.vendedor_id, pe.valor_total, pe.numero,
         coalesce(v.comissao_percentual, em.comissao_padrao) as pct
    into p
    from public.pedidos pe
    join public.empresas em on em.id = pe.empresa_id
    left join public.pessoas v on v.id = pe.vendedor_id
   where pe.id = p_pedido;
  if p.vendedor_id is null or coalesce(p.pct, 0) <= 0 or p.valor_total <= 0 then return; end if;
  if exists (select 1 from public.comissoes where pedido_id = p.id and status = 'ativa' and valor > 0) then return; end if;
  insert into public.comissoes (empresa_id, vendedor_id, pedido_id, competencia, base, percentual, valor, descricao)
  values (p.empresa_id, p.vendedor_id, p.id, v_comp, p.valor_total, p.pct, round(p.valor_total * p.pct / 100, 2), 'Pedido nº ' || p.numero);
  perform public.fn_comissao_titulo(p.vendedor_id, v_comp);
end;
$$;

-- Estorna a comissão de um pedido. Se o mês dela já foi pago, desconta no mês atual.
create or replace function public.fn_comissao_estornar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comissoes;
  v_comp date := date_trunc('month', current_date)::date;
  v_pago boolean;
begin
  for c in select * from public.comissoes where pedido_id = p_pedido and status = 'ativa' and valor > 0 loop
    select exists (select 1 from public.lancamentos where origem = 'comissao' and origem_id = c.vendedor_id
                    and data_competencia = c.competencia and ativo and data_quitacao is not null) into v_pago;
    if v_pago then
      insert into public.comissoes (empresa_id, vendedor_id, pedido_id, competencia, base, percentual, valor, descricao)
      values (c.empresa_id, c.vendedor_id, c.pedido_id, v_comp, -c.base, c.percentual, -c.valor, 'Desconto · ' || coalesce(c.descricao, '') || ' · ' || p_motivo);
      perform public.fn_comissao_titulo(c.vendedor_id, v_comp);
    else
      update public.comissoes set status = 'estornada', descricao = coalesce(descricao, '') || ' · ' || p_motivo where id = c.id;
      perform public.fn_comissao_titulo(c.vendedor_id, c.competencia);
    end if;
  end loop;
end;
$$;

-- Faturar passa a gerar a comissão
create or replace function public.fn_pedido_faturar(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  n integer;
begin
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'pedido' then raise exception 'Orçamento não é faturado.'; end if;
  if p.faturado_em is not null then raise exception 'Pedido nº % já está faturado.', p.numero; end if;
  if p.status not in ('aprovado', 'em_separacao', 'em_rota', 'entregue') then
    raise exception 'Pedido nº % não pode ser faturado (situação: %).', p.numero, p.status;
  end if;
  update public.pedidos set faturado_em = now(), faturado_por = auth.uid() where id = p.id;
  perform public.fn_pedido_gerar_titulos(p.id);
  n := public.fn_pedido_gerar_boletos(p.id);
  perform public.fn_comissao_gerar(p.id);
  perform set_config('elos.regra', '', true);
  return n;
end;
$$;

-- Estorno do faturamento estorna a comissão
create or replace function public.pedido_estornar_faturamento(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('fiscal', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do estorno.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is null then raise exception 'Pedido não está faturado.'; end if;
  if exists (select 1 from public.lancamentos where origem = 'pedido' and origem_id = p.id and ativo and data_quitacao is not null) then
    raise exception 'O pedido tem título pago. Estorne a baixa no financeiro antes.';
  end if;
  if exists (select 1 from public.boletos where pedido_id = p.id and status = 'registrado') then
    raise exception 'O pedido tem boleto registrado no banco. Peça a baixa do boleto antes.';
  end if;
  if p.status not in ('em_rota', 'entregue') then
    perform public.fn_pedido_cancelar_titulos(p.id, 'Faturamento estornado: ' || trim(p_motivo));
  end if;
  perform public.fn_comissao_estornar(p.id, 'faturamento estornado');
  perform set_config('elos.regra', '1', true);
  update public.boletos set status = 'cancelado', cancelado_em = now() where pedido_id = p.id and status in ('pendente', 'erro');
  update public.pedidos set faturado_em = null, faturado_por = null where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Devolução de pedido faturado desconta a comissão
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
    if new.faturado_em is not null then perform public.fn_pedido_gerar_boletos(new.id); end if;
  elsif new.status = 'devolvido' and old.status = 'em_rota' then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Pedido devolvido na entrega');
    if new.faturado_em is not null then perform public.fn_comissao_estornar(new.id, 'pedido devolvido'); end if;
  elsif new.status = 'aprovado' and old.status = 'em_rota' and new.faturado_em is null then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;

-- Ganhos do vendedor para o app (para quem vê tudo: resumo por vendedor)
create or replace function public.app_comissoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ini date := date_trunc('month', current_date)::date;
  v_pct numeric;
  v_dia integer;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select comissao_dia_pagamento, comissao_padrao into v_dia, v_pct from public.empresas where id = v_emp;
  if v_cart is not null then
    select coalesce(comissao_percentual, v_pct) into v_pct from public.pessoas where id = v_cart;
  end if;
  with meses as (
    select c.vendedor_id, c.competencia, sum(c.valor) as valor, sum(c.base) as base,
           count(*) filter (where c.valor > 0) as pedidos
      from public.comissoes c
     where c.empresa_id = v_emp and c.status = 'ativa' and c.competencia >= (v_ini - interval '5 months')
       and (v_cart is null or c.vendedor_id = v_cart)
     group by 1, 2
  ), titulos as (
    select l.origem_id as vendedor_id, l.data_competencia as competencia, l.data_vencimento, l.data_quitacao, l.valor_pago
      from public.lancamentos l
     where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo and (v_cart is null or l.origem_id = v_cart)
  )
  select jsonb_build_object(
    'percentual', v_pct,
    'dia_pagamento', v_dia,
    'mes_valor', coalesce((select sum(valor) from meses where competencia = v_ini), 0),
    'mes_base', coalesce((select sum(base) from meses where competencia = v_ini), 0),
    'mes_pedidos', coalesce((select sum(pedidos) from meses where competencia = v_ini), 0),
    'hoje_valor', coalesce((select sum(c.valor) from public.comissoes c where c.empresa_id = v_emp and c.status = 'ativa'
                             and (c.criado_em at time zone 'America/Campo_Grande')::date = current_date and (v_cart is null or c.vendedor_id = v_cart)), 0),
    'a_receber', coalesce((select sum(l.valor) from public.lancamentos l where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo
                             and l.data_quitacao is null and (v_cart is null or l.origem_id = v_cart)), 0),
    'proximo_pagamento', (v_ini + interval '1 month')::date + (v_dia - 1),
    'recebido_ano', coalesce((select sum(l.valor_pago) from public.lancamentos l where l.empresa_id = v_emp and l.origem = 'comissao' and l.ativo
                             and l.data_quitacao >= date_trunc('year', current_date) and (v_cart is null or l.origem_id = v_cart)), 0),
    'historico', coalesce((
      select jsonb_agg(jsonb_build_object('competencia', m.competencia, 'valor', m.valor, 'base', m.base, 'pedidos', m.pedidos,
               'vencimento', coalesce(t.data_vencimento, (m.competencia + interval '1 month')::date + (v_dia - 1)),
               'pago_em', t.data_quitacao) order by m.competencia desc)
        from (select competencia, sum(valor) as valor, sum(base) as base, sum(pedidos) as pedidos,
                     min(vendedor_id::text)::uuid as vendedor_id, count(distinct vendedor_id) as nv
                from meses group by competencia) m
        left join lateral (select max(t.data_vencimento) as data_vencimento,
                                  case when bool_and(t.data_quitacao is not null) then max(t.data_quitacao) end as data_quitacao
                             from titulos t where t.competencia = m.competencia) t on true), '[]'::jsonb),
    'por_vendedor', case when v_cart is null then coalesce((
      select jsonb_agg(jsonb_build_object('nome', p.razao_social, 'valor', m.valor, 'pedidos', m.pedidos) order by m.valor desc)
        from meses m join public.pessoas p on p.id = m.vendedor_id where m.competencia = v_ini), '[]'::jsonb) end
  ) into r;
  return r;
end;
$$;

revoke execute on function public.fn_comissao_titulo(uuid, date) from public, anon, authenticated;
revoke execute on function public.fn_comissao_gerar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_comissao_estornar(uuid, text) from public, anon, authenticated;
revoke execute on function public.app_comissoes() from public, anon;
grant execute on function public.app_comissoes() to authenticated;

-- Pedidos já faturados antes desta mudança também geram a comissão
do $$ declare r record; begin
  for r in select id from public.pedidos where faturado_em is not null and ativo and status not in ('cancelado', 'devolvido') order by faturado_em loop
    perform public.fn_comissao_gerar(r.id);
  end loop;
end $$;
