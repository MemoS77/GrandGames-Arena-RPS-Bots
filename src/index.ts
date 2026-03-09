import BotSDK from './sdk/arena-bot-node-sdk.js'
import type { IBotSDK } from './sdk/IBotSDK.ts'
import dotenv from 'dotenv'
import type { Round } from './ai/types.ts'
import SimplestRpsAI from './ai/simplest/index.ts'
import type { RpsAI } from './ai/RpsAI.ts'

dotenv.config()

console.clear()
const sdk: IBotSDK = new BotSDK()

const ai: RpsAI = new SimplestRpsAI(sdk)

const token = process.env.JWT
if (!token) throw 'Please, set JWT in .env file'

const connect = () => {
  sdk
    .connect(token, { games: [14] })
    .then((v) => {
      console.log('Connectded! User info: ', v)
      ai.init()
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

sdk.onPosition<Round[]>((p) => {
  console.log(p)
  if (p.needMove) {
    ai.getBestMove(p)
      .then((move) => {
        sdk.move(p.tableId!, move).catch((err) => {
          console.error(`Error making move "${move}"`, err)
        })
      })
      .catch((err) => {
        console.error('Error getting best move:', err)
      })
  }
})

connect()
