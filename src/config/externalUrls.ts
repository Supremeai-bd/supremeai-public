const getEnvVar = (key: string, fallback: string): string => {
  try {
    const val = (import.meta as unknown as { env?: Record<string, string> }).env?.[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  } catch {
    // Ignore when imported in Node/SSR contexts
  }
  return fallback;
};

export const EXTERNAL_URLS = {
  tailwindCdn: getEnvVar('VITE_CDN_TAILWIND_URL', 'https://cdn.tailwindcss.com'),
  babelStandaloneCdn: getEnvVar(
    'VITE_CDN_BABEL_URL',
    'https://unpkg.com/@babel/standalone/babel.min.js'
  ),
  mermaidCdn: getEnvVar(
    'VITE_CDN_MERMAID_URL',
    'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
  ),
  esmReactBase: getEnvVar('VITE_CDN_ESM_REACT_URL', 'https://esm.sh/react@19.2.0'),
  esmReactDomClientBase: getEnvVar(
    'VITE_CDN_ESM_REACT_DOM_CLIENT_URL',
    'https://esm.sh/react-dom@19.2.0/client'
  ),
  esmReactDomBase: getEnvVar('VITE_CDN_ESM_REACT_DOM_URL', 'https://esm.sh/react-dom@19.2.0'),
  esmLucideReact: getEnvVar('VITE_CDN_ESM_LUCIDE_URL', 'https://esm.sh/lucide-react@0.577.0'),
  mermaidUmdCdn: getEnvVar(
    'VITE_CDN_MERMAID_UMD_URL',
    'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
  ),
  umdReact18: getEnvVar(
    'VITE_CDN_UMD_REACT_URL',
    'https://unpkg.com/react@18/umd/react.development.js'
  ),
  umdReactDom18: getEnvVar(
    'VITE_CDN_UMD_REACT_DOM_URL',
    'https://unpkg.com/react-dom@18/umd/react-dom.development.js'
  ),
  esmCdnOrigin: getEnvVar('VITE_CDN_ESM_ORIGIN', 'https://esm.sh'),
  esmPreviewReact: getEnvVar('VITE_CDN_ESM_PREVIEW_REACT_URL', 'https://esm.sh/react@18.3.1'),
  esmPreviewReactDom: getEnvVar(
    'VITE_CDN_ESM_PREVIEW_REACT_DOM_URL',
    'https://esm.sh/react-dom@18.3.1'
  ),
  githubOrgBase: getEnvVar('VITE_GITHUB_ORG_URL', 'https://github.com/Supremeai-bd'),
  githubFrontendRepo: getEnvVar(
    'VITE_GITHUB_FRONTEND_REPO',
    'https://github.com/Supremeai-bd/supremeai-public'
  ),
  githubPublicRepo: getEnvVar(
    'VITE_GITHUB_PUBLIC_REPO',
    'https://github.com/Supremeai-bd/supremeai-public'
  ),
  githubBackendRepo: getEnvVar(
    'VITE_GITHUB_BACKEND_REPO',
    'https://github.com/Supremeai-bd/supremeai'
  ),
  webStudioUrl: getEnvVar('VITE_WEB_STUDIO_URL', 'https://supremeai-studio.pages.dev'),
  mcpTowerUrl: getEnvVar('VITE_MCP_TOWER_URL', 'https://supremeai-mcp-tower-live.onrender.com/mcp'),
};

export const getRuntimeOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return '';
};
