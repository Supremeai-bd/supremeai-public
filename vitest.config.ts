import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    // বাংলা মন্তব্য: সার্ভার, এজ, শেয়ার্ড ও Hono API টেস্টগুলো দ্রুতগতির 'node' এনভায়রনমেন্টে এবং কেবল UI/স্টোর টেস্টগুলো 'jsdom'-এ চালানো হচ্ছে
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: [],
          include: [
            'functions/**/*.test.ts',
            'src/server/**/*.test.ts',
            'src/api/**/*.test.ts',
            'src/shared/**/*.test.ts',
          ],
          exclude: [...configDefaults.exclude, 'src/shared/productionHardening.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: [
            ...configDefaults.exclude,
            'src/server/**/*.test.ts',
            'src/api/**/*.test.ts',
            'src/shared/**/*.test.ts',
          ],
        },
      },
    ],
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
      // বাংলা মন্তব্য: নতুন সিকিউরিটি ও সার্ভার ইউনিট টেস্ট যুক্ত হওয়ার পর কভারেজ র‍্যাচেট আরও শক্তিশালী করা হয়েছে
      thresholds: {
        lines: 42,
        statements: 42,
        functions: 38,
        branches: 38,
      },
    },
  },
});
