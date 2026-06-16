-- ============================================================================
-- Plan Sharing: create plan_shares table + update plans RLS
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- ============================================================================

-- 1. Create the plan_shares table
CREATE TABLE IF NOT EXISTS public.plan_shares (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id       uuid NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  owner_email   text NOT NULL,
  shared_with_email text NOT NULL,
  permission    text NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'edit')),
  seen          boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate shares of the same plan to the same person
  UNIQUE (plan_id, shared_with_email)
);

-- Index for fast lookups by recipient email
CREATE INDEX IF NOT EXISTS idx_plan_shares_recipient ON public.plan_shares(shared_with_email);
-- Index for fast lookups by plan_id (for listing who a plan is shared with)
CREATE INDEX IF NOT EXISTS idx_plan_shares_plan ON public.plan_shares(plan_id);

-- 2. Enable RLS on plan_shares
ALTER TABLE public.plan_shares ENABLE ROW LEVEL SECURITY;

-- plan_shares RLS: users can read shares where they are the recipient
CREATE POLICY "Users can view shares for themselves"
  ON public.plan_shares FOR SELECT
  USING (
    shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- plan_shares RLS: plan owners can read shares they created
CREATE POLICY "Owners can view shares they created"
  ON public.plan_shares FOR SELECT
  USING (
    plan_id IN (SELECT id FROM public.plans WHERE user_id = auth.uid())
  );

-- 3. Update plans RLS: allow shared users to SELECT plans shared with them
-- First, check if the default select policy exists and drop it if needed
-- (Adjust the policy name to match your existing policy)
-- DROP POLICY IF EXISTS "Users can view own plans" ON public.plans;

-- New SELECT policy: own plans OR shared-with-me plans
CREATE POLICY "Users can view shared plans"
  ON public.plans FOR SELECT
  USING (
    user_id = auth.uid()
    OR id IN (
      SELECT plan_id FROM public.plan_shares
      WHERE shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
  );

-- New UPDATE policy: own plans OR shared-with-me plans with edit permission
CREATE POLICY "Users can update shared plans with edit permission"
  ON public.plans FOR UPDATE
  USING (
    user_id = auth.uid()
    OR id IN (
      SELECT plan_id FROM public.plan_shares
      WHERE shared_with_email = (SELECT email FROM auth.users WHERE id = auth.uid())
        AND permission = 'edit'
    )
  );
