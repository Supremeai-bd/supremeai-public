// বাংলা মন্তব্য: core / CI / keep-warm থেকে অ্যালার্ট গ্রহণ — চ্যানেলে পাঠানো ও ইতিহাসে লেখা adminAlerts-এ।
import { PagesContext, handleCorsPreflight } from '../../_lib/edgeHelpers';
import { handleAlertIngest } from '../../_lib/adminAlerts';

export async function onRequest(context: PagesContext): Promise<Response> {
  // বাংলা মন্তব্য: কেবল OPTIONS প্রিফ্লাইট হলেই 204 ফেরানো হবে; POST অ্যালার্ট সরাসরি handleAlertIngest-এ যাবে।
  if (context.request.method === 'OPTIONS') {
    return handleCorsPreflight(context.request, context.env);
  }
  return handleAlertIngest(context.request, context.env);
}
