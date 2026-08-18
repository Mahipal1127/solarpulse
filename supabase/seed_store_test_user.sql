-- Solar Pulse OS — test user for the Store department module
--
-- NOT a migration (no number): this is seed/dev data. Run it in the Supabase SQL
-- editor (or `supabase db execute`) against a dev database — never production.
--
-- WHY THIS EXISTS: signing in with an account that is not attached to the 'store'
-- department makes requireDepartment('store') redirect to /forbidden ("access
-- denied"). 0002 seeds the Store department and its roles but NO users, so a Store
-- login has to be provisioned explicitly — same as every other module.
--
-- It does the two steps 0004 documents in one go:
--   1. create a Supabase Auth login (auth.users + auth.identities), and
--   2. call provision_app_user() to link a public.users row with a role.
--
-- Depends on 0002 (org/departments/roles) having run. Uses the 'Store Executive'
-- role, which 0002 always seeds — so this works whether or not 0017 has been
-- applied yet. For the lead experience (delegation inbox), see the note at the
-- bottom and pass 'Store Manager' instead (that role needs 0017).
-- Idempotent: re-running updates the app-user row and leaves the login be.
--
-- LOGIN:  store.exec@solarpulse.test  /  Passw0rd!
-- Change the password after first sign-in, or edit the literal below before running.

do $$
declare
  v_email    text := 'store.exec@solarpulse.test';
  v_password text := 'Passw0rd!';
  v_name     text := 'Sanjay Store';
  v_auth_id  uuid;
begin
  -- 1a. The auth login. If it already exists, reuse it.
  select id into v_auth_id from auth.users where email = v_email;

  if v_auth_id is null then
    v_auth_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      -- These token columns default to NULL, and some GoTrue versions error at
      -- login trying to scan NULL into a string ("converting NULL to string is
      -- unsupported"). Seed them as empty strings to stay compatible.
      confirmation_token, recovery_token, email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_auth_id,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('full_name', v_name),
      now(),
      now(),
      '', '', '', ''
    );

    -- 1b. GoTrue needs a matching identities row for email/password sign-in.
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      v_auth_id::text,
      v_auth_id,
      jsonb_build_object('sub', v_auth_id::text, 'email', v_email, 'email_verified', true),
      'email',
      now(), now(), now()
    );
  end if;

  -- 2. Link the app-user row to the Store department with the Store Executive role
  -- (department-wide access; no delegation inbox). Idempotent — see 0004.
  perform provision_app_user(v_email, v_name, 'store', 'Store Executive');

  raise notice 'Store test user ready: % (password: %)', v_email, v_password;
end;
$$;

-- ---------------------------------------------------------------------------
-- Want the LEAD login (delegation inbox + "· Lead" in the sidebar)? The lead role
-- is 'Store Manager', created by migration 0017 — apply 0017 first, then copy the
-- block above with a different email/name and pass that role instead:
--
--   perform provision_app_user(
--     'store.manager@solarpulse.test', 'Kavita Manager',
--     'store', 'Store Manager'
--   );
-- ---------------------------------------------------------------------------
