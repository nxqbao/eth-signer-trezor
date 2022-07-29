export class ConnectError extends Error {
  readonly code

  constructor (msg: string, code?: string) {
    super(msg)

    this.code = code
  }
}