import type { PositionInfo } from '../../sdk/IBotSDK.ts'
import { RpsAI } from '../RpsAI.js'
import type { Move, Round } from '../types.ts'

export default class SimplestRpsAI extends RpsAI {
  private greetingSent = new Set<number>()

  override async init() {
    this.sdk.onMessage((tableId: number, _message: string, login: string) => {
      this.sdk.message(
        tableId,
        `Sorry, ${login}, I don't understand your messages...`,
      )
    })

    // Clear greeting sent flag
    setInterval(
      () => {
        this.greetingSent.clear()
      },
      1000 * 60 * 60,
    )
  }

  override async getBestMove(pos: PositionInfo<Round[]>): Promise<Move> {
    if (!this.greetingSent.has(pos.tableId)) {
      this.greetingSent.add(pos.tableId)

      setTimeout(() => {
        this.sdk.message(
          pos.tableId,
          `Hello! I am a simple bot. I will play randomly.`,
        )
      }, 1000)
    }
    const moves = ['r', 'p', 's']
    const move = moves[Math.floor(Math.random() * 3)]!

    return move as Move
  }
}
