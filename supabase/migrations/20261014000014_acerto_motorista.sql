-- =====================================================================
-- Fase 4e · Recebimento na entrega e acerto do motorista
-- Forma de pagamento diz o que o motorista recebe (dinheiro, PIX, cartão);
-- na entrega ele registra o que recebeu, podendo dividir em dois tipos;
-- no fim da carga o escritório faz o acerto e pode baixar os títulos.
-- =====================================================================

alter table public.formas_pagamento
  add column if not exists recebe_na_entrega text check (recebe_na_entrega in ('dinheiro', 'pix', 'cartao'));
update public.formas_pagamento set recebe_na_entrega = case codigo_nfe
    when '01' then 'dinheiro' when '17' then 'pix' when '03' then 'cartao' when '04' then 'cartao' end
 where recebe_na_entrega is null and codigo_nfe in ('01', '17', '03', '04');

-- O que foi recebido em cada entrega (até três linhas: ex. parte em dinheiro, parte no PIX)
create table public.entregas_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  expedicao_pedido_id uuid not null references public.expedicoes_pedidos(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id),
  tipo text not null check (tipo in ('dinheiro', 'pix', 'cartao')),
  valor numeric(14,2) not null check (valor > 0),
  criado_em timestamptz not null default now(),
  criado_por uuid
);
create index entregas_recebimentos_exp_idx on public.entregas_recebimentos (expedicao_id);
alter table public.entregas_recebimentos enable row level security;
create policy "entregas_recebimentos_ver" on public.entregas_recebimentos for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Acerto da carga com o motorista
create table public.acertos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null unique references public.expedicoes(id) on delete cascade,
  motorista_id uuid references public.pessoas(id),
  dinheiro_esperado numeric(14,2) not null default 0,
  pix_recebido numeric(14,2) not null default 0,
  cartao_recebido numeric(14,2) not null default 0,
  dinheiro_entregue numeric(14,2) not null default 0,
  despesas jsonb not null default '[]'::jsonb,
  total_despesas numeric(14,2) not null default 0,
  diferenca numeric(14,2) not null default 0,
  observacao text,
  conta_dinheiro_id uuid references public.contas_bancarias(id),
  conta_pix_id uuid references public.contas_bancarias(id),
  titulos_baixados integer not null default 0,
  criado_por uuid,
  criado_em timestamptz not null default now()
);
alter table public.acertos enable row level security;
create policy "acertos_ver" on public.acertos for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Entrega registrada com o que foi recebido
drop function if exists public.expedicao_registrar_entrega(uuid, text, text, numeric, numeric);
create function public.expedicao_registrar_entrega(
  p_expedicao_pedido uuid, p_resultado text, p_motivo text default null,
  p_lat numeric default null, p_lng numeric default null, p_recebimentos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
  v_cliente uuid;
  v_total numeric;
  v_recebe text;
  v_soma numeric := 0;
  v_rec jsonb;
  r jsonb;
  v_concluida boolean := false;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_resultado not in ('entregue', 'devolvido_total', 'ausente') then
    raise exception 'Resultado de entrega inválido.';
  end if;
  if p_resultado = 'devolvido_total' and coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da devolução.';
  end if;

  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  select pe.numero, pe.cliente_id, pe.valor_total, fp.recebe_na_entrega into v_numero, v_cliente, v_total, v_recebe
    from public.pedidos pe left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
   where pe.id = ep.pedido_id for update of pe;

  if p_resultado = 'entregue' then
    -- recebimento: o informado pelo motorista, ou o valor todo na forma do pedido
    v_rec := case when p_recebimentos is not null and jsonb_typeof(p_recebimentos) = 'array' and jsonb_array_length(p_recebimentos) > 0
                  then p_recebimentos
                  when v_recebe is not null then jsonb_build_array(jsonb_build_object('tipo', v_recebe, 'valor', v_total))
                  else '[]'::jsonb end;
    if jsonb_array_length(v_rec) > 3 then raise exception 'Use no máximo três formas no mesmo recebimento.'; end if;
    for r in select * from jsonb_array_elements(v_rec) loop
      if coalesce(r->>'tipo', '') not in ('dinheiro', 'pix', 'cartao') then raise exception 'Forma de recebimento inválida.'; end if;
      if coalesce((r->>'valor')::numeric, 0) <= 0 then raise exception 'Informe o valor recebido em cada forma.'; end if;
      v_soma := v_soma + round((r->>'valor')::numeric, 2);
    end loop;
    if jsonb_array_length(v_rec) > 0 and abs(v_soma - v_total) > 0.01 then
      raise exception 'O recebido (%) não fecha com o valor do pedido (%).', public.fn_brl(v_soma), public.fn_brl(v_total);
    end if;
    insert into public.entregas_recebimentos (empresa_id, expedicao_id, expedicao_pedido_id, pedido_id, tipo, valor, criado_por)
    select e.empresa_id, e.id, ep.id, ep.pedido_id, x->>'tipo', round((x->>'valor')::numeric, 2), auth.uid()
      from jsonb_array_elements(v_rec) x;

    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), ''),
           latitude = p_lat, longitude = p_lng, chegou_em = coalesce(chegou_em, now()) where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
    if p_lat is not null and p_lng is not null then
      update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng, coordenada_fonte = 'entrega'
       where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                      order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
         and (x.latitude is null or x.coordenada_fonte = 'geocodificada');
    end if;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente'),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    perform public.fn_pedido_reservar(ep.pedido_id);
    update public.pedidos set status = 'aprovado' where id = ep.pedido_id;
  end if;

  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id and status_entrega = 'pendente') then
    update public.expedicoes set status = 'concluida' where id = e.id;
    v_concluida := true;
  end if;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('carga_concluida', v_concluida);
end;
$$;

-- Entregas com o que receber e o que foi recebido (colunas novas no fim)
create or replace view public.vw_expedicao_pedidos
as
select ep.id, ep.expedicao_id, ep.pedido_id, ep.ordem_entrega, ep.status_entrega, ep.entregue_em, ep.motivo_devolucao,
       pe.numero as pedido_numero, pe.status as pedido_status, pe.valor_total, pe.peso_total_kg, pe.data_entrega,
       pe.observacao, pe.pedido_cliente,
       c.id as cliente_id, c.codigo as cliente_codigo, c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia,
       c.telefone, c.whatsapp,
       en.logradouro, en.numero as endereco_numero, en.complemento, en.bairro, en.cidade, en.uf, en.cep, en.referencia,
       en.latitude, en.longitude,
       cp.nome as condicao_nome, fp.nome as forma_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       ep.latitude as entrega_latitude, ep.longitude as entrega_longitude,
       ep.etapa, ep.a_caminho_em, ep.chegou_em, en.coordenada_fonte,
       fp.recebe_na_entrega,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'dinheiro'), 0) as recebido_dinheiro,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'pix'), 0) as recebido_pix,
       coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'cartao'), 0) as recebido_cartao
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.pessoas c on c.id = pe.cliente_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- Resumo para o acerto: o que devia receber, o que recebeu e o que voltou
create or replace function public.acerto_resumo(p_expedicao uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  r jsonb;
begin
  if not (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  select * into e from public.expedicoes where id = p_expedicao and empresa_id = public.empresa_atual();
  if not found then raise exception 'Carga não encontrada.'; end if;
  with ped as (
    select ep.id, ep.ordem_entrega, ep.status_entrega, pe.numero, pe.valor_total, fp.nome as forma_nome, fp.recebe_na_entrega,
           coalesce(c.nome_fantasia, c.razao_social) as cliente,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'dinheiro'), 0) as din,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'pix'), 0) as pix,
           coalesce((select sum(x.valor) from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id and x.tipo = 'cartao'), 0) as cartao
      from public.expedicoes_pedidos ep
      join public.pedidos pe on pe.id = ep.pedido_id
      join public.pessoas c on c.id = pe.cliente_id
      left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
     where ep.expedicao_id = e.id
  )
  select jsonb_build_object(
    'carga', jsonb_build_object('id', e.id, 'numero', e.numero, 'data', e.data, 'status', e.status,
                                'motorista', (select razao_social from public.pessoas where id = e.motorista_id)),
    'pendentes', count(*) filter (where status_entrega = 'pendente'),
    'entregues', count(*) filter (where status_entrega = 'entregue'),
    'nao_entregues', count(*) filter (where status_entrega not in ('pendente', 'entregue')),
    'previsto_dinheiro', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'dinheiro'), 0),
    'previsto_pix', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'pix'), 0),
    'previsto_cartao', coalesce(sum(valor_total) filter (where recebe_na_entrega = 'cartao'), 0),
    'a_prazo', coalesce(sum(valor_total) filter (where recebe_na_entrega is null), 0),
    'recebido_dinheiro', coalesce(sum(din), 0),
    'recebido_pix', coalesce(sum(pix), 0),
    'recebido_cartao', coalesce(sum(cartao), 0),
    'valor_devolvido', coalesce(sum(valor_total) filter (where status_entrega not in ('pendente', 'entregue')), 0),
    'pedidos', coalesce(jsonb_agg(jsonb_build_object('ordem', ordem_entrega, 'numero', numero, 'cliente', cliente, 'valor', valor_total,
                 'forma', forma_nome, 'recebe', recebe_na_entrega, 'status', status_entrega, 'dinheiro', din, 'pix', pix, 'cartao', cartao)
                 order by ordem_entrega), '[]'::jsonb),
    'acerto', (select to_jsonb(a) from public.acertos a where a.expedicao_id = e.id)
  ) into r
    from ped;
  return r;
end;
$$;

-- Registra o acerto; com p_baixar, quita os títulos dos pedidos pagos na entrega
create or replace function public.acerto_registrar(
  p_expedicao uuid, p_dinheiro_entregue numeric, p_despesas jsonb default '[]'::jsonb, p_observacao text default null,
  p_baixar boolean default false, p_conta_dinheiro uuid default null, p_conta_pix uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  v_din numeric; v_pix numeric; v_cartao numeric;
  v_desp numeric := 0;
  d jsonb;
  rec record;
  l record;
  v_resta numeric;
  v_parte numeric;
  v_conta uuid;
  v_baixados integer := 0;
  v_forma uuid;
  v_acerto public.acertos;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_baixar then perform public.fn_exigir('financeiro', 'editar'); end if;
  select * into e from public.expedicoes where id = p_expedicao and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if e.status <> 'concluida' then raise exception 'O acerto é feito depois que todas as entregas forem registradas.'; end if;
  if exists (select 1 from public.acertos where expedicao_id = e.id) then raise exception 'Esta carga já tem acerto.'; end if;
  if coalesce(p_dinheiro_entregue, -1) < 0 then raise exception 'Informe quanto o motorista entregou em dinheiro.'; end if;
  if jsonb_typeof(coalesce(p_despesas, '[]'::jsonb)) <> 'array' then raise exception 'Despesas inválidas.'; end if;
  for d in select * from jsonb_array_elements(coalesce(p_despesas, '[]'::jsonb)) loop
    if coalesce(trim(d->>'descricao'), '') = '' or coalesce((d->>'valor')::numeric, 0) <= 0 then
      raise exception 'Cada despesa precisa de descrição e valor.';
    end if;
    v_desp := v_desp + round((d->>'valor')::numeric, 2);
  end loop;

  select coalesce(sum(valor) filter (where tipo = 'dinheiro'), 0), coalesce(sum(valor) filter (where tipo = 'pix'), 0),
         coalesce(sum(valor) filter (where tipo = 'cartao'), 0)
    into v_din, v_pix, v_cartao
    from public.entregas_recebimentos where expedicao_id = e.id;

  if p_baixar then
    if p_conta_dinheiro is null and v_din > 0 then raise exception 'Escolha a conta (caixa) que recebe o dinheiro.'; end if;
    if p_conta_pix is null and (v_pix + v_cartao) > 0 then raise exception 'Escolha a conta que recebe o PIX e o cartão.'; end if;
    -- cada recebimento quita os títulos em aberto do pedido, do mais antigo para o mais novo
    for rec in select x.pedido_id, x.tipo, x.valor from public.entregas_recebimentos x where x.expedicao_id = e.id order by x.pedido_id, x.tipo loop
      v_resta := rec.valor;
      v_conta := case when rec.tipo = 'dinheiro' then p_conta_dinheiro else p_conta_pix end;
      select id into v_forma from public.formas_pagamento
       where empresa_id = e.empresa_id and ativo and recebe_na_entrega = rec.tipo order by nome limit 1;
      for l in select id, valor from public.lancamentos
                where origem = 'pedido' and origem_id = rec.pedido_id and ativo and data_quitacao is null and tipo = 'receber'
                order by data_vencimento, parcela, criado_em loop
        exit when v_resta <= 0.009;
        v_parte := least(v_resta, l.valor);
        perform public.lancamento_baixar(l.id, current_date, v_parte, v_conta, 0, 0, 0, v_forma,
                                         format('Recebido na entrega · carga nº %s', e.numero));
        v_baixados := v_baixados + 1;
        v_resta := round(v_resta - v_parte, 2);
      end loop;
    end loop;
  end if;

  insert into public.acertos (empresa_id, expedicao_id, motorista_id, dinheiro_esperado, pix_recebido, cartao_recebido,
    dinheiro_entregue, despesas, total_despesas, diferenca, observacao, conta_dinheiro_id, conta_pix_id, titulos_baixados, criado_por)
  values (e.empresa_id, e.id, e.motorista_id, v_din, v_pix, v_cartao, round(p_dinheiro_entregue, 2), coalesce(p_despesas, '[]'::jsonb),
    v_desp, round(p_dinheiro_entregue + v_desp - v_din, 2), nullif(trim(p_observacao), ''),
    case when p_baixar then p_conta_dinheiro end, case when p_baixar then p_conta_pix end, v_baixados, auth.uid())
  returning * into v_acerto;
  perform set_config('elos.regra', '', true);
  return to_jsonb(v_acerto);
end;
$$;

-- Desfaz um acerto lançado errado (só se não baixou títulos)
create or replace function public.acerto_excluir(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.acertos;
begin
  perform public.fn_exigir('expedicao', 'editar');
  select * into a from public.acertos where expedicao_id = p_expedicao and empresa_id = public.empresa_atual();
  if not found then raise exception 'Acerto não encontrado.'; end if;
  if a.titulos_baixados > 0 then raise exception 'Este acerto baixou títulos. Estorne as baixas no financeiro antes.'; end if;
  delete from public.acertos where id = a.id;
end;
$$;

do $$ declare f text; begin foreach f in array array[
  'expedicao_registrar_entrega(uuid, text, text, numeric, numeric, jsonb)',
  'acerto_resumo(uuid)', 'acerto_registrar(uuid, numeric, jsonb, text, boolean, uuid, uuid)', 'acerto_excluir(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
