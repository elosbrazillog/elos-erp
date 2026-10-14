-- =====================================================================
-- Fase 4a · Expedição
-- Carga junta pedidos aprovados; a saída da carga baixa o estoque dos
-- lotes reservados; a entrega confirma, devolve ao mesmo lote ou, com o
-- cliente ausente, devolve ao estoque e libera o pedido para outra carga.
-- =====================================================================

-- Carga: situação só muda pelas ações
create or replace function public.fn_expedicao_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    new.status := 'montando';
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Use Cancelar carga.';
  end if;
  if new.status is distinct from old.status then
    raise exception 'A situação da carga só muda pelas ações (separar, saída, cancelar).';
  end if;
  if old.status in ('concluida', 'cancelada') then
    raise exception 'Carga encerrada não pode ser alterada.';
  end if;
  return new;
end;
$$;
create trigger trg_expedicoes_protege before insert or update or delete on public.expedicoes
  for each row execute function public.fn_expedicao_protege();

-- Pedidos da carga: só pelas ações
create or replace function public.fn_expedicao_pedido_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  raise exception 'Use as ações da carga para incluir, ordenar, retirar ou registrar entregas.';
end;
$$;
create trigger trg_expedicoes_pedidos_protege before insert or update or delete on public.expedicoes_pedidos
  for each row execute function public.fn_expedicao_pedido_protege();

create or replace function public.fn_expedicao_obter(p_expedicao uuid, p_status text[])
returns public.expedicoes
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  select * into e from public.expedicoes
   where id = p_expedicao and empresa_id = public.empresa_atual()
   for update;
  if not found then raise exception 'Carga não encontrada.'; end if;
  if not (e.status = any(p_status)) then
    raise exception 'Ação não permitida com a carga na situação atual (%).', e.status;
  end if;
  perform set_config('elos.regra', '1', true);
  return e;
end;
$$;

-- Inclui pedidos aprovados na carga, na ordem de visita dos clientes
create or replace function public.expedicao_incluir_pedidos(p_expedicao uuid, p_pedidos uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  r record;
  v_ordem integer;
  v_n integer := 0;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  select coalesce(max(ordem_entrega), 0) into v_ordem from public.expedicoes_pedidos where expedicao_id = e.id;

  for r in
    select pe.id, pe.numero, pe.status
      from public.pedidos pe join public.pessoas c on c.id = pe.cliente_id
     where pe.id = any(p_pedidos) and pe.empresa_id = e.empresa_id
     order by c.ordem_visita nulls last, c.razao_social
     for update of pe
  loop
    if r.status <> 'aprovado' then
      raise exception 'O pedido % não está aprovado (situação: %).', r.numero, r.status;
    end if;
    v_ordem := v_ordem + 1;
    insert into public.expedicoes_pedidos (empresa_id, expedicao_id, pedido_id, ordem_entrega)
    values (e.empresa_id, e.id, r.id, v_ordem);
    update public.pedidos set status = 'em_separacao' where id = r.id;
    v_n := v_n + 1;
  end loop;
  perform set_config('elos.regra', '', true);
  return v_n;
end;
$$;

-- Tira o pedido da carga; ele volta para aprovado com a reserva intacta
create or replace function public.expedicao_retirar_pedido(p_expedicao uuid, p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  delete from public.expedicoes_pedidos where expedicao_id = e.id and pedido_id = p_pedido;
  if not found then raise exception 'Pedido não está nesta carga.'; end if;
  update public.pedidos set status = 'aprovado' where id = p_pedido and status = 'em_separacao';
  perform set_config('elos.regra', '', true);
end;
$$;

-- Define a ordem de entrega pela posição na lista
create or replace function public.expedicao_ordenar(p_expedicao uuid, p_pedidos uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando', 'em_rota']);
  update public.expedicoes_pedidos ep
     set ordem_entrega = x.pos
    from unnest(p_pedidos) with ordinality as x(pedido_id, pos)
   where ep.expedicao_id = e.id and ep.pedido_id = x.pedido_id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.expedicao_separar(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando']);
  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id) then
    raise exception 'Inclua ao menos um pedido na carga.';
  end if;
  update public.expedicoes set status = 'separando', responsavel_separacao = auth.uid() where id = e.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Saída para entrega: a reserva de cada pedido vira baixa no estoque
create or replace function public.expedicao_saida(p_expedicao uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
  p record;
  r record;
  v_pedidos integer := 0;
  v_itens numeric := 0;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  if e.motorista_id is null then raise exception 'Informe o motorista da carga.'; end if;
  if not exists (select 1 from public.expedicoes_pedidos where expedicao_id = e.id) then
    raise exception 'A carga não tem pedidos.';
  end if;

  for p in
    select pe.id, pe.numero from public.expedicoes_pedidos ep join public.pedidos pe on pe.id = ep.pedido_id
     where ep.expedicao_id = e.id order by ep.ordem_entrega
     for update of pe
  loop
    if not exists (select 1 from public.pedidos_reservas where pedido_id = p.id) then
      raise exception 'O pedido % está sem estoque reservado. Retire-o da carga, reabra e confirme de novo.', p.numero;
    end if;
    for r in select * from public.pedidos_reservas where pedido_id = p.id loop
      update public.estoque_saldos
         set quantidade_reservada = greatest(quantidade_reservada - r.quantidade, 0), alterado_em = now()
       where id = r.estoque_saldo_id;
      insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
      values (e.empresa_id, 'saida', r.deposito_id, r.produto_id, r.lote_id, r.quantidade, 'expedicao', p.id,
              format('Carga nº %s · pedido nº %s', e.numero, p.numero));
      v_itens := v_itens + r.quantidade;
    end loop;
    delete from public.pedidos_reservas where pedido_id = p.id;
    update public.pedidos set status = 'em_rota' where id = p.id;
    v_pedidos := v_pedidos + 1;
  end loop;

  update public.expedicoes set status = 'em_rota' where id = e.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('pedidos', v_pedidos, 'unidades', v_itens);
end;
$$;

-- Devolve ao estoque, nos mesmos lotes e depósitos, o que saiu com o pedido
create or replace function public.fn_expedicao_devolver(p_pedido uuid, p_obs text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
  select m.empresa_id, 'devolucao', m.deposito_id, m.produto_id, m.lote_id,
         sum(case when m.tipo = 'saida' then m.quantidade else -m.quantidade end), 'expedicao', p_pedido, p_obs
    from public.estoque_movimentos m
   where m.origem = 'expedicao' and m.origem_id = p_pedido and m.tipo in ('saida', 'devolucao')
   group by m.empresa_id, m.deposito_id, m.produto_id, m.lote_id
  having sum(case when m.tipo = 'saida' then m.quantidade else -m.quantidade end) > 0;
end;
$$;

-- Resultado da entrega de um pedido: entregue, devolvido ou ausente
create or replace function public.expedicao_registrar_entrega(p_expedicao_pedido uuid, p_resultado text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ep public.expedicoes_pedidos;
  e public.expedicoes;
  v_numero bigint;
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
  select numero into v_numero from public.pedidos where id = ep.pedido_id for update;

  if p_resultado = 'entregue' then
    update public.expedicoes_pedidos set status_entrega = 'entregue', entregue_em = now(), motivo_devolucao = nullif(trim(p_motivo), '') where id = ep.id;
    update public.pedidos set status = 'entregue' where id = ep.pedido_id;
  elsif p_resultado = 'devolvido_total' then
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Devolução · carga nº %s · pedido nº %s · %s', e.numero, v_numero, trim(p_motivo)));
    update public.expedicoes_pedidos set status_entrega = 'devolvido_total', entregue_em = now(), motivo_devolucao = trim(p_motivo) where id = ep.id;
    update public.pedidos set status = 'devolvido' where id = ep.pedido_id;
  else
    -- cliente ausente: mercadoria volta, é reservada de novo e o pedido fica livre para outra carga
    perform public.fn_expedicao_devolver(ep.pedido_id, format('Cliente ausente · carga nº %s · pedido nº %s', e.numero, v_numero));
    update public.expedicoes_pedidos set status_entrega = 'ausente', entregue_em = now(), motivo_devolucao = coalesce(nullif(trim(p_motivo), ''), 'Cliente ausente') where id = ep.id;
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

-- Cancela a carga antes da saída; pedidos voltam para aprovado
create or replace function public.expedicao_cancelar(p_expedicao uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expedicoes;
begin
  perform public.fn_exigir('expedicao', 'editar');
  e := public.fn_expedicao_obter(p_expedicao, array['montando', 'separando']);
  update public.pedidos set status = 'aprovado'
   where id in (select pedido_id from public.expedicoes_pedidos where expedicao_id = e.id) and status = 'em_separacao';
  delete from public.expedicoes_pedidos where expedicao_id = e.id;
  update public.expedicoes set status = 'cancelada' where id = e.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Cancelar pedido que está numa carga ainda não saída: tira da carga
create or replace function public.pedido_cancelar(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'Este pedido não pode mais ser cancelado por aqui.';
  end if;
  delete from public.expedicoes_pedidos ep using public.expedicoes e
   where ep.pedido_id = p.id and e.id = ep.expedicao_id and e.status in ('montando', 'separando');
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views (expedição e motorista não têm acesso a vendas: estas views
-- rodam com os direitos do dono e filtram empresa e perfil)
-- ---------------------------------------------------------------------
create or replace view public.vw_expedicoes
as
select e.id, e.empresa_id, e.numero, e.data, e.status, e.observacao, e.rota_id, e.motorista_id, e.veiculo_id, e.criado_em,
       r.nome as rota_nome,
       m.razao_social as motorista_nome,
       v.placa as veiculo_placa,
       v.descricao as veiculo_descricao,
       v.capacidade_kg,
       count(ep.id) as qtd_pedidos,
       coalesce(sum(pe.peso_total_kg), 0) as peso_total_kg,
       coalesce(sum(pe.valor_total), 0) as valor_total,
       count(ep.id) filter (where ep.status_entrega = 'entregue') as entregues,
       count(ep.id) filter (where ep.status_entrega = 'pendente') as pendentes,
       count(ep.id) filter (where ep.status_entrega in ('devolvido_total', 'devolvido_parcial', 'ausente')) as nao_entregues
  from public.expedicoes e
  left join public.rotas r on r.id = e.rota_id
  left join public.pessoas m on m.id = e.motorista_id
  left join public.veiculos v on v.id = e.veiculo_id
  left join public.expedicoes_pedidos ep on ep.expedicao_id = e.id
  left join public.pedidos pe on pe.id = ep.pedido_id
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
 group by e.id, r.nome, m.razao_social, v.placa, v.descricao, v.capacidade_kg;

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
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens
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

create or replace view public.vw_expedicao_itens
as
select ep.expedicao_id, ep.pedido_id, i.id as pedido_item_id, pr.codigo as produto_codigo, pr.nome as produto_nome,
       u.sigla as unidade, i.quantidade, i.valor_total, i.ordem
  from public.expedicoes_pedidos ep
  join public.pedidos_itens i on i.pedido_id = ep.pedido_id and i.ativo
  join public.produtos pr on pr.id = i.produto_id
  left join public.unidades u on u.id = pr.unidade_id
 where ep.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver');

-- O que separar: antes da saída vem das reservas; depois, do que saiu
create or replace view public.vw_separacao
as
select x.expedicao_id, d.nome as deposito_nome, pr.codigo as produto_codigo, pr.nome as produto_nome, u.sigla as unidade,
       lo.numero as lote_numero, lo.validade, sum(x.quantidade) as quantidade
  from (
    select ep.expedicao_id, r.deposito_id, r.produto_id, r.lote_id, r.quantidade
      from public.expedicoes_pedidos ep join public.pedidos_reservas r on r.pedido_id = ep.pedido_id
    union all
    select ep.expedicao_id, m.deposito_id, m.produto_id, m.lote_id,
           case when m.tipo = 'saida' then m.quantidade else -m.quantidade end
      from public.expedicoes_pedidos ep
      join public.estoque_movimentos m on m.origem = 'expedicao' and m.origem_id = ep.pedido_id and m.tipo in ('saida', 'devolucao')
     where ep.status_entrega not in ('ausente')
  ) x
  join public.depositos d on d.id = x.deposito_id
  join public.produtos pr on pr.id = x.produto_id
  left join public.unidades u on u.id = pr.unidade_id
  left join public.lotes lo on lo.id = x.lote_id
  join public.expedicoes e on e.id = x.expedicao_id
 where e.empresa_id = public.empresa_atual() and public.tem_permissao('expedicao', 'ver')
 group by x.expedicao_id, d.nome, pr.codigo, pr.nome, u.sigla, lo.numero, lo.validade
having sum(x.quantidade) > 0;

revoke all on public.vw_expedicoes, public.vw_expedicao_pedidos, public.vw_expedicao_itens, public.vw_separacao from public, anon;
grant select on public.vw_expedicoes, public.vw_expedicao_pedidos, public.vw_expedicao_itens, public.vw_separacao to authenticated;

revoke execute on function public.fn_expedicao_obter(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.fn_expedicao_devolver(uuid, text) from public, anon, authenticated;

do $$ declare f text; begin foreach f in array array[
  'expedicao_incluir_pedidos(uuid, uuid[])', 'expedicao_retirar_pedido(uuid, uuid)', 'expedicao_ordenar(uuid, uuid[])',
  'expedicao_separar(uuid)', 'expedicao_saida(uuid)', 'expedicao_registrar_entrega(uuid, text, text)',
  'expedicao_cancelar(uuid)', 'pedido_cancelar(uuid, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
