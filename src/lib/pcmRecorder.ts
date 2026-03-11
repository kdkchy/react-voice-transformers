const TARGET_SAMPLE_RATE = 16_000
const PROCESSOR_BUFFER_SIZE = 4_096

function mergeChunks(chunks: Float32Array[], totalFrames: number): Float32Array {
  const merged = new Float32Array(totalFrames)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return merged
}

function resampleLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Float32Array {
  if (inputRate === outputRate) {
    return input
  }

  const sampleRateRatio = inputRate / outputRate
  const outputLength = Math.max(1, Math.round(input.length / sampleRateRatio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * sampleRateRatio
    const leftIndex = Math.floor(position)
    const rightIndex = Math.min(leftIndex + 1, input.length - 1)
    const interpolationWeight = position - leftIndex

    const leftValue = input[leftIndex] ?? 0
    const rightValue = input[rightIndex] ?? leftValue

    output[i] = leftValue + (rightValue - leftValue) * interpolationWeight
  }

  return output
}

export class PCMRecorder {
  private context: AudioContext | null = null

  private mediaStream: MediaStream | null = null

  private sourceNode: MediaStreamAudioSourceNode | null = null

  private processorNode: ScriptProcessorNode | null = null

  private sinkNode: GainNode | null = null

  private chunks: Float32Array[] = []

  private totalFrames = 0

  private recording = false

  public async start(): Promise<void> {
    if (this.recording) {
      throw new Error('Recorder is already running.')
    }

    this.chunks = []
    this.totalFrames = 0

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    this.context = new AudioContext({
      sampleRate: TARGET_SAMPLE_RATE,
      latencyHint: 'interactive',
    })

    this.sourceNode = this.context.createMediaStreamSource(this.mediaStream)
    this.processorNode = this.context.createScriptProcessor(
      PROCESSOR_BUFFER_SIZE,
      1,
      1,
    )
    this.sinkNode = this.context.createGain()
    this.sinkNode.gain.value = 0

    this.processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      const frame = new Float32Array(input.length)
      frame.set(input)
      this.chunks.push(frame)
      this.totalFrames += frame.length
    }

    this.sourceNode.connect(this.processorNode)
    this.processorNode.connect(this.sinkNode)
    this.sinkNode.connect(this.context.destination)
    this.recording = true
  }

  public async stop(): Promise<Float32Array> {
    if (!this.recording) {
      throw new Error('Recorder is not running.')
    }

    const sourceSampleRate = this.context?.sampleRate ?? TARGET_SAMPLE_RATE

    this.processorNode?.disconnect()
    this.sourceNode?.disconnect()
    this.sinkNode?.disconnect()

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop()
      }
    }

    if (this.context) {
      await this.context.close()
    }

    this.processorNode = null
    this.sourceNode = null
    this.sinkNode = null
    this.mediaStream = null
    this.context = null
    this.recording = false

    const merged = mergeChunks(this.chunks, this.totalFrames)
    this.chunks = []
    this.totalFrames = 0

    if (merged.length === 0) {
      return merged
    }

    return resampleLinear(merged, sourceSampleRate, TARGET_SAMPLE_RATE)
  }
}
