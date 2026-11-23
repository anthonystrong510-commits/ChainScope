-- ChainScope Full PostgreSQL Schema for Supabase
-- Run this script inside your Supabase Dashboard -> SQL Editor.
-- Safe to re-run on existing projects (includes IF NOT EXISTS & column migrations).
-- Server-side Express routes (/api/db/*) use SUPABASE_SERVICE_ROLE_KEY (AI Studio Secrets),
-- which bypasses Row Level Security while keeping public anon REST access locked down.

CREATE TABLE IF NOT EXISTS public.chainscope_users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL,
  display_name TEXT NOT NULL,
  linked_wallet TEXT NOT NULL DEFAULT '',
  sol_balance NUMERIC NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.chainscope_users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.chainscope_meme_coins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ticker TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  chain TEXT NOT NULL DEFAULT 'solana',
  mode TEXT NOT NULL DEFAULT 'standard',
  emblem_icon TEXT NOT NULL DEFAULT 'rocket',
  emblem_color TEXT NOT NULL DEFAULT '#3B82F6',
  website TEXT NOT NULL DEFAULT '',
  twitter TEXT NOT NULL DEFAULT '',
  creator_uid TEXT NOT NULL,
  creator_handle TEXT NOT NULL,
  virtual_sol NUMERIC NOT NULL DEFAULT 30,
  virtual_tokens NUMERIC NOT NULL DEFAULT 1073000000,
  real_sol NUMERIC NOT NULL DEFAULT 0,
  total_supply NUMERIC NOT NULL DEFAULT 1000000000,
  price_sol NUMERIC NOT NULL DEFAULT 0,
  market_cap_sol NUMERIC NOT NULL DEFAULT 0,
  volume_sol NUMERIC NOT NULL DEFAULT 0,
  trade_count INTEGER NOT NULL DEFAULT 0,
  graduated BOOLEAN NOT NULL DEFAULT FALSE,
  holder_reward_pool_sol NUMERIC NOT NULL DEFAULT 0,
  creator_fees_sol NUMERIC NOT NULL DEFAULT 0,
  gas_collected_sol NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS emblem_icon TEXT NOT NULL DEFAULT 'rocket';
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS emblem_color TEXT NOT NULL DEFAULT '#3B82F6';
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS twitter TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS total_supply NUMERIC NOT NULL DEFAULT 1000000000;
ALTER TABLE public.chainscope_meme_coins ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.chainscope_trades (
  id TEXT PRIMARY KEY,
  coin_id TEXT NOT NULL,
  trader_uid TEXT NOT NULL,
  trader_handle TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  sol_amount NUMERIC NOT NULL DEFAULT 0,
  token_amount NUMERIC NOT NULL DEFAULT 0,
  price_sol NUMERIC NOT NULL DEFAULT 0,
  gas_sol NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_trades_coin_created ON public.chainscope_trades (coin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_comments (
  id TEXT PRIMARY KEY,
  coin_id TEXT NOT NULL,
  author_uid TEXT NOT NULL,
  author_handle TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_comments_coin_created ON public.chainscope_comments (coin_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_holdings (
  owner_uid TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  emblem_icon TEXT NOT NULL DEFAULT 'rocket',
  emblem_color TEXT NOT NULL DEFAULT '#3B82F6',
  token_balance NUMERIC NOT NULL DEFAULT 0,
  avg_buy_price_sol NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_uid, coin_id)
);

CREATE TABLE IF NOT EXISTS public.chainscope_perp_positions (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  collateral_sol NUMERIC NOT NULL DEFAULT 0,
  leverage INTEGER NOT NULL DEFAULT 1,
  entry_price_sol NUMERIC NOT NULL DEFAULT 0,
  liquidation_price_sol NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
  realized_pnl_sol NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_perps_owner_created ON public.chainscope_perp_positions (owner_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_reward_claims (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  coin_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  claimed_sol NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_claims_owner_created ON public.chainscope_reward_claims (owner_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_admins (
  uid TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('superadmin', 'moderator')),
  granted_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chainscope_admin_audit_logs (
  id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_audit_created ON public.chainscope_admin_audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_admin_wallets (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('hot', 'cold', 'emergency')),
  origin TEXT NOT NULL CHECK (origin IN ('created', 'imported')),
  evm_address TEXT NOT NULL DEFAULT '',
  solana_address TEXT NOT NULL DEFAULT '',
  assigned_uid TEXT NOT NULL DEFAULT '',
  assigned_handle TEXT NOT NULL DEFAULT '',
  treasury_sol NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.chainscope_admin_wallets ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_admin_wallets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.chainscope_emergency_funds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  allocated_sol NUMERIC NOT NULL DEFAULT 0,
  disbursed_sol NUMERIC NOT NULL DEFAULT 0,
  source_wallet_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'standby',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.chainscope_emergency_funds ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_emergency_funds ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.chainscope_platform_economics (
  id TEXT PRIMARY KEY,
  creation_fee_sol NUMERIC NOT NULL DEFAULT 0.01,
  base_gas_sol NUMERIC NOT NULL DEFAULT 0.0005,
  priority_gas_sol NUMERIC NOT NULL DEFAULT 0.0015,
  protocol_fee_bps INTEGER NOT NULL DEFAULT 50,
  holder_reward_bps INTEGER NOT NULL DEFAULT 30,
  creator_fee_bps INTEGER NOT NULL DEFAULT 20,
  congestion_multiplier NUMERIC NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.chainscope_platform_economics ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT '';

INSERT INTO public.chainscope_platform_economics (
  id, creation_fee_sol, base_gas_sol, priority_gas_sol,
  protocol_fee_bps, holder_reward_bps, creator_fee_bps, congestion_multiplier, updated_by
)
VALUES ('economics', 0.01, 0.0005, 0.0015, 50, 30, 20, 1.0, 'system')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.chainscope_wallet_snapshots (
  id TEXT PRIMARY KEY,
  wallet_id TEXT NOT NULL,
  label TEXT NOT NULL,
  evm_address TEXT NOT NULL DEFAULT '',
  solana_address TEXT NOT NULL DEFAULT '',
  total_usd NUMERIC NOT NULL DEFAULT 0,
  chains JSONB NOT NULL DEFAULT '{}'::jsonb,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (public anon access denied by default; Express server uses service_role)
ALTER TABLE public.chainscope_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_meme_coins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_perp_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_reward_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_admin_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_emergency_funds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_platform_economics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_wallet_snapshots ENABLE ROW LEVEL SECURITY;

-- ChainScope System Coin (CSC-1) Network Tables
CREATE TABLE IF NOT EXISTS public.chainscope_csc_network (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL DEFAULT 7860,
  block_height BIGINT NOT NULL DEFAULT 1000,
  mined_supply NUMERIC NOT NULL DEFAULT 0,
  reward_pool_remaining NUMERIC NOT NULL DEFAULT 14000000,
  burned_supply NUMERIC NOT NULL DEFAULT 0,
  usdt_pool_csc NUMERIC NOT NULL DEFAULT 500000,
  usdt_pool_usd NUMERIC NOT NULL DEFAULT 125000,
  usdt_volume_usd NUMERIC NOT NULL DEFAULT 0,
  usd1_pool_csc NUMERIC NOT NULL DEFAULT 500000,
  usd1_pool_usd NUMERIC NOT NULL DEFAULT 125000,
  usd1_volume_usd NUMERIC NOT NULL DEFAULT 0,
  total_tx_count BIGINT NOT NULL DEFAULT 0,
  total_taps BIGINT NOT NULL DEFAULT 0,
  price_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chainscope_csc_accounts (
  uid TEXT PRIMARY KEY,
  handle TEXT NOT NULL DEFAULT '',
  referral_code TEXT UNIQUE NOT NULL,
  referred_by_uid TEXT NOT NULL DEFAULT '',
  referred_by_code TEXT NOT NULL DEFAULT '',
  referral_count INTEGER NOT NULL DEFAULT 0,
  referral_bonus_csc NUMERIC NOT NULL DEFAULT 0,
  energy INTEGER NOT NULL DEFAULT 100,
  last_energy_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_taps BIGINT NOT NULL DEFAULT 0,
  total_mined_csc NUMERIC NOT NULL DEFAULT 0,
  total_gas_paid_csc NUMERIC NOT NULL DEFAULT 0,
  primary_wallet_id TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chainscope_csc_wallets (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  owner_handle TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT 'Primary CSC Vault',
  address TEXT UNIQUE NOT NULL,
  evm_address TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'genesis',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  csc_balance NUMERIC NOT NULL DEFAULT 0,
  usdt_balance NUMERIC NOT NULL DEFAULT 0,
  usd1_balance NUMERIC NOT NULL DEFAULT 0,
  nonce BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chainscope_csc_transactions (
  id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  tx_type TEXT NOT NULL,
  from_address TEXT NOT NULL DEFAULT '',
  to_address TEXT NOT NULL DEFAULT '',
  from_label TEXT NOT NULL DEFAULT '',
  to_label TEXT NOT NULL DEFAULT '',
  asset_in TEXT NOT NULL,
  amount_in NUMERIC NOT NULL DEFAULT 0,
  asset_out TEXT NOT NULL,
  amount_out NUMERIC NOT NULL DEFAULT 0,
  gas_fee_csc NUMERIC NOT NULL DEFAULT 0,
  burned_csc NUMERIC NOT NULL DEFAULT 0,
  price_usd_at_tx NUMERIC NOT NULL DEFAULT 0.25,
  note TEXT NOT NULL DEFAULT '',
  actor_uid TEXT NOT NULL DEFAULT '',
  actor_handle TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.chainscope_csc_network ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_csc_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_csc_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_csc_transactions ENABLE ROW LEVEL SECURITY;

-- Wallet Username/Password Auth, Profile Photos & Optional Google Linking
ALTER TABLE public.chainscope_users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_users ADD COLUMN IF NOT EXISTS linked_google_uid TEXT NOT NULL DEFAULT '';
ALTER TABLE public.chainscope_users ADD COLUMN IF NOT EXISTS linked_google_email TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.chainscope_wallet_auth (
  uid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  evm_address TEXT NOT NULL DEFAULT '',
  solana_address TEXT NOT NULL DEFAULT '',
  csc_address TEXT NOT NULL DEFAULT '',
  linked_google_uid TEXT NOT NULL DEFAULT '',
  linked_google_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.chainscope_wallet_auth ENABLE ROW LEVEL SECURITY;

-- Strict 1:1 Username <-> Wallet Fingerprint Index
ALTER TABLE public.chainscope_wallet_auth ADD COLUMN IF NOT EXISTS wallet_fingerprint TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_chainscope_wallet_auth_evm_unique
  ON public.chainscope_wallet_auth (LOWER(evm_address))
  WHERE evm_address <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_chainscope_wallet_auth_sol_unique
  ON public.chainscope_wallet_auth (solana_address)
  WHERE solana_address <> '';

-- Decentralized Proof-Based P2P Exchange Tables
CREATE TABLE IF NOT EXISTS public.chainscope_p2p_payment_profiles (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'USD',
  method_id TEXT NOT NULL,
  method_name TEXT NOT NULL,
  account_holder TEXT NOT NULL DEFAULT '',
  account_details TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_p2p_profiles_owner
  ON public.chainscope_p2p_payment_profiles (owner_uid, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_p2p_ads (
  id TEXT PRIMARY KEY,
  maker_uid TEXT NOT NULL,
  maker_username TEXT NOT NULL,
  maker_display_name TEXT NOT NULL DEFAULT '',
  maker_wallet_address TEXT NOT NULL DEFAULT '',
  maker_evm_address TEXT NOT NULL DEFAULT '',
  maker_solana_address TEXT NOT NULL DEFAULT '',
  maker_csc_address TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL CHECK (side IN ('sell', 'buy')),
  asset TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'US',
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  price_type TEXT NOT NULL DEFAULT 'fixed' CHECK (price_type IN ('fixed', 'floating')),
  fixed_price_fiat NUMERIC NOT NULL DEFAULT 0,
  floating_margin_pct NUMERIC NOT NULL DEFAULT 0,
  available_crypto_amount NUMERIC NOT NULL DEFAULT 0,
  min_fiat_order NUMERIC NOT NULL DEFAULT 10,
  max_fiat_order NUMERIC NOT NULL DEFAULT 5000,
  payment_method_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_method_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  payment_window_mins INTEGER NOT NULL DEFAULT 15,
  escrow_mode TEXT NOT NULL DEFAULT 'vault_balance' CHECK (escrow_mode IN ('vault_balance', 'onchain_proof')),
  terms TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_p2p_ads_market
  ON public.chainscope_p2p_ads (status, side, asset, country_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_p2p_orders (
  id TEXT PRIMARY KEY,
  ad_id TEXT NOT NULL,
  asset TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'US',
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  unit_price_fiat NUMERIC NOT NULL DEFAULT 0,
  crypto_amount NUMERIC NOT NULL DEFAULT 0,
  fiat_amount NUMERIC NOT NULL DEFAULT 0,
  fee_crypto NUMERIC NOT NULL DEFAULT 0,
  net_buyer_crypto NUMERIC NOT NULL DEFAULT 0,
  buyer_uid TEXT NOT NULL,
  buyer_username TEXT NOT NULL,
  buyer_wallet_address TEXT NOT NULL DEFAULT '',
  seller_uid TEXT NOT NULL,
  seller_username TEXT NOT NULL,
  seller_wallet_address TEXT NOT NULL DEFAULT '',
  payment_method_id TEXT NOT NULL,
  payment_method_name TEXT NOT NULL,
  payment_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  escrow_mode TEXT NOT NULL DEFAULT 'vault_balance',
  escrow_asset_locked BOOLEAN NOT NULL DEFAULT FALSE,
  escrow_locked_amount NUMERIC NOT NULL DEFAULT 0,
  escrow_tx_hash TEXT NOT NULL DEFAULT '',
  escrow_signature TEXT NOT NULL DEFAULT '',
  escrow_vault_address TEXT NOT NULL DEFAULT '',
  fiat_proof_ref TEXT NOT NULL DEFAULT '',
  fiat_proof_image TEXT NOT NULL DEFAULT '',
  fiat_proof_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_escrow',
  dispute_reason TEXT NOT NULL DEFAULT '',
  disputed_by_uid TEXT NOT NULL DEFAULT '',
  admin_resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by_uid TEXT NOT NULL DEFAULT '',
  resolved_by_handle TEXT NOT NULL DEFAULT '',
  payment_deadline_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  escrow_locked_at TIMESTAMPTZ,
  fiat_paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_chainscope_p2p_orders_parties
  ON public.chainscope_p2p_orders (buyer_uid, seller_uid, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.chainscope_p2p_messages (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  sender_uid TEXT NOT NULL,
  sender_username TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'buyer',
  kind TEXT NOT NULL DEFAULT 'text',
  text TEXT NOT NULL DEFAULT '',
  attachment_image TEXT NOT NULL DEFAULT '',
  tx_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chainscope_p2p_messages_order
  ON public.chainscope_p2p_messages (order_id, created_at ASC);

ALTER TABLE public.chainscope_p2p_payment_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_p2p_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_p2p_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chainscope_p2p_messages ENABLE ROW LEVEL SECURITY;
