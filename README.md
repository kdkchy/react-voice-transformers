# Offline Whisper Prototype (React + TypeScript)

This project contains a prototype web page for **offline speech-to-text** with:

- React + TypeScript
- `@xenova/transformers`
- Whisper base model (`Xenova/whisper-base`)
- ONNX Runtime WASM backend

## What is implemented

- Web Worker-based transcription (`src/workers/whisper.worker.ts`)
- Microphone recording to mono PCM + resample to 16kHz (`src/lib/pcmRecorder.ts`)
- React page with model load, start/stop recording, transcription output (`src/App.tsx`)
- Local-only model loading (`env.allowRemoteModels = false`)

## Offline setup

1. Install dependencies:

```bash
npm install
```

2. Copy ONNX Runtime WASM files into `public/wasm`:

```bash
npm run prepare:wasm
```

3. Download all files for `Xenova/whisper-base` from Hugging Face and place them in:

```txt
public/models/Xenova/whisper-base
```

Recommended: download a full snapshot of the model repo so all required config/tokenizer/onnx files are present.

4. Start dev server:

```bash
npm run dev
```

## Notes

- This prototype assumes local assets are available at:
  - model root: `/models/Xenova/whisper-base`
  - WASM root: `/wasm`
- The worker is configured for offline mode and will fail if required local files are missing.
