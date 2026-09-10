import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReportView } from "@/components/ReportView";
import { loadRun } from "@/lib/store";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cached?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const record = await loadRun(id);
  if (!record) return { title: "리포트를 찾을 수 없어요" };
  const title = `${record.site.host} · ${record.score.total}점 · ${record.score.grade}`;
  return {
    title,
    description: `${record.verdict.oneLiner} — 첫손님 5명이 실제 브라우저로 방문한 리뷰`,
    openGraph: { title: `${title} · 첫손님`, description: record.verdict.oneLiner, type: "article" },
    twitter: { card: "summary_large_image", title: `${title} · 첫손님`, description: record.verdict.oneLiner },
  };
}

export default async function ReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { cached } = await searchParams;
  const record = await loadRun(id);
  if (!record) notFound();
  return <ReportView record={record} cached={cached === "1"} />;
}
