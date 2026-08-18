-- Solar Pulse OS — test user for the Marketing & Training dashboard
--
-- NOT a migration (no number): this is seed/dev data. Run it in the Supabase SQL
-- editor (or `supabase db execute`) against a dev database — never production.
--
-- It does the two steps 0004 documents in one go:
--   1. create a Supabase Auth login (auth.users + auth.identities), and
--   2. call provision_app_user() to link a public.users row with a role.
--
-- Depends on 0002 (org/departments/roles) and 0014 (the 'Marketing Manager' role)
-- having run. Idempotent: re-running updates the app-user row and leaves the login be.
--
-- LOGIN:  marketing.manager@solarpulse.test  /  Passw0rd!
-- Change the password after first sign-in, or edit the literal below before running.

do $$
declare
  v_email    text := 'marketing.manager@solarpulse.test';
  v_password text := 'Passw0rd!';
  v_name     text := 'Meera Marketing';
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

  -- 2. Link the app-user row with the Marketing Manager role (department-wide access,
  -- and the dashboard's Department tab). Idempotent — see 0004.
  perform provision_app_user(v_email, v_name, 'marketing-training', 'Marketing Manager');

  raise notice 'Marketing test user ready: % (password: %)', v_email, v_password;
end;
$$;

-- ---------------------------------------------------------------------------
-- Want an employee-level login too (own-work view, no Department tab)? The
-- role seeded by 0002 for this department is 'Marketing & Training Executive'.
-- Copy the block above with a different email/name and pass that role instead:
--
--   perform provision_app_user(
--     'marketing.exec@solarpulse.test', 'Ravi Executive',
--     'marketing-training', 'Marketing & Training Executive'
--   );
-- ---------------------------------------------------------------------------
