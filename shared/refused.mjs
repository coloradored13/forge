// owns: R10 · shared — the one refusal. Every door in either half says no the same way:
// a code a caller can branch on, a message a person can read, an optional detail with
// the evidence. One class, so a console or an eval tests `instanceof` once.

export class Refused extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}
