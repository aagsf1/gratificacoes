# Gestão de Gratificações

Aplicativo multiusuário estático para GitHub Pages, com autenticação e persistência no Supabase. O banco PostgreSQL aplica as permissões por Row Level Security; o frontend nunca precisa de chave secreta.

## Funcionalidades

- Supabase Auth com primeiro acesso e recuperação de senha por códigos digitados manualmente, resistentes ao consumo antecipado por scanners de e-mail;
- cadastro de usuários por convite, disponível somente para administradores;
- exclusão administrativa de usuários com confirmação reforçada, proteção contra autoexclusão e preservação do último administrador;
- painel de usuários online por heartbeat protegido por RLS;
- perfis `admin`, `gestor` e `consulta`;
- RLS no PostgreSQL e trilha de auditoria protegida, com limpeza exclusiva do administrador;
- cadastro e inativação de gratificações por `admin` e `gestor`;
- página **Referências** para `admin` e `gestor`, com orçamento, competência, valores integrais, percentual padrão de 65%, valor com vínculo calculado ou personalizado e histórico auditável;
- snapshots integrais das gratificações por competência, com identidade histórica estável, cópia transacional, bloqueio de competências encerradas e detecção de edição concorrente;
- dashboard e filtros operacionais;
- relatório customizável por competência, com comparação histórica opcional, título, seleção de campos, busca, filtros por CJ, situação, vínculo, status e unidade, agrupamento, ordenação, métricas, CSV e impressão;
- Relatório Quadro CSJT com seleção independente da Situação Anterior e Situação Atual, quadros de orçamento, proporção e saldo, paleta verde/azul/amarela e impressão A4 paisagem;
- cálculos financeiros internos com quatro casas decimais e exibição padronizada em duas casas;
- somente CJ-01, CJ-02, CJ-03 e CJ-04.

## Configuração

1. Crie um projeto no Supabase.
2. Execute `supabase-setup.sql` no SQL Editor.
3. Execute `supabase-references-migration.sql` para criar as referências financeiras por competência e suas políticas RLS.
4. Execute `supabase-history-migration.sql` para habilitar snapshots integrais por competência.
5. Execute `supabase-seed.sql` para inserir e validar os 78 registros iniciais.
6. Crie o primeiro usuário em **Authentication > Users**.
7. Promova-o com o comando comentado ao final de `supabase-setup.sql`.
8. Copie a URL do projeto e a chave **publishable/anon** para `app-config.js`.
9. Em **Authentication > URL Configuration**, registre a URL do GitHub Pages como Site URL e Redirect URL.
10. Em **Authentication > Emails > Reset password**, use o conteúdo de `supabase-email-template-recovery.html`.
11. Em **Authentication > Emails > Invite user**, use o conteúdo de `supabase-email-template-invite.html`.
12. Em um projeto já configurado, execute `supabase-admin-presence-migration.sql`, `supabase-access-ui-migration.sql`, `supabase-references-migration.sql` e `supabase-history-migration.sql`, nesta ordem.

## Histórico por competência

Na página **Referências**, use **Copiar selecionada** para abrir uma nova competência. A opção de copiar todas as gratificações cria um snapshot completo em uma única transação, preservando a identidade de cada gratificação entre os meses. Alterações posteriores atingem somente o snapshot selecionado.

Uma competência pode ficar em rascunho, vigente, encerrada ou arquivada. Encerradas e arquivadas são somente leitura; apenas administradores podem reabri-las. O indicador **Dados individualizados completos** controla os avisos dos relatórios e evita que uma base parcial seja apresentada como reconstrução histórica integral.

O sistema não inventa composições passadas. Para reconstruir uma competência antiga, copie a competência anterior mais próxima ou crie uma vazia, ajuste individualmente as gratificações e marque os dados como completos somente depois da conferência documental. O relatório customizável compara duas competências por identidade histórica; o Quadro CSJT usa exclusivamente os snapshots escolhidos.

## Cadastro de usuários pela aplicação

O formulário em **Administração** usa a Edge Function `invite-user`. Ela mantém a operação administrativa no Supabase e nunca envia a chave secreta ao navegador.

Na primeira configuração, publique a função com a CLI do Supabase:

```sh
supabase login
supabase link --project-ref wiollbxstffanegwdiod
supabase secrets set SITE_URL=https://aagsf1.github.io/gratificacoes/
supabase functions deploy invite-user
supabase functions deploy delete-user
```

Depois disso, um administrador pode informar nome, e-mail e perfil na aplicação. O usuário receberá um código de convite, abrirá **Primeiro acesso / cadastrar senha** na tela inicial, validará o código e criará a própria senha. Não é gerada nem enviada uma senha automática. Os perfis continuam protegidos por RLS e somente administradores podem alterá-los.

O modelo de convite não usa `ConfirmationURL`: o botão do e-mail apenas abre o aplicativo e o código é consumido somente após a confirmação manual. Essa configuração evita que scanners de segurança invalidem o convite antes do usuário.

## Administração de usuários

A exclusão permanente é executada exclusivamente pela Edge Function `delete-user`, depois de validar novamente a sessão e o perfil do administrador. A aplicação impede a autoexclusão e a remoção do último administrador ativo. A operação exige que o administrador digite o e-mail do usuário e é registrada em `audit_logs`.

A trilha de auditoria é exclusiva do perfil `admin`. A opção **Limpar registros** exige a confirmação textual `LIMPAR AUDITORIA` e chama uma função protegida no banco; a própria limpeza deixa um novo registro com a quantidade removida. Em projetos existentes, execute também `supabase-access-ui-migration.sql`: usuários com o perfil antigo `auditor` são migrados para `consulta`.

O quadro **Usuários online agora** usa heartbeats na tabela `user_presence`. Cada aba autenticada pode gravar e remover somente a própria sessão; apenas administradores podem consultar as sessões dos demais usuários. Uma sessão é considerada online enquanto seu heartbeat tiver menos de 90 segundos. “Online” significa que a aplicação está aberta e ativa, não apenas que existe uma sessão Auth ainda válida. A lista é informativa e não é usada para decisões de autorização.

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
