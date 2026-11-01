export function PairCard({
  qrDataUrl,
  displayCode,
  title,
  hint,
  compact,
}: {
  qrDataUrl: string;
  displayCode: string;
  title: string;
  hint: string;
  compact?: boolean;
}) {
  return (
    <div className={`pair-card well ${compact ? "pair-card-compact" : ""}`}>
      <p className="small">{title}</p>
      {/* data URL from the pairing API; not a hosted image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrDataUrl} alt="Pairing QR code" className="pair-qr" data-testid="pair-qr" />
      <p className="pair-code num" data-testid="pair-code">
        {displayCode}
      </p>
      <p className="small">{hint}</p>
    </div>
  );
}
