import { redirect } from 'next/navigation';

/**
 * 「今日」页已撤（2026-11-12）：内容并到稿件流水线，根路径直接跳过去。
 * 账号三件在 /publish、标题在 /titles、复盘在 /review，这里不再重复一份。
 */
export default function Home() {
  redirect('/manuscripts');
}
