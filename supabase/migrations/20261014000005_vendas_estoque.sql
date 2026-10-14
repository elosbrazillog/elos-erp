-- =====================================================================
-- Fase 2 · Vendas e estoque
-- Pedido confirmado reserva estoque por lote (vencimento mais próximo
-- primeiro) e passa pela trava de crédito. Situação do pedido e saldos
-- só mudam pelas funções abaixo, nunca direto pela tela.
-- =====================================================================

alter table public.pedidos add column if not exists motivo_trava text;

-- Sinal de que a alteração vem de uma função de regra (vale só na transação)
create or replace function public.fn_via_regra()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('elos.regra', true), '') = '1';
$$;

-- Valor em reais para mensagens: 1234.5 -> R$ 1.234,50
create or replace function public.fn_brl(v numeric)
returns text
language sql
immutable
as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- Quantidade sem zeros sobrando: 12.000 -> 12, 1.500 -> 1,5
create or replace function public.fn_qtd(v numeric)
returns text
language sql
immutable
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from to_char(coalesce(v, 0), 'FM999999999990.000'))), '.', ',');
$$;

-- Nome do usuário (para listas de histórico), só da mesma empresa
create or replace function public.fn_nome_usuario(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nome from public.usuarios where id = p_id and empresa_id = public.empresa_atual();
$$;

-- ---------------------------------------------------------------------
-- Reservas de estoque por lote
-- ---------------------------------------------------------------------
create table public.pedidos_reservas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pedido_id uuid not null references public.pedidos(id) on delete cascade,
  pedido_item_id uuid not null references public.pedidos_itens(id) on delete cascade,
  estoque_saldo_id uuid not null references public.estoque_saldos(id),
  deposito_id uuid not null references public.depositos(id),
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  quantidade numeric(14,3) not null check (quantidade > 0),
  criado_em timestamptz not null default now()
);
create index pedidos_reservas_pedido_idx on public.pedidos_reservas (pedido_id);
create index pedidos_reservas_saldo_idx on public.pedidos_reservas (estoque_saldo_id);

alter table public.pedidos_reservas enable row level security;
create policy "pedidos_reservas_ver" on public.pedidos_reservas for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('vendas', 'ver') or public.tem_permissao('estoque', 'ver')));

-- ---------------------------------------------------------------------
-- Inventário
-- ---------------------------------------------------------------------
create table public.inventarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  numero bigint,
  deposito_id uuid not null references public.depositos(id),
  data date not null default current_date,
  status text not null default 'aberto' check (status in ('aberto', 'concluido', 'cancelado')),
  observacao text,
  concluido_em timestamptz,
  concluido_por uuid,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true,
  unique (empresa_id, numero)
);

create table public.inventarios_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null default public.empresa_atual() references public.empresas(id) on delete cascade,
  inventario_id uuid not null references public.inventarios(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.lotes(id),
  -- lote encontrado na contagem que ainda não existe no sistema
  lote_numero text,
  validade date,
  quantidade_sistema numeric(14,3) not null default 0,
  quantidade_contada numeric(14,3) check (quantidade_contada >= 0),
  diferenca numeric(14,3),
  criado_em timestamptz not null default now(),
  criado_por uuid,
  alterado_em timestamptz not null default now(),
  alterado_por uuid,
  ativo boolean not null default true
);
create index inventarios_itens_inv_idx on public.inventarios_itens (inventario_id);
-- o mesmo lote não entra duas vezes na mesma contagem
create unique index inventarios_itens_un on public.inventarios_itens
  (inventario_id, produto_id, coalesce(lote_id::text, coalesce(upper(lote_numero), '') || '|' || coalesce((validade - date '2000-01-01')::text, '')));

do $$ declare t text; begin foreach t in array array['inventarios', 'inventarios_itens'] loop
  perform public.fn_cria_politicas(t, 'estoque');
  execute format('create trigger trg_%1$s_auditoria before insert or update on public.%1$I
                  for each row execute function public.fn_auditoria()', t);
end loop; end $$;

-- Itens do inventário só mudam enquanto ele está aberto
create or replace function public.fn_inventario_item_protege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status from public.inventarios where id = coalesce(new.inventario_id, old.inventario_id);
  if v_status is not null and v_status <> 'aberto' and not public.fn_via_regra() then
    raise exception 'Este inventário já foi encerrado e não pode mais ser alterado.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' and not public.fn_via_regra() then
    new.quantidade_sistema := 0;  -- item incluído na contagem: não existia no sistema
    if new.lote_id is null and exists (select 1 from public.produtos where id = new.produto_id and controla_lote) and new.validade is null then
      raise exception 'Informe a validade do lote encontrado.';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_inventarios_itens_protege before insert or update or delete on public.inventarios_itens
  for each row execute function public.fn_inventario_item_protege();

create or replace function public.fn_inventario_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'concluido' then raise exception 'Inventário concluído não pode ser excluído.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Use a ação Abrir inventário.';
  end if;
  if new.status is distinct from old.status or new.deposito_id is distinct from old.deposito_id then
    raise exception 'Use as ações Concluir ou Cancelar.';
  end if;
  return new;
end;
$$;
create trigger trg_inventarios_protege before insert or update or delete on public.inventarios
  for each row execute function public.fn_inventario_protege();

-- ---------------------------------------------------------------------
-- Saldo nunca negativo
-- ---------------------------------------------------------------------
create or replace function public.fn_estoque_movimento_saldo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sinal numeric;
  v_saldo numeric;
begin
  v_sinal := case when new.tipo in ('entrada', 'ajuste_entrada', 'transferencia_entrada', 'devolucao') then 1 else -1 end;

  insert into public.estoque_saldos (empresa_id, deposito_id, produto_id, lote_id, quantidade)
  values (new.empresa_id, new.deposito_id, new.produto_id, new.lote_id, v_sinal * new.quantidade)
  on conflict (deposito_id, produto_id, coalesce(lote_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set quantidade = public.estoque_saldos.quantidade + excluded.quantidade,
                alterado_em = now()
  returning quantidade into v_saldo;

  if v_saldo < 0 then
    raise exception 'Saldo insuficiente: o estoque deste lote ficaria negativo (%).', public.fn_qtd(v_saldo);
  end if;
  return new;
end;
$$;

-- Movimentos só entram pelas funções de estoque
drop policy if exists "estoque_movimentos_criar" on public.estoque_movimentos;

-- ---------------------------------------------------------------------
-- Pedido: valores padrão vindos do cliente
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_padroes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
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
create trigger trg_pedidos_padroes before insert or update of cliente_id on public.pedidos
  for each row execute function public.fn_pedido_padroes();

-- ---------------------------------------------------------------------
-- Pedido: proteção da situação e dos valores depois de confirmado
-- ---------------------------------------------------------------------
create or replace function public.fn_pedido_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'rascunho' then
      raise exception 'Só pedidos em rascunho podem ser excluídos. Use Cancelar.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'rascunho';
    new.motivo_trava := null;
    new.credito_liberado_por := null;
    new.credito_liberado_em := null;
    new.motivo_cancelamento := null;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.tipo is distinct from old.tipo
     or new.motivo_trava is distinct from old.motivo_trava
     or new.credito_liberado_por is distinct from old.credito_liberado_por
     or new.credito_liberado_em is distinct from old.credito_liberado_em
     or new.motivo_cancelamento is distinct from old.motivo_cancelamento then
    raise exception 'A situação do pedido só muda pelas ações (confirmar, liberar crédito, reabrir, cancelar).';
  end if;

  if old.status <> 'rascunho'
     and (new.cliente_id, new.vendedor_id, new.tabela_preco_id, new.condicao_pagamento_id, new.forma_pagamento_id,
          new.deposito_id, new.valor_desconto, new.valor_frete, new.empresa_id)
         is distinct from
         (old.cliente_id, old.vendedor_id, old.tabela_preco_id, old.condicao_pagamento_id, old.forma_pagamento_id,
          old.deposito_id, old.valor_desconto, old.valor_frete, old.empresa_id) then
    raise exception 'Pedido já confirmado. Use Reabrir para alterar cliente, valores ou pagamento.';
  end if;

  if old.status in ('faturado', 'em_rota', 'entregue', 'devolvido', 'cancelado')
     and (new.data_entrega, new.observacao, new.observacao_nfe, new.pedido_cliente, new.rota_id)
         is distinct from
         (old.data_entrega, old.observacao, old.observacao_nfe, old.pedido_cliente, old.rota_id) then
    raise exception 'Pedido encerrado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_protege before insert or update or delete on public.pedidos
  for each row execute function public.fn_pedido_protege();

-- Itens só mudam com o pedido em rascunho
create or replace function public.fn_pedido_item_protege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if public.fn_via_regra() then
    return coalesce(new, old);
  end if;
  select status into v_status from public.pedidos where id = coalesce(new.pedido_id, old.pedido_id);
  if v_status is not null and v_status <> 'rascunho' then
    raise exception 'Os itens só podem ser alterados com o pedido em rascunho. Use Reabrir.';
  end if;
  if tg_op = 'UPDATE' and new.pedido_id is distinct from old.pedido_id then
    raise exception 'Não é possível mover um item para outro pedido.';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger trg_pedidos_itens_protege before insert or update or delete on public.pedidos_itens
  for each row execute function public.fn_pedido_item_protege();

-- Preço do item: tabela do pedido, senão preço de venda do produto
create or replace function public.fn_pedido_item_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.preco_unitario is null then
    select coalesce(ti.preco, pr.preco_venda)
      into new.preco_unitario
      from public.produtos pr
      left join public.pedidos pe on pe.id = new.pedido_id
      left join public.tabelas_preco_itens ti
             on ti.tabela_preco_id = pe.tabela_preco_id and ti.produto_id = pr.id and ti.ativo
     where pr.id = new.produto_id;
  end if;
  new.valor_total := round(new.quantidade * new.preco_unitario - coalesce(new.desconto, 0), 2);
  if new.valor_total < 0 then
    raise exception 'O desconto do item é maior que o valor do item.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Regras internas (não expostas pela API)
-- ---------------------------------------------------------------------

-- Motivo para travar o crédito, ou null se o pedido pode seguir.
-- Limite zero = cliente sem limite definido: só bloqueio e atraso travam.
create or replace function public.fn_credito_motivo(p_pedido uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_atraso numeric;
  v_aberto numeric;
  v_pedidos numeric;
begin
  select pe.cliente_id, pe.valor_total, p.limite_credito, p.bloqueado, p.motivo_bloqueio
    into r
    from public.pedidos pe join public.pessoas p on p.id = pe.cliente_id
   where pe.id = p_pedido;

  if r.bloqueado then
    return 'Cliente bloqueado' || coalesce(': ' || nullif(r.motivo_bloqueio, ''), '');
  end if;

  select coalesce(sum(valor) filter (where data_vencimento < current_date), 0), coalesce(sum(valor), 0)
    into v_atraso, v_aberto
    from public.lancamentos
   where pessoa_id = r.cliente_id and tipo = 'receber' and ativo and data_quitacao is null;

  if v_atraso > 0 then
    return 'Títulos vencidos em aberto: ' || public.fn_brl(v_atraso);
  end if;

  if r.limite_credito > 0 then
    select coalesce(sum(valor_total), 0) into v_pedidos
      from public.pedidos
     where cliente_id = r.cliente_id and id <> p_pedido and tipo = 'pedido' and ativo
       and status in ('aguardando_credito', 'aprovado', 'em_separacao');
    if v_aberto + v_pedidos + r.valor_total > r.limite_credito then
      return format('Limite de crédito excedido: limite %s, títulos em aberto %s, outros pedidos %s, este pedido %s',
                    public.fn_brl(r.limite_credito), public.fn_brl(v_aberto), public.fn_brl(v_pedidos), public.fn_brl(r.valor_total));
    end if;
  end if;
  return null;
end;
$$;

-- Reserva os itens no depósito do pedido, vencimento mais próximo primeiro.
-- Lotes vencidos nunca são reservados.
create or replace function public.fn_pedido_reservar(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dep uuid;
  v_emp uuid;
  it record;
  s record;
  v_falta numeric;
  v_q numeric;
  v_faltas text[] := '{}';
begin
  select deposito_id, empresa_id into v_dep, v_emp from public.pedidos where id = p_pedido;
  if v_dep is null then
    raise exception 'Informe o depósito de saída do pedido.';
  end if;

  for it in
    select i.id, i.produto_id, i.quantidade, pr.codigo, pr.nome
      from public.pedidos_itens i join public.produtos pr on pr.id = i.produto_id
     where i.pedido_id = p_pedido and i.ativo
     order by i.ordem, i.criado_em
  loop
    v_falta := it.quantidade;
    for s in
      select es.id, es.lote_id, es.quantidade - es.quantidade_reservada as disponivel
        from public.estoque_saldos es
        left join public.lotes l on l.id = es.lote_id
       where es.deposito_id = v_dep
         and es.produto_id = it.produto_id
         and es.quantidade - es.quantidade_reservada > 0
         and (l.id is null or l.validade >= current_date)
       order by l.validade nulls last, l.criado_em, es.id
       for update of es
    loop
      exit when v_falta <= 0;
      v_q := least(v_falta, s.disponivel);
      update public.estoque_saldos
         set quantidade_reservada = quantidade_reservada + v_q, alterado_em = now()
       where id = s.id;
      insert into public.pedidos_reservas (empresa_id, pedido_id, pedido_item_id, estoque_saldo_id, deposito_id, produto_id, lote_id, quantidade)
      values (v_emp, p_pedido, it.id, s.id, v_dep, it.produto_id, s.lote_id, v_q);
      v_falta := v_falta - v_q;
    end loop;
    if v_falta > 0 then
      v_faltas := v_faltas || format('%s %s: faltam %s', it.codigo, it.nome, public.fn_qtd(v_falta));
    end if;
  end loop;

  if cardinality(v_faltas) > 0 then
    raise exception 'Estoque insuficiente. %', array_to_string(v_faltas, ' · ');
  end if;
end;
$$;

-- Devolve ao disponível tudo o que o pedido reservou
create or replace function public.fn_pedido_liberar_reservas(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.estoque_saldos es
     set quantidade_reservada = greatest(es.quantidade_reservada - r.q, 0), alterado_em = now()
    from (select estoque_saldo_id, sum(quantidade) as q
            from public.pedidos_reservas where pedido_id = p_pedido group by estoque_saldo_id) r
   where es.id = r.estoque_saldo_id;
  delete from public.pedidos_reservas where pedido_id = p_pedido;
end;
$$;

-- Carrega o pedido da empresa do usuário, travado para alteração
create or replace function public.fn_pedido_obter(p_pedido uuid)
returns public.pedidos
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  select * into p from public.pedidos
   where id = p_pedido and empresa_id = public.empresa_atual() and ativo
   for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  perform set_config('elos.regra', '1', true);
  return p;
end;
$$;

create or replace function public.fn_exigir(p_modulo text, p_acao text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tem_permissao(p_modulo, p_acao) then
    raise exception 'Seu perfil não tem permissão para esta ação.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Ações do pedido (chamadas pela tela)
-- ---------------------------------------------------------------------

-- Confirma o pedido: reserva o estoque e aprova, ou trava no crédito
create or replace function public.pedido_confirmar(p_pedido uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  v_motivo text;
  v_status text;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'pedido' then raise exception 'Orçamento não é confirmado. Converta em pedido primeiro.'; end if;
  if p.status <> 'rascunho' then raise exception 'Só pedidos em rascunho podem ser confirmados.'; end if;
  if not exists (select 1 from public.pedidos_itens where pedido_id = p.id and ativo) then
    raise exception 'Inclua ao menos um item no pedido.';
  end if;
  if exists (select 1 from public.pessoas where id = p.cliente_id and not ativo) then
    raise exception 'O cliente está inativo.';
  end if;

  perform public.fn_pedido_recalcula(p.id);
  perform public.fn_pedido_reservar(p.id);
  v_motivo := public.fn_credito_motivo(p.id);
  v_status := case when v_motivo is null then 'aprovado' else 'aguardando_credito' end;

  update public.pedidos
     set status = v_status, motivo_trava = v_motivo, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('status', v_status, 'motivo', v_motivo);
end;
$$;

-- Volta para rascunho e devolve a reserva, para alterar o pedido
create or replace function public.pedido_reabrir(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.status not in ('aguardando_credito', 'aprovado') then
    raise exception 'Só pedidos aguardando crédito ou aprovados podem ser reabertos.';
  end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos
     set status = 'rascunho', motivo_trava = null, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

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
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.pedido_liberar_credito(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.status <> 'aguardando_credito' then raise exception 'Este pedido não está aguardando crédito.'; end if;
  update public.pedidos
     set status = 'aprovado', credito_liberado_por = auth.uid(), credito_liberado_em = now()
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

create or replace function public.pedido_recusar_credito(p_pedido uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo da recusa.'; end if;
  p := public.fn_pedido_obter(p_pedido);
  if p.status <> 'aguardando_credito' then raise exception 'Este pedido não está aguardando crédito.'; end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos set status = 'cancelado', motivo_cancelamento = 'Crédito recusado: ' || trim(p_motivo) where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Orçamento vira pedido em rascunho, com o mesmo número
create or replace function public.orcamento_converter(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.tipo <> 'orcamento' or p.status <> 'rascunho' then raise exception 'Só orçamentos em aberto podem ser convertidos.'; end if;
  if p.validade is not null and p.validade < current_date then
    raise exception 'Orçamento vencido em %. Altere a validade antes de converter.', to_char(p.validade, 'DD/MM/YYYY');
  end if;
  update public.pedidos set tipo = 'pedido', data_emissao = now() where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Ações de estoque
-- ---------------------------------------------------------------------

-- Lote do produto pelo número; cria se não existir.
-- Sem número informado, o lote leva a validade: V20270131.
create or replace function public.fn_lote_obter(p_produto uuid, p_numero text, p_validade date, p_fabricacao date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_controla boolean;
  v_numero text;
  v_lote public.lotes;
begin
  select controla_lote into v_controla from public.produtos where id = p_produto and empresa_id = public.empresa_atual();
  if not found then raise exception 'Produto não encontrado.'; end if;
  v_numero := nullif(upper(trim(coalesce(p_numero, ''))), '');
  if not v_controla and v_numero is null and p_validade is null then
    return null;
  end if;
  if p_validade is null and v_numero is null then
    raise exception 'Informe a validade do lote.';
  end if;
  v_numero := coalesce(v_numero, 'V' || to_char(p_validade, 'YYYYMMDD'));

  select * into v_lote from public.lotes where produto_id = p_produto and numero = v_numero;
  if found then
    if p_validade is not null and v_lote.validade <> p_validade then
      raise exception 'O lote % já está cadastrado com validade %.', v_numero, to_char(v_lote.validade, 'DD/MM/YYYY');
    end if;
    return v_lote.id;
  end if;
  if p_validade is null then
    raise exception 'Lote % novo: informe a validade.', v_numero;
  end if;
  insert into public.lotes (empresa_id, produto_id, numero, fabricacao, validade)
  values (public.empresa_atual(), p_produto, v_numero, p_fabricacao, p_validade)
  returning id into v_lote.id;
  return v_lote.id;
end;
$$;

-- Entrada de mercadoria em um depósito
create or replace function public.estoque_entrada(
  p_produto uuid, p_deposito uuid, p_quantidade numeric,
  p_lote text default null, p_validade date default null, p_fabricacao date default null,
  p_custo numeric default null, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid;
  v_id uuid;
begin
  perform public.fn_exigir('estoque', 'criar');
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if not exists (select 1 from public.depositos where id = p_deposito and empresa_id = public.empresa_atual()) then
    raise exception 'Depósito não encontrado.';
  end if;
  if p_validade is not null and p_validade < current_date then
    raise exception 'A validade informada já passou. Lance como perda ou no depósito de avarias.';
  end if;
  v_lote := public.fn_lote_obter(p_produto, p_lote, p_validade, p_fabricacao);
  insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, custo_unitario, origem, observacao)
  values (public.empresa_atual(), 'entrada', p_deposito, p_produto, v_lote, p_quantidade, p_custo, 'manual', nullif(trim(p_observacao), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Ajuste, perda ou transferência a partir de um saldo (depósito + lote)
create or replace function public.estoque_movimentar(
  p_saldo uuid, p_tipo text, p_quantidade numeric,
  p_observacao text default null, p_deposito_destino uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.estoque_saldos;
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('estoque', 'criar');
  if p_tipo not in ('ajuste_entrada', 'ajuste_saida', 'perda', 'transferencia') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if coalesce(p_quantidade, 0) <= 0 then raise exception 'Informe uma quantidade maior que zero.'; end if;
  if p_tipo in ('ajuste_entrada', 'ajuste_saida', 'perda') and coalesce(trim(p_observacao), '') = '' then
    raise exception 'Informe o motivo do ajuste ou da perda.';
  end if;

  select * into s from public.estoque_saldos where id = p_saldo and empresa_id = v_emp for update;
  if not found then raise exception 'Saldo não encontrado.'; end if;

  if p_tipo <> 'ajuste_entrada' and p_quantidade > s.quantidade - s.quantidade_reservada then
    raise exception 'Só há % disponível neste lote (% reservado para pedidos).',
      public.fn_qtd(s.quantidade - s.quantidade_reservada), public.fn_qtd(s.quantidade_reservada);
  end if;

  if p_tipo = 'transferencia' then
    if p_deposito_destino is null or p_deposito_destino = s.deposito_id then
      raise exception 'Escolha um depósito de destino diferente do de origem.';
    end if;
    if not exists (select 1 from public.depositos where id = p_deposito_destino and empresa_id = v_emp) then
      raise exception 'Depósito de destino não encontrado.';
    end if;
    insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, observacao)
    values (v_emp, 'transferencia_saida', s.deposito_id, s.produto_id, s.lote_id, p_quantidade, 'transferencia', nullif(trim(p_observacao), '')),
           (v_emp, 'transferencia_entrada', p_deposito_destino, s.produto_id, s.lote_id, p_quantidade, 'transferencia', nullif(trim(p_observacao), ''));
  else
    insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, observacao)
    values (v_emp, p_tipo, s.deposito_id, s.produto_id, s.lote_id, p_quantidade, 'manual', trim(p_observacao));
  end if;
end;
$$;

-- Abre o inventário de um depósito com o retrato dos saldos atuais
create or replace function public.inventario_abrir(p_deposito uuid, p_observacao text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_id uuid;
begin
  perform public.fn_exigir('estoque', 'criar');
  if not exists (select 1 from public.depositos where id = p_deposito and empresa_id = v_emp) then
    raise exception 'Depósito não encontrado.';
  end if;
  if exists (select 1 from public.inventarios where deposito_id = p_deposito and status = 'aberto') then
    raise exception 'Já existe um inventário aberto para este depósito.';
  end if;
  perform set_config('elos.regra', '1', true);
  insert into public.inventarios (empresa_id, numero, deposito_id, observacao)
  values (v_emp, public.proximo_numero(v_emp, 'inventario'), p_deposito, nullif(trim(p_observacao), ''))
  returning id into v_id;

  insert into public.inventarios_itens (empresa_id, inventario_id, produto_id, lote_id, quantidade_sistema)
  select v_emp, v_id, s.produto_id, s.lote_id, s.quantidade
    from public.estoque_saldos s
   where s.deposito_id = p_deposito and s.quantidade <> 0;
  perform set_config('elos.regra', '', true);
  return v_id;
end;
$$;

-- Conclui: lança ajustes para cada diferença entre contado e saldo atual.
-- Itens sem contagem ficam como estão.
create or replace function public.inventario_concluir(p_inventario uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  inv public.inventarios;
  it record;
  v_lote uuid;
  v_atual numeric;
  v_dif numeric;
  v_ajustes integer := 0;
begin
  perform public.fn_exigir('estoque', 'editar');
  select * into inv from public.inventarios where id = p_inventario and empresa_id = v_emp for update;
  if not found then raise exception 'Inventário não encontrado.'; end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário já foi encerrado.'; end if;
  perform set_config('elos.regra', '1', true);

  for it in select * from public.inventarios_itens where inventario_id = inv.id and quantidade_contada is not null loop
    v_lote := coalesce(it.lote_id,
      case when it.lote_numero is not null or it.validade is not null
           then public.fn_lote_obter(it.produto_id, it.lote_numero, it.validade, null) end);
    select coalesce(sum(quantidade), 0) into v_atual
      from public.estoque_saldos
     where deposito_id = inv.deposito_id and produto_id = it.produto_id and lote_id is not distinct from v_lote;
    v_dif := it.quantidade_contada - v_atual;
    if v_dif <> 0 then
      insert into public.estoque_movimentos (empresa_id, tipo, deposito_id, produto_id, lote_id, quantidade, origem, origem_id, observacao)
      values (v_emp, case when v_dif > 0 then 'ajuste_entrada' else 'ajuste_saida' end, inv.deposito_id, it.produto_id, v_lote,
              abs(v_dif), 'inventario', inv.id, 'Inventário nº ' || inv.numero);
      v_ajustes := v_ajustes + 1;
    end if;
    update public.inventarios_itens set lote_id = v_lote, diferenca = v_dif where id = it.id;
  end loop;

  update public.inventarios set status = 'concluido', concluido_em = now(), concluido_por = auth.uid() where id = inv.id;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('ajustes', v_ajustes);
end;
$$;

create or replace function public.inventario_cancelar(p_inventario uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('estoque', 'editar');
  perform set_config('elos.regra', '1', true);
  update public.inventarios set status = 'cancelado'
   where id = p_inventario and empresa_id = public.empresa_atual() and status = 'aberto';
  if not found then raise exception 'Só inventários abertos podem ser cancelados.'; end if;
  perform set_config('elos.regra', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- Views para as telas
-- ---------------------------------------------------------------------
create or replace view public.vw_pedidos
with (security_invoker = true)
as
select pe.*,
       c.codigo as cliente_codigo,
       c.razao_social as cliente_nome,
       c.nome_fantasia as cliente_fantasia,
       v.razao_social as vendedor_nome,
       r.nome as rota_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id;

drop view if exists public.vw_estoque;
create view public.vw_estoque
with (security_invoker = true)
as
select s.id,
       s.empresa_id,
       s.deposito_id,
       d.nome as deposito_nome,
       s.produto_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       pr.categoria_id,
       s.lote_id,
       lo.numero as lote_numero,
       lo.fabricacao,
       lo.validade,
       (lo.validade - current_date) as dias_para_vencer,
       s.quantidade,
       s.quantidade_reservada,
       -- lote vencido não fica disponível para venda
       case when lo.validade < current_date then 0 else s.quantidade - s.quantidade_reservada end as disponivel,
       pr.custo,
       round(s.quantidade * pr.custo, 2) as valor_custo
  from public.estoque_saldos s
  join public.depositos d on d.id = s.deposito_id
  join public.produtos pr on pr.id = s.produto_id
  left join public.lotes lo on lo.id = s.lote_id
 where s.quantidade <> 0 or s.quantidade_reservada <> 0;

-- Resumo por produto, inclusive os sem estoque (para ver o que falta).
-- Disponível desconta reservas e ignora lotes vencidos.
create or replace view public.vw_estoque_produtos
with (security_invoker = true)
as
select pr.id as produto_id,
       pr.empresa_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       pr.categoria_id,
       pr.estoque_minimo,
       coalesce(sum(s.quantidade), 0) as quantidade,
       coalesce(sum(s.quantidade_reservada), 0) as quantidade_reservada,
       coalesce(sum(s.quantidade - s.quantidade_reservada) filter (where lo.validade is null or lo.validade >= current_date), 0) as disponivel,
       coalesce(sum(s.quantidade) filter (where lo.validade < current_date), 0) as quantidade_vencida,
       min(lo.validade) filter (where s.quantidade > 0 and lo.validade >= current_date) as proxima_validade,
       count(distinct s.lote_id) filter (where s.quantidade > 0) as lotes
  from public.produtos pr
  left join public.estoque_saldos s on s.produto_id = pr.id
  left join public.lotes lo on lo.id = s.lote_id
 where pr.ativo
 group by pr.id;

-- Disponível para venda por depósito (o vendedor não enxerga lotes, então
-- esta view roda com os direitos do dono e filtra a empresa e o perfil)
create or replace view public.vw_estoque_disponivel
as
select s.deposito_id,
       s.produto_id,
       sum(s.quantidade - s.quantidade_reservada) filter (where lo.id is null or lo.validade >= current_date) as disponivel,
       coalesce(sum(s.quantidade) filter (where lo.validade < current_date), 0) as vencido
  from public.estoque_saldos s
  left join public.lotes lo on lo.id = s.lote_id
 where s.empresa_id = public.empresa_atual()
   and (public.tem_permissao('vendas', 'ver') or public.tem_permissao('estoque', 'ver'))
 group by s.deposito_id, s.produto_id;
revoke all on public.vw_estoque_disponivel from public, anon;
grant select on public.vw_estoque_disponivel to authenticated;

create or replace view public.vw_estoque_movimentos
with (security_invoker = true)
as
select m.id,
       m.empresa_id,
       m.data,
       m.tipo,
       m.origem,
       m.origem_id,
       m.deposito_id,
       d.nome as deposito_nome,
       m.produto_id,
       pr.codigo as produto_codigo,
       pr.nome as produto_nome,
       m.lote_id,
       lo.numero as lote_numero,
       lo.validade,
       m.quantidade,
       case when m.tipo in ('entrada', 'ajuste_entrada', 'transferencia_entrada', 'devolucao') then m.quantidade else -m.quantidade end as quantidade_sinal,
       m.custo_unitario,
       m.observacao,
       public.fn_nome_usuario(m.criado_por) as usuario_nome
  from public.estoque_movimentos m
  join public.depositos d on d.id = m.deposito_id
  join public.produtos pr on pr.id = m.produto_id
  left join public.lotes lo on lo.id = m.lote_id;

-- ---------------------------------------------------------------------
-- Funções internas fora da API; ações liberadas só para quem está logado
-- ---------------------------------------------------------------------
revoke execute on function public.fn_credito_motivo(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_reservar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_liberar_reservas(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_obter(uuid) from public, anon, authenticated;
revoke execute on function public.fn_lote_obter(uuid, text, date, date) from public, anon, authenticated;
revoke execute on function public.fn_exigir(text, text) from public, anon, authenticated;
revoke execute on function public.fn_nome_usuario(uuid) from public, anon;
grant execute on function public.fn_nome_usuario(uuid) to authenticated;

do $$ declare f text; begin foreach f in array array[
  'pedido_confirmar(uuid)', 'pedido_reabrir(uuid)', 'pedido_cancelar(uuid, text)',
  'pedido_liberar_credito(uuid)', 'pedido_recusar_credito(uuid, text)', 'orcamento_converter(uuid)',
  'estoque_entrada(uuid, uuid, numeric, text, date, date, numeric, text)',
  'estoque_movimentar(uuid, text, numeric, text, uuid)',
  'inventario_abrir(uuid, text)', 'inventario_concluir(uuid)', 'inventario_cancelar(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
