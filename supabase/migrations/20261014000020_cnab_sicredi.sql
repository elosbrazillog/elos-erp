-- =====================================================================
-- Fase 5d · Boletos Sicredi por arquivo de remessa e retorno (CNAB 400)
-- O ERP numera o boleto (nosso número, código de barras e linha
-- digitável), gera o arquivo .CRM para enviar ao Sicredi e lê o arquivo
-- de retorno (.CRT) para registrar, baixar e quitar os títulos.
-- =====================================================================

alter table public.contas_bancarias
  add column if not exists cnab_byte integer not null default 5 check (cnab_byte between 2 and 9),
  add column if not exists cnab_ano integer,
  add column if not exists cnab_proximo_numero integer not null default 1 check (cnab_proximo_numero between 1 and 99999),
  add column if not exists cnab_ultima_remessa integer not null default 0 check (cnab_ultima_remessa >= 0),
  add column if not exists boleto_multa numeric(5,2) not null default 5 check (boleto_multa between 0 and 99),
  add column if not exists boleto_juros_dia numeric(6,3) not null default 0.10 check (boleto_juros_dia between 0 and 99),
  add column if not exists boleto_hibrido boolean not null default true,
  add column if not exists boleto_protesto_dias integer not null default 0 check (boleto_protesto_dias = 0 or boleto_protesto_dias between 3 and 99);

-- A conta Sicredi já usada pelo sistema anterior: a última remessa enviada foi a 4
update public.contas_bancarias set cnab_ultima_remessa = 4
 where banco_codigo = '748' and sicredi_codigo_beneficiario = '72189' and cnab_ultima_remessa = 0;

create table public.cnab_remessas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_bancaria_id uuid not null references public.contas_bancarias(id),
  numero integer not null,
  nome_arquivo text not null,
  conteudo text not null,
  qtd_registros integer not null,
  qtd_baixas integer not null default 0,
  valor_total numeric(14,2) not null,
  criado_em timestamptz not null default now(),
  criado_por uuid
);
create table public.cnab_retornos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_bancaria_id uuid references public.contas_bancarias(id),
  nome_arquivo text,
  hash text not null,
  data_arquivo date,
  numero integer,
  resumo jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  criado_por uuid,
  unique (empresa_id, hash)
);
alter table public.cnab_remessas enable row level security;
alter table public.cnab_retornos enable row level security;
create policy "cnab_remessas_ver" on public.cnab_remessas for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('financeiro', 'ver'));
create policy "cnab_retornos_ver" on public.cnab_retornos for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('financeiro', 'ver'));

alter table public.boletos
  add column if not exists seu_numero text,
  add column if not exists remessa_id uuid references public.cnab_remessas(id),
  add column if not exists instrucao text check (instrucao in ('baixa')),
  add column if not exists ocorrencia text,
  add column if not exists retorno_em timestamptz,
  add column if not exists codigo_pagador text;
alter table public.boletos drop constraint if exists boletos_status_check;
alter table public.boletos add constraint boletos_status_check
  check (status in ('pendente', 'enviado', 'registrado', 'pago', 'baixado', 'vencido', 'erro', 'cancelado'));

-- ---------------------------------------------------------------------
-- Cálculos do boleto
-- ---------------------------------------------------------------------
-- Soma ponderada 2..9 da direita para a esquerda (módulo 11)
create or replace function public.fn_mod11_soma(p text)
returns integer
language plpgsql
immutable
as $$
declare s integer := 0; w integer := 2; i integer;
begin
  for i in reverse length(p)..1 loop
    s := s + substr(p, i, 1)::integer * w;
    w := case when w = 9 then 2 else w + 1 end;
  end loop;
  return s;
end;
$$;

create or replace function public.fn_mod10(p text)
returns integer
language plpgsql
immutable
as $$
declare s integer := 0; w integer := 2; i integer; x integer;
begin
  for i in reverse length(p)..1 loop
    x := substr(p, i, 1)::integer * w;
    s := s + (x / 10) + (x % 10);
    w := case when w = 2 then 1 else 2 end;
  end loop;
  return (10 - s % 10) % 10;
end;
$$;

-- Texto aceito pelo banco: sem acentos nem caracteres especiais, no tamanho exato
create or replace function public.fn_cnab_texto(p text, p_tam integer)
returns text
language sql
immutable
as $$
  select rpad(substr(regexp_replace(
           translate(coalesce(p, ''), 'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑºª°&',
                                      'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCNoaoE'),
           '[^A-Za-z0-9 ,.()/-]', ' ', 'g'), 1, p_tam), p_tam, ' ');
$$;

create or replace function public.fn_cnab_num(p numeric, p_tam integer)
returns text
language sql
immutable
as $$ select lpad(coalesce(p, 0)::bigint::text, p_tam, '0'); $$;

-- Numera um boleto: nosso número, código de barras e linha digitável (Sicredi)
create or replace function public.fn_boleto_numerar(p_boleto uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.boletos;
  c public.contas_bancarias;
  l public.lancamentos;
  v_ano integer := extract(year from current_date)::integer % 100;
  v_seq integer;
  v_nn text;
  v_cl text;
  v_fator integer;
  v_valor text;
  v_sem_dv text;
  v_dv integer;
  v_barras text;
  r integer;
  v_seu text;
  v_num integer;
begin
  select * into b from public.boletos where id = p_boleto for update;
  if not found or b.nosso_numero is not null or b.status not in ('pendente', 'erro') then return; end if;
  select * into c from public.contas_bancarias
   where id = coalesce(b.conta_bancaria_id, (select id from public.contas_bancarias x
                                               where x.empresa_id = b.empresa_id and x.ativo and x.emite_boleto and x.banco_codigo = '748'
                                               order by x.criado_em limit 1))
   for update;
  if not found or c.banco_codigo is distinct from '748'
     or coalesce(c.agencia, '') !~ '^\d{4}$' or coalesce(c.posto, '') !~ '^\d{1,2}$'
     or coalesce(c.sicredi_codigo_beneficiario, '') !~ '^\d{5}$' then
    return;
  end if;
  select * into l from public.lancamentos where id = b.lancamento_id;

  -- Sequência por ano
  v_seq := case when c.cnab_ano is distinct from v_ano then 1 else c.cnab_proximo_numero end;
  if v_seq > 99999 then raise exception 'Acabou a numeração de boletos do ano no byte %. Troque o byte na conta.', c.cnab_byte; end if;
  update public.contas_bancarias set cnab_ano = v_ano, cnab_proximo_numero = v_seq + 1 where id = c.id;

  v_nn := lpad(v_ano::text, 2, '0') || c.cnab_byte::text || lpad(v_seq::text, 5, '0');
  r := 11 - public.fn_mod11_soma(c.agencia || lpad(c.posto, 2, '0') || c.sicredi_codigo_beneficiario || v_nn) % 11;
  v_nn := v_nn || case when r > 9 then 0 else r end::text;

  v_cl := '11' || v_nn || c.agencia || lpad(c.posto, 2, '0') || c.sicredi_codigo_beneficiario || case when b.valor > 0 then '1' else '0' end || '0';
  r := public.fn_mod11_soma(v_cl) % 11;
  v_cl := v_cl || case when r in (0, 1) then 0 else 11 - r end::text;

  v_fator := case when b.data_vencimento >= date '2025-02-22' then (b.data_vencimento - date '2025-02-22') + 1000
                  else b.data_vencimento - date '1997-10-07' end;
  if v_fator > 9999 then v_fator := ((v_fator - 1000) % 9000) + 1000; end if;
  v_valor := lpad(round(b.valor * 100)::bigint::text, 10, '0');
  v_sem_dv := '7489' || lpad(v_fator::text, 4, '0') || v_valor || v_cl;
  v_dv := 11 - public.fn_mod11_soma(v_sem_dv) % 11;
  if v_dv in (0, 1, 10, 11) then v_dv := 1; end if;
  v_barras := '7489' || v_dv::text || lpad(v_fator::text, 4, '0') || v_valor || v_cl;

  select numero into v_num from public.pedidos where id = b.pedido_id;
  v_seu := case when v_num is not null then 'P ' || v_num || case when coalesce(l.total_parcelas, 1) > 1 then '/' || l.parcela else '' end
                else coalesce(nullif(l.documento, ''), v_nn) end;

  update public.boletos set
    conta_bancaria_id = c.id,
    nosso_numero = substr(v_nn, 1, 2) || '/' || substr(v_nn, 3, 6) || '-' || substr(v_nn, 9, 1),
    codigo_barras = v_barras,
    linha_digitavel =
      substr(v_barras, 1, 4) || substr(v_cl, 1, 5) || public.fn_mod10(substr(v_barras, 1, 4) || substr(v_cl, 1, 5))::text ||
      substr(v_cl, 6, 10) || public.fn_mod10(substr(v_cl, 6, 10))::text ||
      substr(v_cl, 16, 10) || public.fn_mod10(substr(v_cl, 16, 10))::text ||
      v_dv::text || lpad(v_fator::text, 4, '0') || v_valor,
    seu_numero = substr(v_seu, 1, 10)
  where id = b.id;
end;
$$;

-- Boleto novo já sai numerado (quando a conta Sicredi está configurada)
create or replace function public.fn_boletos_numerar_novo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_boleto_numerar(new.id);
  return null;
end;
$$;
drop trigger if exists trg_boletos_numerar on public.boletos;
create trigger trg_boletos_numerar after insert on public.boletos
  for each row execute function public.fn_boletos_numerar_novo();

-- Título cancelado ou quitado fora do boleto: se o banco já tem o boleto, a baixa vai na próxima remessa
create or replace function public.fn_lancamento_boleto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ativo and not new.ativo then
    update public.boletos set
           instrucao = case when status in ('enviado', 'registrado') then 'baixa' end,
           status = 'cancelado', cancelado_em = now(),
           mensagem_erro = case when status in ('enviado', 'registrado') then 'Título cancelado: a baixa vai na próxima remessa.' else mensagem_erro end
     where lancamento_id = new.id and status not in ('cancelado', 'pago', 'baixado');
  elsif new.data_quitacao is not null and old.data_quitacao is null then
    update public.boletos set
           instrucao = case when status in ('enviado', 'registrado') then 'baixa' end,
           status = case when status in ('enviado', 'registrado') then status else 'cancelado' end,
           cancelado_em = case when status in ('enviado', 'registrado') then cancelado_em else now() end,
           mensagem_erro = case when status in ('enviado', 'registrado') then 'Título quitado fora do boleto: a baixa vai na próxima remessa.' else mensagem_erro end
     where lancamento_id = new.id and status not in ('cancelado', 'pago', 'baixado');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_lancamentos_boleto on public.lancamentos;
create trigger trg_lancamentos_boleto after update of ativo, data_quitacao on public.lancamentos
  for each row execute function public.fn_lancamento_boleto();

-- ---------------------------------------------------------------------
-- Remessa
-- ---------------------------------------------------------------------
create or replace function public.remessa_gerar(p_conta uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  c public.contas_bancarias;
  x record;
  v_linhas text[] := '{}';
  v_seq integer := 1;
  v_num integer;
  v_qtd integer := 0;
  v_baixas integer := 0;
  v_total numeric := 0;
  v_erros jsonb := '[]'::jsonb;
  v_erro text;
  v_doc text;
  v_cep text;
  v_nn text;
  v_txid text;
  v_ids uuid[] := '{}';
  v_mes text;
  v_nome text;
  v_hoje_qtd integer;
  v_id uuid;
  v_conteudo text;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into c from public.contas_bancarias
   where empresa_id = v_emp and ativo and id = coalesce(p_conta, (select id from public.contas_bancarias y where y.empresa_id = v_emp and y.ativo
                                                                    and y.emite_boleto and y.banco_codigo = '748' order by y.criado_em limit 1))
   for update;
  if not found then raise exception 'Cadastre a conta Sicredi que emite boletos (Financeiro → Contas bancárias).'; end if;
  if c.banco_codigo is distinct from '748' then raise exception 'A remessa deste layout é só para o Sicredi (banco 748).'; end if;
  if coalesce(c.agencia, '') !~ '^\d{4}$' or coalesce(c.posto, '') !~ '^\d{1,2}$' or coalesce(c.sicredi_codigo_beneficiario, '') !~ '^\d{5}$' then
    raise exception 'Complete cooperativa (4 dígitos), posto e código do beneficiário (5 dígitos) da conta %.', c.nome;
  end if;

  -- Boletos ainda sem número ganham agora
  for x in select b.id from public.boletos b join public.lancamentos l on l.id = b.lancamento_id
            where b.empresa_id = v_emp and b.status in ('pendente', 'erro') and b.nosso_numero is null
              and l.ativo and l.data_quitacao is null loop
    perform public.fn_boleto_numerar(x.id);
  end loop;

  for x in
    select b.*, l.data_competencia, l.ativo as l_ativo, l.data_quitacao,
           coalesce((pe.faturado_em at time zone 'America/Campo_Grande')::date, (b.criado_em at time zone 'America/Campo_Grande')::date) as emissao,
           p.razao_social, p.documento,
           en.logradouro, en.numero as end_numero, en.complemento, en.cep
      from public.boletos b
      join public.lancamentos l on l.id = b.lancamento_id
      left join public.pedidos pe on pe.id = b.pedido_id
      left join public.pessoas p on p.id = l.pessoa_id
      left join lateral (select * from public.pessoas_enderecos e where e.pessoa_id = p.id and e.ativo
                          order by (e.tipo = 'cobranca') desc, (e.tipo = 'principal') desc, e.criado_em limit 1) en on true
     where b.empresa_id = v_emp and b.conta_bancaria_id = c.id and b.nosso_numero is not null
       and ((b.status in ('pendente', 'erro') and b.remessa_id is null and l.ativo and l.data_quitacao is null)
            or b.instrucao = 'baixa')
     order by b.instrucao nulls first, b.data_vencimento, b.criado_em
  loop
    v_doc := regexp_replace(coalesce(x.documento, ''), '\D', '', 'g');
    v_cep := regexp_replace(coalesce(x.cep, ''), '\D', '', 'g');
    v_erro := case
      when length(v_doc) not in (11, 14) then 'Cliente sem CPF/CNPJ válido.'
      when length(v_cep) <> 8 then 'Endereço do cliente sem CEP.'
      when coalesce(trim(x.logradouro), '') = '' then 'Cliente sem endereço.'
      when x.instrucao is null and x.data_vencimento < current_date then 'Vencimento já passou: altere o vencimento do título.'
    end;
    if v_erro is not null then
      if x.instrucao is null then
        update public.boletos set status = 'erro', mensagem_erro = v_erro where id = x.id;
      end if;
      v_erros := v_erros || jsonb_build_object('pagador', x.razao_social, 'valor', x.valor, 'erro', v_erro);
      continue;
    end if;

    v_nn := regexp_replace(x.nosso_numero, '\D', '', 'g');
    v_seq := v_seq + 1;
    v_linhas := v_linhas || (
      '1' || 'A' || 'A' || 'A' || ' ' || case when c.boleto_hibrido then 'H' else ' ' end || repeat(' ', 10) ||
      'A' || 'A' || 'B' || repeat(' ', 28) ||
      v_nn || repeat(' ', 6) ||
      to_char(current_date, 'YYYYMMDD') || ' ' || 'N' || ' ' || 'B' || '00' || '00' || repeat(' ', 4) ||
      repeat('0', 10) || public.fn_cnab_num(c.boleto_multa * 100, 4) || repeat(' ', 12) ||
      case when x.instrucao = 'baixa' then '02' else '01' end ||
      public.fn_cnab_texto(x.seu_numero, 10) ||
      to_char(x.data_vencimento, 'DDMMYY') || public.fn_cnab_num(round(x.valor * 100), 13) || repeat(' ', 9) ||
      'A' || 'N' || to_char(x.emissao, 'DDMMYY') ||
      case when c.boleto_protesto_dias > 0 then '06' || lpad(c.boleto_protesto_dias::text, 2, '0') else '0000' end ||
      public.fn_cnab_num(round(c.boleto_juros_dia * 100), 13) ||
      '000000' || repeat('0', 13) || repeat('0', 13) || repeat('0', 13) ||
      case when length(v_doc) = 11 then '1' else '2' end || '0' || lpad(v_doc, 14, '0') ||
      public.fn_cnab_texto(x.razao_social, 40) ||
      public.fn_cnab_texto(concat_ws(',', nullif(trim(x.logradouro), ''), nullif(trim(x.end_numero), ''), nullif(trim(x.complemento), '')), 40) ||
      lpad(coalesce(nullif(regexp_replace(coalesce(x.codigo_pagador, ''), '\D', '', 'g'), ''), '0'), 5, '0') ||
      '000000' || ' ' || v_cep || '00000' || repeat(' ', 14) || repeat(' ', 41) ||
      lpad(v_seq::text, 6, '0'));
    if c.boleto_hibrido and x.instrucao is null then
      v_txid := coalesce(x.txid, (select string_agg(substr('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1 + floor(random() * 36)::integer, 1), '')
                                    from generate_series(1, 35)));
      v_seq := v_seq + 1;
      v_linhas := v_linhas || ('8' || rpad(v_nn, 15, ' ') || ' ' || 'H' || repeat(' ', 12) || public.fn_cnab_texto(x.seu_numero, 10) ||
                               v_txid || repeat(' ', 319) || lpad(v_seq::text, 6, '0'));
      update public.boletos set txid = v_txid where id = x.id;
    end if;
    v_ids := v_ids || x.id;
    if x.instrucao = 'baixa' then v_baixas := v_baixas + 1; else v_qtd := v_qtd + 1; v_total := v_total + x.valor; end if;
  end loop;

  if v_qtd + v_baixas = 0 then
    if jsonb_array_length(v_erros) > 0 then
      return jsonb_build_object('id', null, 'qtd', 0, 'baixas', 0, 'valor', 0, 'erros', v_erros);
    end if;
    raise exception 'Nenhum boleto para enviar.';
  end if;

  v_num := c.cnab_ultima_remessa + 1;
  v_conteudo :=
    '0' || '1' || 'REMESSA' || '01' || rpad('COBRANCA', 15, ' ') || c.sicredi_codigo_beneficiario ||
    lpad(regexp_replace((select cnpj from public.empresas where id = v_emp), '\D', '', 'g'), 14, '0') || repeat(' ', 31) ||
    '748' || rpad('SICREDI', 15, ' ') || to_char(current_date, 'YYYYMMDD') || repeat(' ', 8) || lpad(v_num::text, 7, '0') ||
    repeat(' ', 273) || '2.00' || '000001' || E'\r\n' ||
    array_to_string(v_linhas, E'\r\n') || E'\r\n' ||
    '9' || '1' || '748' || c.sicredi_codigo_beneficiario || repeat(' ', 384) || lpad((v_seq + 1)::text, 6, '0') || E'\r\n';

  v_mes := case extract(month from current_date)::integer when 10 then 'O' when 11 then 'N' when 12 then 'D'
           else extract(month from current_date)::integer::text end;
  select count(*) into v_hoje_qtd from public.cnab_remessas
   where conta_bancaria_id = c.id and (criado_em at time zone 'America/Campo_Grande')::date = current_date;
  v_nome := c.sicredi_codigo_beneficiario || v_mes || to_char(current_date, 'DD') || '.' ||
            case when v_hoje_qtd = 0 then 'CRM' else 'RM' || (v_hoje_qtd + 1)::text end;

  insert into public.cnab_remessas (empresa_id, conta_bancaria_id, numero, nome_arquivo, conteudo, qtd_registros, qtd_baixas, valor_total, criado_por)
  values (v_emp, c.id, v_num, v_nome, v_conteudo, v_qtd, v_baixas, v_total, auth.uid())
  returning id into v_id;
  update public.contas_bancarias set cnab_ultima_remessa = v_num where id = c.id;
  update public.boletos set
         status = case when instrucao = 'baixa' then status else 'enviado' end,
         mensagem_erro = case when instrucao = 'baixa' then 'Baixa enviada na remessa ' || v_num else null end,
         remessa_id = case when instrucao = 'baixa' then remessa_id else v_id end,
         instrucao = null
   where id = any(v_ids);

  return jsonb_build_object('id', v_id, 'numero', v_num, 'nome', v_nome, 'conteudo', v_conteudo,
                            'qtd', v_qtd, 'baixas', v_baixas, 'valor', v_total, 'erros', v_erros);
end;
$$;

-- Pede a baixa de um boleto no banco (cliente pagou de outro jeito, renegociação...)
create or replace function public.boleto_pedir_baixa(p_boleto uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare b public.boletos;
begin
  perform public.fn_exigir('financeiro', 'editar');
  select * into b from public.boletos where id = p_boleto and empresa_id = public.empresa_atual();
  if not found then raise exception 'Boleto não encontrado.'; end if;
  if b.status in ('pendente', 'erro') then
    update public.boletos set status = 'cancelado', cancelado_em = now() where id = b.id;
  elsif b.status in ('enviado', 'registrado') then
    update public.boletos set instrucao = 'baixa', mensagem_erro = 'Baixa pedida: vai na próxima remessa.' where id = b.id;
  else
    raise exception 'Este boleto não está em aberto no banco.';
  end if;
end;
$$;

-- Volta um boleto enviado para ser incluído de novo na próxima remessa (arquivo não chegou ao banco)
create or replace function public.boleto_reenviar(p_boleto uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_exigir('financeiro', 'editar');
  update public.boletos set status = 'pendente', remessa_id = null, mensagem_erro = null
   where id = p_boleto and empresa_id = public.empresa_atual() and status in ('enviado', 'erro');
  if not found then raise exception 'Só boletos enviados ou com erro podem ser reenviados.'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Retorno
-- ---------------------------------------------------------------------
create or replace function public.fn_cnab_data(p text)
returns date
language plpgsql
immutable
as $$
begin
  if p is null or p !~ '^\d{6}$' or p = '000000' then return null; end if;
  return to_date(p, 'DDMMYY');
exception when others then return null;
end;
$$;

create or replace function public.fn_cnab_valor(p text)
returns numeric
language sql
immutable
as $$ select coalesce(nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), ''), '0')::numeric / 100; $$;

create or replace function public.retorno_processar(p_conteudo text, p_nome text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp uuid := public.empresa_atual();
  v_hash text := md5(p_conteudo);
  v_linhas text[];
  v_lin text;
  c public.contas_bancarias;
  b public.boletos;
  l public.lancamentos;
  v_nn text;
  v_oc text;
  v_data date;
  v_pago numeric; v_juros numeric; v_multa numeric; v_desc numeric;
  v_motivos text;
  v_reg integer := 0; v_rej integer := 0; v_liq integer := 0; v_baix integer := 0; v_outros integer := 0; v_nao integer := 0; v_pix integer := 0;
  v_valor_liq numeric := 0;
  v_itens jsonb := '[]'::jsonb;
  v_resumo jsonb;
  v_msg text;
  v_ja boolean;
begin
  perform public.fn_exigir('financeiro', 'editar');
  if exists (select 1 from public.cnab_retornos where empresa_id = v_emp and hash = v_hash) then
    raise exception 'Este arquivo de retorno já foi processado.';
  end if;
  v_linhas := regexp_split_to_array(replace(p_conteudo, E'\r', ''), E'\n');
  v_lin := v_linhas[1];
  if v_lin is null or substr(v_lin, 1, 9) <> '02RETORNO' then
    raise exception 'Não é um arquivo de retorno CNAB 400 (a primeira linha deve começar com 02RETORNO).';
  end if;
  select * into c from public.contas_bancarias
   where empresa_id = v_emp and ativo and banco_codigo = '748' and sicredi_codigo_beneficiario = substr(v_lin, 27, 5) limit 1;
  if not found then raise exception 'O retorno é do beneficiário %, que não está em nenhuma conta Sicredi cadastrada.', substr(v_lin, 27, 5); end if;

  foreach v_lin in array v_linhas loop
    continue when length(v_lin) < 100;
    if substr(v_lin, 1, 1) = '8' then
      v_nn := substr(regexp_replace(substr(v_lin, 2, 15), '\D', '', 'g'), 1, 9);
      update public.boletos set pix_copia_cola = nullif(trim(substr(v_lin, 135, 256)), ''),
             txid = coalesce(nullif(trim(substr(v_lin, 21, 35)), ''), txid)
       where empresa_id = v_emp and conta_bancaria_id = c.id and regexp_replace(nosso_numero, '\D', '', 'g') = v_nn;
      if found and nullif(trim(substr(v_lin, 135, 256)), '') is not null then v_pix := v_pix + 1; end if;
      continue;
    end if;
    continue when substr(v_lin, 1, 1) <> '1';

    v_nn := substr(regexp_replace(substr(v_lin, 48, 15), '\D', '', 'g'), 1, 9);
    v_oc := substr(v_lin, 109, 2);
    v_data := coalesce(public.fn_cnab_data(substr(v_lin, 111, 6)), current_date);
    v_motivos := trim(substr(v_lin, 319, 10));
    select * into b from public.boletos
     where empresa_id = v_emp and conta_bancaria_id = c.id and regexp_replace(nosso_numero, '\D', '', 'g') = v_nn
     order by criado_em desc limit 1;
    if not found then
      v_nao := v_nao + 1;
      v_itens := v_itens || jsonb_build_object('nosso_numero', v_nn, 'ocorrencia', v_oc, 'msg', 'Boleto não encontrado no ERP');
      continue;
    end if;
    select * into l from public.lancamentos where id = b.lancamento_id;
    v_msg := null;

    if v_oc = '02' then
      update public.boletos set status = case when status in ('pendente', 'enviado', 'erro') then 'registrado' else status end,
             registrado_em = coalesce(registrado_em, now()), codigo_pagador = nullif(substr(v_lin, 15, 5), '00000'),
             ocorrencia = '02', retorno_em = now(), mensagem_erro = case when status = 'erro' then null else mensagem_erro end
       where id = b.id;
      v_reg := v_reg + 1;
      v_msg := 'Registrado' || case when v_motivos like '%P2%' then ' (sem QR Code Pix)' else '' end;
    elsif v_oc in ('03', '24') then
      update public.boletos set status = 'erro', remessa_id = null, ocorrencia = v_oc, retorno_em = now(),
             mensagem_erro = 'Recusado pelo Sicredi' || case when v_oc = '24' then ': CEP inválido' else '' end ||
                             case when v_motivos <> '' and v_motivos !~ '^0+$' then ' (motivos ' || v_motivos || ')' else '' end ||
                             '. Corrija o cadastro e gere outra remessa.'
       where id = b.id and status not in ('pago', 'cancelado');
      v_rej := v_rej + 1;
      v_msg := 'Recusado (' || v_oc || ' ' || v_motivos || ')';
    elsif v_oc in ('06', '15', '17') then
      v_pago := public.fn_cnab_valor(substr(v_lin, 254, 13));
      v_juros := public.fn_cnab_valor(substr(v_lin, 267, 13));
      v_multa := public.fn_cnab_valor(substr(v_lin, 280, 13));
      v_desc := public.fn_cnab_valor(substr(v_lin, 241, 13)) + public.fn_cnab_valor(substr(v_lin, 228, 13));
      v_ja := l.data_quitacao is not null;
      update public.boletos set status = 'pago', data_pagamento = v_data, valor_pago = v_pago, ocorrencia = v_oc, retorno_em = now(), instrucao = null
       where id = b.id;
      if not v_ja and l.ativo then
        begin
          perform public.lancamento_baixar(l.id, least(v_data, current_date), v_pago, c.id,
                                           v_juros, v_multa, v_desc, null,
                                           'Boleto Sicredi ' || b.nosso_numero || ' · crédito ' ||
                                           coalesce(to_char(to_date(nullif(substr(v_lin, 329, 8), '00000000'), 'YYYYMMDD'), 'DD/MM/YYYY'), '-'));
          v_msg := 'Pago e baixado no financeiro';
        exception when others then
          update public.boletos set mensagem_erro = 'Pago no banco, mas a baixa automática falhou: ' || sqlerrm where id = b.id;
          v_msg := 'Pago, baixa manual necessária: ' || sqlerrm;
        end;
      else
        v_msg := case when v_ja then 'Pago (título já estava quitado: verifique pagamento em dobro)' else 'Pago (título cancelado)' end;
      end if;
      v_liq := v_liq + 1; v_valor_liq := v_valor_liq + v_pago;
    elsif v_oc in ('09', '10') then
      update public.boletos set status = case when status = 'pago' then status else 'baixado' end, ocorrencia = v_oc, retorno_em = now(),
             instrucao = null
       where id = b.id;
      v_baix := v_baix + 1;
      v_msg := 'Baixado no banco';
    else
      update public.boletos set ocorrencia = v_oc, retorno_em = now() where id = b.id;
      v_outros := v_outros + 1;
      v_msg := 'Ocorrência ' || v_oc || case when v_motivos <> '' and v_motivos !~ '^0+$' then ' (' || v_motivos || ')' else '' end;
    end if;
    v_itens := v_itens || jsonb_build_object('nosso_numero', b.nosso_numero, 'seu_numero', b.seu_numero, 'ocorrencia', v_oc, 'msg', v_msg,
                                             'valor', b.valor);
  end loop;

  v_resumo := jsonb_build_object('registrados', v_reg, 'recusados', v_rej, 'liquidados', v_liq, 'valor_liquidado', v_valor_liq,
                                 'baixados', v_baix, 'outros', v_outros, 'nao_encontrados', v_nao, 'pix', v_pix, 'itens', v_itens);
  insert into public.cnab_retornos (empresa_id, conta_bancaria_id, nome_arquivo, hash, data_arquivo, numero, resumo, criado_por)
  values (v_emp, c.id, p_nome, v_hash, to_date(nullif(substr(v_linhas[1], 95, 8), '00000000'), 'YYYYMMDD'),
          nullif(regexp_replace(substr(v_linhas[1], 111, 7), '\D', '', 'g'), '')::integer, v_resumo, auth.uid());
  return v_resumo;
end;
$$;

-- Boletos para impressão e acompanhamento: inclui dados da remessa
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
       concat_ws(', ', em.logradouro, em.numero, em.bairro) as beneficiario_endereco, em.cidade as beneficiario_cidade, em.uf as beneficiario_uf,
       b.seu_numero, b.instrucao, b.ocorrencia, b.remessa_id, r.numero as remessa_numero, r.nome_arquivo as remessa_arquivo,
       b.data_pagamento, b.valor_pago, cb.boleto_multa, cb.boleto_juros_dia, b.criado_em
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
  left join public.cnab_remessas r on r.id = b.remessa_id
 where b.empresa_id = public.empresa_atual()
   and (public.tem_permissao('financeiro', 'ver') or public.tem_permissao('fiscal', 'ver')
        or (public.tem_permissao('vendas', 'ver') and (public.fn_carteira() is null or pe.vendedor_id = public.fn_carteira())));
revoke all on public.vw_boletos from public, anon;
grant select on public.vw_boletos to authenticated;

revoke execute on function public.fn_boleto_numerar(uuid) from public, anon, authenticated;
revoke execute on function public.fn_boletos_numerar_novo() from public, anon, authenticated;
do $$ declare f text; begin foreach f in array array[
  'remessa_gerar(uuid)', 'boleto_pedir_baixa(uuid)', 'boleto_reenviar(uuid)', 'retorno_processar(text, text)'
] loop
  execute format('revoke execute on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
end loop; end $$;

-- Numera os boletos que já existem e ainda estão em aberto
do $$ declare r record; begin
  for r in select b.id from public.boletos b join public.lancamentos l on l.id = b.lancamento_id
            where b.status in ('pendente', 'erro') and b.nosso_numero is null and l.ativo and l.data_quitacao is null
            order by b.criado_em loop
    perform public.fn_boleto_numerar(r.id);
  end loop;
end $$;
