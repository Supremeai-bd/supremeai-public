import {
  PagesContext,
  handleCorsPreflight,
  resolveUpstreamOrigin,
  verifyUpstreamSession,
} from '../../../_lib/edgeHelpers';
import { handleUserMemoriesRequest } from '../../../_lib/userMemories';

/**
 * বাংলা মন্তব্য: AI Memory (সব AI-এর মেমরি এক জায়গায়)। আসল লজিক `_lib/userMemories.ts`-এ;
 * এখানে শুধু CORS আর সেশন যাচাই জুড়ে দেওয়া।
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  const upstreamOrigin = resolveUpstreamOrigin(env);
  return handleUserMemoriesRequest(request, env, {
    verify: (req) => verifyUpstreamSession(req, upstreamOrigin),
  });
}
