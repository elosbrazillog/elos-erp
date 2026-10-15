-- =====================================================================
-- Fase 4c · Alteração de pedido pelo vendedor, faturamento em lote e boletos
-- Pedido não faturado pode ser alterado (itens e pagamento) pelo vendedor,
-- inclusive pelo app sem sinal. Faturar trava o pedido, gera as contas a
-- receber e os boletos (pendentes até o registro no Sicredi).
-- =====================================================================

alter table public.pedidos
  add column if not exists faturado_em timestamptz,
  add column if not exists faturado_por uuid,
  add column if not exists alteracao_id_local text;

-- Faturamento só muda pelas ações; pedido faturado não muda mais
create or replace function public.fn_pedido_faturado_protege()
returns trigger
language plpgsql
as $$
begin
  if public.fn_via_regra() then
    return new;
  end if;
  if (new.faturado_em, new.faturado_por) is distinct from (old.faturado_em, old.faturado_por) then
    raise exception 'O faturamento só muda pelas ações de faturar e estornar.';
  end if;
  if old.faturado_em is not null
     and (new.cliente_id, new.condicao_pagamento_id, new.forma_pagamento_id, new.valor_desconto, new.valor_frete, new.tabela_preco_id)
         is distinct from
         (old.cliente_id, old.condicao_pagamento_id, old.forma_pagamento_id, old.valor_desconto, old.valor_frete, old.tabela_preco_id) then
    raise exception 'Pedido faturado não pode ser alterado.';
  end if;
  return new;
end;
$$;
create trigger trg_pedidos_faturado_protege before update on public.pedidos
  for each row execute function public.fn_pedido_faturado_protege();

-- Reabrir: não vale para faturado; pedido em carga ainda montando sai da carga
create or replace function public.pedido_reabrir(p_pedido uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.pedidos;
  v_carga record;
begin
  perform public.fn_exigir('vendas', 'editar');
  p := public.fn_pedido_obter(p_pedido);
  if p.faturado_em is not null then
    raise exception 'Pedido já faturado: não pode mais ser alterado.';
  end if;
  if p.status = 'em_separacao' then
    select e.id, e.numero, e.status into v_carga
      from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
     where ep.pedido_id = p.id and e.status in ('montando', 'separando')
     limit 1;
    if v_carga.status = 'separando' then
      raise exception 'O pedido já está sendo separado na carga nº %. Peça à expedição para tirá-lo da carga.', v_carga.numero;
    end if;
    delete from public.expedicoes_pedidos where pedido_id = p.id and expedicao_id = v_carga.id;
  elsif p.status not in ('aguardando_credito', 'aprovado') then
    raise exception 'Só pedidos aguardando crédito ou aprovados podem ser reabertos.';
  end if;
  perform public.fn_pedido_liberar_reservas(p.id);
  update public.pedidos
     set status = 'rascunho', motivo_trava = null, credito_liberado_por = null, credito_liberado_em = null
   where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Cancelar: faturado precisa estornar o faturamento antes
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
  if p.faturado_em is not null then
    raise exception 'Pedido faturado: estorne o faturamento antes de cancelar.';
  end if;
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
-- Boletos (um por título de pedido com forma que gera boleto)
-- ---------------------------------------------------------------------
-- A tabela boletos já existe (fase 1, sem uso até aqui): ganha o vínculo com o pedido,
-- a situação "cancelado" e passa a ser gravada só pelas funções.
alter table public.boletos
  add column if not exists pedido_id uuid references public.pedidos(id),
  add column if not exists txid text,
  add column if not exists registrado_em timestamptz,
  add column if not exists cancelado_em timestamptz;
alter table public.boletos alter column conta_bancaria_id drop not null;
alter table public.boletos drop constraint if exists boletos_status_check;
alter table public.boletos add constraint boletos_status_check
  check (status in ('pendente', 'registrado', 'pago', 'baixado', 'vencido', 'erro', 'cancelado'));
create unique index if not exists boletos_lancamento_ativo_un on public.boletos (lancamento_id) where status <> 'cancelado';
create index if not exists boletos_pedido_idx on public.boletos (pedido_id);
create index if not exists boletos_status_idx on public.boletos (empresa_id, status);
drop policy if exists "boletos_ver" on public.boletos;
drop policy if exists "boletos_criar" on public.boletos;
drop policy if exists "boletos_editar" on public.boletos;
drop policy if exists "boletos_excluir" on public.boletos;
create policy "boletos_ver" on public.boletos for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('financeiro', 'ver') or public.tem_permissao('fiscal', 'ver')
              or (public.tem_permissao('vendas', 'ver')
                  and (public.fn_carteira() is null
                       or exists (select 1 from public.pedidos p where p.id = pedido_id and p.vendedor_id = public.fn_carteira())))));

-- Cria os boletos que faltam para os títulos em aberto do pedido
create or replace function public.fn_pedido_gerar_boletos(p_pedido uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.boletos (empresa_id, lancamento_id, pedido_id, conta_bancaria_id, valor, data_vencimento)
  select l.empresa_id, l.id, p_pedido, l.conta_bancaria_id, l.valor, l.data_vencimento
    from public.lancamentos l
    join public.formas_pagamento fp on fp.id = l.forma_pagamento_id and fp.gera_boleto
   where l.origem = 'pedido' and l.origem_id = p_pedido and l.ativo and l.data_quitacao is null
     and not exists (select 1 from public.boletos b where b.lancamento_id = l.id and b.status <> 'cancelado');
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Título cancelado leva o boleto junto
create or replace function public.fn_lancamento_boleto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ativo and not new.ativo then
    update public.boletos set status = 'cancelado', cancelado_em = now(),
           mensagem_erro = case when status = 'registrado' then 'Título cancelado: pedir baixa do boleto no banco.' else mensagem_erro end
     where lancamento_id = new.id and status not in ('cancelado', 'pago');
  end if;
  return null;
end;
$$;
create trigger trg_lancamentos_boleto after update of ativo on public.lancamentos
  for each row execute function public.fn_lancamento_boleto();

-- Pedido faturado que volta por cliente ausente mantém os títulos (a venda continua de pé)
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
  elsif new.status = 'aprovado' and old.status = 'em_rota' and new.faturado_em is null then
    perform public.fn_pedido_cancelar_titulos(new.id, 'Cliente ausente: título refeito na próxima saída');
  end if;
  perform set_config('elos.regra', coalesce(v_regra, ''), true);
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Faturamento
-- ---------------------------------------------------------------------
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
  perform set_config('elos.regra', '', true);
  return n;
end;
$$;

-- Fatura vários pedidos; o que não puder ser faturado volta com o motivo e não atrapalha os outros
create or replace function public.pedido_faturar_lote(p_pedidos uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_ok integer := 0;
  v_bol integer := 0;
  v_erros jsonb := '[]'::jsonb;
  v_num bigint;
begin
  perform public.fn_exigir('fiscal', 'editar');
  if coalesce(cardinality(p_pedidos), 0) = 0 then raise exception 'Selecione ao menos um pedido.'; end if;
  foreach v_id in array p_pedidos loop
    begin
      v_bol := v_bol + public.fn_pedido_faturar(v_id);
      v_ok := v_ok + 1;
    exception when others then
      select numero into v_num from public.pedidos where id = v_id;
      v_erros := v_erros || jsonb_build_object('pedido_id', v_id, 'numero', v_num, 'motivo', sqlerrm);
    end;
  end loop;
  perform set_config('elos.regra', '', true);
  return jsonb_build_object('faturados', v_ok, 'boletos', v_bol, 'erros', v_erros);
end;
$$;

-- Desfaz o faturamento: só sem título pago e sem boleto já registrado no banco
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
  perform set_config('elos.regra', '1', true);
  update public.boletos set status = 'cancelado', cancelado_em = now() where pedido_id = p.id and status in ('pendente', 'erro');
  update public.pedidos set faturado_em = null, faturado_por = null where id = p.id;
  perform set_config('elos.regra', '', true);
end;
$$;

-- Pedidos com o que importa para faturar e imprimir boletos
drop view if exists public.vw_pedidos;
create view public.vw_pedidos
with (security_invoker = true)
as
select pe.*,
       c.codigo as cliente_codigo,
       c.razao_social as cliente_nome,
       c.nome_fantasia as cliente_fantasia,
       v.razao_social as vendedor_nome,
       r.nome as rota_nome,
       (select count(*) from public.pedidos_itens i where i.pedido_id = pe.id and i.ativo) as qtd_itens,
       cp.nome as condicao_nome,
       fp.nome as forma_nome,
       coalesce(fp.gera_boleto, false) as gera_boleto
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id;

-- Fila de faturamento: pedidos aprovados em diante ainda sem faturar, com a carga em que estão
create or replace view public.vw_faturamento
as
select pe.id, pe.numero, pe.status, pe.data_emissao, pe.data_entrega, pe.valor_total, pe.faturado_em,
       c.razao_social as cliente_nome, c.nome_fantasia as cliente_fantasia, c.documento as cliente_documento,
       v.razao_social as vendedor_nome, r.nome as rota_nome, pe.rota_id, pe.vendedor_id,
       cp.nome as condicao_nome, fp.nome as forma_nome, coalesce(fp.gera_boleto, false) as gera_boleto,
       ca.id as carga_id, ca.numero as carga_numero,
       (select count(*) from public.boletos b where b.pedido_id = pe.id and b.status <> 'cancelado') as boletos,
       (select count(*) from public.boletos b where b.pedido_id = pe.id and b.status = 'registrado') as boletos_registrados
  from public.pedidos pe
  join public.pessoas c on c.id = pe.cliente_id
  left join public.pessoas v on v.id = pe.vendedor_id
  left join public.rotas r on r.id = pe.rota_id
  left join public.condicoes_pagamento cp on cp.id = pe.condicao_pagamento_id
  left join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
  left join lateral (
    select e.id, e.numero from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
     where ep.pedido_id = pe.id and e.status <> 'cancelada' order by e.criado_em desc limit 1
  ) ca on true
 where pe.empresa_id = public.empresa_atual() and pe.tipo = 'pedido' and pe.ativo
   and pe.status in ('aprovado', 'em_separacao', 'em_rota', 'entregue')
   and (public.tem_permissao('fiscal', 'ver') or public.tem_permissao('financeiro', 'ver'));
revoke all on public.vw_faturamento from public, anon;
grant select on public.vw_faturamento to authenticated;

-- Boletos para impressão: título, pagador, beneficiário e conta
create or replace view public.vw_boletos
as
select b.id, b.status, b.nosso_numero, b.linha_digitavel, b.codigo_barras, b.pix_copia_cola, b.mensagem_erro as erro, b.registrado_em,
       b.pedido_id, pe.numero as pedido_numero, pe.vendedor_id,
       l.id as lancamento_id, l.valor, l.data_vencimento, l.data_competencia, l.documento, l.parcela, l.total_parcelas, l.data_quitacao,
       c.razao_social as pagador_nome, c.documento as pagador_documento,
       en.logradouro as pagador_logradouro, en.numero as pagador_numero, en.complemento as pagador_complemento,
       en.bairro as pagador_bairro, en.cidade as pagador_cidade, en.uf as pagador_uf, en.cep as pagador_cep,
       cb.nome as conta_nome, cb.banco_codigo, cb.agencia, cb.posto, cb.conta, cb.sicredi_codigo_beneficiario,
       em.razao_social as beneficiario_nome, em.cnpj as beneficiario_cnpj,
       concat_ws(', ', em.logradouro, em.numero, em.bairro) as beneficiario_endereco, em.cidade as beneficiario_cidade, em.uf as beneficiario_uf
  from public.boletos b
  join public.lancamentos l on l.id = b.lancamento_id
  join public.empresas em on em.id = b.empresa_id
  left join public.pedidos pe on pe.id = b.pedido_id
  left join public.pessoas c on c.id = l.pessoa_id
  left join lateral (
    select * from public.pessoas_enderecos x where x.pessoa_id = c.id and x.ativo
     order by (x.tipo = 'cobranca') desc, (x.tipo = 'principal') desc, x.criado_em limit 1
  ) en on true
  left join public.contas_bancarias cb on cb.id = b.conta_bancaria_id
 where b.empresa_id = public.empresa_atual()
   and (public.tem_permissao('financeiro', 'ver') or public.tem_permissao('fiscal', 'ver')
        or (public.tem_permissao('vendas', 'ver') and (public.fn_carteira() is null or pe.vendedor_id = public.fn_carteira())));
revoke all on public.vw_boletos from public, anon;
grant select on public.vw_boletos to authenticated;

-- ---------------------------------------------------------------------
-- App do vendedor: pagamento, consulta e alteração de pedido
-- ---------------------------------------------------------------------

-- Condições e formas de pagamento para escolher no celular
create or replace function public.app_pagamentos()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
begin
  perform public.fn_exigir('vendas', 'ver');
  return jsonb_build_object(
    'condicoes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) order by nome), '[]'::jsonb)
                    from public.condicoes_pagamento where empresa_id = v_emp and ativo),
    'formas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'gera_boleto', gera_boleto) order by nome), '[]'::jsonb)
                 from public.formas_pagamento where empresa_id = v_emp and ativo));
end;
$$;

-- Carteira passa a trazer a condição e a forma padrão de cada cliente
drop function if exists public.app_carteira();
create function public.app_carteira()
returns table (
  id uuid, codigo bigint, nome text, razao_social text, documento text, telefone text, whatsapp text,
  endereco text, bairro text, cidade text, latitude numeric, longitude numeric,
  rota_id uuid, rota_nome text, dias_semana smallint[], ordem_visita integer, tabela_preco_id uuid,
  condicao_nome text, forma_nome text, bloqueado boolean, motivo_bloqueio text,
  limite_credito numeric, em_aberto numeric, em_atraso numeric,
  ultimo_pedido_data date, ultimo_pedido_numero bigint, ultimo_pedido_valor numeric, ultimo_itens jsonb,
  visita_hoje text, condicao_pagamento_id uuid, forma_pagamento_id uuid)
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
            from public.visitas vi where vi.cliente_id = c.id and vi.data = current_date having count(*) > 0),
         c.condicao_pagamento_id, c.forma_pagamento_id
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

-- Grava itens e pagamento no pedido em rascunho e tenta confirmar
create or replace function public.fn_app_gravar_pedido(
  p_pedido uuid, p_itens jsonb, p_condicao uuid, p_forma uuid, p_observacao text, p_data_entrega date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  it jsonb;
  v_ordem integer := 0;
  v_res jsonb;
  v_ped public.pedidos;
begin
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if p_condicao is not null and not exists (select 1 from public.condicoes_pagamento where id = p_condicao and empresa_id = v_emp and ativo) then
    raise exception 'Condição de pagamento inválida.';
  end if;
  if p_forma is not null and not exists (select 1 from public.formas_pagamento where id = p_forma and empresa_id = v_emp and ativo) then
    raise exception 'Forma de pagamento inválida.';
  end if;

  perform set_config('elos.regra', '1', true);
  delete from public.pedidos_itens where pedido_id = p_pedido;
  for it in select * from jsonb_array_elements(p_itens) loop
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    if not exists (select 1 from public.produtos where id = (it->>'produto_id')::uuid and empresa_id = v_emp and ativo) then
      raise exception 'Produto não encontrado ou inativo.';
    end if;
    v_ordem := v_ordem + 1;
    insert into public.pedidos_itens (empresa_id, pedido_id, produto_id, quantidade, preco_unitario, ordem)
    values (v_emp, p_pedido, (it->>'produto_id')::uuid, (it->>'quantidade')::numeric, nullif(it->>'preco', '')::numeric, v_ordem);
  end loop;
  if v_ordem = 0 then raise exception 'O pedido não tem itens com quantidade.'; end if;
  update public.pedidos
     set condicao_pagamento_id = coalesce(p_condicao, condicao_pagamento_id),
         forma_pagamento_id = coalesce(p_forma, forma_pagamento_id),
         observacao = nullif(trim(p_observacao), ''),
         data_entrega = p_data_entrega,
         motivo_trava = null
   where id = p_pedido;
  perform public.fn_pedido_recalcula(p_pedido);
  perform set_config('elos.regra', '', true);

  begin
    v_res := public.pedido_confirmar(p_pedido);
  exception when others then
    perform set_config('elos.regra', '1', true);
    update public.pedidos set motivo_trava = 'Enviado pelo app e não confirmado: ' || sqlerrm where id = p_pedido;
    perform set_config('elos.regra', '', true);
  end;
  select * into v_ped from public.pedidos where id = p_pedido;
  return jsonb_build_object('pedido_id', v_ped.id, 'numero', v_ped.numero, 'status', v_ped.status,
                            'motivo', coalesce(v_ped.motivo_trava, v_res->>'motivo'));
end;
$$;

-- Novo pedido do celular, agora com a forma e a condição escolhidas
drop function if exists public.app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric);
create function public.app_enviar_pedido(
  p_id_local text, p_cliente uuid, p_itens jsonb,
  p_observacao text default null, p_data_entrega date default null,
  p_lat numeric default null, p_lng numeric default null,
  p_condicao uuid default null, p_forma uuid default null)
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

  insert into public.pedidos (empresa_id, cliente_id, origem, id_local, condicao_pagamento_id, forma_pagamento_id)
  values (v_emp, p_cliente, 'app', p_id_local, p_condicao, p_forma)
  returning id into v_id;
  v_res := public.fn_app_gravar_pedido(v_id, p_itens, p_condicao, p_forma, p_observacao, p_data_entrega);

  insert into public.visitas (empresa_id, id_local, cliente_id, vendedor_id, usuario_id, resultado, pedido_id, latitude, longitude)
  select v_emp, 'pedido:' || p_id_local, p_cliente, pe.vendedor_id, auth.uid(), 'pedido', v_id, p_lat, p_lng
    from public.pedidos pe where pe.id = v_id
  on conflict (empresa_id, id_local) do nothing;

  return v_res || jsonb_build_object('ja_existia', false);
end;
$$;

-- Alteração pelo vendedor enquanto o pedido não foi faturado (itens, pagamento, entrega, observação).
-- p_id_envio evita refazer a mesma alteração quando o celular reenviar.
create or replace function public.app_alterar_pedido(
  p_pedido uuid, p_id_envio text, p_itens jsonb,
  p_condicao uuid default null, p_forma uuid default null,
  p_observacao text default null, p_data_entrega date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  p public.pedidos;
  v_saiu_carga boolean := false;
  v_res jsonb;
begin
  perform public.fn_exigir('vendas', 'editar');
  if coalesce(trim(p_id_envio), '') = '' then raise exception 'Identificador da alteração ausente.'; end if;
  select * into p from public.pedidos where id = p_pedido and empresa_id = public.empresa_atual() and ativo;
  if not found or (v_cart is not null and p.vendedor_id is distinct from v_cart) then
    raise exception 'Pedido não encontrado.';
  end if;
  if p.alteracao_id_local = p_id_envio then
    return jsonb_build_object('pedido_id', p.id, 'numero', p.numero, 'status', p.status, 'motivo', p.motivo_trava, 'ja_existia', true);
  end if;
  if p.faturado_em is not null then
    raise exception 'O pedido nº % já foi faturado e não pode mais ser alterado. Fale com o escritório.', p.numero;
  end if;
  if p.status not in ('rascunho', 'aguardando_credito', 'aprovado', 'em_separacao') then
    raise exception 'O pedido nº % não pode mais ser alterado (situação: %).', p.numero, p.status;
  end if;
  if p.status <> 'rascunho' then
    v_saiu_carga := p.status = 'em_separacao';
    perform public.pedido_reabrir(p.id);
  end if;
  v_res := public.fn_app_gravar_pedido(p.id, p_itens, p_condicao, p_forma, p_observacao, p_data_entrega);
  perform set_config('elos.regra', '1', true);
  update public.pedidos set alteracao_id_local = p_id_envio where id = p.id;
  perform set_config('elos.regra', '', true);
  return v_res || jsonb_build_object('ja_existia', false, 'saiu_da_carga', v_saiu_carga);
end;
$$;

-- Detalhe do pedido para o celular
create or replace function public.app_pedido(p_pedido uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cart uuid := public.fn_carteira();
  r jsonb;
begin
  perform public.fn_exigir('vendas', 'ver');
  select jsonb_build_object(
    'id', p.id, 'numero', p.numero, 'status', p.status, 'data_emissao', p.data_emissao, 'data_entrega', p.data_entrega,
    'cliente_id', p.cliente_id, 'cliente_nome', coalesce(c.nome_fantasia, c.razao_social),
    'condicao_pagamento_id', p.condicao_pagamento_id, 'condicao_nome', cp.nome,
    'forma_pagamento_id', p.forma_pagamento_id, 'forma_nome', fp.nome,
    'observacao', p.observacao, 'motivo_trava', p.motivo_trava, 'valor_total', p.valor_total,
    'faturado_em', p.faturado_em, 'origem', p.origem,
    'pode_alterar', p.faturado_em is null and (p.status in ('rascunho', 'aguardando_credito', 'aprovado')
                      or (p.status = 'em_separacao' and exists (
                            select 1 from public.expedicoes_pedidos ep join public.expedicoes e on e.id = ep.expedicao_id
                             where ep.pedido_id = p.id and e.status = 'montando'))),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('produto_id', i.produto_id, 'codigo', pr.codigo, 'nome', pr.nome,
                       'quantidade', i.quantidade, 'preco', i.preco_unitario, 'total', i.valor_total) order by i.ordem), '[]'::jsonb)
                from public.pedidos_itens i join public.produtos pr on pr.id = i.produto_id
               where i.pedido_id = p.id and i.ativo),
    'titulos', (select coalesce(jsonb_agg(jsonb_build_object('parcela', l.parcela, 'total_parcelas', l.total_parcelas, 'valor', l.valor,
                       'vencimento', l.data_vencimento, 'quitado', l.data_quitacao is not null) order by l.parcela), '[]'::jsonb)
                  from public.lancamentos l where l.origem = 'pedido' and l.origem_id = p.id and l.ativo))
    into r
    from public.pedidos p
    join public.pessoas c on c.id = p.cliente_id
    left join public.condicoes_pagamento cp on cp.id = p.condicao_pagamento_id
    left join public.formas_pagamento fp on fp.id = p.forma_pagamento_id
   where p.id = p_pedido and p.empresa_id = public.empresa_atual() and p.ativo
     and (v_cart is null or p.vendedor_id = v_cart);
  if r is null then raise exception 'Pedido não encontrado.'; end if;
  return r;
end;
$$;

revoke execute on function public.fn_pedido_gerar_boletos(uuid) from public, anon, authenticated;
revoke execute on function public.fn_pedido_faturar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_app_gravar_pedido(uuid, jsonb, uuid, uuid, text, date) from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'pedido_reabrir(uuid)', 'pedido_cancelar(uuid, text)',
  'pedido_faturar_lote(uuid[])', 'pedido_estornar_faturamento(uuid, text)',
  'app_pagamentos()', 'app_carteira()',
  'app_enviar_pedido(text, uuid, jsonb, text, date, numeric, numeric, uuid, uuid)',
  'app_alterar_pedido(uuid, text, jsonb, uuid, uuid, text, date)', 'app_pedido(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
