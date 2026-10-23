/** Minimal canonical identity tables used by every communications migration fixture. */
export const collaborationIdentityFixtureSql = `
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,banned_until timestamptz);
 CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES auth.users(id),not_after timestamptz,created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE customer_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),auth_user_id uuid NOT NULL UNIQUE,email_normalized varchar(255) NOT NULL,display_name varchar(255) NOT NULL,phone_e164 varchar(20),status varchar(20) NOT NULL DEFAULT 'ACTIVE',sessions_valid_after timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),last_signed_in_at timestamptz);
`;
