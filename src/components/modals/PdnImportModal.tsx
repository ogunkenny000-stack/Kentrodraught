import { ClipboardList } from "lucide-react";
import { ModalShell } from "../ui/ModalShell";

interface PdnImportModalProps {
  open: boolean;
  onClose: () => void;
  pdnImportText: string;
  setPdnImportText: (v: string) => void;
  pdnImportError: string | null;
  onImport: () => void;
}

export function PdnImportModal({ open, onClose, pdnImportText, setPdnImportText, pdnImportError, onImport }: PdnImportModalProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      size="sm"
      title="Import a Game"
      icon={<ClipboardList className="w-4 h-4 text-amber-500" />}
      footer={
        <button
          onClick={onImport}
          disabled={!pdnImportText.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition cursor-pointer text-xs"
        >
          Import &amp; Analyze
        </button>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        <p className="text-xs text-slate-400">
          Paste a Kentro PDN export (including its custom position), or a move list in "from-to" notation. Captures use "x": e.g.{" "}
          <span className="text-slate-300 font-mono">32-28 19-23 37-32 23x32</span>. Move numbers like "1." are optional and ignored.
        </p>

        <textarea
          aria-label="Game moves or exported PDN"
          value={pdnImportText}
          onChange={(e) => setPdnImportText(e.target.value)}
          rows={6}
          placeholder={"1. 32-28 19-23\n2. 37-32 23x32"}
          className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 resize-none focus:outline-none focus:border-amber-500/50 select-text"
        />

        {pdnImportError && (
          <p role="alert" className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {pdnImportError}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
