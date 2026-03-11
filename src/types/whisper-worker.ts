export type WhisperWorkerStatus = 'idle' | 'loading' | 'ready' | 'transcribing'

export type WhisperWorkerRequest =
  | {
      type: 'init'
      modelId: string
      baseUrl?: string
    }
  | {
      type: 'transcribe'
      audio: Float32Array
      language?: string
    }

export type WhisperWorkerResponse =
  | {
      type: 'status'
      status: WhisperWorkerStatus
      message: string
      progress?: number
    }
  | {
      type: 'result'
      text: string
    }
  | {
      type: 'error'
      stage: 'init' | 'transcribe'
      message: string
    }
