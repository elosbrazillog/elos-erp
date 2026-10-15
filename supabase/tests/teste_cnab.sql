\set ON_ERROR_STOP 1
-- Remessa e retorno CNAB 400 Sicredi. Roda depois de teste_painel_inicio.sql.
update contas_bancarias set agencia = '0913', posto = '08', sicredi_codigo_beneficiario = '72189', emite_boleto = true, cnab_byte = 4,
       cnab_ano = extract(year from current_date)::integer % 100, cnab_proximo_numero = 10026
 where banco_codigo = '748';
update pessoas set documento = '67807267000166' where razao_social = 'Cliente Livre';
update pessoas_enderecos set cep = '79117470', logradouro = 'R Antônio de Morais Ribeiro', numero = '679'
 where pessoa_id = (select id from pessoas where razao_social = 'Cliente Livre');
-- boletos antigos ficam fora
update boletos set status = 'cancelado' where status in ('pendente', 'erro', 'enviado');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
create temp table _r (k text, v text);
do $$ declare vend uuid := (select id from pessoas where razao_social = 'João Vendedor'); p uuid; b record; r jsonb;
  cli uuid := (select id from pessoas where razao_social = 'Cliente Livre');
  prod uuid := (select id from produtos where codigo = 'EMP1');
  bol uuid := (select id from formas_pagamento where nome = 'Boleto');
  linhas text[]; ret text; nn text;
begin
  perform estoque_entrada(prod, (select id from depositos order by padrao desc, (tipo = 'camara_fria') desc, nome limit 1), 20, 'L-CNAB', current_date + 60, null, 10, 'teste cnab');
  insert into pedidos (cliente_id, vendedor_id, forma_pagamento_id) values (cli, vend, bol) returning id into p;
  insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) values (p, prod, 2, 162.5);
  perform pedido_confirmar(p);
  perform pedido_faturar_lote(array[p]);
  select * into b from boletos where pedido_id = p and status <> 'cancelado';
  assert b.nosso_numero is not null, 'numerado na criação';
  assert regexp_replace(b.nosso_numero, '\D', '', 'g') like '__41002__', 'sequência ' || b.nosso_numero;
  assert length(b.codigo_barras) = 44 and length(b.linha_digitavel) = 47;
  insert into _r values ('barras', b.codigo_barras), ('linha', b.linha_digitavel), ('nn', b.nosso_numero), ('venc', b.data_vencimento::text), ('valor', b.valor::text);

  r := remessa_gerar(null);
  assert (r->>'qtd')::int = 1, 'um boleto na remessa ' || r::text;
  assert (r->>'numero')::int = 1;
  linhas := regexp_split_to_array(r->>'conteudo', E'\r\n');
  assert array_length(linhas, 1) = 5, 'header, 1, 8, trailer + fim ' || array_length(linhas, 1);
  for i in 1..4 loop assert length(linhas[i]) = 400, 'linha ' || i || ' com ' || length(linhas[i]); end loop;
  assert substr(linhas[1], 1, 19) = '01REMESSA01COBRANCA' and substr(linhas[1], 27, 5) = '72189' and substr(linhas[1], 111, 7) = '0000001';
  assert substr(linhas[2], 1, 6) = '1AAA H' and substr(linhas[2], 109, 2) = '01' and substr(linhas[2], 127, 13) = '0000000032500', substr(linhas[2], 100, 50);
  assert substr(linhas[2], 93, 4) = '0500' and substr(linhas[2], 161, 13) = '0000000000010';
  assert substr(linhas[2], 219, 16) = '2067807267000166' and substr(linhas[2], 327, 8) = '79117470';
  assert substr(linhas[2], 275, 40) like 'R Antonio de Morais Ribeiro,679%', substr(linhas[2], 275, 40);
  assert substr(linhas[3], 1, 1) = '8' and substr(linhas[3], 18, 1) = 'H' and length(trim(substr(linhas[3], 41, 35))) = 35;
  assert substr(linhas[4], 1, 10) = '9174872189' and substr(linhas[4], 395, 6) = '000004';
  assert (select status from boletos where id = b.id) = 'enviado';
  insert into _r values ('remessa', r->>'conteudo'), ('nome', r->>'nome');
  begin perform remessa_gerar(null); raise exception 'deveria falhar'; exception when others then assert sqlerrm like 'Nenhum boleto%', sqlerrm; end;

  -- retorno: entrada confirmada + pix + liquidação
  nn := regexp_replace(b.nosso_numero, '\D', '', 'g');
  ret := rpad('02RETORNO01COBRANCA       7218955732264000121', 76) || rpad('748BANSICREDI', 18) || to_char(current_date, 'YYYYMMDD') || rpad('', 8) || '0000001' || rpad('', 277) || '000001' || E'\r\n'
      || rpad(rpad('1A           A1234500000' , 47) || rpad(nn, 15) || rpad('', 46) || '02' || to_char(current_date, 'DDMMYY'), 318) || 'P1        ' || rpad('', 66) || '000002' || E'\r\n'
      || rpad('8' || rpad(nn, 15) || ' H  ' || rpad('TXIDTESTE', 35) || ' ' || rpad('qrpix.sicredi.com.br/x', 77) || ' ' || '00020101021226PIXTESTE', 394) || '000003' || E'\r\n'
      || rpad(rpad('1A           A1234500000', 47) || rpad(nn, 15) || rpad('', 46) || '06' || to_char(current_date, 'DDMMYY'), 253) || '0000000032650' || '0000000000150' || '0000000000000' || rpad('', 26) || '0000000000' || to_char(current_date, 'YYYYMMDD') || rpad('', 58) || '000004' || E'\r\n'
      || rpad('9274872189', 394) || '000005' || E'\r\n';
  r := retorno_processar(ret, 'teste.CRT');
  assert (r->>'registrados')::int = 1 and (r->>'liquidados')::int = 1 and (r->>'pix')::int = 1, r::text;
  select * into b from boletos where id = b.id;
  assert b.status = 'pago' and b.valor_pago = 326.50 and b.pix_copia_cola like '00020101%' and b.codigo_pagador = '12345', row_to_json(b)::text;
  assert (select data_quitacao from lancamentos where id = b.lancamento_id) is not null, 'título baixado';
  begin perform retorno_processar(ret, 'teste.CRT'); raise exception 'deveria falhar'; exception when others then assert sqlerrm like '%já foi processado%', sqlerrm; end;

  -- cancelar título com boleto registrado manda baixa na próxima remessa
  insert into pedidos (cliente_id, vendedor_id, forma_pagamento_id) values (cli, vend, bol) returning id into p;
  insert into pedidos_itens (pedido_id, produto_id, quantidade, preco_unitario) values (p, prod, 1, 100);
  perform pedido_confirmar(p);
  perform pedido_faturar_lote(array[p]);
  r := remessa_gerar(null);
  assert r->>'nome' like '72189%.RM2', r->>'nome';
  select * into b from boletos where pedido_id = p and status <> 'cancelado';
  reset role;
  update boletos set status = 'registrado' where id = b.id;
  set role authenticated;
  perform boleto_pedir_baixa(b.id);
  r := remessa_gerar(null);
  assert (r->>'baixas')::int = 1 and (r->>'qtd')::int = 0;
  assert substr(split_part(r->>'conteudo', E'\r\n', 2), 109, 2) = '02';
  raise notice 'CNAB OK';
end $$;
reset role;
\pset tuples_only on
\pset format unaligned
select k || '=' || v from _r where k in ('barras', 'linha', 'nn', 'venc', 'valor');
\o /tmp/claude-0/remessa_teste.txt
select v from _r where k = 'remessa';
\o
