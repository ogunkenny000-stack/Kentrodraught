import { Compass, BookOpen, Layout, ClipboardList } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

interface AnalysisSetupModalProps {
  open: boolean;
  onClose: () => void;
  onAnalyzePastGames: () => void;
  onBlankBoard: () => void;
  onImportPdn: () => void;
}

export function AnalysisSetupModal({ open, onClose, onAnalyzePastGames, onBlankBoard, onImportPdn }: AnalysisSetupModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      title="Analysis Options"
      icon={<Compass className="w-4 h-4 text-amber-500" />}
    >
      <p className="text-xs text-slate-400 -mt-1 mb-4">Choose how you want to analyze.</p>

      <div className="flex flex-col gap-3 pb-1">
        <button
          onClick={onAnalyzePastGames}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 transition cursor-pointer"
        >
          <BookOpen className="w-6 h-6 mb-2" />
          <span className="font-bold text-sm">Analyze Your Past Games</span>
          <span className="text-[10px] text-amber-400/70 mt-1">Review previously played matches</span>
        </button>

        <button
          onClick={onBlankBoard}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition cursor-pointer"
        >
          <Layout className="w-6 h-6 mb-2" />
          <span className="font-bold text-sm">Blank Analysis Board</span>
          <span className="text-[10px] text-slate-500 mt-1">Explore positions freely</span>
        </button>

        <button
          onClick={onImportPdn}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-800 bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition cursor-pointer"
        >
          <ClipboardList className="w-6 h-6 mb-2" />
          <span className="font-bold text-sm">Analyze Any Game</span>
          <span className="text-[10px] text-slate-500 mt-1">Import a PDN / paste a move list</span>
        </button>
      </div>
    </ModalShell>
  );
}
