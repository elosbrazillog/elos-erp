# Elos ERP

Sistema de gestão da Elos Distribuidora: cadastros, pedidos, força de vendas, expedição, estoque por lote, NF-e e financeiro com boletos Sicredi.

Stack: Next.js 15 (App Router) + Supabase (PostgreSQL, Auth, RLS) + Vercel.

## Situação

| Fase | Conteúdo | Situação |
| --- | --- | --- |
| 0 · Fundação | Login, perfis de acesso, menu, lista e formulário padrão | Pronta |
| 1 · Cadastros | Clientes/fornecedores com papéis, produtos, rotas, tabelas de preço, tabelas de apoio, importação por planilha, usuários, perfis, dados da empresa | Pronta |
| 2 · Vendas e estoque | Pedidos, trava de crédito, lotes e validade, reserva, movimentações | Banco pronto, telas a fazer |
| 3 · NF-e | Emissão via API de terceiro | Banco pronto, telas a fazer |
| 4 · Expedição e força de vendas | Carga por rota, romaneio, app offline, entrega com canhoto | Banco pronto, telas a fazer |
| 5 · Financeiro e Sicredi | Lançamentos, boletos, baixa automática, painel e relatórios | Banco pronto, telas a fazer |

O banco de dados já tem todas as tabelas da versão 1.

## Como colocar no ar

### 1. Supabase

1. Crie um projeto em supabase.com, região South America (São Paulo).
2. Em **SQL Editor**, cole e rode `supabase/instalar_tudo.sql` (é a soma dos três arquivos abaixo, na ordem):
   - `20261014000001_schema.sql`
   - `20261014000002_seguranca.sql`
   - `20261014000003_dados_iniciais.sql`
3. Em **Authentication > Sign In / Providers**, desligue **Allow new users to sign up**. Usuários entram só por convite feito dentro do sistema.
4. Em **Authentication > URL Configuration**, coloque o endereço do sistema na Vercel em **Site URL** e adicione `https://SEU-ENDERECO/auth/confirmar` em **Redirect URLs**.
5. Em **Authentication > Users**, clique em **Add user > Create new user** com o seu e-mail e senha. **O primeiro usuário criado vira administrador automaticamente.**

### 2. Vercel

1. Importe o repositório do GitHub.
2. Em **Environment Variables**, cadastre (valores em Supabase > Project Settings > API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (chave anon / publishable)
   - `SUPABASE_SERVICE_ROLE_KEY` (chave service_role / secret, usada só para convidar usuários)
   - `NEXT_PUBLIC_SITE_URL` (endereço final, ex.: `https://elos-erp.vercel.app`)
3. Faça o deploy.

### 3. Primeiro acesso

Entre com o usuário criado no passo 1.5. O painel mostra a lista de implantação: dados da empresa, produtos, grupo tributário, tabela de preço, vendedores, rotas e clientes.

## Rodar localmente

```bash
cp .env.example .env.local   # preencha com os dados do Supabase
npm install
npm run dev
```

## Como o código é organizado

- `supabase/migrations/` — banco de dados, regras de acesso (RLS) e dados iniciais.
- `supabase/tests/` — teste do banco em Postgres local (`tests/rodar.sh`).
- `src/lib/entidades.ts` — definição de cada cadastro: campos, abas, colunas, busca e filtros. Um cadastro novo simples é só uma entrada aqui.
- `src/components/crud/` — lista padrão (busca, filtros, colunas, seleção, ações em massa, Excel) e formulário padrão (abas, validação, CEP, CNPJ, sub-cadastros).
- `src/app/(app)/` — telas autenticadas.

## Regras de segurança

- Toda tabela tem `empresa_id` e só é visível para usuários da mesma empresa.
- Cada perfil tem permissões por módulo: ver, criar, editar, excluir. Administrador tem acesso total.
- Movimentos de estoque não podem ser alterados nem apagados; correção é um novo movimento.
- Um usuário não pode trocar o próprio perfil nem se desativar.
- Cadastro espontâneo pela tela do Supabase não dá acesso a nada.
