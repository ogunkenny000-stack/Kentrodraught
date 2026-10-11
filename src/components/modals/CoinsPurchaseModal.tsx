import React from "react";
import { Crown, Check, ArrowRight, ShieldCheck, Sparkles, Send } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";
import { OPAY_PAYMENT_DETAILS, CoinSettings, CoinPackage } from "../../lib/constants";
import { KentroCoin, KentroCoinStack, CoinBadge } from "../ui/KentroCoin";

interface CoinsPurchaseModalProps {
  open: boolean;
  onClose: () => void;
  coinBalance: number;
  storeTab: "buy" | "withdraw";
  setStoreTab: (t: "buy" | "withdraw") => void;
  coinPackages: CoinPackage[];
  selectedPackageId: string;
  setSelectedPackageId: (id: string) => void;
  purchaseReceiptRef: string;
  setPurchaseReceiptRef: (v: string) => void;
  purchaseError: string | null;
  setPurchaseError: (v: string | null) => void;
  purchaseSubmitting: boolean;
  purchaseSubmitted: boolean;
  setPurchaseSubmitted: (v: boolean) => void;
  onSubmitPurchase: () => void;
  coinSettings: CoinSettings | null;
  withdrawCoins: string;
  setWithdrawCoins: (v: string) => void;
  withdrawAccountName: string;
  setWithdrawAccountName: (v: string) => void;
  withdrawAccountNumber: string;
  setWithdrawAccountNumber: (v: string) => void;
  withdrawBankName: string;
  setWithdrawBankName: (v: string) => void;
  withdrawError: string | null;
  setWithdrawError: (v: string | null) => void;
  withdrawSubmitting: boolean;
  withdrawSubmitted: { nairaAmount: number } | null;
  setWithdrawSubmitted: (v: { nairaAmount: number } | null) => void;
  onSubmitWithdrawal: () => void;
}

export function CoinsPurchaseModal(props: CoinsPurchaseModalProps) {
  const {
    open, onClose, coinBalance, storeTab, setStoreTab, coinPackages, selectedPackageId,
    setSelectedPackageId, purchaseReceiptRef, setPurchaseReceiptRef, purchaseError,
    setPurchaseError, purchaseSubmitting, purchaseSubmitted, setPurchaseSubmitted, onSubmitPurchase,
    coinSettings, withdrawCoins, setWithdrawCoins, withdrawAccountName, setWithdrawAccountName,
    withdrawAccountNumber, setWithdrawAccountNumber, withdrawBankName, setWithdrawBankName,
    withdrawError, setWithdrawError, withdrawSubmitting, withdrawSubmitted, setWithdrawSubmitted,
    onSubmitWithdrawal,
  } = props;

  const selectedPkg = coinPackages.find(p => p.id === selectedPackageId) || coinPackages[0];

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="md"
      title="Kentro Treasury & Store"
      icon={<KentroCoin size="sm" glow />}
    >
      <div className="flex flex-col gap-4 pb-1">
        {/* Flashy Hero Header Banner */}
        <div className="relative overflow-hidden bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/50 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
          {/* Subtle background glow effect */}
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-amber-500/15 rounded-full blur-2xl pointer-events-none" />
          
          <div className="flex items-center gap-3.5 z-10">
            <div className="relative">
              <KentroCoin size="xl" glow interactive className="drop-shadow-[0_0_14px_rgba(245,158,11,0.6)]" />
              <span className="absolute -bottom-1 -right-1 bg-amber-500 text-slate-950 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full font-mono shadow-md">
                24K
              </span>
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-white tracking-tight flex items-center gap-1.5">
                Kentro Gold Coins <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              </h3>
              <p className="text-[11px] text-amber-200/70 font-medium">
                Stake in live matches, enter tournaments & unlock AI levels.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end shrink-0 z-10">
            <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider font-semibold">Your Balance</span>
            <CoinBadge amount={coinBalance} size="sm" highlight />
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-950 border border-slate-800 rounded-xl p-1">
          <button
            onClick={() => { setStoreTab("buy"); setWithdrawError(null); setWithdrawSubmitted(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              storeTab === "buy"
                ? "bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <KentroCoin size="2xs" />
            Buy Coins
          </button>
          <button
            onClick={() => { setStoreTab("withdraw"); setPurchaseError(null); setPurchaseSubmitted(false); }}
            className={`flex-1 py-2 rounded-lg text-xs font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5 ${
              storeTab === "withdraw"
                ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-slate-950 shadow-md"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Withdraw to Naira
          </button>
        </div>

        {storeTab === "buy" ? (
          <>
            {/* Packages Grid */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wider font-mono flex items-center gap-1">
                  Choose Coin Package
                </span>
                <span className="text-[10px] text-amber-400/90 font-mono">100 Coins ≈ ₦1,000</span>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {coinPackages.map((pkg, idx) => {
                  const isSelected = selectedPackageId === pkg.id;
                  const isTopTier = idx === coinPackages.length - 1;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setSelectedPackageId(pkg.id)}
                      className={`relative flex flex-col items-center p-3 rounded-xl border text-center transition-all cursor-pointer overflow-hidden ${
                        isSelected
                          ? "bg-gradient-to-b from-amber-950/70 via-slate-900 to-amber-950/50 border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.25)] scale-[1.02]"
                          : "bg-slate-950 border-slate-800 hover:border-amber-500/40 hover:bg-slate-900/60"
                      }`}
                    >
                      {isTopTier && (
                        <div className="absolute top-0 right-0 bg-amber-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded-bl-lg font-mono">
                          BEST
                        </div>
                      )}

                      <div className="my-1">
                        {pkg.coins >= 500 ? (
                          <KentroCoinStack size="sm" glow={isSelected} />
                        ) : (
                          <KentroCoin size={pkg.coins >= 200 ? "lg" : "md"} glow={isSelected} interactive />
                        )}
                      </div>

                      <span className={`text-base font-black font-sans leading-none mt-1 ${isSelected ? "text-amber-200" : "text-white"}`}>
                        {pkg.coins.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-amber-400/80 font-mono uppercase font-bold tracking-wide">
                        Coins
                      </span>

                      <div className="mt-2 pt-2 border-t border-slate-800/80 w-full flex items-center justify-center">
                        <span className={`text-xs font-bold font-mono ${isSelected ? "text-white" : "text-slate-300"}`}>
                          ₦{pkg.priceNaira.toLocaleString()}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment instructions */}
            <div className="bg-slate-950 border border-amber-500/25 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-amber-400 font-bold uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> Payment Details
                </span>
                <span className="text-[11px] text-slate-300 font-mono">
                  Total: <strong className="text-white font-bold">₦{selectedPkg?.priceNaira?.toLocaleString() ?? "—"}</strong>
                </span>
              </div>

              <div className="font-mono text-xs text-slate-200 bg-slate-900/90 border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1 select-text">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Bank:</span>
                  <span className="font-bold text-amber-300">{OPAY_PAYMENT_DETAILS.provider}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Account Number:</span>
                  <span className="font-bold text-white tracking-wider">{OPAY_PAYMENT_DETAILS.phoneNumber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 text-[11px]">Account Name:</span>
                  <span className="font-bold text-slate-200">{OPAY_PAYMENT_DETAILS.accountName}</span>
                </div>
              </div>

              <a
                href={`https://wa.me/234${OPAY_PAYMENT_DETAILS.phoneNumber.replace(/^0/, "")}?text=${encodeURIComponent(`Hi, here's my receipt for ${selectedPkg?.coins ?? ""} Kentro Coins (₦${selectedPkg?.priceNaira ?? ""}).`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold text-xs py-2.5 px-4 rounded-xl transition shadow-md cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send Receipt on WhatsApp
              </a>

              <p className="text-slate-400 text-[10px] leading-relaxed">
                After making the transfer, please send your receipt on WhatsApp and enter your reference code below. Coin balances are reviewed and credited swiftly!
              </p>
            </div>

            {/* Reference input */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">
                Transaction Reference / Sender Name
              </label>
              <input
                type="text"
                value={purchaseReceiptRef}
                onChange={(e) => setPurchaseReceiptRef(e.target.value)}
                placeholder="e.g. OPay Ref 009238491823 or Sender Name"
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 select-text"
              />
            </div>

            {purchaseError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                {purchaseError}
              </p>
            )}

            <button
              onClick={onSubmitPurchase}
              disabled={purchaseSubmitting || coinPackages.length === 0}
              className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black py-3 px-4 rounded-xl transition cursor-pointer text-xs uppercase tracking-wider shadow-lg shadow-amber-500/10 flex items-center justify-center gap-2"
            >
              <KentroCoin size="2xs" />
              {purchaseSubmitting ? "Submitting..." : "I've Paid — Submit for Confirmation"}
            </button>
          </>
        ) : withdrawSubmitted ? (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center shadow-lg shadow-emerald-500/10">
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100">Withdrawal Request Received</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
                ₦{withdrawSubmitted.nairaAmount.toLocaleString()} will be transferred to your account within 24 hours. The coins have been safely deducted.
              </p>
            </div>
            <button
              onClick={() => { setWithdrawSubmitted(null); setStoreTab("buy"); }}
              className="mt-2 text-xs bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-amber-300 font-bold px-4 py-2 rounded-xl cursor-pointer"
            >
              Return to Store
            </button>
          </div>
        ) : (
          <>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-1 text-[11px] text-slate-300 leading-relaxed">
              <p className="flex items-center gap-1.5 text-amber-300 font-bold">
                <KentroCoin size="2xs" /> Withdrawal Rate: ₦{coinSettings?.withdrawalRatePerHundredCoins ?? 950} per 100 coins
              </p>
              <p className="text-slate-400 text-[10px]">
                Minimum {coinSettings?.withdrawalMinCoins ?? 500} coins, {coinSettings?.withdrawalMinGamesPlayed ?? 20}+ games played, account older than {coinSettings?.withdrawalMinAccountAgeDays ?? 7} days.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Coins to withdraw</label>
              <input
                type="number"
                min={coinSettings?.withdrawalMinCoins ?? 500}
                value={withdrawCoins}
                onChange={(e) => setWithdrawCoins(e.target.value)}
                placeholder={`Minimum ${coinSettings?.withdrawalMinCoins ?? 500}`}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 select-text"
              />
              {!!withdrawCoins && Number.isFinite(parseInt(withdrawCoins, 10)) && (
                <span className="text-xs text-emerald-400 font-bold font-mono">
                  ≈ ₦{Math.floor((parseInt(withdrawCoins, 10) / 100) * (coinSettings?.withdrawalRatePerHundredCoins ?? 950)).toLocaleString()} Naira
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Account name</label>
              <input
                type="text"
                value={withdrawAccountName}
                onChange={(e) => setWithdrawAccountName(e.target.value)}
                placeholder="Full Name on Receiving Account"
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 select-text"
              />
            </div>

            <div className="flex gap-2">
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Account number</label>
                <input
                  type="text"
                  value={withdrawAccountNumber}
                  onChange={(e) => setWithdrawAccountNumber(e.target.value)}
                  placeholder="10-digit Account / Phone"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 select-text"
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Bank (optional)</label>
                <input
                  type="text"
                  value={withdrawBankName}
                  onChange={(e) => setWithdrawBankName(e.target.value)}
                  placeholder="e.g. OPay, Kuda, GTBank"
                  className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500/50 select-text"
                />
              </div>
            </div>

            {withdrawError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
                {withdrawError}
              </p>
            )}

            <button
              onClick={onSubmitWithdrawal}
              disabled={withdrawSubmitting}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-black py-3 px-4 rounded-xl transition cursor-pointer text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/10"
            >
              {withdrawSubmitting ? "Submitting..." : "Request Withdrawal"}
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}
