import React, { useState } from "react";
import { X, AlertTriangle, ShieldCheck, Check } from "lucide-react";
import type { ReportPayload } from "./types";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser: string;
  messageId?: string;
  onSubmitReport: (payload: { reportedUser: string; reason: string; details?: string; messageId?: string }) => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  onClose,
  targetUser,
  messageId,
  onSubmitReport
}) => {
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const REASONS = [
    { id: "harassment", label: "Harassment or Bullying" },
    { id: "spam", label: "Spam or Unsolicited Promotion" },
    { id: "inappropriate", label: "Inappropriate or Offensive Language" },
    { id: "cheating", label: "Cheating or Engine / Fair-play Abuse" },
    { id: "offensive_profile", label: "Offensive Username or Avatar" },
    { id: "other", label: "Other Rule Violation" }
  ];

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmitReport({
      reportedUser: targetUser,
      reason,
      details: details.trim(),
      messageId
    });
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setDetails("");
      onClose();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-sm bg-[#090b16] border border-rose-500/30 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-900 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <h3 className="text-sm font-black uppercase tracking-wider font-sans">
              Report User
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {submitted ? (
          <div className="p-8 flex flex-col items-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <Check className="w-6 h-6 stroke-[3]" />
            </div>
            <span className="text-sm font-bold text-white">Report Submitted</span>
            <span className="text-xs text-slate-400">
              Thank you for keeping KentroDraught Grandmaster Lounge safe and respectful.
            </span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                Reporting Player
              </span>
              <span className="text-sm font-black text-rose-300">@{targetUser}</span>
            </div>

            {/* Reasons radio */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                Select Reason
              </label>
              {REASONS.map((r) => (
                <label
                  key={r.id}
                  className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer transition ${
                    reason === r.id
                      ? "bg-rose-950/20 border-rose-500/50 text-rose-200"
                      : "bg-slate-950/40 border-slate-900 text-slate-400 hover:border-slate-800"
                  }`}
                >
                  <input
                    type="radio"
                    name="reportReason"
                    value={r.id}
                    checked={reason === r.id}
                    onChange={(e) => setReason(e.target.value)}
                    className="accent-rose-500"
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>

            {/* Additional details */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                Additional Context (Optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what occurred..."
                maxLength={200}
                rows={2}
                className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-rose-500/50 resize-none"
              />
            </div>

            <button
              type="submit"
              className="py-2.5 px-4 bg-rose-500 hover:bg-rose-400 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Submit Report
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
