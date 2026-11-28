import { onRequest as edgeTtsHandler } from './tts/edge';
import { PagesContext, handleCorsPreflight, jsonEdgeResponse } from '../_lib/edgeHelpers';

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
  if (request.method !== 'POST') {
    return jsonEdgeResponse({ error: 'Method not allowed' }, 405, request, undefined, env);
  }
  return edgeTtsHandler(context);
}
