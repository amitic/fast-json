const { EventTree } = require('./EventTree');

const OPEN_BRACE = '{'.charCodeAt(0);
const CLOSE_BRACE = '}'.charCodeAt(0);
const OPEN_BRACKET = '['.charCodeAt(0);
const CLOSE_BRACKET = ']'.charCodeAt(0);
const QUOTE = '"'.charCodeAt(0);
const SPACE = ' '.charCodeAt(0);
const NEW_LINE = '\n'.charCodeAt(0);
const CARRIAGE_RETURN = '\r'.charCodeAt(0);
const TAB = '\t'.charCodeAt(0);
const COLON = ':'.charCodeAt(0);
const COMMA = ','.charCodeAt(0);
const BACKSLASH = '\\'.charCodeAt(0);

const TYPE_ARRAY = 1;
const TYPE_OBJECT = 2;
const ROOT_KEY = '/';

class FastJson {
  /**
   * @param {FastJsonOptions} [options] The fast-json options.
   */
  constructor(options = {}) {
    this._stack = [];
    this._postColon = false;
    this._lastString = {};
    this._skipped = false;

    this._events = new EventTree(ROOT_KEY, options.pathSeparator);
  }

  /**
   * Adds a listener function for the provided path.
   * @param {Array|String} path The JSON path to get values.
   * @param {FastJson~jsonListener} listener The function called after finding the JSON path.
   */
  on(path, listener) {
    this._events.on(path, listener);
  }

  /**
   * Start processing JSON using the defined paths in {@link FastJson#on} method.
   * @param {String|Buffer} data The JSON to process.
   */
  write(data) {
    for (let i = 0; i < data.length && !this._skipped; i++) {
      switch (FastJson._get(data, i)) {
        case OPEN_BRACE:
          i = this._onOpenBlock(data, i, TYPE_OBJECT, OPEN_BRACE, CLOSE_BRACE);
          break;
        case OPEN_BRACKET:
          i = this._onOpenBlock(data, i, TYPE_ARRAY, OPEN_BRACKET, CLOSE_BRACKET);
          break;
        case CLOSE_BRACE: case CLOSE_BRACKET:
          this._onCloseBlock(data, i);
          break;
        case QUOTE:
          i = this._onQuote(data, i);
          break;
        case TAB: case CARRIAGE_RETURN: case NEW_LINE: case SPACE:
          break;
        case COLON:
          this._postColon = true;
          break;
        case COMMA:
          this._onComma();
          break;
        default:
          i = this._onPrimitive(data, i);
      }
    }

    if (this._skipped) {
      this._skipCleanUp();
    }
  }

  /**
   * Stop processing the last JSON provided in the {@link FastJson#write} method.
   */
  skip() {
    this._skipped = true;
  }

  _skipCleanUp() {
    this._stack = [];
    this._postColon = false;
    this._skipped = false;
    this._events.reset();
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @param {String} type
   * @param {Number} openChar
   * @param {Number} closeChar
   * @returns {Number}
   * @private
   */
  _onOpenBlock(data, index, type, openChar, closeChar) {
    const key = this._getKey(data);
    if (!this._events.hasNode(key)) {
      return FastJson._skipBlock(data, index, openChar, closeChar);
    }

    this._events.down(key);

    this._stack.push({
      // General
      type,
      start: index,
      key,

      // TYPE_ARRAY
      index: 0,
    });

    this._postColon = false;

    return index;
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @private
   */
  _onCloseBlock(data, index) {
    const frame = this._stack.pop();
    frame.end = index;

    if (this._events.hasListener()) {
      this._events.emit(data.slice(frame.start, frame.end + 1));
    }

    this._events.up();
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @returns {Number}
   * @private
   */
  _onQuote(data, index) {
    const strStart = index + 1;
    const strEnd = FastJson._parseString(data, index);

    this._emitPrimitiveOrString(data, strStart, strEnd);

    this._postColon = false;
    this._lastString.start = strStart;
    this._lastString.end = strEnd;

    return index + ((strEnd - strStart) + 1);
  }

  _onComma() {
    const frame = this._getFrame();
    if (frame.type === TYPE_ARRAY) {
      frame.index++;
    }
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @returns {Number}
   * @private
   */
  _onPrimitive(data, index) {
    const primEnd = FastJson._parsePrimitive(data, index);

    this._emitPrimitiveOrString(data, index, primEnd);

    this._postColon = false;

    return index + (primEnd - index - 1);
  }

  _emitPrimitiveOrString(data, start, end) {
    const frame = this._getFrame();

    if (this._postColon) {
      const key = this._getKeyForPrimitiveObject(data);
      if (this._events.hasNode(key)) {
        this._events.down(key);

        if (this._events.hasListener()) {
          this._events.emit(data.slice(start, end));
        }

        this._events.up();
      }
    } else if (frame.type === TYPE_ARRAY) {
      const key = FastJson._getKeyForPrimitiveArray(frame);
      if (this._events.hasNode(key)) {
        this._events.down(key);

        if (this._events.hasListener()) {
          this._events.emit(data.slice(start, end));
        }

        this._events.up();
      }
    }
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @param {Number} openChar
   * @param {Number} closeChar
   * @returns {Number}
   * @private
   */
  static _skipBlock(data, index, openChar, closeChar) {
    let blockDepth = 1;
    let i = index + 1;

    for (; blockDepth > 0; i++) {
      switch (FastJson._get(data, i)) {
        case QUOTE: {
          const strEnd = FastJson._parseString(data, i);
          i += strEnd - i;
          break;
        }
        case openChar:
          blockDepth++;
          break;
        case closeChar:
          blockDepth--;
          break;
        default:
      }
    }

    return i - 1;
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @returns {Number}
   * @private
   */
  static _parseString(data, index) {
    for (let i = index + 1; ;i++) {
      switch (FastJson._get(data, i)) {
        case QUOTE: return i;
        case BACKSLASH: i++; break;
        default:
      }
    }
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @returns {Number}
   * @private
   */
  static _parsePrimitive(data, index) {
    for (let i = index; ;i++) {
      switch (FastJson._get(data, i)) {
        case CLOSE_BRACKET: case CLOSE_BRACE: case COMMA:
        case TAB: case CARRIAGE_RETURN: case NEW_LINE: case SPACE:
          return i;
        default:
      }
    }
  }

  /**
   * @param {String|Buffer} data
   * @returns {String}
   * @private
   */
  _getKey(data) {
    if (this._stack.length === 0) {
      return ROOT_KEY;
    }

    const frame = this._getFrame();
    if (frame.type === TYPE_ARRAY) {
      return FastJson._getKeyForPrimitiveArray(frame);
    }

    return this._getKeyForPrimitiveObject(data);
  }

  /**
   * @return {Object}
   * @private
   */
  _getFrame() {
    return this._stack[this._stack.length - 1];
  }

  /**
   * @param {String|Buffer} data
   * @returns {String}
   * @private
   */
  _getKeyForPrimitiveObject(data) {
    return FastJson._toString(data, this._lastString.start, this._lastString.end);
  }

  /**
   * @param {Object} frame
   * @returns {String}
   * @private
   */
  static _getKeyForPrimitiveArray(frame) {
    return `${frame.index}`;
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} index
   * @returns {Number}
   * @private
   */
  static _get(data, index) {
    if (typeof data === 'string') {
      return data.charCodeAt(index);
    }

    return data[index];
  }

  /**
   * @param {String|Buffer} data
   * @param {Number} start
   * @param {Number} end
   * @returns {String}
   * @private
   */
  static _toString(data, start, end) {
    if (typeof data === 'string') {
      return data.slice(start, end);
    }

    return data.toString(undefined, start, end);
  }
}

module.exports = {
  FastJson,
};

/**
 * @callback FastJson~jsonListener
 * @param {String|Buffer} value The found value type will depend of the type used in
 *   {@link FastJson#write}.
 */

/**
 * @typedef FastJsonOptions
 * @type {object}
 * @property {String} [options.pathSeparator] Path separator to use in string JSON paths. This can
 *   be used to allow JSON keys with special characters like dots. Setting this to <code>/</code>
 *   allows JSON paths like <code>user/first.name</code> which will be separated into
 *   <code>['user', 'first.name']</code>.
 */
