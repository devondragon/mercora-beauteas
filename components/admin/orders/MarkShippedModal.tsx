"use client";

/**
 * BMC-216D: the only way an operator moves an order to `shipped`.
 *
 * Carrier and tracking are optional AS A PAIR — untracked shipments are valid,
 * but a tracking number without a carrier (or a carrier with no number) is not,
 * because the server derives the customer-facing tracking link from the pair.
 * The preview below uses the SAME buildTrackingUrl the server and email use, so
 * what the operator sees is what the customer gets.
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Mail, RefreshCw, Truck } from "lucide-react";
import { buildTrackingUrl, sanitizeTrackingNumber } from "@/lib/fulfillment/tracking";
import { CARRIERS, CARRIER_LABELS } from "@/lib/fulfillment/queue-view";
import type { Carrier } from "@/lib/fulfillment/types";

export interface MarkShippedSubmit {
  carrier: Carrier | null;
  trackingNumber: string | null;
}

interface MarkShippedModalProps {
  open: boolean;
  orderId: string;
  recipient: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: MarkShippedSubmit) => void;
}

export default function MarkShippedModal({
  open,
  orderId,
  recipient,
  submitting,
  error,
  onCancel,
  onConfirm,
}: MarkShippedModalProps) {
  const [carrier, setCarrier] = useState<"" | Carrier>("");
  const [trackingInput, setTrackingInput] = useState("");

  const chosenCarrier: Carrier | null = carrier === "" ? null : carrier;
  const sanitized = sanitizeTrackingNumber(trackingInput);
  const hasTrackingText = trackingInput.trim().length > 0;
  const previewUrl = buildTrackingUrl(chosenCarrier, sanitized);

  const validationError = hasTrackingText && !sanitized
    ? "That tracking number is too long or contains unsupported characters."
    : hasTrackingText && !chosenCarrier
      ? "Choose a carrier so the customer gets a working tracking link."
      : !hasTrackingText && chosenCarrier
        ? "Enter a tracking number, or clear the carrier to ship without tracking."
        : null;

  const canSubmit = !submitting && !validationError;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark order #{orderId} shipped</DialogTitle>
          <DialogDescription>
            Recording the shipment for {recipient}. Carrier and tracking are optional — leave both
            blank to ship without tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="mark-shipped-carrier" className="mb-2 block text-text-secondary">
              Carrier
            </Label>
            <select
              id="mark-shipped-carrier"
              value={carrier}
              disabled={submitting}
              onChange={(event) => setCarrier(event.target.value as "" | Carrier)}
              className="w-full rounded-md border admin-input px-3 py-2"
            >
              <option value="">No carrier (untracked)</option>
              {CARRIERS.map((code) => (
                <option key={code} value={code}>
                  {CARRIER_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="mark-shipped-tracking" className="mb-2 block text-text-secondary">
              Tracking number <span className="text-text-muted">(optional)</span>
            </Label>
            <Input
              id="mark-shipped-tracking"
              value={trackingInput}
              disabled={submitting}
              onChange={(event) => setTrackingInput(event.target.value)}
              className="admin-input"
              placeholder="e.g. 1Z999AA10123456784"
            />
          </div>

          <div className="rounded bg-surface p-3 text-sm text-text-secondary">
            <p className="font-medium text-text-primary">Customer tracking link</p>
            {previewUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary-600 hover:underline"
              >
                {previewUrl}
              </a>
            ) : (
              <p>
                {chosenCarrier === "other"
                  ? "Other carriers show the tracking number with no link."
                  : "No tracking link — the customer will see the shipment without a carrier link."}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded bg-state-info-bg p-3 text-sm text-text-secondary">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-state-info" />
            <span>
              The customer will receive a shipping confirmation email as soon as this shipment is
              recorded.
            </span>
          </div>

          {validationError && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {validationError}
            </p>
          )}
          {error && (
            <p className="flex items-center text-sm text-state-error">
              <AlertTriangle className="mr-2 h-4 w-4" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm({ carrier: chosenCarrier, trackingNumber: sanitized })}
            disabled={!canSubmit}
            className="bg-primary-500 hover:bg-primary-600"
          >
            {submitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Truck className="mr-2 h-4 w-4" />
            )}
            Confirm shipment &amp; email customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
