import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PlanTier } from './platformState';

/**
 * User & customer directory primitives for the Express bootstrap: admin identity
 * config (env-driven), user/customer record types, the session signing secret,
 * the dev-only users cache file and the dev-only demo customer seed. Moved
 * verbatim out of `server.ts` (docs/SERVER_TS_SPLIT_PLAN.md); the mutable
 * `usersDb` / `customerDirectory` arrays stay in `server.ts`.
 *
 * বাংলা: server.ts ভাগ — শুধু টাইপ/সিড/হেল্পার; আচরণ অপরিবর্তিত।
 */

export const createAdminIdentityConfig = () => {
  const envAdminEmails = [
    'niloyjoy7@gmail.com',
    'paykaribazaronline@gmail.com',
    process.env.ADMIN_EMAIL,
    ...(process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : []),
  ]
    .map((e) => (e || '').trim().toLowerCase())
    .filter(Boolean);

  // Personal/organisational emails are never seeded from source control. The only
  // built-in admin identities come from ADMIN_EMAIL / ADMIN_EMAILS, and users or
  // customers declared admin in the database (see getDatabaseAdminEmails below).
  const SEEDED_ADMIN_EMAILS = new Set<string>(envAdminEmails);
  // Admin user IDs are likewise environment-driven, never hardcoded.
  const ADMIN_USER_IDS = new Set(
    (process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
  );
  const ADMIN_RBAC_ROLES = new Set(['admin', 'super_admin', 'superadmin', 'root_admin', 'owner']);
  return { envAdminEmails, SEEDED_ADMIN_EMAILS, ADMIN_USER_IDS, ADMIN_RBAC_ROLES };
};

export type RbacRole = 'admin' | 'super_admin' | 'developer' | 'user';

export interface ServerUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  rbacRole?: RbacRole;
  isAdminEligible: boolean;
  isDeveloperEligible: boolean;
  adminUserId?: string;
  plan: PlanTier;
  createdAt: string;
  avatar?: string;
}

export interface ServerCustomerRecord {
  id: string;
  name: string;
  email: string;
  tier: PlanTier;
  status: 'active' | 'past_due' | 'suspended';
  mrr: number;
  tokensUsed: number;
  tokenLimit: number;
  connectedRepos: number;
  joinedDate: string;
  lastActive: string;
  githubHandle?: string;
  region: string;
  isDeveloperEligible: boolean;
  isAdminEligible?: boolean;
  rbacRole?: RbacRole;
}

export const getSessionSigningSecret = (): string => {
  // বাংলা মন্তব্য: ডুয়াল-পারপাস কী (ADMIN_PASSKEY) সাইনিং চেইন থেকে বাদ দেওয়া হয়েছে যাতে সেশন টোকেন ও পাসকি আলাদা থাকে
  const fromEnv = process.env.AUTH_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const keyFilePath = path.join(os.tmpdir(), 'supremeai_session_signing.key');
  try {
    if (fs.existsSync(keyFilePath)) {
      const existing = fs.readFileSync(keyFilePath, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyFilePath, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
};

export const DEV_USERS_FILE = path.join(os.tmpdir(), 'supremeai_dev_users.json');
export const loadDevUsersDb = (isProduction: boolean): ServerUser[] => {
  if (isProduction) return [];
  try {
    if (fs.existsSync(DEV_USERS_FILE)) {
      const raw = fs.readFileSync(DEV_USERS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Ignore corrupt dev cache
  }
  return [];
};
export const persistDevUsersDb = (users: ServerUser[], isProduction: boolean) => {
  if (isProduction) return;
  try {
    fs.writeFileSync(DEV_USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal in read-only environments
  }
};

/** Dev/preview demo customers (empty in production). */
export const createCustomerDirectorySeed = (isProduction: boolean): ServerCustomerRecord[] =>
  isProduction
    ? []
    : [
        {
          id: 'cust_001',
          name: 'Studio Developer',
          email: 'demo.developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 142500,
          tokenLimit: 1000000,
          connectedRepos: 2,
          joinedDate: '2026-01-14',
          lastActive: 'Just now',
          githubHandle: 'supremeai-dev',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_sarah',
          name: 'Sarah Chen',
          email: 'sarah.chen@fintech.io',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 384200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-03-10',
          lastActive: '5 mins ago',
          githubHandle: 'sarah-fintech',
          region: 'US/West',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_alex',
          name: 'Alex Johnson',
          email: 'alex.j@partner.io',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 24500,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-04-01',
          lastActive: '1 hour ago',
          githubHandle: 'alexj-partner',
          region: 'Europe/London',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_002',
          name: 'Rahim Chowdhury',
          email: 'rahim.chowdhury@techscale.io',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 1845000,
          tokenLimit: 5000000,
          connectedRepos: 14,
          joinedDate: '2025-11-03',
          lastActive: '12 mins ago',
          githubHandle: 'rahim-techscale',
          region: 'Asia/Singapore',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_003',
          name: 'Sarah Jenkins',
          email: 'sarah.j@vertexlabs.ai',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 2910000,
          tokenLimit: 5000000,
          connectedRepos: 8,
          joinedDate: '2025-10-22',
          lastActive: '45 mins ago',
          githubHandle: 'sjenkins-ai',
          region: 'US/East',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_004',
          name: 'Demo Developer',
          email: 'developer@supremeai.bd',
          tier: 'Pro',
          status: 'active',
          mrr: 29,
          tokensUsed: 620400,
          tokenLimit: 1000000,
          connectedRepos: 3,
          joinedDate: '2026-02-01',
          lastActive: '2 hours ago',
          githubHandle: 'demo-developer',
          region: 'Asia/Dhaka',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_005',
          name: 'Elena Rostova',
          email: 'elena@novasoft.eu',
          tier: 'Pro',
          status: 'past_due',
          mrr: 29,
          tokensUsed: 980200,
          tokenLimit: 1000000,
          connectedRepos: 4,
          joinedDate: '2026-01-18',
          lastActive: '5 hours ago',
          githubHandle: 'elena-novasoft',
          region: 'Europe/Berlin',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_006',
          name: 'Marcus Brody',
          email: 'marcus.brody@openbuild.dev',
          tier: 'Free',
          status: 'active',
          mrr: 0,
          tokensUsed: 42100,
          tokenLimit: 100000,
          connectedRepos: 1,
          joinedDate: '2026-02-10',
          lastActive: '1 day ago',
          githubHandle: 'mbrody',
          region: 'US/West',
          isDeveloperEligible: false,
        },
        {
          id: 'cust_007',
          name: 'Fatima Al-Mansoor',
          email: 'fatima@cloudcore.ae',
          tier: 'Enterprise',
          status: 'active',
          mrr: 199,
          tokensUsed: 3120000,
          tokenLimit: 5000000,
          connectedRepos: 12,
          joinedDate: '2025-12-08',
          lastActive: '3 hours ago',
          githubHandle: 'fatima-cloud',
          region: 'MiddleEast/Dubai',
          isDeveloperEligible: true,
        },
        {
          id: 'cust_010',
          name: 'David Zhao',
          email: 'zhao.david@quantmatrix.com',
          tier: 'Free',
          status: 'suspended',
          mrr: 0,
          tokensUsed: 100000,
          tokenLimit: 100000,
          connectedRepos: 0,
          joinedDate: '2026-02-04',
          lastActive: '7 days ago',
          githubHandle: 'zhaodavid',
          region: 'Asia/Tokyo',
          isDeveloperEligible: false,
        },
      ];
