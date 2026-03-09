// Not used enum for erasable syntax in node support

export const PlayerState = {
  Passive: 0, // Not moving at the current moment
  Active: 1, // Moving at the current moment
  Winner: 2, // Won
  Looser: 3, // Lost
  Drawer: 4, // Draw
  Unused: 5, // Not considered, for example left at the beginning, etc.
} as const

export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState]

export const TableState = {
  Empty: 0, // Has free slots
  Started: 1, // Game in progress
  Finished: 2, // Game finished
  Canceled: 3, // Game canceled
} as const

export type TableState = (typeof TableState)[keyof typeof TableState]

export type UserInfo = {
  uid: number
  login: string
}

export type PositionInfo<T = object> = {
  moveNumber: number
  position: T
  // Whether time per move is fixed. If yes, the bot can think for all this time. If no, need to calculate acceptable thinking time.
  fixedMoveTime: boolean
  // Additional time in seconds (used only if fixedMoveTime = false)
  addTime?: number
  // Bot index
  botIndex: number | null
  // Whether the bot should make a move now
  needMove: boolean
  // Fixed game identifier on GrandGames Arena
  game: number
  // Table number
  tableId: number

  state: TableState

  players: (null | {
    uid: number
    login: string
    rating?: number
    time: number
    state: PlayerState
  })[]
}

export type ConnectionOptions = {
  games: number[]
  serverUrl?: string
}

export interface IBotSDK {
  // Connect and set supported games. return bot uid and login if token is valid
  connect(token: string, options: ConnectionOptions): Promise<UserInfo>

  // Connection was lost
  onDisconnect(handler: (code: number) => void): void

  // Triggered on any table updates, not only position changed.
  onPosition<T>(handler: (data: PositionInfo<T>) => void): void

  onMessage(
    handler: (tableId: number, text: string, login: string) => void,
  ): void

  // Do move
  move(tableId: number, move: string): Promise<void>

  // Send chat message
  message(tableId: number, text: string): void
}
