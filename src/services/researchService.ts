import { apiClient } from './apiClient';
import { env } from '../config/env';

export interface ResearchSection {
  title: string;
  content: string;
  sources?: string[];
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet?: string;
}

export interface ResearchReport {
  title: string;
  summary: string;
  sections: ResearchSection[];
  sources: ResearchSource[];
}

export interface DeepResearchResult {
  id: string;
  report: ResearchReport;
  steps_completed: number;
  total_sources: number;
}

export interface ResearchHistoryItem {
  id: string;
  query: string;
  status: string;
  steps_completed: number;
  total_sources: number;
  created_at: string;
  report?: ResearchReport;
}

export const researchService = {
  async execute(
    query: string,
    maxSteps: number = 8,
    language: 'en' | 'bn' = 'en'
  ): Promise<DeepResearchResult> {
    if (env.isMockEnabled) {
      const isBn = language === 'bn';
      return {
        id: `res_${Date.now()}`,
        steps_completed: maxSteps,
        total_sources: 6,
        report: {
          title: isBn ? `ডিপ রিসার্চ বিশ্লেষণ: ${query}` : `Deep Research Analysis: ${query}`,
          summary: isBn
            ? `"${query}" বিষয়ে একাধিক উৎস থেকে প্রাপ্ত প্রযুক্তিগত তথ্য, সিস্টেম বেঞ্চমার্ক ও আর্কিটেকচারাল বিশ্লেষণের সারসংক্ষেপ।`
            : `Synthesized multi-source empirical investigation into ${query}. Analysis includes system benchmarks, verified documentation, and architectural considerations.`,
          sections: [
            {
              title: isBn ? '১. নির্বাহী সারসংক্ষেপ ও পরিধি' : '1. Executive Summary & Problem Scope',
              content: isBn
                ? `"${query}" বিশ্লেষণে দেখা যায় এটি প্রোডাকশন ডিস্ট্রিবিউটেড সিস্টেম ও ক্লাউড অপ্টিমাইজেশনের সাথে সরাসরি সম্পর্কিত।`
                : `A thorough investigation of "${query}" indicates high relevance to production distributed systems and cloud optimization strategies. Current industry standards emphasize zero-cost tiers, fail-safe redundancy, and verified cryptographic attestation.`,
              sources: ['https://supremeai.bd/docs', 'https://docs.render.com'],
            },
            {
              title: isBn
                ? '২. প্রযুক্তিগত আর্কিটেকচার ও ইনভ্যারিয়েন্ট'
                : '2. Technical Architecture & Invariants',
              content: isBn
                ? 'মাল্টি-টেন্যান্ট আইসোলেশন, Redis কমান্ড পুলিং এবং pgvector মেমোরি প্রজেকশন ৯৯.৯% আপটাইম নিশ্চিত করে।'
                : `Key findings demonstrate that multi-tenant isolation, combined with Redis command pooling and pgvector memory projections, yields 99.9% uptime while eliminating cold-start latency regressions.`,
              sources: ['https://upstash.com/docs', 'https://supabase.com/docs'],
            },
            {
              title: isBn ? '৩. কৌশলগত সুপারিশ' : '3. Strategic Recommendations',
              content: isBn
                ? 'স্বয়ংক্রিয় কোটা গভার্নর, PaaS সীমানা নীতি এবং সব ডেটা স্টোরে অ্যাটমিক রোলব্যাক হ্যান্ডলার ব্যবহার করুন।'
                : `Implement automated quota governors, enforce strict single-service account boundaries on PaaS providers, and maintain atomic database rollback handlers on all mission-critical data stores.`,
              sources: ['https://github.com/Supremeai-bd/supremeai'],
            },
          ],
          sources: [
            {
              title: 'SupremeAI Architectural SSOT',
              url: 'https://supremeai.bd/docs',
              snippet: 'Multi-cloud free tier safeguard specification',
            },
            {
              title: 'Render Multi-Service Blueprint',
              url: 'https://docs.render.com',
              snippet: 'Account limits and runtime isolation',
            },
            {
              title: 'Upstash Global Distributed Quota',
              url: 'https://upstash.com/docs',
              snippet: 'Command budgeting and latency metrics',
            },
          ],
        },
      };
    }

    try {
      return await apiClient.post<DeepResearchResult>('/api/research/deep', {
        query,
        max_steps: maxSteps,
        language,
        language_pref: language,
      });
    } catch (err: unknown) {
      throw new Error(err instanceof Error ? err.message : 'Deep research execution failed.', {
        cause: err,
      });
    }
  },

  async getHistory(): Promise<ResearchHistoryItem[]> {
    if (env.isMockEnabled) {
      return [];
    }
    try {
      const res = await apiClient.get<ResearchHistoryItem[]>('/api/research/history');
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  },

  async getDetail(researchId: string): Promise<DeepResearchResult | null> {
    if (env.isMockEnabled) {
      return null;
    }
    try {
      return await apiClient.get<DeepResearchResult>(
        `/api/research/${encodeURIComponent(researchId)}`
      );
    } catch {
      return null;
    }
  },
};
