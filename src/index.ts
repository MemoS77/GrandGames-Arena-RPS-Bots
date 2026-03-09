import BotSDK from './sdk/arena-bot-node-sdk.js'
import { TableState, type IBotSDK, type PositionInfo } from './sdk/IBotSDK.ts'
import dotenv from 'dotenv'
import type { GamePosition } from './ai/types.ts'
import AI from './ai/swe15/index.ts'
import type { RpsAI } from './ai/RpsAI.ts'

dotenv.config()

console.clear()

const sdk: IBotSDK = new BotSDK()

const ai: RpsAI = new AI(sdk)

const token = process.env.JWT
if (!token) throw 'Please, set JWT in .env file'

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

  const p = positionQueue.shift()!
  processingKey = getPositionKey(p)

  try {
    const move = await ai.getBestMove(p)
    await sdk.move(p.tableId!, move)
  } catch (err) {
    console.error('Error processing position:', err)
  } finally {
    processingKey = null
    processQueue()
  }
}

sdk.onPosition<GamePosition>((p) => {
  if (p.state === TableState.Finished || p.state === TableState.Canceled) {
    ai.onGameEnd(p.tableId)
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
  } else {
    positionQueue.push(p)
  }

  processQueue()
})

const connect = () => {
  sdk
    .connect(token, { games: [14] })
    .then((v) => {
      console.log('Connectded! User info: ', v)
      ai.init(v.login)
    })
    .catch((err) => {
      console.log(`Can't connect`, err)
    })
}

sdk.onDisconnect((code) => {
  console.log(`Disconnected with code: ${code}`)
  setTimeout(() => {
    connect()
  }, 2000)
})

connect()
