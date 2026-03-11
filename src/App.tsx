import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { PCMRecorder } from './lib/pcmRecorder'
import type {
  WhisperWorkerResponse,
  WhisperWorkerStatus,
} from './types/whisper-worker'

const MODEL_ID = 'Xenova/whisper-base'

function normalizeBasePath(pathname: string) {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function App() {
  const [engineStatus, setEngineStatus] = useState<WhisperWorkerStatus>('idle')
  const [statusMessage, setStatusMessage] = useState(
    'Model not loaded. Prepare local assets first.',
  )
  const [loadProgress, setLoadProgress] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [transcript, setTranscript] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0)
  const [language, setLanguage] = useState<'auto' | 'en' | 'id'>('auto')
  const basePath = useMemo(
    () => normalizeBasePath(import.meta.env.BASE_URL || '/'),
    [],
  )
  const modelLocalPath = `${basePath}models/Xenova/whisper-base`
  const wasmLocalPath = `${basePath}wasm`

  const workerRef = useRef<Worker | null>(null)
  const recorderRef = useRef<PCMRecorder | null>(null)
  const recordingTickRef = useRef<number | null>(null)
  const recordingStartRef = useRef<number | null>(null)

  const isBrowserSupported = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia
    )
  }, [])

  useEffect(() => {
    const worker = new Worker(new URL('./workers/whisper.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WhisperWorkerResponse>) => {
      const message = event.data

      if (message.type === 'status') {
        setEngineStatus(message.status)
        setStatusMessage(message.message)
        setLoadProgress(
          typeof message.progress === 'number'
            ? Math.max(0, Math.min(100, Math.round(message.progress * 100)))
            : null,
        )
        return
      }

      if (message.type === 'result') {
        const nextText = message.text.trim()
        if (!nextText) {
          return
        }

        setTranscript((previous) =>
          previous ? `${previous.trimEnd()}\n${nextText}` : nextText,
        )
        return
      }

      setErrorMessage(message.message)
      setEngineStatus('idle')
      setStatusMessage('Failed. Check local model + WASM files, then retry.')
      setLoadProgress(null)
    }

    worker.onerror = () => {
      setErrorMessage('Worker crashed. Reload this page and retry.')
      setEngineStatus('idle')
      setStatusMessage('Worker crashed.')
      setLoadProgress(null)
    }

    return () => {
      if (recordingTickRef.current !== null) {
        window.clearInterval(recordingTickRef.current)
      }
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const handleLoadModel = () => {
    const worker = workerRef.current
    if (!worker) {
      setErrorMessage('Worker is not available.')
      return
    }

    setErrorMessage(null)
    setLoadProgress(null)
    setStatusMessage('Initializing local Whisper model...')
    setEngineStatus('loading')
    worker.postMessage({
      type: 'init',
      modelId: MODEL_ID,
      baseUrl: basePath,
    })
  }

  const handleStartRecording = async () => {
    if (!isBrowserSupported) {
      setErrorMessage('Browser does not support microphone capture APIs.')
      return
    }

    if (engineStatus !== 'ready') {
      setErrorMessage('Load model first.')
      return
    }

    try {
      setErrorMessage(null)
      if (!recorderRef.current) {
        recorderRef.current = new PCMRecorder()
      }

      await recorderRef.current.start()
      setIsRecording(true)
      setRecordingElapsedMs(0)
      recordingStartRef.current = performance.now()

      if (recordingTickRef.current !== null) {
        window.clearInterval(recordingTickRef.current)
      }

      recordingTickRef.current = window.setInterval(() => {
        if (recordingStartRef.current === null) {
          return
        }
        setRecordingElapsedMs(performance.now() - recordingStartRef.current)
      }, 200)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Cannot start recording. Check microphone permission.'
      setErrorMessage(message)
      setIsRecording(false)
    }
  }

  const handleStopAndTranscribe = async () => {
    if (!recorderRef.current) {
      setErrorMessage('Recorder is not initialized.')
      return
    }

    try {
      setIsRecording(false)
      if (recordingTickRef.current !== null) {
        window.clearInterval(recordingTickRef.current)
        recordingTickRef.current = null
      }

      const audio = await recorderRef.current.stop()
      if (audio.length === 0) {
        setErrorMessage('No audio captured. Try speaking a bit longer.')
        return
      }

      const worker = workerRef.current
      if (!worker) {
        setErrorMessage('Worker is not available.')
        return
      }

      setErrorMessage(null)
      worker.postMessage(
        {
          type: 'transcribe',
          audio,
          language: language === 'auto' ? undefined : language,
        },
        [audio.buffer],
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to stop recording and transcribe.'
      setErrorMessage(message)
      setIsRecording(false)
    } finally {
      recordingStartRef.current = null
    }
  }

  const clearTranscript = () => {
    setTranscript('')
  }

  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">Offline Web Speech Prototype</p>
        <h1>React + Whisper WASM</h1>

        <div className="status-row">
          <span className={`badge badge-${engineStatus}`}>{engineStatus}</span>
          <span className="status-message">{statusMessage}</span>
          {loadProgress !== null && engineStatus === 'loading' ? (
            <span className="progress">{loadProgress}%</span>
          ) : null}
        </div>

        <div className="controls">
          <button
            onClick={handleLoadModel}
            disabled={engineStatus === 'loading' || engineStatus === 'transcribing'}
          >
            Load Offline Model
          </button>
          <button
            onClick={handleStartRecording}
            disabled={isRecording || engineStatus !== 'ready'}
          >
            Start Recording
          </button>
          <button onClick={handleStopAndTranscribe} disabled={!isRecording}>
            Stop + Transcribe
          </button>
          <button onClick={clearTranscript} disabled={transcript.length === 0}>
            Clear Text
          </button>
        </div>

        <div className="toolbar">
          <label htmlFor="language">Language</label>
          <select
            id="language"
            value={language}
            onChange={(event) => {
              const selected = event.target.value as 'auto' | 'en' | 'id'
              setLanguage(selected)
            }}
            disabled={isRecording || engineStatus === 'transcribing'}
          >
            <option value="auto">Auto detect</option>
            <option value="en">English</option>
            <option value="id">Indonesian</option>
          </select>
          <span className="recording-time">
            {isRecording ? `Recording ${formatDuration(recordingElapsedMs)}` : 'Idle'}
          </span>
        </div>

        <label className="transcript-label" htmlFor="transcript">
          Transcript
        </label>
        <textarea
          id="transcript"
          className="transcript"
          value={transcript}
          placeholder="Transcript will appear here..."
          readOnly
        />

        <div className="notes">
          <p>
            Expected local model path: <code>{modelLocalPath}</code>
          </p>
          <p>
            Expected local WASM path: <code>{wasmLocalPath}</code>
          </p>
          <p>
            Model ID: <code>{MODEL_ID}</code>
          </p>
        </div>

        {errorMessage ? (
          <div className="error" role="alert">
            {errorMessage}
          </div>
        ) : null}
      </section>
    </main>
  )
}

export default App
