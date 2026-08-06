"use client";

/**
 * BMC-216D: correct the carrier/tracking on an already-shipped order.
 *
 * PATCH /api/admin/orders/[id]/tracking requires a full valid pair, and it
 * never emails the customer — the copy below says so explicitly so the operator
 * is not surprised by silence.
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
import { AlertTriangle, Pencil, RefreshCw } from "lucide-react";
import { buildTrackingUrl, sanitizeTrackingNumber } from "@/lib/fulfillment/tracking";
import { CARRIERS, CARRIER_LABELS } from "@/lib/fulfillment/queue-view";
import type { Carrier } from "@/lib/fulfillment/types";

export interface EditTrackingSubmit {
  carrier: Carrier;
  trackingNumber: string;
}

interface EditTrackingModalProps {
  open: boolean;
  orderId: string;
  initialCarrier: Carrier | null;
  initialTrackingNumber: string | null;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: EditTrackingSubmit) => void;
}

export default function EditTrackingModal({
  open,
  orderId,
  initialCarrier,
  initialTrackingNumber,
  submitting,
  error,
  onCancel,
  onConfirm,
}: EditTrackingModalProps) {
  const [carrier, setCarrier] = useState<"" | Carrier>(initialCarrier ?? "");
  const [trackingInput, setTrackingInput] = useState(initialTrackingNumber ?? "");

  const chosenCarrier: Carrier | null = carrier === "" ? null : carrier;
  const sanitized = sanitizeTrackingNumber(trackingInput);
  const previewUrl = buildTrackingUrl(chosenCarrier, sanitized);

  const validationError = !chosenCarrier
    ? "Choose a carrier."
    : !sanitized
      ? "Enter a valid tracking number (1–100 characters)."
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !submitting) onCancel(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit tracking for order #{orderId}</DialogTitle>
          <DialogDescription>
            Corrects the carrier and tracking number on a shipped order. This does not email the
            customer; use Resend email if they need the corrected link.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor="edit-tracking-carrier" className="mb-2 block text-text-secondary">
              Carrier
            </Label>
            <select
              id="edit-tracking-carrier"
              value={carrier}
              disabled={submitting}
              onChange={(event) => setCarrier(event.target.value as "" | Carrier)}
              className="w-full rounded-md border admin-input px-3 py-2"
            >
              <option value="">Select a carrier</option>
              {CARRIERS.map((code) => (
                <option key={code} value={code}>
                  {CARRIER_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="edit-tracking-number" className="mb-2 block text-text-secondary">
              Tracking number
            </Label>
            <Input
              id="edit-tracking-number"
              value={trackingInput}
              disabled={submitting}
              onChange={(event) => setTrackingInput(event.target.value)}
              className="admin-input"
              placeholder="Enter tracking number"
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
              <p>No link for this carrier. The tracking number is shown on its own.</p>
            )}
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
            onClick={() => {
              if (!chosenCarrier || !sanitized) return;
              onConfirm({ carrier: chosenCarrier, trackingNumber: sanitized });
            }}
            disabled={submitting || Boolean(validationError)}
            className="bg-primary-500 hover:bg-primary-600"
          >
            {submitting ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Pencil className="mr-2 h-4 w-4" />
            )}
            Save tracking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
