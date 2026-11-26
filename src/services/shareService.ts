import { apiClient } from './apiClient';
import { env } from '../config/env';

export interface ShareResponse {
  share_id: string;
  share_url: string;
  expires_at?: string;
  created_at?: string;
}

export const shareService = {
  async generateShareLink(conversationId: string): Promise<ShareResponse> {
    if (env.isMockEnabled) {
      const mockId = `shr_${Date.now().toString(36)}`;
      return {
        share_id: mockId,
        share_url: `${window.location.origin}/share/${mockId}`,
        created_at: new Date().toISOString(),
      };
    }

    // বাংলা মন্তব্য: stateless Edge payload আর stored backend share আলাদা contract।
    // Failure-এ নকল /share/id ফেরালে UI মিথ্যা success দেখায়; caller-এর error toast-এ পৌঁছাতে দাও।
    const response = await apiClient.post<ShareResponse>('/api/share/generate', {
      conversation_id: conversationId,
    });
    if (
      !response ||
      typeof response.share_id !== 'string' ||
      !response.share_id.trim() ||
      typeof response.share_url !== 'string' ||
      !response.share_url.trim()
    ) {
      throw new Error('Invalid share response');
    }
    return response;
  },

  async getSharedConversation(shareId: string): Promise<any> {
    return apiClient.get(`/api/share/${encodeURIComponent(shareId)}`, { skipAuth: true });
  },
};
