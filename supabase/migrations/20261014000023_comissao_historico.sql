-- =====================================================================
-- Comissão sobre as vendas do sistema anterior (Atende)
-- Vale para as vendas faturadas a partir de empresas.comissao_historico_desde
-- (outubro/2026: os meses anteriores já foram pagos fora do ERP).
-- Cada mês vira o mesmo título a pagar do vendedor, vencendo no dia 5.
-- =====================================================================

alter table public.empresas add column if not exists comissao_historico_desde date not null default date '2026-10-01';
alter table public.comissoes add column if not exists historico_codigo text;
create unique index if not exists comissoes_historico_ativa_un on public.comissoes (empresa_id, historico_codigo)
  where status = 'ativa' and valor > 0 and historico_codigo is not null;

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
  select coalesce(sum(valor), 0), count(*) filter (where (pedido_id is not null or historico_codigo is not null) and valor > 0) into v_total, v_qtd
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

-- Gera (ou refaz) a comissão dos pedidos do histórico informados; sem lista, todos
create or replace function public.fn_comissao_historico(p_emp uuid, p_codigos text[] default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde date;
  v_padrao numeric;
  n integer := 0;
  x record;
  v_comp date;
begin
  select comissao_historico_desde, comissao_padrao into v_desde, v_padrao from public.empresas where id = p_emp;
  create temp table if not exists _afetados (vendedor_id uuid, competencia date) on commit drop;
  truncate _afetados;

  -- tira as comissões ainda não pagas desses pedidos (serão refeitas com o valor atual)
  with apagadas as (
    delete from public.comissoes c
     where c.empresa_id = p_emp and c.historico_codigo is not null
       and (p_codigos is null or c.historico_codigo = any(p_codigos))
       and not exists (select 1 from public.lancamentos l where l.empresa_id = p_emp and l.origem = 'comissao' and l.origem_id = c.vendedor_id
                         and l.data_competencia = c.competencia and l.ativo and l.data_quitacao is not null)
    returning c.vendedor_id, c.competencia)
  insert into _afetados select distinct vendedor_id, competencia from apagadas;

  for x in
    select h.pedido_codigo, h.vendedor_id, h.total, h.data, h.cliente_nome,
           coalesce(v.comissao_percentual, v_padrao) as pct
      from public.vw_historico_pedidos h
      join public.pessoas v on v.id = h.vendedor_id
     where h.empresa_id = p_emp and h.origem = 'atende' and h.faturado and h.data >= v_desde and h.total > 0
       and (p_codigos is null or h.pedido_codigo = any(p_codigos))
       and not exists (select 1 from public.comissoes c where c.empresa_id = p_emp and c.historico_codigo = h.pedido_codigo
                         and c.status = 'ativa' and c.valor > 0)
  loop
    continue when coalesce(x.pct, 0) <= 0;
    v_comp := date_trunc('month', x.data)::date;
    -- mês já pago ao vendedor: entra no mês atual
    if exists (select 1 from public.lancamentos l where l.empresa_id = p_emp and l.origem = 'comissao' and l.origem_id = x.vendedor_id
                 and l.data_competencia = v_comp and l.ativo and l.data_quitacao is not null) then
      v_comp := date_trunc('month', current_date)::date;
    end if;
    insert into public.comissoes (empresa_id, vendedor_id, historico_codigo, competencia, base, percentual, valor, descricao, criado_em)
    values (p_emp, x.vendedor_id, x.pedido_codigo, v_comp, x.total, x.pct, round(x.total * x.pct / 100, 2),
            'Pedido nº ' || x.pedido_codigo || ' (Atende)', (x.data + time '12:00') at time zone 'America/Campo_Grande');
    insert into _afetados values (x.vendedor_id, v_comp);
    n := n + 1;
  end loop;

  for x in select distinct vendedor_id, competencia from _afetados loop
    perform public.fn_comissao_titulo(x.vendedor_id, x.competencia);
  end loop;
  return n;
end;
$$;

create or replace function public.historico_importar(p_linhas jsonb, p_origem text default 'atende')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  n integer;
begin
  perform public.fn_exigir('vendas', 'editar');
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then raise exception 'Nada para importar.'; end if;
  if jsonb_array_length(p_linhas) > 3000 then raise exception 'Envie no máximo 3000 linhas por vez.'; end if;

  drop table if exists _hist;
  create temp table _hist on commit drop as
  select x.*
    from jsonb_to_recordset(p_linhas) as x(pedido text, linha integer, status text, nfe text, data_nfe date, data date,
         quantidade numeric, preco numeric, total numeric, documento text, cliente text, cidade text, uf text,
         vendedor text, forma text, produto_codigo text, produto_nome text, unidade text, ncm text);
  if exists (select 1 from _hist where coalesce(trim(pedido), '') = '') then raise exception 'Há linhas sem código da venda.'; end if;

  delete from public.vendas_historico h
   where h.empresa_id = v_emp and h.origem = p_origem and h.pedido_codigo in (select distinct trim(pedido) from _hist);

  insert into public.vendas_historico (empresa_id, origem, pedido_codigo, linha, status, faturado, nfe, data_nfe, data,
    quantidade, preco, total, cliente_documento, cliente_nome, cidade, uf, vendedor_nome, forma_pagamento,
    produto_codigo, produto_nome, unidade, ncm, importado_por)
  select v_emp, p_origem, trim(pedido), coalesce(linha, row_number() over (partition by trim(pedido))::integer), nullif(trim(status), ''),
         coalesce(public.fn_normaliza(status) like '%faturado%' and public.fn_normaliza(status) not like '%nao faturado%'
                  and public.fn_normaliza(status) not like '%sem faturamento%', false),
         nullif(trim(nfe), ''), data_nfe, data,
         coalesce(quantidade, 0), coalesce(preco, 0), round(coalesce(total, quantidade * preco, 0), 2),
         nullif(regexp_replace(coalesce(documento, ''), '\D', '', 'g'), ''), nullif(trim(cliente), ''), nullif(trim(cidade), ''),
         upper(nullif(trim(uf), '')), nullif(trim(vendedor), ''), nullif(trim(forma), ''),
         nullif(trim(produto_codigo), ''), nullif(trim(produto_nome), ''), upper(nullif(trim(unidade), '')), nullif(trim(ncm), ''),
         auth.uid()
    from _hist
   -- pedidos que não foram faturados no sistema anterior ficam de fora
   where coalesce(public.fn_normaliza(status) like '%faturado%' and public.fn_normaliza(status) not like '%nao faturado%'
                  and public.fn_normaliza(status) not like '%sem faturamento%', false);
  get diagnostics n = row_count;
  perform public.fn_historico_vincular(v_emp);
  perform public.fn_comissao_historico(v_emp, array(select distinct trim(pedido) from _hist));
  return jsonb_build_object('linhas', n, 'pedidos', (select count(distinct pedido) from _hist), 'ignoradas', (select count(*) from _hist) - n);
end;
$$;

revoke execute on function public.fn_comissao_historico(uuid, text[]) from public, anon, authenticated;

-- Vendas do histórico que já estejam importadas
do $$ declare e record; begin
  for e in select id from public.empresas loop perform public.fn_comissao_historico(e.id); end loop;
end $$;
