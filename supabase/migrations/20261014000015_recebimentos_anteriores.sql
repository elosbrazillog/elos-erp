-- Entregas feitas antes do registro de recebimento: considera o valor todo
-- recebido na forma do pedido (dinheiro, PIX ou cartão), para o acerto fechar.
insert into public.entregas_recebimentos (empresa_id, expedicao_id, expedicao_pedido_id, pedido_id, tipo, valor)
select ep.empresa_id, ep.expedicao_id, ep.id, ep.pedido_id, fp.recebe_na_entrega, pe.valor_total
  from public.expedicoes_pedidos ep
  join public.pedidos pe on pe.id = ep.pedido_id
  join public.formas_pagamento fp on fp.id = pe.forma_pagamento_id
 where ep.status_entrega = 'entregue' and fp.recebe_na_entrega is not null and pe.valor_total > 0
   and not exists (select 1 from public.entregas_recebimentos x where x.expedicao_pedido_id = ep.id);
