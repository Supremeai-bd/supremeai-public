// Cross-repo reference: supremeai-public/src/constants/poolProvidersManifest.ts
// Fleet Node manifest (sovereign branding; provider identities only in auth dialog per SSOT 1.1.A)

export interface PoolProviderManifest {
  id: string;
  name: string;
  badge: string;
  category: 'instant_gmail' | 'developer_account';
  logo: string;
  gmailAuthUrl: string;
  keyPattern: string;
  bonusTokensPerDay: number;
  speedBadge: string;
  description: string;
}

export const POOL_PROVIDER_MANIFESTS: PoolProviderManifest[] = [
  {
    id: 'kilo',
    name: 'Kilo AI Gateway (Node Alpha)',
    badge: 'Master Hub • 7-in-1',
    category: 'instant_gmail',
    logo: '👑',
    gmailAuthUrl: 'https://app.kilo.ai/profile',
    keyPattern: '^eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$',
    bonusTokensPerDay: 150000,
    speedBadge: 'Claude/GPT-4o/DeepSeek',
    description: 'Unlocks Claude 3.5 Sonnet, GPT-4o, DeepSeek R1 & Gemini all in one key.',
  },
  {
    id: 'gemini',
    name: 'Google Gemini (Node Omni)',
    badge: 'Popular Free • 1,500 RPD',
    category: 'instant_gmail',
    logo: '🧠',
    gmailAuthUrl: 'https://aistudio.google.com/apikey',
    keyPattern: '^AIzaSy[A-Za-z0-9_-]{33}$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Fast • Multimodal',
    description: 'Generous 1,500 requests per day with 2M token context window.',
  },
  {
    id: 'groq',
    name: 'Groq Cloud (Node Hyper)',
    badge: 'Ultra Fast • 14.4K RPD',
    category: 'instant_gmail',
    logo: '⚡',
    gmailAuthUrl: 'https://console.groq.com/keys',
    keyPattern: '^gsk_[A-Za-z0-9]{52}$',
    bonusTokensPerDay: 100000,
    speedBadge: '300+ tps',
    description: 'Blazing fast inference on Llama 3.3 70B with 14,400 daily requests.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras LPU (Node Hyper)',
    badge: 'Blazing • 1M Tokens/Day',
    category: 'instant_gmail',
    logo: '🚀',
    gmailAuthUrl: 'https://cloud.cerebras.ai/',
    keyPattern: '^csk-[a-z0-9]{32,}$',
    bonusTokensPerDay: 100000,
    speedBadge: '2,000 tps',
    description: 'World record 2,000 tokens/sec speed with 1M tokens/day allowance.',
  },
  {
    id: 'sambanova',
    name: 'SambaNova Cloud (Node Hyper)',
    badge: 'High RPM • Llama 3.3',
    category: 'instant_gmail',
    logo: '🔥',
    gmailAuthUrl: 'https://cloud.sambanova.ai/apis',
    keyPattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Ultra Fast',
    description: 'Full precision Llama 3.3 70B & Qwen 2.5 72B with high RPM limits.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (Node Matrix)',
    badge: 'DeepSeek R1 & Llama 3',
    category: 'instant_gmail',
    logo: '🌐',
    gmailAuthUrl: 'https://openrouter.ai/settings/keys',
    keyPattern: '^sk-or-v1-[a-f0-9]{64}$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Free Reasoning',
    description: 'Broad access to all open-weights models tagged :free.',
  },
  {
    id: 'github',
    name: 'GitHub Models (Node Dev)',
    badge: 'GPT-4o & Claude Free',
    category: 'developer_account',
    logo: '💻',
    gmailAuthUrl: 'https://github.com/settings/personal-access-tokens/new',
    keyPattern: '^(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Smart Models',
    description: 'Azure AI backed playground with 150 requests/day for GitHub developers.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI (Node Dev)',
    badge: 'Codestral & Small',
    category: 'developer_account',
    logo: '🌪️',
    gmailAuthUrl: 'https://console.mistral.ai/api-keys',
    keyPattern: '^[A-Za-z0-9]{32}$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Code & Logic',
    description: 'State of the art code reasoning with Codestral and Mistral Small.',
  },
  {
    id: 'cohere',
    name: 'Cohere (Node Dev)',
    badge: '1,000 Calls / Month Free',
    category: 'developer_account',
    logo: '🔷',
    gmailAuthUrl: 'https://dashboard.cohere.com/api-keys',
    keyPattern: '^[A-Za-z0-9]{40}$',
    bonusTokensPerDay: 100000,
    speedBadge: 'Command-R',
    description: 'High performance enterprise reasoning with Command R+ trial key.',
  },
];
