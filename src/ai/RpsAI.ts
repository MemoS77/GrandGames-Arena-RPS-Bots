import { type Round, Move } from './types.ts'
import type { IBotSDK, PositionInfo } from '../sdk/IBotSDK.ts'

export abstract class RpsAI {
  protected botLogin: string = '-'
  constructor(protected sdk: IBotSDK) {}
  // Init databese, bind hadlers, etc
  async init(botLogin: string): Promise<void> {
    console.log('Initializing AI with bot login:', botLogin)
    this.botLogin = botLogin
  }

  // Get best move for current position
  abstract getBestMove(pos: PositionInfo<Round[]>): Promise<Move>
}
