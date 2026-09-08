-- 管理员账号密码持久化（只需执行一次）
create table if not exists public.admin_auth (
    id integer primary key,
    username text not null,
    salt text not null,
    password_hash text not null
);

alter table public.admin_auth enable row level security;
revoke all on public.admin_auth from anon, authenticated;
grant select, insert, update, delete on public.admin_auth to service_role;
