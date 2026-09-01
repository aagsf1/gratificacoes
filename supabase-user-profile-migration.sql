-- Garante exclusividade do e-mail dos perfis sem alterar usuários existentes.
-- Revise eventuais duplicidades antes da execução caso o índice não possa ser criado.
create unique index if not exists profiles_email_lower_unique
  on public.profiles (lower(email));
