/**
 * Final-sale and stock-age disclosure, shown at checkout.
 *
 * Deliberately a notice rather than a required checkbox: the goal is that nobody
 * is surprised, not that they are made to feel they are signing something. The
 * same facts are on /thank-you, in Chai's answers, and in the refund policy.
 */
import Link from "next/link";

export default function FinalSaleNotice() {
  return (
    <div className="rounded-lg border-l-4 border-primary-500 bg-surface-light p-4 text-sm text-text-muted">
      <p className="mb-2 font-semibold text-text-primary">
        A couple of honest notes before you order
      </p>
      <p className="mb-2">
        We&rsquo;re closing BeauTeas for good, so every order is final. No returns
        or exchanges. If something arrives damaged or never turns up, we&rsquo;ll
        still make it right, always.
      </p>
      <p>
        And our remaining stock has been in sealed, airtight storage for several
        years. It&rsquo;s been kept carefully and it&rsquo;s still lovely to drink,
        though the aroma is a little gentler than a fresh harvest, which is part of why
        it&rsquo;s priced the way it is.{" "}
        <Link href="/thank-you" className="underline hover:text-text-primary">
          More about all of this here.
        </Link>
      </p>
    </div>
  );
}
