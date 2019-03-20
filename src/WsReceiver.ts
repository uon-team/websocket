import { Writable } from "stream";
import { IsValidStatusCode, WsErrorCode } from "./WsUtils";

const ERROR_CODE = Symbol('status-code');
const EMPTY_BUFFER = Buffer.alloc(0);
const MAX_SAFE_INT_VALUE = Math.pow(2, 53) - 1;

enum ReceiverState {
    ReadInfo,
    ReadPayloadLength16,
    ReadPayloadLength64,
    ReadMask,
    ReadData,
    Inflating
};


/**
 * 
 */
export class WsReceiver extends Writable {

    private _fin: boolean = false;
    private _opcode: number = 0;


    private _messageLength: number;
    private _fragments: any[] = [];
    private _payloadLength: number;
    private _totalPayloadLength: number = 0;
    private _bufferedBytes: number = 0;
    private _buffers: any[] = [];

    private _fragmented: number;
    private _compressed: boolean;
    private _masked: boolean;
    private _mask: Buffer;
    private _loop: boolean;
    private _state: ReceiverState = ReceiverState.ReadInfo;


    constructor(private _binaryType: string,
        private _maxPayload: number) {
        super();
    }


    _write(chunk: any, encoding: any, cb: Function) {
        if (this._opcode === 0x08) return cb();

        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);

        this.startLoop(cb);
    }

    private startLoop(cb: Function) {

        let err;
        this._loop = true;

        do {
            switch (this._state) {
                case ReceiverState.ReadInfo:
                    err = this.readInfo();
                    break;
                case ReceiverState.ReadPayloadLength16:
                    err = this.readPayloadLength16();
                    break;
                case ReceiverState.ReadPayloadLength64:
                    err = this.readPayloadLength64();
                    break;
                case ReceiverState.ReadMask:
                    this.readMask();
                    break;
                case ReceiverState.ReadData:
                    err = this.readData(cb);
                    break;
                default: // `INFLATING`
                    this._loop = false;
                    return;
            }
        } while (this._loop);

        cb(err);

    }

    private consume(n: number): Buffer {

        this._bufferedBytes -= n;

        if (n === this._buffers[0].length) {
            return this._buffers.shift();
        }

        if (n < this._buffers[0].length) {

            const buf = this._buffers[0];
            this._buffers[0] = buf.slice(n);
            return buf.slice(0, n);
        }

        const dst = Buffer.allocUnsafe(n);

        do {

            const buf = this._buffers[0];

            if (n >= buf.length) {

                this._buffers.shift().copy(dst, dst.length - n);

            }
            else {

                buf.copy(dst, dst.length - n, 0, n);
                this._buffers[0] = buf.slice(n);

            }

            n -= buf.length;
        } while (n > 0);

        return dst;
    }

    private readInfo() {
        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }

        const buf = this.consume(2);

        if ((buf[0] & 0x30) !== 0x00) {
            this._loop = false;
            return MakeError(RangeError, 'RSV2 and RSV3 must be clear', WsErrorCode.ProtocolError);
        }

        const compressed = (buf[0] & 0x40) === 0x40;

         if (compressed) {
             this._loop = false;
             return MakeError(RangeError, `Implementation doesn't yet support compression`, WsErrorCode.UnsupportedData);
         }

        this._fin = (buf[0] & 0x80) === 0x80;
        this._opcode = buf[0] & 0x0f;
        this._payloadLength = buf[1] & 0x7f;

        if (this._opcode === 0x00) {
            if (compressed) {
                this._loop = false;
                return MakeError(RangeError, 'RSV1 must be clear', WsErrorCode.ProtocolError);
            }

            if (!this._fragmented) {
                this._loop = false;
                return MakeError(RangeError, 'invalid opcode 0', WsErrorCode.ProtocolError);
            }

            this._opcode = this._fragmented;
        }

        else if (this._opcode === 0x01 || this._opcode === 0x02) {
            if (this._fragmented) {
                this._loop = false;
                return MakeError(RangeError, `invalid opcode ${this._opcode}`, WsErrorCode.ProtocolError);
            }

            this._compressed = compressed;
        }

        else if (this._opcode > 0x07 && this._opcode < 0x0b) {
            if (!this._fin) {
                this._loop = false;
                return MakeError(RangeError, 'FIN must be set', WsErrorCode.ProtocolError);
            }

            if (compressed) {
                this._loop = false;
                return MakeError(RangeError, 'RSV1 must be clear', WsErrorCode.ProtocolError);
            }

            if (this._payloadLength > 0x7d) {
                this._loop = false;
                return MakeError(RangeError, `invalid payload length ${this._payloadLength}`, WsErrorCode.ProtocolError);
            }
        }

        else {
            this._loop = false;
            return MakeError(RangeError, `invalid opcode ${this._opcode}`, WsErrorCode.ProtocolError);
        }

        if (!this._fin && !this._fragmented) {
            this._fragmented = this._opcode;
        }

        this._masked = (buf[1] & 0x80) === 0x80;

        if (this._payloadLength === 126) {
            this._state = ReceiverState.ReadPayloadLength16;
        }
        else if (this._payloadLength === 127) {
            this._state = ReceiverState.ReadPayloadLength64;
        }
        else {
            return this.haveLength();
        }
    }


    haveLength() {
        if (this._payloadLength && this._opcode < 0x08) {

            this._totalPayloadLength += this._payloadLength;

            if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
                this._loop = false;
                return MakeError(RangeError, 'Max payload size exceeded', WsErrorCode.PayloadTooLarge);
            }
        }

        if (this._masked) {
            this._state = ReceiverState.ReadMask;
        }
        else {
            this._state = ReceiverState.ReadData;
        }
    }


    readPayloadLength16() {

        if (this._bufferedBytes < 2) {
            this._loop = false;
            return;
        }

        this._payloadLength = this.consume(2).readUInt16BE(0);
        return this.haveLength();
    }

    readPayloadLength64() {

        if (this._bufferedBytes < 8) {
            this._loop = false;
            return;
        }

        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);

        // care for max safe int value
        if (num > MAX_SAFE_INT_VALUE) {
            this._loop = false;
            return MakeError(
                RangeError,
                'Unsupported WebSocket frame: payload length > 2^53 - 1',
                WsErrorCode.PayloadTooLarge
            );
        }

        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        return this.haveLength();
    }

    /**
   * Reads mask bytes.
   *
   * @private
   */
    readMask() {
        if (this._bufferedBytes < 4) {
            this._loop = false;
            return;
        }

        this._mask = this.consume(4);
        this._state = ReceiverState.ReadData;
    }


    readData(cb: Function) {
        let data = EMPTY_BUFFER;

        if (this._payloadLength) {
            if (this._bufferedBytes < this._payloadLength) {
                this._loop = false;
                return;
            }

            data = this.consume(this._payloadLength);
            if (this._masked) {
                Unmask(data, this._mask);
            }
        }

        if (this._opcode > 0x07) {
            return this.handleControlMessage(data);
        }

        if (this._compressed) {
            this._state = ReceiverState.Inflating;
            //this.decompress(data, cb);
            return;
        }

        if (data.length) {
            //
            // This message is not compressed so its lenght is the sum of the payload
            // length of all fragments.
            //
            this._messageLength = this._totalPayloadLength;
            this._fragments.push(data);
        }

        return this.handleDataMessage();
    }

    private handleControlMessage(data: Buffer) {
        if (this._opcode === 0x08) {

            this._loop = false;

            if (data.length === 0) {
                this.emit('conclude', 1005, '');
                this.end();
            }

            else if (data.length === 1) {
                return MakeError(RangeError, 'invalid payload length 1', WsErrorCode.ProtocolError);
            }

            else {
                const code = data.readUInt16BE(0);

                if (!IsValidStatusCode(code)) {
                    return MakeError(RangeError, `invalid status code ${code}`, WsErrorCode.ProtocolError);
                }

                const buf = data.slice(2);

                this.emit('conclude', code, buf.toString());
                this.end();
            }

            return;
        }

        if (this._opcode === 0x09) {
            this.emit('ping', data);
        }
        else {
            this.emit('pong', data);
        }

        this._state = ReceiverState.ReadInfo;
    }


    handleDataMessage() {

        if (this._fin) {
            const messageLength = this._messageLength;
            const fragments = this._fragments;

            this._totalPayloadLength = 0;
            this._messageLength = 0;
            this._fragmented = 0;
            this._fragments = [];

            if (this._opcode === 2) {
                var data;

                if (this._binaryType === 'nodebuffer') {
                    data = ToBuffer(fragments, messageLength);
                }
                else if (this._binaryType === 'arraybuffer') {
                    data = ToArrayBuffer(ToBuffer(fragments, messageLength));
                }
                else {
                    data = fragments;
                }

                this.emit('message', data);


            } else {
                const buf: Buffer = ToBuffer(fragments, messageLength);

                this.emit('message', buf);
            }
        }

        this._state = ReceiverState.ReadInfo;
    }

}


function MakeError(type: any, message: string, code: number) {

    let err = new type(message);
    Error.captureStackTrace(err, MakeError);
    err[ERROR_CODE] = code;

    return err;
}


function Unmask(buffer: Buffer, mask: Buffer) {
    const length = buffer.length;
    let i: number;
    for (i = 0; i < length; ++i) {
        buffer[i] ^= mask[i & 3];
    }
}

function ToBuffer(fragments: any[], messageLength: number) {
    if (fragments.length === 1)
        return fragments[0];
    if (fragments.length > 1)
        return Buffer.concat(fragments, messageLength);
    return EMPTY_BUFFER;
}

function ToArrayBuffer(buf: Buffer) {
    if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
        return buf.buffer;
    }

    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

