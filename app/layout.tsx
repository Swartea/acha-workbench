import type { Metadata } from 'next';
import os from 'node:os';
import './globals.css';
import Nav from '@/components/Nav';

export const metadata: Metadata = {
  title: '阿茶 AI 实验室 · 工作台',
  description: '微信公众号工作台：自主写稿 / 雷达 / 核实 / 质检',
};

function lanAddress(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <Nav lanUrl={`http://${lanAddress()}:8787`} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
