// বাংলা মন্তব্য: core / CI / keep-warm থেকে অ্যালার্ট গ্রহণ — চ্যানেলে পাঠানো ও ইতিহাসে লেখা adminAlerts-এ।
import { PagesContext, handleCorsPreflight } from '../../_lib/edgeHelpers';
import { handleAlertIngest } from '../../_lib/adminAlerts';

export async function onRequest(context: PagesContext): Promise<Response> {
  const preflight = handleCorsPreflight(context.request, context.env);
  if (preflight) return preflight;
  return handleAlertIngest(context.request, context.env);
}
