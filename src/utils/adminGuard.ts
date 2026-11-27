import { useControlCenterStore, type SafetyGatePrompt } from '../stores/useControlCenterStore';
import { toast } from '../stores/useToastStore';

/**
 * বাংলা মন্তব্য: অ্যাডমিন প্যানেলের বিপজ্জনক বোতামের জন্য এক জায়গার গেট।
 * নতুন modal বানানো হয়নি — বিদ্যমান ControlCenterSafetyGateModal-ই ব্যবহার হয়।
 * এই store অ্যাকশনগুলোর ব্যাকএন্ড dry-run বোঝে না, তাই "Dry-Run Preview" চাপলে
 * কিছুই পাঠানো হয় না — শুধু জানানো হয় যে কিছু বদলায়নি।
 */
export interface AdminGuardOptions {
  title: string;
  description: string;
  impactSummary: string;
  riskLevel: SafetyGatePrompt['riskLevel'];
  run: () => unknown;
}

export function guardAdminAction(options: AdminGuardOptions): void {
  const { run, ...prompt } = options;
  useControlCenterStore.getState().requestGuardedAction({
    ...prompt,
    onExecute: async (gate) => {
      if (gate.dryRun) {
        toast.info('ড্রাই-রান', 'শুধু প্রিভিউ — কিছুই বদলানো হয়নি।');
        return;
      }
      await run();
    },
  });
}

export { adminWriteErrorMessage, isNotWiredError } from './adminWriteError';
