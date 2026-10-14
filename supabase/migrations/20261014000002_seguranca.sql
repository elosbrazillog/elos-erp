-- =====================================================================
-- Segurança: RLS por empresa + permissão por módulo do perfil
-- =====================================================================

-- Cria as 4 políticas padrão de uma tabela ligada a um módulo
create or replace function public.fn_cria_politicas(p_tabela text, p_modulo text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  execute format($f$create policy "%1$s_ver" on public.%1$I for select to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'ver'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_criar" on public.%1$I for insert to authenticated
                   with check (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'criar'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_editar" on public.%1$I for update to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'editar'))
                   with check (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'editar'))$f$, p_tabela, p_modulo);
  execute format($f$create policy "%1$s_excluir" on public.%1$I for delete to authenticated
                   using (empresa_id = public.empresa_atual() and public.tem_permissao(%2$L, 'excluir'))$f$, p_tabela, p_modulo);
end;
$$;

do $$ declare t text; begin foreach t in array array[
  'categorias', 'marcas', 'unidades', 'formas_pagamento', 'condicoes_pagamento', 'depositos',
  'rotas', 'tabelas_preco', 'tabelas_preco_itens', 'pessoas', 'pessoas_enderecos',
  'pessoas_contatos', 'produtos', 'veiculos'
] loop perform public.fn_cria_politicas(t, 'cadastros'); end loop; end $$;

do $$ declare t text; begin foreach t in array array[
  'plano_contas', 'centros_custo', 'contas_bancarias', 'lancamentos', 'boletos'
] loop perform public.fn_cria_politicas(t, 'financeiro'); end loop; end $$;

do $$ declare t text; begin foreach t in array array['pedidos', 'pedidos_itens'] loop perform public.fn_cria_politicas(t, 'vendas'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['expedicoes', 'expedicoes_pedidos'] loop perform public.fn_cria_politicas(t, 'expedicao'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['notas_fiscais', 'notas_fiscais_eventos', 'grupos_tributarios'] loop perform public.fn_cria_politicas(t, 'fiscal'); end loop; end $$;
do $$ declare t text; begin foreach t in array array['lotes'] loop perform public.fn_cria_politicas(t, 'estoque'); end loop; end $$;

-- Movimentos de estoque: só incluir, nunca alterar ou apagar (correção = novo movimento)
alter table public.estoque_movimentos enable row level security;
create policy "estoque_movimentos_ver" on public.estoque_movimentos for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('estoque', 'ver'));
create policy "estoque_movimentos_criar" on public.estoque_movimentos for insert to authenticated
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('estoque', 'criar'));

-- Saldos: só leitura (gravados pelo gatilho dos movimentos)
alter table public.estoque_saldos enable row level security;
create policy "estoque_saldos_ver" on public.estoque_saldos for select to authenticated
  using (empresa_id = public.empresa_atual()
         and (public.tem_permissao('estoque', 'ver') or public.tem_permissao('vendas', 'ver')));

-- Numeradores: acesso só pelas funções
alter table public.numeradores enable row level security;

-- Empresa: todos da empresa leem, só configurações edita
alter table public.empresas enable row level security;
create policy "empresas_ver" on public.empresas for select to authenticated
  using (id = public.empresa_atual());
create policy "empresas_editar" on public.empresas for update to authenticated
  using (id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));

-- Perfis: todos da empresa leem (o menu depende disso), configurações administra
alter table public.perfis enable row level security;
create policy "perfis_ver" on public.perfis for select to authenticated
  using (empresa_id = public.empresa_atual());
create policy "perfis_criar" on public.perfis for insert to authenticated
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'criar'));
create policy "perfis_editar" on public.perfis for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));
create policy "perfis_excluir" on public.perfis for delete to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'excluir') and not administrador);

-- Usuários: cada um lê o próprio registro; configurações lê e edita todos da empresa
alter table public.usuarios enable row level security;
create policy "usuarios_ver_proprio" on public.usuarios for select to authenticated
  using (id = auth.uid());
create policy "usuarios_ver" on public.usuarios for select to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'ver'));
create policy "usuarios_editar" on public.usuarios for update to authenticated
  using (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'))
  with check (empresa_id = public.empresa_atual() and public.tem_permissao('configuracoes', 'editar'));

-- Usuário não pode trocar o próprio perfil nem se desativar
create or replace function public.fn_usuario_protege_proprio()
returns trigger
language plpgsql
as $$
begin
  if new.id = auth.uid() and (new.perfil_id is distinct from old.perfil_id or new.ativo is distinct from old.ativo) then
    raise exception 'Você não pode alterar o próprio perfil nem desativar o próprio acesso.';
  end if;
  return new;
end;
$$;
create trigger trg_usuarios_protege before update on public.usuarios
  for each row execute function public.fn_usuario_protege_proprio();

-- ---------------------------------------------------------------------
-- Novo login: liga o usuário do Supabase Auth à empresa e ao perfil
-- 1) convite feito pelo sistema traz empresa_id e perfil_id nos metadados
-- 2) o primeiríssimo usuário vira administrador da empresa cadastrada
-- 3) qualquer outro cadastro espontâneo fica sem acesso
-- ---------------------------------------------------------------------
create or replace function public.fn_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
  v_perfil uuid;
  v_nome text;
begin
  v_nome := coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1));

  if new.raw_user_meta_data ? 'empresa_id' then
    v_empresa := (new.raw_user_meta_data ->> 'empresa_id')::uuid;
    v_perfil := nullif(new.raw_user_meta_data ->> 'perfil_id', '')::uuid;
    insert into public.usuarios (id, empresa_id, perfil_id, nome, email, criado_por)
    values (new.id, v_empresa, v_perfil, v_nome, new.email, new.id);
  elsif not exists (select 1 from public.usuarios) then
    select id into v_empresa from public.empresas order by criado_em limit 1;
    if v_empresa is not null then
      select id into v_perfil from public.perfis where empresa_id = v_empresa and administrador limit 1;
      insert into public.usuarios (id, empresa_id, perfil_id, nome, email, criado_por)
      values (new.id, v_empresa, v_perfil, v_nome, new.email, new.id);
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_auth_novo_usuario
  after insert on auth.users
  for each row execute function public.fn_novo_usuario();

-- Funções internas não ficam expostas pela API
revoke execute on function public.proximo_numero(uuid, text) from public, anon, authenticated;
revoke execute on function public.fn_cria_politicas(text, text) from public, anon, authenticated;
revoke execute on function public.fn_pedido_recalcula(uuid) from public, anon, authenticated;
