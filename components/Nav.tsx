'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS: Record<string, React.ReactNode> = {
  today: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  ),
  topics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  manuscripts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4M10 12h5M10 16h5" />
    </svg>
  ),
  publish: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3L10 14M21 3l-7 18-4-7-7-4z" />
    </svg>
  ),
  figures: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 15l-5-5L5 20" />
    </svg>
  ),
  titles: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M12 6v13" />
      <path d="M8 19h8" />
    </svg>
  ),
  verify: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9.5 12l1.8 1.8L15 10" />
      <path d="M12 3v2" opacity="0.5" />
    </svg>
  ),
  quality: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  review: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  ),
  automation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  experts: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M3.5 19c.6-3 2.4-4.5 4.5-4.5s3.9 1.5 4.5 4.5" />
      <path d="M14.5 17.5c.5-2.2 1.6-3.3 2.9-3.3 1.2 0 2.3 1 2.8 3" />
    </svg>
  ),
  radar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13l2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M4 13h5l1 2h4l1-2h5" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </svg>
  ),
};

const MAIN = [
  { href: '/topics', label: '选题', icon: 'topics' },
  { href: '/manuscripts', label: '稿件', icon: 'manuscripts' },
  { href: '/publish', label: '发布', icon: 'publish' },
  { href: '/radar', label: '雷达', icon: 'radar' },
  { href: '/intake', label: '投素材', icon: 'inbox' },
];

const TOOLS = [
  { href: '/autopilot', label: '自主写稿', icon: 'automation' },
  { href: '/figures', label: '配图', icon: 'figures' },
  { href: '/verify', label: '核实', icon: 'verify' },
  { href: '/quality', label: '质检', icon: 'quality' },
  { href: '/titles', label: '标题', icon: 'titles' },
  { href: '/review', label: '复盘', icon: 'review' },
];

/** 依赖没装齐、点进去也跑不动：留着入口，但不和生产工具混在一起。 */
const DISABLED_TOOLS = [
  { href: '/experts', label: 'AI 编辑部', icon: 'experts' },
  { href: '/hermes', label: 'Hermes 管家', icon: 'automation' },
];

export default function Nav({ lanUrl }: { lanUrl: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <aside className="side">
      <div className="brand">
        <div className="brand-mark">茶</div>
        <div>
          <div className="brand-name">阿茶 AI 实验室</div>
          <div className="brand-sub">WORKBENCH</div>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-label">工作区</div>
        {MAIN.map((item) => (
          <Link key={item.href} href={item.href} className={`nav-item${isActive(item.href) ? ' active' : ''}`}>
            {ICONS[item.icon]}
            {item.label}
          </Link>
        ))}

        <div className="nav-label">生产与复盘</div>
        {TOOLS.map((item) => (
          <Link key={item.href} href={item.href} className={`nav-item${isActive(item.href) ? ' active' : ''}`}>
            {ICONS[item.icon]}
            {item.label}
          </Link>
        ))}

        <div className="nav-label">未启用 · 缺依赖</div>
        {DISABLED_TOOLS.map((item) => (
          <Link key={item.href} href={item.href} className={`nav-item${isActive(item.href) ? ' active' : ''}`}>
            {ICONS[item.icon]}
            {item.label}
          </Link>
        ))}

        <div className="nav-label">系统</div>
        <Link href="/settings" className={`nav-item${isActive('/settings') ? ' active' : ''}`}>
          {ICONS.settings}
          设置
        </Link>
      </nav>

      <div className="side-foot">
        <div className="serve">
          <span className="dot" />
          <span>工作台运行中 · 8787</span>
        </div>
        <div className="lan">{lanUrl}</div>
      </div>
    </aside>
  );
}
