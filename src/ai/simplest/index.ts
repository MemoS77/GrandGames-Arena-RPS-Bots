import type { PositionInfo } from '../../sdk/IBotSDK.ts'
import { RpsAI } from '../RpsAI.js'
import type { Move, Round } from '../types.ts'

export default class SimplestRpsAI extends RpsAI {
  private greetingSent = new Set<number>()

  override async init(botLogin: string) {
    super.init(botLogin)
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

  private sendGreeting(pos: PositionInfo<Round[]>) {
    if (!this.greetingSent.has(pos.tableId)) {
      this.greetingSent.add(pos.tableId)
      const enemy = pos.players.find(
        (p) => p !== null && p.login !== this.botLogin,
      )

      setTimeout(() => {
        this.sdk.message(
          pos.tableId,
          `Hello ${enemy?.login}! I am a simple bot. I will play randomly.`,
        )
      }, 0)
    }
  }

  override async getBestMove(pos: PositionInfo<Round[]>): Promise<Move> {
    this.sendGreeting(pos)

    //console.log('Get move for:', pos)

    const moves = ['r', 'p', 's']
    const move = moves[Math.floor(Math.random() * 3)]!

    return move as Move
  }

  override onGameEnd(tableId: number): void {
    console.log('Game ended for table', tableId)
    this.greetingSent.delete(tableId)
  }
}
