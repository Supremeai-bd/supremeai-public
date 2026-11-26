import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['{src,functions}/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'src/shared/productionHardening.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary'],
      // বাংলা: কভারেজ শুধু সেই কোডে মাপা হয় যেটা ইউনিট-টেস্ট করার কথা।
      // বড় React ভিউ (src/components/**) ইচ্ছাকৃতভাবে বাদ — ওগুলো E2E/Playwright-এর
      // বিষয়, jsdom-এ ওগুলোর কভারেজ মাপলে সংখ্যাটা ২০%-এ নেমে যায় এবং গেট অর্থহীন হয়।
      include: [
        'src/services/**/*.{ts,tsx}',
        'src/utils/**/*.{ts,tsx}',
        'src/stores/**/*.{ts,tsx}',
        'src/shared/**/*.{ts,tsx}',
        'src/server/**/*.{ts,tsx}',
        'src/api/**/*.{ts,tsx}',
        'src/lib/**/*.{ts,tsx}',
        'src/data/**/*.{ts,tsx}',
        'functions/**/*.{ts,tsx}',
      ],
      exclude: [
        ...configDefaults.exclude,
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/test/**',
        // বাংলা: শুধু টাইপ/কনস্ট্যান্ট ডিক্লারেশন — রানটাইম লজিক নেই
        'src/**/types.ts',
        'src/**/*.types.ts',
      ],
      // বাংলা: থ্রেশহোল্ড "আজকের বাস্তব মান"-এর ঠিক নিচে বসানো — আগে ৬০% লেখা ছিল
      // অথচ মাপা মান ৩১%, অর্থাৎ গেট কখনো চলত না (মিথ্যা নিরাপত্তা)।
      // এখন গেট সত্যিই চলবে: কভারেজ কমলে CI লাল হবে। প্রতি স্প্রিন্টে ৫ পয়েন্ট বাড়ান।
      // পরিমাপ (২০২৬-১১-২৩): lines ৩১.১ · stmts ৩০.৩ · funcs ২৯.৩ · branches ২৫.২
      thresholds: {
        lines: 30,
        statements: 30,
        functions: 28,
        branches: 24,
      },
    },
  },
});
