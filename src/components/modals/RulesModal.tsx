import { BookOpen } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="draught.com Platform Rules"
      icon={<BookOpen className="w-5 h-5 text-amber-500" />}
      footer={
        <button
          onClick={onClose}
          className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold py-3 rounded-xl transition text-center text-xs tracking-wide cursor-pointer"
        >
          DISMISS
        </button>
      }
    >
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed pb-1">
                <div>
                  <h4 className="font-bold text-amber-400 mb-1.5 uppercase tracking-wider text-[10px]">Two-Step Authentication & Match Setup</h4>
                  <p className="mb-2 text-slate-400">The multiplayer system uses a secure two-step authentication process to connect players:</p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-300">
                    <li>The <strong className="text-white">Host</strong> presses the <strong className="text-amber-500">Create Match</strong> button.</li>
                    <li>If successful, a unique <strong className="text-white">match code</strong> is generated and displayed instantly.</li>
                    <li>The <strong className="text-white">Guest</strong> enters the generated match code to join.</li>
                    <li>Once the second player connects, the game automatically begins.</li>
                  </ol>
                </div>

                <div className="border-t border-slate-900 pt-3">
                  <h4 className="font-bold text-amber-400 mb-1.5 uppercase tracking-wider text-[10px]">Special Match Options</h4>
                  <p className="mb-2 text-slate-400">Handicap configurations are available for varying skill levels:</p>
                  <div className="space-y-2.5 pl-1">
                    <div>
                      <span className="font-semibold text-white">Short One:</span>
                      <p className="text-slate-300 mt-0.5">Gives the receiving player a handicap. The player who creates the match starts with one fewer piece than normal. During the game, the opponent may choose one of the host's pieces to remove before play begins (the host begins the match with one piece less).</p>
                    </div>
                    <div>
                      <span className="font-semibold text-white">Short Two:</span>
                      <p className="text-slate-300 mt-0.5">The host starts the match with two fewer pieces.</p>
                    </div>
                    <div>
                      <span className="font-semibold text-white">Short Three:</span>
                      <p className="text-slate-300 mt-0.5">The host starts the match with three fewer pieces.</p>
                    </div>
                    <p className="text-[10px] text-slate-500 italic">The same pattern applies for any higher "Short" value.</p>
                  </div>
                </div>

                <div className="border-t border-slate-900 pt-3">
                  <h4 className="font-bold text-amber-400 mb-1.5 uppercase tracking-wider text-[10px]">Crown Crown Mode</h4>
                  <p className="text-slate-300 mb-1">Crown Crown is a special premium game mode where:</p>
                  <ul className="list-disc pl-4 space-y-1 text-slate-300">
                    <li>Each player still starts with <strong className="text-white">20 pieces</strong> total.</li>
                    <li>Before the game begins, each player removes <strong className="text-amber-500">one piece from their own front row</strong> (their most advanced starting row).</li>
                    <li>That piece is then placed back on the board as a <strong className="text-amber-500">King</strong>, anywhere they choose on their own back row.</li>
                  </ul>
                  <p className="text-slate-400 mt-1.5">Both players start the match with an already-crowned King placed wherever they prefer on their back row -- at the cost of one fewer piece up front.</p>
                </div>
              </div>
    </ModalShell>
  );
}
