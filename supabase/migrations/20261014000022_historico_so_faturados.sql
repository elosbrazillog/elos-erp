-- =====================================================================
-- Histórico: só os pedidos faturados no sistema anterior entram
-- =====================================================================
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
  return jsonb_build_object('linhas', n, 'pedidos', (select count(distinct pedido) from _hist), 'ignoradas', (select count(*) from _hist) - n);
end;
$$;

delete from public.vendas_historico where not faturado;
