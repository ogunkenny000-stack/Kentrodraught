import { ngRcToSq } from "../gameLogic";
import type { ReplayFrame } from "./kentroTv";

/** Creates a small self-contained video of a game highlight. Unsupported browsers
 * can still share the animated Kentro TV link; no server-side video rendering needed.
 */
export async function renderHighlightVideo(frames: ReplayFrame[], start: number, end: number, names: string): Promise<{blob: Blob; extension: string}> {
  if (!HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === "undefined") throw new Error("Video export is not supported by this browser. Share the animated link instead.");
  const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(MediaRecorder.isTypeSupported);
  if (!mime) throw new Error("This browser cannot record board videos. Share the highlight link instead.");
  const canvas = document.createElement("canvas");
  canvas.width = 620; canvas.height = 700;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering unavailable.");
  const videoStream = canvas.captureStream(20);
  const recorder = new MediaRecorder(videoStream, { mimeType: mime, videoBitsPerSecond: 1_100_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  const completion = new Promise<{blob:Blob;extension:string}>((resolve,reject)=>{
    recorder.onerror = () => reject(new Error("Unable to record this highlight."));
    recorder.onstop = () => resolve({ blob: new Blob(chunks, { type: mime }), extension: mime.includes("mp4") ? "mp4" : "webm" });
  });
  const sq = 58;
  function draw(frame: ReplayFrame) {
    ctx!.fillStyle = "#070913";ctx!.fillRect(0,0,620,700);
    ctx!.fillStyle = "#fbbf24";ctx!.font = "bold 27px sans-serif";ctx!.fillText("KENTRO TV", 23,38);
    ctx!.fillStyle = "#e2e8f0";ctx!.font = "17px sans-serif";
    ctx!.fillText(names.slice(0,55), 23,68);
    for (let row=0;row<10;row++) for(let col=0;col<10;col++) {
      const square=ngRcToSq(row,col),x=20+col*sq,y=85+row*sq;
      ctx!.fillStyle=square===null?"#eac494":"#7c4c24";ctx!.fillRect(x,y,sq,sq);
      if(square!==null && frame.move && (square===frame.move.from||square===frame.move.to)) {ctx!.strokeStyle="#fbbf24";ctx!.lineWidth=4;ctx!.strokeRect(x+2,y+2,sq-4,sq-4);}
      const piece=square===null?null:frame.board[square];
      if(piece) {
        ctx!.beginPath();ctx!.arc(x+sq/2,y+sq/2,sq*.36,0,Math.PI*2);
        ctx!.fillStyle=piece.toLowerCase()==="w"?"#f8fafc":"#101826";ctx!.fill();
        ctx!.strokeStyle=piece.toLowerCase()==="w"?"#94a3b8":"#020617";ctx!.lineWidth=3;ctx!.stroke();
        if(piece==="W"||piece==="B") {ctx!.fillStyle=piece==="W"?"#111827":"#fbbf24";ctx!.font="bold 25px sans-serif";ctx!.textAlign="center";ctx!.fillText("K",x+sq/2,y+sq/2+9);ctx!.textAlign="left";}
      }
    }
    ctx!.fillStyle="#94a3b8";ctx!.font="15px sans-serif";ctx!.fillText(`MOVE ${Math.ceil(frame.ply/2)} · WATCH ON DRAUGHT.COM`,22,688);
  }
  const from=Math.max(0,Math.min(frames.length-1,start)),to=Math.max(from,Math.min(frames.length-1,end));
  let interval: ReturnType<typeof setInterval> | undefined;
  try {
    draw(frames[from]);recorder.start();
    await new Promise<void>(resolve=>{
      let index=from;
      interval=setInterval(()=>{
        index++;if(index>to){clearInterval(interval);resolve();return;}
        draw(frames[index]);
      },750);
    });
    await new Promise(r=>setTimeout(r,500));
    recorder.stop();
    return await completion;
  } finally {
    if(interval)clearInterval(interval);
    if(recorder.state!=="inactive") recorder.stop();
    videoStream.getTracks().forEach(track=>track.stop());
  }
}
