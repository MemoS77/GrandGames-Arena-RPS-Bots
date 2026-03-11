import BotSDK from './sdk/arena-bot-node-sdk.js'
import { TableState, type IBotSDK, type PositionInfo } from './sdk/IBotSDK.js'

import type { GamePosition } from './ai/types.js'
import type { RpsAI } from './ai/RpsAI.js'
import { TOKEN, AI, SERVER } from './conf.js'
import log from './log.js'

// Dynamic AI import
const aiModules = {
  opus: () => import('./ai/opus/index.js'),
  codex: () => import('./ai/codex/index.js'),
  random: () => import('./ai/random/index.js'),
  swe15: () => import('./ai/swe15/index.js'),
  gpt: () => import('./ai/gpt/index.js'),
}

// Type for AI constructor
type AIConstructor = new (sdk: IBotSDK) => RpsAI

const loadAIClass = async (aiName: string): Promise<AIConstructor> => {
  const moduleLoader = aiModules[aiName as keyof typeof aiModules]
  if (!moduleLoader) {
    throw new Error(`Unknown AI: ${aiName}`)
  }
  const module = await moduleLoader()
  return module.default as AIConstructor
}

console.clear()

const sdk: IBotSDK = new BotSDK()

// Initialize AI dynamically
let ai: RpsAI

const initializeAI = async () => {
  if (!AI) {
    throw new Error('AI environment variable is not set')
  }
  const AIClass = await loadAIClass(AI)
  ai = new AIClass(sdk)
  console.info(`AI ${AI} initialized successfully`)
}

initializeAI().catch((err) => {
  console.error('Failed to initialize AI:', err)
  process.exit(1)
})

type PositionItem = PositionInfo<GamePosition>

const positionQueue: PositionItem[] = []
let processingKey: string | null = null

const simpleHash = (str: string): number => {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

const getPositionKey = (p: PositionItem): string => {
  return `${p.tableId}:${simpleHash(JSON.stringify(p.position))}`
}

const processQueue = async () => {
  if (processingKey !== null || positionQueue.length === 0) return
  if (!ai) return // AI not yet initialized

  const p = positionQueue.shift()!
  processingKey = getPositionKey(p)

  try {
    const move = await ai.getBestMove(p)
    log('Making move:', move)
    const newPos = await sdk.move(p.tableId!, move)
    log('Move made successfully. New position: ', newPos)
  } catch (err) {
    console.error('Error processing position:', err)
  } finally {
    processingKey = null
    processQueue()
  }
}

sdk.onPosition<GamePosition>((p) => {
  log('Position received in onPosition:', p)
  if (p.state === TableState.Finished || p.state === TableState.Canceled) {
    if (ai) ai.onGameEnd(p.tableId)
    return
  }
  if (!p.needMove) return

  const key = getPositionKey(p)
  if (key === processingKey) return

  const existingIndex = positionQueue.findIndex(
    (q) => getPositionKey(q) === key,
  )
  if (existingIndex !== -1) return

  const sameTableIndex = positionQueue.findIndex((q) => q.tableId === p.tableId)
  if (sameTableIndex !== -1) {
    positionQueue[sameTableIndex] = p
    log('Position updated in queue', p.tableId)
  } else {
    positionQueue.push(p)
    log('Position added to queue', p.tableId)
  }

  processQueue()
})

const connect = () => {
  sdk
    .connect(TOKEN!, { games: [14], serverUrl: SERVER })
    .then((v) => {
      log('Connectded! User info: ', v)
      if (ai) ai.init(v.login)
    })
    .catch((err) => {
      log(`Can't connect`, err)
    })
}

sdk.onDisconnect((code) => {
  log(`Disconnected with code: ${code}`)
  setTimeout(() => {
    connect()
  }, 2000)
})

connect()
