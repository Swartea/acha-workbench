import { redirect } from 'next/navigation';

/**
 * 「今日」页已撤（2026-11-12）；选题 / 稿件 / 发布三页也已撤（2026-11-19，
 * 自动写稿闭环后不再人工排期），根路径跳自主写稿——现在的主入口。
 */
export default function Home() {
  redirect('/autopilot');
}
