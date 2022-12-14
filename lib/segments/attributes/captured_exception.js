const crypto = require('crypto');

/**
 * Represents a captured exception.
 * @constructor
 * @param {Exception} err - The exception to capture.
 * @param {boolean} [remote] - Flag for whether the error was remote.
 */

function CapturedException(err, remote) {
  this.init(err, remote);
}

CapturedException.prototype.init = function init(err, remote) {
  var e = (typeof err === 'string' || err instanceof String) ? { message: err, name: '' } : err;

  this.message = e.message;
  this.type = e.name;
  this.stack = [];
  this.remote = !!remote;
  this.id = crypto.randomBytes(8).toString('hex');

  if (e.stack) {
    var stack = e.stack.split('\n');
    stack.shift();

    stack.forEach((stackline) => {
      var line = stackline.trim().replace(/\(|\)/g, '');
      line = line.substring(line.indexOf(' ') + 1);

      var label = line.lastIndexOf(' ') >= 0 ? line.slice(0, line.lastIndexOf(' ')) : null;
      var path = Array.isArray(label) && !label.length ? line : line.slice(line.lastIndexOf(' ') + 1);
      path = path.split(':');

      var entry = {
        path: path[0],
        line: parseInt(path[1]),
        label: label || 'anonymous'
      };

      this.stack.push(entry);
    }, this);
  }
};

module.exports = CapturedException;
