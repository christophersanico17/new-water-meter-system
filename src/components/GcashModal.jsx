import React from "react";
import { peso } from "../data";
import gcashQrImage from "../assets/gcash-qr.jpg";

// Phone photos are several MB; the receipt only needs to be readable. Scale
// it down to at most 1600px on the long side and re-encode as JPEG, which
// keeps the upload to a few hundred KB.
const RECEIPT_MAX_SIDE = 1600;

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, RECEIPT_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; // transparent PNG areas would turn black in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Not an image"));
    };
    img.src = url;
  });
}

export function GcashModal({ household, step, onConfirm, onClose }) {
  const [paymentReference, setPaymentReference] = React.useState("");
  const [receiptFile, setReceiptFile] = React.useState(null);
  const [receiptPreview, setReceiptPreview] = React.useState(null);
  const [formError, setFormError] = React.useState("");
  if (!household) return null;

  function handleReceiptChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setReceiptPreview(ev.target?.result);
      reader.readAsDataURL(file);
    }
  }

  async function submitReference(event) {
    event.preventDefault();
    // Require at least reference OR receipt
    if (!paymentReference.trim() && !receiptFile) {
      setFormError("Please enter a reference number or upload a receipt photo.");
      return;
    }

    let receiptImageBase64 = null;
    if (receiptFile) {
      try {
        receiptImageBase64 = await shrinkImage(receiptFile);
      } catch {
        setFormError("That file couldn't be read as an image. Please choose a photo or screenshot of your receipt.");
        return;
      }
    }
    setFormError("");

    onConfirm({
      reference: paymentReference.trim(),
      receiptImage: receiptImageBase64
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[min(100%,26rem)] overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-[#0072CE] text-white px-5 py-4 flex items-center justify-between sticky top-0">
          <div className="font-bold">Pay with GCash QR</div>
          {step !== "processing" && (
            <button onClick={onClose} aria-label="Close" className="text-white/80 hover:text-white text-lg leading-none">×</button>
          )}
        </div>

        <div className="p-5">
          {step === "confirm" && (
            <form onSubmit={submitReference} className="flex flex-col items-center">
              <div className="text-xs text-slate-500">Barangay Kinamlutan Water System</div>
              <div className="text-lg font-bold text-slate-800 mt-1">{peso(household.totalDue)}</div>
              <img
                src={gcashQrImage}
                alt="GCash payment QR code"
                className="w-56 h-56 object-contain border border-slate-200 rounded-md my-4"
              />
              <div className="w-full text-xs text-slate-600 mb-3">
                Scan the QR code and pay the exact amount above. Submit your payment proof by entering the reference number, uploading your receipt photo, or both.
              </div>
              {formError && (
                <div className="w-full mb-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {formError}
                </div>
              )}
              <label htmlFor="gcash-payment-reference" className="w-full text-xs font-semibold text-slate-600 mb-1">
                GCash reference number
              </label>
              <input
                id="gcash-payment-reference"
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={80}
                autoComplete="off"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="Enter receipt reference"
              />
              <label htmlFor="receipt-upload" className="w-full text-xs font-semibold text-slate-600 mb-1 mt-3">
                Receipt photo (optional)
              </label>
              {receiptPreview && (
                <div className="mb-3 relative">
                  <img src={receiptPreview} alt="Receipt preview" className="w-full max-h-40 object-contain rounded-md border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptFile(null);
                      setReceiptPreview(null);
                    }}
                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm"
                  >
                    ×
                  </button>
                </div>
              )}
              <input
                id="receipt-upload"
                type="file"
                accept="image/*"
                onChange={handleReceiptChange}
                className="w-full text-xs"
              />
              <button
                type="submit"
                className="w-full mt-3 bg-[#0072CE] hover:bg-[#005ea3] text-white font-semibold text-sm py-2.5 rounded-md transition"
              >
                Submit payment for verification
              </button>
            </form>
          )}

          {step === "processing" && (
            <div className="py-8 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-[#0072CE] border-t-transparent rounded-full animate-spin" />
              <div className="text-sm text-slate-500">Submitting payment reference…</div>
            </div>
          )}

          {step === "gcash-pending" && (
            <div className="flex flex-col items-center gap-3 py-3 text-center">
              <div className="w-11 h-11 rounded-full bg-amber-50 flex items-center justify-center text-amber-500 text-xl">⏳</div>
              <div className="font-bold text-slate-800 text-sm">Waiting for admin verification</div>
              <p className="text-xs text-slate-500">
                Your GCash reference <span className="font-semibold text-slate-700">{household.paymentReference || paymentReference}</span> was submitted. Your bill will update after an admin verifies the payment.
              </p>
              <button onClick={onClose} className="mt-1 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-2.5 rounded-md transition">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
