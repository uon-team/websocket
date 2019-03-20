import { Socket } from "net";
import { IsValidStatusCode } from "./WsUtils";

import * as crypto from 'crypto';

const EMPTY_BUFFER = Buffer.alloc(0);
const EMPTY_OBJECT = {};

export interface WsSendOptions {
    compress?: boolean;
    binary?: boolean;
    fin?: boolean;
    mask?: boolean;
}

export class WsSender {

    private _queue: any[] = [];
    private _bufferedBytes: number = 0;
    private _first: boolean = true;

    constructor(private _socket: Socket) {

    }


    close(code: number, data?: string, mask?: boolean) {

        let buf: Buffer;

        if (code === undefined) {
            buf = EMPTY_BUFFER;
        }
        else if (typeof code !== 'number' || !IsValidStatusCode(code)) {
            throw new TypeError('First argument must be a valid error code number');
        }
        else if (data === undefined || data === '') {
            buf = Buffer.allocUnsafe(2);
            buf.writeUInt16BE(code, 0);
        }
        else {
            buf = Buffer.allocUnsafe(2 + Buffer.byteLength(data));
            buf.writeUInt16BE(code, 0);
            buf.write(data, 2);
        }

        return this.sendFrame(MakeFrame(buf, {
            fin: true,
            rsv1: false,
            opcode: 0x08,
            mask
        }));

    }



    send(data: Buffer | ArrayBuffer | string, options: WsSendOptions = EMPTY_OBJECT) {

        let opcode = options.binary ? 2 : 1;
        let rsv1 = !!options.compress;

        if (this._first) {
            this._first = false;
        }
        else {
            opcode = 0;
        }


        if (options.fin) {
            this._first = true;
        }

        let frame = MakeFrame(EnsureBuffer(data), {
            fin: options.fin,
            rsv1: false,
            opcode,
            mask: options.mask
        });

        return this.sendFrame(frame);

    }

    ping(data: Buffer | ArrayBuffer | string, options: WsSendOptions = EMPTY_OBJECT) {

        return this.sendFrame(
            MakeFrame(EnsureBuffer(data), {
                fin: true,
                rsv1: false,
                opcode: 0x09,
                mask: options.mask
            })
        );
    }

    pong(data: Buffer | ArrayBuffer | string, options: WsSendOptions = EMPTY_OBJECT) {

        return this.sendFrame(
            MakeFrame(EnsureBuffer(data), {
                fin: true,
                rsv1: false,
                opcode: 0x0a,
                mask: options.mask
            })
        );
    }


    private sendFrame(list: Buffer[]) {

        return new Promise<void>((resolve, reject) => {

            this._socket.write(list[0]);
            this._socket.write(list[1], () => {
                resolve();
            });
        })
    }


}

interface FrameOptions {
    fin?: boolean;
    opcode?: number;
    mask?: boolean;
    rsv1?: boolean;
}

function EnsureBuffer(data: Buffer | ArrayBuffer | string) {
    let result: Buffer;
    if (!Buffer.isBuffer(data)) {
        if (data instanceof ArrayBuffer) {
            result = Buffer.from(data);
        }
        else if (ArrayBuffer.isView(data)) {
            result = ViewToBuffer(data);
        }
        else {
            result = Buffer.from(data, 'utf8');
        }
    }

    return result;
}

function MakeFrame(data: Buffer, options: FrameOptions) {

    let offset = options.mask ? 6 : 2;
    let payload_length = data.length;

    if (data.length >= 65536) {
        offset += 8;
        payload_length = 127;
    }
    else if (data.length > 125) {
        offset += 2;
        payload_length = 126;
    }

    // create header buffer
    const header = Buffer.allocUnsafe(offset);

    // write the opcode
    header[0] = options.fin ? options.opcode | 0x80 : options.opcode;

    // or with rsv1
    if (options.rsv1) {
        header[0] |= 0x40;
    }

    // write the data length type
    header[1] = options.mask ? payload_length | 0x80 : payload_length;

    // then the actual length
    if (payload_length === 126) {
        header.writeUInt16BE(data.length, 2);
    }
    else if (payload_length === 127) {
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(data.length, 6);
    }

    // generate mask and mask the data buffer
    // WARNING: this will modify the data buffer
    if (options.mask) {

        const mask = crypto.randomBytes(4);
        header[offset - 4] = mask[0];
        header[offset - 3] = mask[1];
        header[offset - 2] = mask[2];
        header[offset - 1] = mask[3];

        Mask(data, mask);
    }

    // all done return the header and data
    return [header, data];

}

function ViewToBuffer(view: ArrayBufferView) {
    const buf = Buffer.from(view.buffer as ArrayBuffer);

    if (view.byteLength !== view.buffer.byteLength) {
        return buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }

    return buf;
}

function Mask(data: Buffer, mask: Buffer) {

    const length = data.length;
    let i: number;
    for (i = 0; i < length; ++i) {
        data[i] ^= mask[i & 3];
    }

}