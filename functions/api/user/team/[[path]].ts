import {
  PagesContext,
  handleCorsPreflight,
  resolveUpstreamOrigin,
  verifyUpstreamSession,
} from '../../../_lib/edgeHelpers';
import { handleUserTeamRequest } from '../../../_lib/userTeam';

/**
 * বাংলা মন্তব্য: Team roster + team chat (রোডম্যাপ 4.4)। আসল লজিক `_lib/userTeam.ts`-এ;
 * এখানে শুধু CORS আর সেশন যাচাইয়ের ফাংশন জুড়ে দেওয়া হয়।
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  const upstreamOrigin = resolveUpstreamOrigin(env);
  return handleUserTeamRequest(request, env, {
    verify: (req) => verifyUpstreamSession(req, upstreamOrigin),
  });
}
