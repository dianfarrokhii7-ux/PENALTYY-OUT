'use strict';
class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra || null; }
}
const err = (status, code, message, extra) => new HttpError(status, code, message, extra);
module.exports = { HttpError, err };
