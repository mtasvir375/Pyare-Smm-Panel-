-- Supabase Migration Schema
-- Run this in your Supabase SQL Editor

-- 1. Users Table
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT auth.uid(),
  email text UNIQUE NOT NULL,
  display_name text,
  role text DEFAULT 'student',
  balance decimal(12,2) DEFAULT 0.00,
  last_active timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- 2. Services (Courses) Table
CREATE TABLE IF NOT EXISTS public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text,
  price decimal(12,2) NOT NULL,
  status text DEFAULT 'published',
  updated_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- 3. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES public.services(id),
  title text, -- Redundant but useful for history if service is deleted
  target_link text NOT NULL,
  quantity integer NOT NULL,
  total_price decimal(12,2) NOT NULL,
  status text DEFAULT 'pending',
  provider_order_id text,
  created_at timestamp with time zone DEFAULT now()
);

-- 4. Transactions (Deposits/Balance changes) Table
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  amount decimal(12,2) NOT NULL,
  type text NOT NULL, -- 'deposit', 'order', 'refund'
  status text DEFAULT 'pending',
  utr text UNIQUE,
  screenshot_url text,
  created_at timestamp with time zone DEFAULT now()
);

-- 5. Providers Table
CREATE TABLE IF NOT EXISTS public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  api_url text NOT NULL,
  api_key text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- 6. Settings Table
CREATE TABLE IF NOT EXISTS public.settings (
  id text PRIMARY KEY,
  payment_qr_url text,
  upi_id text,
  merchant_name text,
  provider_api_url text,
  provider_api_key text,
  backend_api_url text,
  whatsapp_link text,
  whatsapp_chat_number text,
  guide_video_url text,
  razorpay_enabled boolean DEFAULT false,
  razorpay_key_id text,
  razorpay_key_secret text,
  auto_approve_deposits boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Basic Policies (Adjust based on exact needs)
-- Users can see their own profile
CREATE POLICY "Users can view own profile" ON users FOR SELECT USING (auth.uid() = id);
-- Public can view services
CREATE POLICY "Public can view services" ON services FOR SELECT USING (true);
-- Users can view own orders
CREATE POLICY "Users can view own orders" ON orders FOR SELECT USING (auth.uid() = user_id);
-- Users can view own transactions
CREATE POLICY "Users can view own transactions" ON transactions FOR SELECT USING (auth.uid() = user_id);
