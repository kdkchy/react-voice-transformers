/// <reference lib="webworker" />

import {
  AutomaticSpeechRecognitionPipeline,
  AutoModelForSpeechSeq2Seq,
  AutoProcessor,
  AutoTokenizer,
  env,
} from '@xenova/transformers'
import type {
  WhisperWorkerRequest,
  WhisperWorkerResponse,
} from '../types/whisper-worker'

declare const self: DedicatedWorkerGlobalScope

const DEFAULT_BASE_URL = '/'
const DEFAULT_MODEL_ID = 'Xenova/whisper-base'

type Transcriber = (
  audio: Float32Array,
  options?: Record<string, unknown>,
) => Promise<unknown>

type DisposablePipeline = {
  dispose?: () => Promise<void>
}

type ProgressPayload = {
  progress?: number
  file?: string
}

let activeModelId = ''
let transcriber: Transcriber | null = null
let transcriberInstance: DisposablePipeline | null = null
let activeBaseUrl = DEFAULT_BASE_URL

function sendMessage(message: WhisperWorkerResponse) {
  self.postMessage(message)
}

function hasTextResult(value: unknown): value is { text: string } {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return 'text' in value && typeof (value as { text?: unknown }).text === 'string'
}

function normalizeBaseUrl(baseUrl?: string) {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim()
  if (!trimmed) {
    return DEFAULT_BASE_URL
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function configureRuntimeEnvironment(baseUrl: string) {
  const normalizedBase = normalizeBaseUrl(baseUrl)
  const modelRoot = `${normalizedBase}models/`
  const wasmRoot = `${normalizedBase}wasm/`

  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = modelRoot
  env.useBrowserCache = true
  env.backends.onnx.wasm.wasmPaths = wasmRoot
  env.backends.onnx.wasm.numThreads = 1
}

async function initializeModel(modelId: string, baseUrl: string) {
  const normalizedBase = normalizeBaseUrl(baseUrl)

  if (transcriber && activeModelId === modelId && activeBaseUrl === normalizedBase) {
    sendMessage({
      type: 'status',
      status: 'ready',
      message: `Ready (${modelId})`,
    })
    return
  }

  if (transcriber && (activeModelId !== modelId || activeBaseUrl !== normalizedBase)) {
    if (transcriberInstance?.dispose) {
      await transcriberInstance.dispose()
    }
    transcriber = null
    transcriberInstance = null
  }

  sendMessage({
    type: 'status',
    status: 'loading',
    message: `Loading ${modelId} from local files...`,
    progress: 0,
  })

  configureRuntimeEnvironment(normalizedBase)

  const pretrainedOptions = {
    quantized: true,
    progress_callback: (progress: ProgressPayload) => {
      const progressValue =
        typeof progress.progress === 'number' ? progress.progress : undefined

      sendMessage({
        type: 'status',
        status: 'loading',
        message: progress.file
          ? `Loading ${progress.file}...`
          : `Loading ${modelId} from local files...`,
        progress: progressValue,
      })
    },
  }

  const [tokenizer, processor, model] = await Promise.all([
    AutoTokenizer.from_pretrained(modelId, pretrainedOptions),
    AutoProcessor.from_pretrained(modelId, pretrainedOptions),
    AutoModelForSpeechSeq2Seq.from_pretrained(modelId, pretrainedOptions),
  ])

  const asrPipeline = new AutomaticSpeechRecognitionPipeline({
    task: 'automatic-speech-recognition',
    model,
    tokenizer,
    processor,
  })

  transcriberInstance = asrPipeline as unknown as DisposablePipeline
  transcriber = asrPipeline as unknown as Transcriber

  activeModelId = modelId
  activeBaseUrl = normalizedBase

  sendMessage({
    type: 'status',
    status: 'ready',
    message: `Ready (${modelId})`,
  })
}

async function transcribeAudio(audio: Float32Array, language?: string) {
  if (!transcriber) {
    await initializeModel(DEFAULT_MODEL_ID, activeBaseUrl)
  }

  if (!transcriber) {
    throw new Error('Transcriber failed to initialize.')
  }

  sendMessage({
    type: 'status',
    status: 'transcribing',
    message: 'Running offline transcription...',
  })

  const result = await transcriber(audio, {
    chunk_length_s: 20,
    stride_length_s: 4,
    return_timestamps: false,
    task: 'transcribe',
    ...(language ? { language } : {}),
  })

  const text =
    typeof result === 'string' ? result : hasTextResult(result) ? result.text : ''

  sendMessage({
    type: 'result',
    text,
  })

  sendMessage({
    type: 'status',
    status: 'ready',
    message: `Ready (${activeModelId || DEFAULT_MODEL_ID})`,
  })
}

self.onmessage = (event: MessageEvent<WhisperWorkerRequest>) => {
  const message = event.data

  if (message.type === 'init') {
    void initializeModel(message.modelId, message.baseUrl || DEFAULT_BASE_URL).catch(
      (error: unknown) => {
        sendMessage({
          type: 'error',
          stage: 'init',
          message:
            error instanceof Error
              ? error.message
              : 'Unable to initialize local model.',
        })
      },
    )
    return
  }

  if (!activeBaseUrl) {
    activeBaseUrl = DEFAULT_BASE_URL
  }

  void transcribeAudio(message.audio, message.language).catch((error: unknown) => {
    sendMessage({
      type: 'error',
      stage: 'transcribe',
      message:
        error instanceof Error ? error.message : 'Unable to transcribe audio.',
    })
  })
}
