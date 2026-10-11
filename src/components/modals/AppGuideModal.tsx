import { BookOpen, Trophy, User, Cpu, Wrench, Sparkles, TrendingUp, Layout } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

export function AppGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Lobby & Features Guide"
      icon={<BookOpen className="w-5 h-5 text-amber-500" />}
      footer={
        <button
          onClick={onClose}
          className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold py-3 rounded-xl transition text-center text-xs tracking-wide cursor-pointer"
        >
          GOT IT
        </button>
      }
    >
              <div className="space-y-4 text-xs text-slate-300 leading-relaxed pb-1">
                <div>
                  <h4 className="font-bold text-amber-500 mb-1 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5 animate-bounce" />
                    <span>1. Tournament Championship</span>
                  </h4>
                  <p>
                    Embark on an offline championship campaign against four progressive AI levels. Earn points (Win: 2, Draw: 1, Loss: 0) and advance from Challenger to the grand Champion gold cup!
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-500 mb-1 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span>2. Online Arena (Multiplayer)</span>
                  </h4>
                  <p>
                    Create or join online rooms using unique room IDs. Share codes with your friends or play with available players in real-time, backed by live messaging and chat.
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-500 mb-1 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5" />
                    <span>3. Play vs Computer (Ken Engine)</span>
                  </h4>
                  <p>
                    Hone your Nigerian Draughts skills against Ken, our custom local engine featuring 8 distinct strength levels, move hints, undo abilities, and real-time evaluation bar.
                  </p>
                </div>

                <div>
                  <h4 className="font-bold text-amber-500 mb-1 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                    <Layout className="w-3.5 h-3.5" />
                    <span>4. Custom Theme Editor</span>
                  </h4>
                  <p>
                    Personalize your board colors down to the exact hex codes of light cells, dark cells, and borders. Simply select the <strong>Custom</strong> option in settings.
                  </p>
                </div>
              </div>
    </ModalShell>
  );
}
