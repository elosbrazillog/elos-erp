-- =====================================================================
-- Fase 4f · Despesas da expedição (frota)
-- Combustível exige km atual, litros e preço do litro; o sistema calcula
-- o valor, os km rodados desde o último abastecimento e o consumo.
-- =====================================================================

create table public.despesas_frota (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null default current_date,
  categoria text not null check (categoria in ('combustivel', 'manutencao', 'pneu', 'pedagio', 'alimentacao', 'estacionamento', 'lavagem', 'multa', 'outros')),
  veiculo_id uuid references public.veiculos(id),
  motorista_id uuid references public.pessoas(id),
  expedicao_id uuid references public.expedicoes(id) on delete set null,
  descricao text,
  valor numeric(14,2) not null check (valor > 0),
  pago_pelo_motorista boolean not null default false,
  -- combustível
  km_atual integer check (km_atual is null or km_atual >= 0),
  litros numeric(10,3) check (litros is null or litros > 0),
  preco_litro numeric(10,3) check (preco_litro is null or preco_litro > 0),
  combustivel text check (combustivel in ('diesel', 'diesel_s10', 'gasolina', 'etanol', 'gnv')),
  tanque_cheio boolean not null default true,
  posto text,
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  constraint despesas_frota_combustivel_ck check (
    categoria <> 'combustivel' or (veiculo_id is not null and km_atual is not null and litros is not null and preco_litro is not null))
);
create index despesas_frota_veiculo_idx on public.despesas_frota (veiculo_id, km_atual) where ativo;
create index despesas_frota_data_idx on public.despesas_frota (empresa_id, data);
create index despesas_frota_carga_idx on public.despesas_frota (expedicao_id);
alter table public.despesas_frota enable row level security;
create policy "despesas_frota_ver" on public.despesas_frota for select to authenticated
  using (empresa_id = public.empresa_atual() and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver')));

-- Lança a despesa. No combustível o valor é litros × preço do litro.
create or replace function public.despesa_frota_lancar(
  p_categoria text, p_valor numeric, p_data date default null, p_veiculo uuid default null, p_motorista uuid default null,
  p_expedicao uuid default null, p_descricao text default null, p_pago_pelo_motorista boolean default false,
  p_km_atual integer default null, p_litros numeric default null, p_preco_litro numeric default null,
  p_combustivel text default null, p_tanque_cheio boolean default true, p_posto text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_ultimo integer;
  v_valor numeric;
  v_id uuid;
begin
  perform public.fn_exigir('expedicao', 'editar');
  if p_categoria not in ('combustivel', 'manutencao', 'pneu', 'pedagio', 'alimentacao', 'estacionamento', 'lavagem', 'multa', 'outros') then
    raise exception 'Categoria de despesa inválida.';
  end if;
  if coalesce(p_data, current_date) > current_date then raise exception 'A data da despesa não pode ser futura.'; end if;
  if p_veiculo is not null and not exists (select 1 from public.veiculos where id = p_veiculo and empresa_id = v_emp) then
    raise exception 'Veículo não encontrado.';
  end if;
  if p_motorista is not null and not exists (select 1 from public.pessoas where id = p_motorista and empresa_id = v_emp) then
    raise exception 'Motorista não encontrado.';
  end if;
  if p_expedicao is not null and not exists (select 1 from public.expedicoes where id = p_expedicao and empresa_id = v_emp) then
    raise exception 'Carga não encontrada.';
  end if;

  if p_categoria = 'combustivel' then
    if p_veiculo is null then raise exception 'No combustível, informe o veículo.'; end if;
    if p_km_atual is null or p_km_atual <= 0 then raise exception 'No combustível, informe o km atual do veículo.'; end if;
    if coalesce(p_litros, 0) <= 0 then raise exception 'No combustível, informe os litros abastecidos.'; end if;
    if coalesce(p_preco_litro, 0) <= 0 then raise exception 'No combustível, informe o valor pago no litro.'; end if;
    select max(km_atual) into v_ultimo from public.despesas_frota
     where veiculo_id = p_veiculo and ativo and categoria = 'combustivel' and data <= coalesce(p_data, current_date);
    if v_ultimo is not null and p_km_atual <= v_ultimo then
      raise exception 'O km atual (%) precisa ser maior que o do último abastecimento deste veículo (%).', p_km_atual, v_ultimo;
    end if;
    v_valor := round(p_litros * p_preco_litro, 2);
  else
    if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor da despesa.'; end if;
    if p_categoria = 'outros' and coalesce(trim(p_descricao), '') = '' then raise exception 'Descreva a despesa.'; end if;
    v_valor := round(p_valor, 2);
  end if;

  insert into public.despesas_frota (empresa_id, data, categoria, veiculo_id, motorista_id, expedicao_id, descricao, valor, pago_pelo_motorista,
    km_atual, litros, preco_litro, combustivel, tanque_cheio, posto, criado_por)
  values (v_emp, coalesce(p_data, current_date), p_categoria, p_veiculo, p_motorista, p_expedicao, nullif(trim(p_descricao), ''), v_valor,
    coalesce(p_pago_pelo_motorista, false),
    case when p_categoria = 'combustivel' then p_km_atual end, case when p_categoria = 'combustivel' then p_litros end,
    case when p_categoria = 'combustivel' then p_preco_litro end, case when p_categoria = 'combustivel' then p_combustivel end,
    coalesce(p_tanque_cheio, true), nullif(trim(p_posto), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.despesa_frota_excluir(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('expedicao', 'editar');
  if exists (select 1 from public.despesas_frota d join public.acertos a on a.expedicao_id = d.expedicao_id
              where d.id = p_id and d.pago_pelo_motorista) then
    raise exception 'Esta despesa já entrou no acerto da carga. Desfaça o acerto antes.';
  end if;
  update public.despesas_frota set ativo = false where id = p_id and empresa_id = public.empresa_atual() and ativo;
  if not found then raise exception 'Despesa não encontrada.'; end if;
end;
$$;

-- Lista com km rodados e consumo desde o abastecimento anterior do mesmo veículo
create or replace view public.vw_despesas_frota
as
select d.id, d.data, d.categoria, d.descricao, d.valor, d.pago_pelo_motorista, d.km_atual, d.litros, d.preco_litro, d.combustivel,
       d.tanque_cheio, d.posto, d.criado_em, d.veiculo_id, d.motorista_id, d.expedicao_id,
       v.placa as veiculo_placa, v.descricao as veiculo_descricao, m.razao_social as motorista_nome, e.numero as carga_numero,
       ant.km_atual as km_anterior,
       case when d.categoria = 'combustivel' and ant.km_atual is not null then d.km_atual - ant.km_atual end as km_rodados,
       case when d.categoria = 'combustivel' and ant.km_atual is not null and d.tanque_cheio
            then round((d.km_atual - ant.km_atual) / d.litros, 2) end as km_por_litro,
       case when d.categoria = 'combustivel' and ant.km_atual is not null and d.km_atual > ant.km_atual
            then round(d.valor / (d.km_atual - ant.km_atual), 3) end as custo_km
  from public.despesas_frota d
  left join public.veiculos v on v.id = d.veiculo_id
  left join public.pessoas m on m.id = d.motorista_id
  left join public.expedicoes e on e.id = d.expedicao_id
  left join lateral (
    select x.km_atual from public.despesas_frota x
     where x.veiculo_id = d.veiculo_id and x.categoria = 'combustivel' and x.ativo and x.id <> d.id
       and x.km_atual < d.km_atual
     order by x.km_atual desc limit 1
  ) ant on d.categoria = 'combustivel'
 where d.empresa_id = public.empresa_atual() and d.ativo
   and (public.tem_permissao('expedicao', 'ver') or public.tem_permissao('financeiro', 'ver'));
revoke all on public.vw_despesas_frota from public, anon;
grant select on public.vw_despesas_frota to authenticated;

do $$ declare f text; begin foreach f in array array[
  'despesa_frota_lancar(text, numeric, date, uuid, uuid, uuid, text, boolean, integer, numeric, numeric, text, boolean, text)',
  'despesa_frota_excluir(uuid)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;
