import { type Round, Move } from './types.ts'
import type { IBotSDK, PositionInfo } from '../sdk/IBotSDK.ts'

export abstract class RpsAI {
  constructor(protected sdk: IBotSDK) {}
  // Init databese, bind hadlers, etc
  abstract init(): Promise<void>

  // Get best move for current position
  abstract getBestMove(pos: PositionInfo<Round[]>): Promise<Move>
}
