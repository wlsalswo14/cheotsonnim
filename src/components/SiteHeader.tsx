import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="hdr">
      <div className="wrap hdr__in">
        <Link href="/" className="brand" aria-label="첫손님 홈">
          <span className="brand__mark">첫</span>
          첫손님
          <span className="brand__sub">First Customer</span>
        </Link>
        <nav className="nav">
          <Link href="/gallery">방문 기록</Link>
          <Link href="/#how">어떻게 보나요</Link>
        </nav>
      </div>
    </header>
  );
}
