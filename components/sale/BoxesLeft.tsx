/**
 * Boxes-remaining readout for the closing sale.
 *
 * Renders nothing on a null count. `boxesLeft` (lib/sale/year-supply.ts)
 * returns null for untracked / backorder-allowed variants, where any number
 * would misrepresent stock rather than merely omit it.
 *
 * Zero reads as sold out, NOT "Backordered" - the wording this replaced on the
 * PDP. Nothing is being restocked; the shop is closing.
 */
interface BoxesLeftProps {
  boxes: number | null;
  className?: string;
}

export default function BoxesLeft({ boxes, className }: BoxesLeftProps) {
  if (boxes === null) return null;

  if (boxes === 0) {
    return <p className={className ?? 'text-xs font-semibold text-text-muted'}>Sold out</p>;
  }

  const noun = boxes === 1 ? 'box' : 'boxes';
  return (
    <p className={className ?? 'text-xs font-semibold text-state-warning'}>
      {boxes.toLocaleString('en-US')} {noun} left
    </p>
  );
}
