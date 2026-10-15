-- =====================================================================
-- Fase 4d · Equipe (motoristas e vendedores), roteirização e etapas da entrega
-- Mais dados de motorista e vendedor; ponto de saída da empresa; etapas
-- da entrega para rastrear (na rota, a caminho, chegou, entregue, devolvido).
-- =====================================================================

-- Dados de equipe no cadastro de pessoas
alter table public.pessoas
  add column if not exists cnh_numero text,
  add column if not exists cnh_categoria text,
  add column if not exists cnh_validade date,
  add column if not exists veiculo_padrao_id uuid references public.veiculos(id) on delete set null,
  add column if not exists supervisor_id uuid references public.pessoas(id) on delete set null,
  add column if not exists regiao text,
  add column if not exists desconto_maximo numeric(5,2) check (desconto_maximo is null or desconto_maximo between 0 and 100),
  add column if not exists data_admissao date,
  add column if not exists chave_pix text,
  add column if not exists contato_emergencia text;

-- Ponto de saída das entregas (depósito)
alter table public.empresas
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7);

-- De onde veio a coordenada do endereço
alter table public.pessoas_enderecos
  add column if not exists coordenada_fonte text check (coordenada_fonte in ('manual', 'geocodificada', 'entrega'));
update public.pessoas_enderecos set coordenada_fonte = 'entrega' where latitude is not null and coordenada_fonte is null;

-- Etapa da entrega enquanto ela ainda não foi concluída
alter table public.expedicoes_pedidos
  add column if not exists etapa text not null default 'aguardando' check (etapa in ('aguardando', 'a_caminho', 'chegou')),
  add column if not exists a_caminho_em timestamptz,
  add column if not exists chegou_em timestamptz;

-- Motorista avisa: a caminho deste cliente / cheguei. Só uma entrega "a caminho" por vez.
create or replace function public.expedicao_etapa(p_expedicao_pedido uuid, p_etapa text, p_lat numeric default null, p_lng numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_etapa not in ('aguardando', 'a_caminho', 'chegou') then raise exception 'Etapa inválida.'; end if;
  select * into ep from public.expedicoes_pedidos where id = p_expedicao_pedido and empresa_id = public.empresa_atual() for update;
  if not found then raise exception 'Entrega não encontrada.'; end if;
  e := public.fn_expedicao_obter(ep.expedicao_id, array['em_rota']);
  if ep.status_entrega <> 'pendente' then raise exception 'Esta entrega já foi registrada.'; end if;
  if p_etapa = 'a_caminho' then
    update public.expedicoes_pedidos set etapa = 'aguardando', a_caminho_em = null
     where expedicao_id = e.id and id <> ep.id and status_entrega = 'pendente' and etapa = 'a_caminho';
  end if;
  update public.expedicoes_pedidos
     set etapa = p_etapa,
         a_caminho_em = case when p_etapa = 'a_caminho' then now() when p_etapa = 'aguardando' then null else coalesce(a_caminho_em, now()) end,
         chegou_em = case when p_etapa = 'chegou' then now() else null end
   where id = ep.id;
  if p_lat is not null and p_lng is not null and abs(p_lat) <= 90 and abs(p_lng) <= 180 then
    insert into public.rastreamento (empresa_id, expedicao_id, usuario_id, latitude, longitude)
    values (e.empresa_id, e.id, auth.uid(), p_lat, p_lng);
  end if;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Grava a coordenada achada pelo endereço (geocodificação) no endereço de entrega do pedido,
-- sem sobrescrever coordenada marcada à mão ou aprendida numa entrega
create or replace function public.endereco_coordenada_pedido(p_pedido uuid, p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente uuid;
begin
  if not (public.tem_permissao('expedicao', 'editar') or public.tem_permissao('cadastros', 'editar')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Coordenada inválida.'; end if;
  select cliente_id into v_cliente from public.pedidos where id = p_pedido and empresa_id = public.empresa_atual();
  if not found then raise exception 'Pedido não encontrado.'; end if;
  update public.pessoas_enderecos x set latitude = p_lat, longitude = p_lng, coordenada_fonte = 'geocodificada'
   where x.id = (select y.id from public.pessoas_enderecos y where y.pessoa_id = v_cliente and y.ativo
                  order by (y.tipo = 'entrega') desc, (y.tipo = 'principal') desc, y.criado_em limit 1)
     and (x.latitude is null or x.coordenada_fonte = 'geocodificada');
end;
$$;

-- Ponto de saída das entregas
create or replace function public.empresa_definir_saida(p_lat numeric, p_lng numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.tem_permissao('expedicao', 'editar') or public.tem_permissao('configuracoes', 'editar')) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then raise exception 'Coordenada inválida.'; end if;
  update public.empresas set latitude = p_lat, longitude = p_lng where id = public.empresa_atual();
end;
$$;

-- Entrega registrada: a coordenada do local vale mais que a geocodificada
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

-- Entregas com etapa e origem da coordenada (colunas novas no fim)
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
       ep.etapa, ep.a_caminho_em, ep.chegou_em, en.coordenada_fonte
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

-- Painel: quantas estão a caminho / no cliente agora (colunas novas no fim)
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
       pos.latitude as ultima_latitude, pos.longitude as ultima_longitude, pos.registrado_em as ultima_posicao_em,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente' and x.etapa = 'a_caminho') as a_caminho,
       (select count(*) from public.expedicoes_pedidos x where x.expedicao_id = e.id and x.status_entrega = 'pendente' and x.etapa = 'chegou') as no_cliente
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

do $$ declare f text; begin foreach f in array array[
  'expedicao_etapa(uuid, text, numeric, numeric)', 'endereco_coordenada_pedido(uuid, numeric, numeric)',
  'empresa_definir_saida(numeric, numeric)', 'expedicao_registrar_entrega(uuid, text, text, numeric, numeric)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
