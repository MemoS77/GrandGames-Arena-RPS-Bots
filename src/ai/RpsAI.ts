import { type GamePosition, Move } from './types.js'
import type { IBotSDK, PositionInfo } from '../sdk/IBotSDK.js'

export abstract class RpsAI {
  protected botLogin: string = '-'
  constructor(protected sdk: IBotSDK) {}
  // Init databese, bind hadlers, etc
  async init(botLogin: string): Promise<void> {
    console.log('Initializing AI with bot login:', botLogin)
    this.botLogin = botLogin
  }

  // Get best move for current position
  abstract getBestMove(pos: PositionInfo<GamePosition>): Promise<Move>
  abstract onGameEnd(tableId: number): void
}
