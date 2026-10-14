-- Parâmetros fiscais padrão da NF-e no cadastro da empresa
alter table public.empresas
  add column if not exists nfe_natureza_operacao text not null default 'Venda de mercadoria',
  add column if not exists nfe_pis_cofins_cst text not null default '49',
  add column if not exists nfe_modalidade_frete smallint not null default 0
    check (nfe_modalidade_frete in (0, 1, 2, 3, 4, 9)),
  add column if not exists nfe_info_complementares text;
