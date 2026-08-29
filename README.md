# Gestão de Gratificações

Aplicativo multiusuário estático para GitHub Pages, com autenticação e persistência no Supabase. O banco PostgreSQL aplica as permissões por Row Level Security; o frontend nunca precisa de chave secreta.

## Funcionalidades

- Supabase Auth com recuperação de senha;
- perfis `admin`, `gestor`, `consulta` e `auditor`;
- RLS no PostgreSQL e trilha de auditoria imutável para usuários do app;
- cadastro e inativação de gratificações por `admin` e `gestor`;
- dashboard, filtros, relatórios CSV/impressão e Quadro CSJT;
- cálculos financeiros com quatro casas decimais;
- somente CJ-01, CJ-02, CJ-03 e CJ-04.

## Configuração

1. Crie um projeto no Supabase.
2. Execute `supabase-setup.sql` no SQL Editor.
3. Execute `supabase-seed.sql` para inserir e validar os 78 registros iniciais.
4. Crie o primeiro usuário em **Authentication > Users**.
5. Promova-o com o comando comentado ao final de `supabase-setup.sql`.
6. Copie a URL do projeto e a chave **publishable/anon** para `app-config.js`.
7. Em **Authentication > URL Configuration**, registre a URL do GitHub Pages como Site URL e Redirect URL.

Nunca coloque a chave secreta do projeto, credenciais de banco ou tokens em `app-config.js`. A chave publicável existe para uso no navegador; a segurança efetiva é aplicada pelas políticas RLS.

## Validação local

```sh
npm test
```

Sirva a pasta com qualquer servidor HTTP estático. Abrir `index.html` diretamente via `file://` não é suportado por módulos ES.

## GitHub Pages

O workflow em `.github/workflows/pages.yml` publica a raiz do repositório a cada push na branch `main`. Em **Settings > Pages**, escolha **GitHub Actions** como origem.

## Regressão inicial

- 78 gratificações (66 com vínculo e 12 sem vínculo);
- total pago: R$ 821.607,0825;
- orçamento paradigma: R$ 828.146,7700;
- saldo: R$ 6.539,6875.

Os nomes dos servidores foram integralmente pseudonimizados na base pública. Os nomes e as siglas das unidades foram preservados.
