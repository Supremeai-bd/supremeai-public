/**
 * বাংলা মন্তব্য: মডেল বাছাই সবসময় স্বয়ংক্রিয় — ইউজারকে মডেল বেছে নিতে হয় না (Settings থেকে মডেল পিকার
 * ও Auto Routing টগল সরানো হয়েছে)। পুরনো সেভ করা `autoModelRouting: false` থাকলেও সাধারণ ইউজারের জন্য
 * অটো-রাউটিং চালু থাকে। শুধু অ্যাডমিন (টেস্টিংয়ের জন্য, যেমন VS Code থেকে সিঙ্ক হওয়া সেটিং) বন্ধ রাখতে পারেন।
 */
export function isAutoModelRoutingActive(
  savedPreference: boolean | undefined,
  currentRole: string | null | undefined
): boolean {
  if (currentRole === 'admin') return savedPreference !== false;
  return true;
}
