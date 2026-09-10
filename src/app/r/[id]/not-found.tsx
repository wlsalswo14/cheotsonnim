import Link from "next/link";

export default function ReportNotFound() {
  return (
    <main className="wrap section">
      <div className="empty">
        이 리포트는 찾을 수 없습니다. 주소가 바뀌었거나 아직 게시되지 않았을 수 있어요.{" "}
        <Link href="/" style={{ color: "var(--accent-ink)", fontWeight: 700 }}>
          새 손님 보내기 →
        </Link>
      </div>
    </main>
  );
}
