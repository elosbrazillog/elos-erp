-- =====================================================================
-- Fase 4b · Força de vendas e acompanhamento de entregas
-- Vendedor vê só a própria carteira; app de pedidos com envio idempotente
-- (funciona sem sinal e sincroniza depois); visitas sem pedido;
-- posição do motorista e coordenadas de cada entrega.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Carteira do vendedor
-- ---------------------------------------------------------------------
alter table public.perfis add column if not exists apenas_carteira boolean not null default false;
update public.perfis set apenas_carteira = true where nome = 'Vendedor' and not administrador;

-- Pessoa (vendedor) a que o usuário está restrito, ou null se vê tudo
create or replace function public.fn_carteira()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.apenas_carteira and not p.administrador
              then coalesce(u.pessoa_id, '00000000-0000-0000-0000-000000000000'::uuid) end
    from public.usuarios u join public.perfis p on p.id = u.perfil_id
   where u.id = auth.uid() and u.ativo;
$$;

drop policy if exists "pessoas_ver" on public.pessoas;
drop policy if exists "pessoas_editar" on public.pessoas;
create policy "pessoas_ver" on public.pessoas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'ver')
         and (public.fn_carteira() is null or id = public.fn_carteira() or vendedor_id = public.fn_carteira()));
create policy "pessoas_editar" on public.pessoas for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'editar')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('cadastros', 'editar'));

do $$ declare a text; cond text := '(public.fn_carteira() is null or vendedor_id = public.fn_carteira())'; begin
  foreach a in array array['ver', 'criar', 'editar', 'excluir'] loop
    execute format('drop policy if exists %I on public.pedidos', 'pedidos_' || a);
  end loop;
  execute 'create policy "pedidos_ver" on public.pedidos for select to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''ver'') and ' || cond || ')';
  execute 'create policy "pedidos_criar" on public.pedidos for insert to authenticated with check (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''criar'') and ' || cond || ')';
  execute 'create policy "pedidos_editar" on public.pedidos for update to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''editar'') and ' || cond || ') with check (empresa_id = public.empresa_atual() and ' || cond || ')';
  execute 'create policy "pedidos_excluir" on public.pedidos for delete to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''excluir'') and ' || cond || ')';
end $$;

do $$ declare a text; cond text := '(public.fn_carteira() is null or exists (select 1 from public.pedidos p where p.id = pedido_id and p.vendedor_id = public.fn_carteira()))'; begin
  foreach a in array array['ver', 'criar', 'editar', 'excluir'] loop
    execute format('drop policy if exists %I on public.pedidos_itens', 'pedidos_itens_' || a);
  end loop;
  execute 'create policy "pedidos_itens_ver" on public.pedidos_itens for select to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''ver'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_criar" on public.pedidos_itens for insert to authenticated with check (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''criar'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_editar" on public.pedidos_itens for update to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''editar'') and ' || cond || ')';
  execute 'create policy "pedidos_itens_excluir" on public.pedidos_itens for delete to authenticated using (empresa_id = public.empresa_atual() and public.tem_permissao(''vendas'', ''excluir'') and ' || cond || ')';
  execute 'drop policy if exists "pedidos_reservas_ver" on public.pedidos_reservas';
  execute 'create policy "pedidos_reservas_ver" on public.pedidos_reservas for select to authenticated using (empresa_id = public.empresa_atual() and (public.tem_permissao(''vendas'', ''ver'') or public.tem_permissao(''estoque'', ''ver'')) and ' || cond || ')';
end $$;

-- Pedido de vendedor restrito sempre fica no nome dele
create or replace function public.fn_pedido_padroes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_cart uuid := public.fn_carteira();
begin
  if v_cart is not null then
    new.vendedor_id := v_cart;
  end if;
  if tg_op = 'UPDATE' and new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  select vendedor_id, rota_id, tabela_preco_id, condicao_pagamento_id, forma_pagamento_id
    into c from public.pessoas where id = new.cliente_id;
  if tg_op = 'INSERT' then
    new.vendedor_id := coalesce(new.vendedor_id, c.vendedor_id);
    new.rota_id := coalesce(new.rota_id, c.rota_id);
    new.tabela_preco_id := coalesce(new.tabela_preco_id, c.tabela_preco_id,
      (select id from public.tabelas_preco where empresa_id = new.empresa_id and padrao and ativo limit 1));
    new.condicao_pagamento_id := coalesce(new.condicao_pagamento_id, c.condicao_pagamento_id);
    new.forma_pagamento_id := coalesce(new.forma_pagamento_id, c.forma_pagamento_id);
    new.deposito_id := coalesce(new.deposito_id,
      (select id from public.depositos where empresa_id = new.empresa_id and ativo order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Visitas do vendedor (com ou sem pedido)
-- ---------------------------------------------------------------------
create table public.visitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  id_local text,
  cliente_id uuid not null references public.pessoas(id),
  vendedor_id uuid references public.pessoas(id),
  usuario_id uuid,
  data date not null default current_date,
  momento timestamptz not null default now(),
  resultado text not null check (resultado in ('pedido', 'sem_pedido')),
  motivo text,
  pedido_id uuid references public.pedidos(id) on delete set null,
  latitude numeric(10,7),
  longitude numeric(10,7),
  unique (empresa_id, id_local)
);
create index visitas_cliente_idx on public.visitas (cliente_id, data desc);
create index visitas_vendedor_idx on public.visitas (empresa_id, vendedor_id, data);
alter table public.visitas enable row level security;
create policy "visitas_ver" on public.visitas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('vendas', 'ver')
         and (public.fn_carteira() is null or vendedor_id = public.fn_carteira()));

-- ---------------------------------------------------------------------
-- Rastreamento da carga
-- ---------------------------------------------------------------------
alter table public.expedicoes
  add column if not exists saiu_em timestamptz,
  add column if not exists concluida_em timestamptz;

create or replace function public.fn_expedicao_marcos()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'em_rota' and old.status is distinct from 'em_rota' then new.saiu_em := now(); end if;
  if new.status = 'concluida' and old.status is distinct from 'concluida' then new.concluida_em := now(); end if;
  return new;
end;
$$;
create trigger trg_expedicoes_marcos before update of status on public.expedicoes
  for each row execute function public.fn_expedicao_marcos();

create table public.rastreamento (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.expedicoes(id) on delete cascade,
  usuario_id uuid,
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  precisao numeric(8,1),
  registrado_em timestamptz not null default now()
);
create index rastreamento_exp_idx on public.rastreamento (expedicao_id, registrado_em desc);
alter table public.rastreamento enable row level security;
create policy "rastreamento_ver" on public.rastreamento for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver'));

-- Posição enviada pelo celular do motorista enquanto a carga está em rota
create or replace function public.app_posicao(p_expedicao uuid, p_lat numeric, p_lng numeric, p_precisao numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Posição inválida.';
  end if;
  insert into public.rastreamento (empresa_id, expedicao_id, usuario_id, latitude, longitude, precisao)
  select e.empresa_id, e.id, auth.uid(), p_lat, p_lng, p_precisao
    from public.expedicoes e
   where e.id = p_expedicao and e.empresa_id = public.empresa_atual() and e.status = 'em_rota';
end;
$$;

-- Entrega registrada com o ponto onde aconteceu; endereço sem coordenada aprende a do local
drop function if exists public.expedicao_registrar_entrega(uuid, text, text);
create or replace function public.expedicao_registrar_entrega(
  p_expedicao_pedido uuid, p_resultado text, p_motivo text default null,
  p_lat numeric default null, p_lng numeric default null)
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
  select numero, cliente_id into v_numero, v_cliente from public.pedidos where id = ep.pedido_id for update;

  if p_resultado = 'entregue' then
    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), ''),
           latitude = p_lat, longitude = p_lng where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
    if p_lat is not null and p_lng is not null then
      update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng
       where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                      order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
         and x.latitude is null;
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

-- Entregas com o ponto registrado (colunas novas no fim)
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
       ep.latitude as entrega_latitude, ep.longitude as entrega_longitude
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

-- Painel de acompanhamento: cargas em rota e as concluídas hoje
create or replace view public.vw_acompanhamento
as
select e.id, e.numero, e.data, e.status, e.saiu_em, e.concluida_em,
       r.nome as rota_nome, m.razao_social as motorista_nome, m.whatsapp as motorista_whatsapp, m.telefone as motorista_telefone,
       v.placa as veiculo_placa,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as qtd_pedidos,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'entregue') as entregues,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente') as pendentes,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega in ('devolvido_total', 'devolvido_parcial', 'ausente')) as nao_entregues,
       (select max(x.entregue_em) from public.expedicoes_pedidos x where x.expedicao_id = e.id) as ultima_entrega_em,
       pos.latitude as ultima_latitude, pos.longitude as ultima_longitude, pos.registrado_em as ultima_posicao_em
  from public.expedicoes e
  left join public.rotas r on r.id = e.rota_id
  left join public.pessoas m on m.id = e.motorista_id
  left join public.veiculos v on v.id = e.veiculo_id
  left join lateral (
    select t.latitude, t.longitude, t.registrado_em from public.rastreamento t
     where t.expedicao_id = e.id order by t.registrado_em desc limit 1
  ) pos on true
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
   and (e.status = 'em_rota' or (e.status = 'concluida' and e.concluida_em >= date_trunc('day', now())));

revoke all on public.vw_acompanhamento from public, anon;
grant select on public.vw_acompanhamento to authenticated;

-- ---------------------------------------------------------------------
-- App do vendedor
-- ---------------------------------------------------------------------

-- Carteira para trabalhar sem sinal: dados do cliente, crédito, último pedido e visita de hoje
create or replace function public.app_carteira()
returns table (
  id uuid, codigo bigint, nome text, razao_social text, documento text, telefone text, whatsapp text,
  endereco text, bairro text, cidade text, latitude numeric, longitude numeric,
  rota_id uuid, rota_nome text, dias_semana smallint[], ordem_visita integer, tabela_preco_id uuid,
  condicao_nome text, forma_nome text, bloqueado boolean, motivo_bloqueio text,
  limite_credito numeric, em_aberto numeric, em_atraso numeric,
  ultimo_pedido_data date, ultimo_pedido_numero bigint, ultimo_pedido_valor numeric, ultimo_itens jsonb,
  visita_hoje text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('vendas', 'ver');
  return query
  select c.id, c.codigo, coalesce(c.nome_fantasia, c.razao_social), c.razao_social, c.documento, c.telefone, c.whatsapp,
         concat_ws(', ', en.logradouro, en.numero, en.complemento), en.bairro, en.cidade, en.latitude, en.longitude,
         c.rota_id, r.nome, r.dias_semana, c.ordem_visita, c.tabela_preco_id,
         cp.nome, fp.nome, c.bloqueado, c.motivo_bloqueio,
         c.limite_credito, coalesce(fin.aberto, 0), coalesce(fin.atraso, 0),
         (up.data_emissao at time zone 'America/Campo_Grande')::date, up.numero, up.valor_total,
         (select jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'quantidade', i.quantidade) order by i.ordem)
            from public.pedidos_itens i where i.pedido_id = up.id and i.ativo),
         (select case when bool_or(vi.resultado = 'pedido') then 'pedido' else 'sem_pedido' end
            from public.visitas vi where vi.cliente_id = c.id and vi.data = current_date having count(*) > 0)
    from public.pessoas c
    left join public.rotas r on r.id = c.rota_id
    left join public.condicoes_pagamento cp on cp.id = c.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = c.forma_pagamento_id
    left join lateral (
      select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
       order by (x.tipo = 'entrega') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
    ) en on true
    left join lateral (
      select sum(l.valor) as aberto, sum(l.valor) filter (where l.data_vencimento < current_date) as atraso
        from public.lancamentos l
       where l.pessoa_id = c.id and l.tipo = 'receber' and l.ativo and l.data_quitacao is null
    ) fin on true
    left join lateral (
      select p.id, p.numero, p.valor_total, p.data_emissao from public.pedidos p
       where p.cliente_id = c.id and p.tipo = 'pedido' and p.ativo and p.status not in ('rascunho', 'cancelado', 'devolvido')
       order by p.data_emissao desc limit 1
    ) up on true
   where c.empresa_id = v_emp and c.eh_cliente and c.ativo
     and (v_cart is null or c.vendedor_id = v_cart)
   order by r.nome nulls last, c.ordem_visita nulls last, 3;
end;
$$;

-- Catálogo do app: preço base e disponível no depósito padrão (sem vencidos)
create or replace function public.app_produtos()
returns table (id uuid, codigo text, nome text, unidade text, categoria text, foto_url text,
               preco_venda numeric, preco_minimo numeric, disponivel numeric, unidades_por_caixa integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_dep uuid;
begin
  perform public.fn_exigir('vendas', 'ver');
  select d.id into v_dep from public.depositos d where d.empresa_id = v_emp and d.ativo order by d.padrao desc, (d.tipo = 'camara_fria') desc, d.nome limit 1;
  return query
  select pr.id, pr.codigo, pr.nome, u.sigla, cat.nome, pr.foto_url, pr.preco_venda, pr.preco_minimo,
         coalesce((select sum(s.quantidade - s.quantidade_reservada) from public.estoque_saldos s
                     left join public.lotes lo on lo.id = s.lote_id
                    where s.produto_id = pr.id and s.deposito_id = v_dep and (lo.id is null or lo.validade >= current_date)), 0),
         pr.unidades_por_caixa
    from public.produtos pr
    left join public.unidades u on u.id = pr.unidade_id
    left join public.categorias cat on cat.id = pr.categoria_id
   where pr.empresa_id = v_emp and pr.ativo and pr.visivel_app
   order by cat.nome nulls last, pr.nome;
end;
$$;

-- Recebe o pedido do celular. O id_local evita duplicar quando o envio é repetido.
-- Tenta confirmar na hora; se não der (ex.: falta estoque), fica em rascunho com o motivo para o escritório.
create or replace function public.app_enviar_pedido(
  p_id_local text, p_cliente uuid, p_itens jsonb,
  p_observacao text default null, p_data_entrega date default null,
  p_lat numeric default null, p_lng numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
  v_ped public.pedidos;
  v_id uuid;
  it jsonb;
  v_ordem integer := 0;
  v_motivo text;
  v_res jsonb;
begin
  perform public.fn_exigir('vendas', 'criar');
  if coalesce(trim(p_id_local), '') = '' then raise exception 'Identificador do pedido ausente.'; end if;

  select * into v_ped from public.pedidos where empresa_id = v_emp and id_local = p_id_local;
  if found then
    return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status, 'motivo', v_ped.motivo_trava, 'ja_existia', true);
  end if;

  if not exists (select 1 from public.pessoas c where c.id = p_cliente and c.empresa_id = v_emp and c.eh_cliente
                   and (v_cart is null or c.vendedor_id = v_cart)) then
    raise exception 'Cliente fora da sua carteira.';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;

  insert into public.pedidos (empresa_id, cliente_id, origem, id_local, observacao, data_entrega)
  values (v_emp, p_cliente, 'app', p_id_local, nullif(trim(p_observacao), ''), p_data_entrega)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo) then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.pedidos_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario, ordem)
    values (v_emp, v_id, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric, nullif(it->>'preco', '')::numeric, v_ordem);
  end loop;
  if v_ordem = 0 then raise exception 'O pedido não tem itens com quantidade.'; end if;

  begin
    v_res := public.pedido_confirmar(v_id);
  exception when others then
    v_motivo := 'Enviado pelo app e não confirmado: ' || sqlerrm;
    perform set_config('elos.regra', '1', true);
    update public.pedidos set motivo_trava = v_motivo where id = v_id;
    perform set_config('elos.regra', '', true);
  end;

  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, pedido_id, latitude, longitude)
  select v_emp, 'pedido:' || p_id_local, p_cliente, pe.vendedor_id, auth.uid(), 'pedido', v_id, p_lat, p_lng
    from public.pedidos pe where pe.id = v_id
  on conflict (empresa_id, id_local) do nothing;

  select * into v_ped from public.pedidos where id = v_id;
  return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status,
                            'motivo', coalesce(v_ped.motivo_trava, v_res->>'motivo'), 'ja_existia', false);
end;
$$;

create or replace function public.app_registrar_visita(
  p_id_local text, p_cliente uuid, p_motivo text, p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_cart uuid := public.fn_carteira();
begin
  perform public.fn_exigir('vendas', 'ver');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe por que o cliente não comprou.'; end if;
  if not exists (select 1 from public.pessoas c where c.id = p_cliente and c.empresa_id = v_emp
                   and (v_cart is null or c.vendedor_id = v_cart)) then
    raise exception 'Cliente fora da sua carteira.';
  end if;
  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, motivo, latitude, longitude)
  select v_emp, p_id_local, p_cliente, coalesce(v_cart, c.vendedor_id), auth.uid(), 'sem_pedido', trim(p_motivo), p_lat, p_lng
    from public.pessoas c where c.id = p_cliente
  on conflict (empresa_id, id_local) do nothing;
end;
$$;

-- Resumo do mês do vendedor (ou da empresa toda para quem não tem carteira)
create or replace function public.app_resumo()
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
  v_vend public.pessoas;
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select * into v_vend from public.pessoas where id = coalesce(v_cart, (select pessoa_id from public.usuarios where id = auth.uid()));
  select jsonb_build_object(
    'vendedor', v_vend.razao_social,
    'mes_inicio', v_ini,
    'vendido', coalesce(sum(p.valor_total), 0),
    'pedidos', count(p.id),
    'clientes_positivados', count(distinct p.cliente_id),
    'carteira', (select count(*) from public.pessoas c where c.empresa_id = v_emp and c.eh_cliente and c.ativo and (v_cart is null or c.vendedor_id = v_cart)),
    'meta', case when v_cart is not null then v_vend.meta_mensal end,
    'comissao_percentual', case when v_cart is not null then v_vend.comissao_percentual end,
    'comissao_prevista', case when v_cart is not null then round(coalesce(sum(p.valor_total), 0) * coalesce(v_vend.comissao_percentual, 0) / 100, 2) end,
    'visitas_sem_pedido', (select count(*) from public.visitas vi where vi.empresa_id = v_emp and vi.data >= v_ini and vi.resultado = 'sem_pedido'
                             and (v_cart is null or vi.vendedor_id = v_cart)),
    'dias_uteis_mes', (select count(*) from generate_series(v_ini, (v_ini + interval '1 month - 1 day')::date, interval '1 day') d where extract(dow from d) between 1 and 6),
    'dias_uteis_passados', (select count(*) from generate_series(v_ini, current_date, interval '1 day') d where extract(dow from d) between 1 and 6)
  ) into r
    from public.pedidos p
   where p.empresa_id = v_emp and p.tipo = 'pedido' and p.ativo
     and p.status in ('aprovado', 'em_separacao', 'faturado', 'em_rota', 'entregue')
     and (p.data_emissao at time zone 'America/Campo_Grande')::date >= v_ini
     and (v_cart is null or p.vendedor_id = v_cart);
  return r;
end;
$$;

revoke execute on function public.fn_carteira() from public, anon;
grant execute on function public.fn_carteira() to authenticated;
do $$ declare f text; begin foreach f in array array[
  'app_posicao(uuid, numeric, numeric, numeric)',
  'expedicao_registrar_entrega(uuid, text, text, numeric, numeric)',
  'app_carteira()', 'app_produtos()',
  'app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric)',
  'app_registrar_visita(text, uuid, text, numeric, numeric)', 'app_resumo()'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
