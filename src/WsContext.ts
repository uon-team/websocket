import { EventSource } from "@uon/core";
import { createHash } from "crypto";
import { Socket } from "net";
import { WsReceiver } from "./WsReceiver";
import { WsSender, WsSendOptions } from "./WsSender";


const EMPTY_BUFFER = Buffer.alloc(0);
const EMPTY_OBJECT = {};
const DEFAULT_MAX_PAYLOAD = 2 * 1024 * 1024;

export enum WsContextState {
    Connecting,
    Open,
    Closing,
    Closed
}

export interface WsContextOptions {
    /**
     * The maximum payload size per message (in bytes).
     * defaults to 2mb
     */
    maxPayload?: number;
};



export class WsContext extends EventSource {

    private _id: string;
    private _socket: Socket;

    private _receiver: WsReceiver;
    private _sender: WsSender;

    protected _state: WsContextState = WsContextState.Connecting;

    protected _maxPayload: number;

    constructor(options: WsContextOptions = EMPTY_OBJECT) {

        super();

        // create an id
        this._id = createHash('sha1')
            .update(`${Date.now()} - ${process.pid} - ${Math.random()}`, 'ascii')
            .digest('base64');

        this._maxPayload = options.maxPayload || DEFAULT_MAX_PAYLOAD;

    }

    /**
     * A unique id for this object
     */
    get id() {
        return this._id;
    }

    /**
     * On receive message
     */
    on(type: 'message', callback: (data: Buffer) => any, priority?: number): void;

    /**
     * On connection error
     */
    on(type: 'error', callback: (err: Error) => any, priority?: number): void;

    /**
     * On connection close
     */
    on(type: 'close', callback: (code: number, reason: string) => any, priority?: number): void;

    /**
     * On connection open
     */
    on(type: 'open', callback: (ws: WsContext) => any, priority?: number): void;


    /**
     * Adds an event listener
     * @param type 
     * @param callback 
     */
    on(type: string, callback: (...args: any[]) => any, priority: number = 100) {
        return super.on(type, callback, priority);
    }


    /**
     * Close the connection
     * @param code 
     * @param data 
     */
    async close(code: number = 1000, data?: string) {

        await this._sender.close(code, data);

        this._socket.destroy();

    }


    /**
     * Sends a message 
     * @param data 
     * @param options 
     */
    async send(data: ArrayBuffer | Buffer | string, options: WsSendOptions = EMPTY_OBJECT) {


        if (this._state !== WsContextState.Open) {
            const err = new Error(
                `WebSocket is not open: state ${this._state} `
            );
            throw err;
        }

        const opts = Object.assign({
            binary: typeof data !== 'string',
            compress: false,
            fin: true
        }, options);

        await this._sender.send(data || EMPTY_BUFFER, opts);

    }


    /**
     * Sends a ping
     * @param data 
     */
    ping(data?: any) {
        if (this._state !== WsContextState.Open) {
            const err = new Error(
                `WebSocket is not open: state ${this._state} `
            );
            throw err;
        }

        return this._sender.ping(data || EMPTY_BUFFER);
    }

    /**
     * Sends a pong, usually after receiving a ping
     * @param data 
     */
    pong(data?: any) {
        if (this._state !== WsContextState.Open) {
            const err = new Error(
                `WebSocket is not open: state ${this._state} `
            );
            throw err;
        }

        return this._sender.pong(data || EMPTY_BUFFER);
    }


    /**
     * The acts as the initialization
     * @param socket 
     * @param head 
     */
    protected assignSocket(socket: Socket, head: Buffer = EMPTY_BUFFER) {

        let on_data = (chunk: any) => {
            if (!this._receiver.write(chunk)) {
                this._socket.pause();
            }
        }

        let on_error = (err: Error) => {
            this._socket.removeListener('error', on_error);
            this._state = WsContextState.Closing;
            this._socket.destroy();
        };

        let on_end = () => {
            this._state = WsContextState.Closing;
            this._receiver.end();
            this._socket.end();
        }

        let on_close = () => {

            this._socket.removeListener('close', on_close);
            this._socket.removeListener('end', on_end);

            this._state = WsContextState.Closing;

            this._socket.read();
            this._receiver.end();

            this._socket.removeListener('data', on_data);

            this.emit("close", this);

        }

        let receiver = this._receiver = new WsReceiver('nodebuffer', this._maxPayload);
        receiver.on('conclude', (code, reason) => {

            this._socket.removeListener('data', on_data);
            this._socket.resume();
            this.close();

        });

        receiver.on('drain', () => {
            this._socket.resume();
        });

        receiver.on('error', (err) => {

            this._socket.removeListener('data', on_data);

            this._state = WsContextState.Closing;

            this.emit('error', err);
            this._socket.destroy();
        });

        receiver.on('message', (data) => {
            this.emit('message', data);
        });

        receiver.on('ping', (data) => {

            this.pong(data);
            this.emit('ping', data);
        });

        receiver.on('pong', (data) => {
            this.emit('pong', data);
        });


        this._socket = socket;
        socket.on('close', on_close);
        socket.on('end', on_end);
        socket.on('error', on_error);
        socket.on('data', on_data);

        let sender = this._sender = new WsSender(socket);

        // maybe some initial data to push
        if (head.length > 0) {
            socket.unshift(head);
        }

        // set state to opened
        this._state = WsContextState.Open;

        // emit a connection event on next tick
        process.nextTick(() => {
            this.emit('open', this);
        });
        

    }




}

