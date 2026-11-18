import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">404</div>
          <h1 className="page-title">这页不在工作台里</h1>
          <p className="page-sub">链接可能写错了，或者这个功能还没做。</p>
        </div>
      </header>
      <div className="card">
        <Link href="/manuscripts" className="btn primary">回稿件流水线</Link>
      </div>
    </div>
  );
}
