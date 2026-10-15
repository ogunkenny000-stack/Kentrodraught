-- Browser username lookup must not disclose account email addresses.
-- The Node auth facade uses the existing function with service-role access.
begin;
revoke all on function public.resolve_username_to_email(text) from public, anon, authenticated;
grant execute on function public.resolve_username_to_email(text) to service_role;
commit;
