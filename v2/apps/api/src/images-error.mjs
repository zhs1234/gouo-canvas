export class StudioError extends Error {
  constructor(message, status = 422) { super(message); this.status = status }
}
