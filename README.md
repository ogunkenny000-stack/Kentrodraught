# Kentrodraught Kaggle handoff — 25 October 2026

Transfer for the user's other ChatGPT conversation with Kaggle browser access. **Local training is paused after13completedrounds. Seven wins out of ten has not been achieved.**

Read [HANDOFF.md](HANDOFF.md) first. It contains the exact next-conversation prompt, current model/results, verified work, pending deep-teaching method, Rust-only training requirement and Kaggle portability instructions.

## Downloads

- [Engine-only ZIP (12.79 MB)](https://raw.githubusercontent.com/ogunkenny000-stack/Kentrodraught/kaggle-handoff-2026-10-25/downloads/Kentrodraught-Engine-Only.zip): Linux executable, corresponding Rust engine source and current weights.

- [Compact Kaggle starter ZIP (~45MiB)](https://raw.githubusercontent.com/ogunkenny000-stack/Kentrodraught/kaggle-handoff-2026-10-25/downloads/Kentrodraught-Kaggle-Starter.zip): model, engine/C++/trainer source, prepared native corpus, notebook and evidence. Upload as a private Kaggle dataset in the receiving conversation.
- [Notebook](Kaggle_Rust_Training.ipynb): defaults to preflight, without repeating completed training.
- Full research checkpoint (~552MiB in14parts): run [download_research.py](download_research.py). Its verified multipart download includes22000full-material game archives,500gamehandicapcurriculum, preparedTD/dense data, source/provenance and the unfinishednextdeeptraining experiment. The split avoids GitHub's individual-file size limit.
- [Checksums](SHA256SUMS.txt) and [research part manifest](research-parts.json).

```sh
# Download/reassemble and verify the optional larger research archive:
python download_research.py --output ./research-download
# Also extract, restore content-identical files and verify their hashes:
python download_research.py --output ./research-download --extract
```

The compact starter passed23Rusttests, Clippy, nativecorpuscheck and6portablePython tests in this cloud. No Kaggle run occurred here. Fourteen synthetic tests passed for preparednextselector/TDadapter; no native teacher compilation, deepsearch, productiontargetexport orfit was performed for that experiment. The newcontinuousdeepcampaign is notimplemented.

Latest retained model is warmround12 under theOLDpolicy: freshconfirmation0W0L9ruledraws1cutoff. Round13completedfourfitswithzeroeligiblemodels. Repeating that exact corpus/model/config is reproduction, not newlearning. The starter runs nativeRust onCPU; selectingGPU/TPU inKaggle does not create accelerator kernels. Read the stricterplanneddefense adoption policy in thehandoffbefore promoting anothermodel.

No browser sessions or credentials are included. All derivedengine/training source remains under the includedGPLlicense. This download branch leaves the existing main/releasecode unchanged.
