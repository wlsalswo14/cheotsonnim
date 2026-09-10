export function scoreColor(score: number): string {
  if (score >= 85) return "#1f8a5b";
  if (score >= 70) return "#3f9a3a";
  if (score >= 55) return "#b7790a";
  if (score >= 40) return "#d0641f";
  return "#c1352a";
}

export function ScoreRing({ score, size = 150 }: { score: number; size?: number }) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = scoreColor(score);
  return (
    <div className="ring" style={{ width: size, height: size }} aria-label={`첫손님 점수 ${score}점`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ece6da" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} />
      </svg>
      <div className="ring__num" style={{ color, fontSize: size * 0.3 }}>
        {score}
        <small>/ 100</small>
      </div>
    </div>
  );
}
